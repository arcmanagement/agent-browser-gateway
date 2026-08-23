import Foundation
import GatewayCore
import Vapor

// Companion pairing per docs/IOS_GATEWAY_PAIRING.md. The desktop-facing surface
// (create offer, confirm, list, revoke) is reached only through the local CLI
// transport; the network listener serves nothing but the companion's claim and
// runs only while an offer is active, bound to a private (Tailnet or LAN)
// address the user's own devices can reach.

actor PairingManager {
    private var engine: PairingEngine
    private let auditLog: AuditLog
    private let grantsURL: URL
    private var listenerApp: Application?
    private var listenerAddress: String?
    private var expiryTask: Task<Void, Never>?
    /// Plain session tokens awaiting one-time sealed delivery via the status
    /// endpoint. Never persisted.
    private var pendingSessionTokens: [String: String] = [:]
    /// Connected companion sessions by deviceId.
    private var companionSockets: [String: [WebSocket]] = [:]
    /// Authenticated Safari Web Extension sessions by Gateway extension ID.
    private var browserSockets: [String: WebSocket] = [:]
    private var browserExtensionIdBySocket: [ObjectIdentifier: String] = [:]
    /// Approvals currently forwarded to companions. First decision wins; the
    /// extension's own pending registry is the final authority.
    private var forwardedApprovals: [String: ForwardedApproval] = [:]
    /// Set by the Coordinator: injects a companion decision into the extension.
    var decideHandler: (@Sendable (_ extensionId: String, _ approvalId: String, _ decision: String, _ decidedBy: String) async -> (applied: Bool, reason: String?))?
    var browserMessageHandler: (@Sendable (_ message: ExtensionMessage, _ extensionId: String) async -> Void)?
    var browserDisconnectHandler: (@Sendable (_ extensionId: String) async -> Void)?

    struct ForwardedApproval {
        let summary: CompanionApprovalSummary
        let extensionId: String
        var resolved: Bool
    }

    func setDecideHandler(_ handler: @escaping @Sendable (_ extensionId: String, _ approvalId: String, _ decision: String, _ decidedBy: String) async -> (applied: Bool, reason: String?)) {
        decideHandler = handler
    }

    func setBrowserHandlers(
        onMessage: @escaping @Sendable (_ message: ExtensionMessage, _ extensionId: String) async -> Void,
        onDisconnect: @escaping @Sendable (_ extensionId: String) async -> Void
    ) {
        browserMessageHandler = onMessage
        browserDisconnectHandler = onDisconnect
    }

    /// The port for the on-demand pairing listener. Distinct from the loopback
    /// gateway port so the loopback-only invariant of the main listener holds.
    static let pairingPort = 8767

    init(auditLog: AuditLog) {
        self.auditLog = auditLog
        self.grantsURL = ABGConstants.supportDir.appendingPathComponent("companions.json")
        self.engine = PairingEngine(grants: CompanionGrantStore.load(from: grantsURL))
    }

    // MARK: - Desktop-facing operations (local CLI transport only)

    func createOffer() async -> Result<PairingOfferPayload, PairingError> {
        guard let address = Self.privateInterfaceAddress() else {
            await auditLog.log(action: "pairing_failed", agent: "cli", details: [
                "stage": AnyCodable("offer_create"),
                "reason": AnyCodable("network_not_private"),
                "ok": AnyCodable(false),
            ])
            return .failure(PairingError(.desktopRejected))
        }
        let offer = engine.createOffer()
        let baseUrl = "http://\(address):\(Self.pairingPort)"
        await startListener(on: address)
        scheduleExpiry(at: offer.expiresAt)
        await auditLog.log(action: "pairing_offer_created", agent: "cli", details: [
            "pairingIdHash": AnyCodable(PairingAudit.hashed(offer.pairingId)),
            "method": AnyCodable("qr_or_manual"),
            "requestedScopes": AnyCodable(offer.requestedScopes.map(\.rawValue)),
            "expiresAt": AnyCodable(ISO8601DateFormatter().string(from: offer.expiresAt)),
            "networkMode": AnyCodable(Self.isTailnetAddress(address) ? "tailnet" : "lan"),
            "ok": AnyCodable(true),
        ])
        guard let payload = engine.offerPayload(gatewayBaseUrl: baseUrl) else {
            return .failure(PairingError(.offerNotFound))
        }
        return .success(payload)
    }

    func confirm(pairingId: String) async -> Result<CompanionGrant, PairingError> {
        do {
            let (grant, sessionToken, _) = try engine.confirm(pairingId: pairingId)
            pendingSessionTokens[grant.deviceId] = sessionToken
            persistGrants()
            await stopListenerIfIdle()
            await auditLog.log(action: "pairing_confirmed", agent: "cli", details: [
                "pairingIdHash": AnyCodable(PairingAudit.hashed(pairingId)),
                "deviceIdHash": AnyCodable(PairingAudit.hashed(grant.deviceId)),
                "grantedScopes": AnyCodable(grant.scopes.map(\.rawValue)),
                "confirmedBy": AnyCodable("desktop_user"),
                "ok": AnyCodable(true),
            ])
            return .success(grant)
        } catch let error as PairingError {
            await logFailure(stage: "confirm", reason: error.reason, pairingId: pairingId)
            return .failure(error)
        } catch {
            return .failure(PairingError(.desktopRejected))
        }
    }

    func reject(pairingId: String) async {
        try? engine.reject(pairingId: pairingId)
        await stopListenerIfIdle()
        await logFailure(stage: "confirm", reason: .desktopRejected, pairingId: pairingId)
    }

    func listGrants() -> [CompanionGrant] {
        engine.grants
    }

    /// Pending claim summary for the desktop confirmation screen.
    func pendingClaim() -> (pairingId: String, displayCode: String, deviceLabel: String)? {
        guard let offer = engine.activeOffer, let claim = offer.claim else { return nil }
        return (offer.pairingId, offer.displayCode, claim.deviceLabel)
    }

    func revoke(deviceId: String, by: String) async -> CompanionGrant? {
        guard let grant = engine.revoke(deviceId: deviceId, by: by) else { return nil }
        persistGrants()
        let closed = await closeSessions(deviceId: deviceId)
        await stopListenerIfIdle()
        await auditLog.log(action: "pairing_revoked", agent: by, details: [
            "deviceIdHash": AnyCodable(PairingAudit.hashed(deviceId)),
            "revokedScopes": AnyCodable(grant.scopes.map(\.rawValue)),
            "revokedBy": AnyCodable(by),
            "activeSessionsClosed": AnyCodable(closed),
            "ok": AnyCodable(true),
        ])
        return grant
    }

    func activeGrant(deviceId: String) -> CompanionGrant? {
        engine.activeGrant(deviceId: deviceId)
    }

    func verifySession(deviceId: String, sessionToken: String) -> CompanionGrant? {
        guard engine.verifySession(deviceId: deviceId, sessionToken: sessionToken) else { return nil }
        return engine.activeGrant(deviceId: deviceId)
    }

    /// Status payload for the companion. Delivers the sealed session token
    /// exactly once after the desktop confirmation.
    func statusPayload(pairingId: String) -> PairingStatusResponse {
        switch engine.status(pairingId: pairingId) {
        case .offerActive:
            return PairingStatusResponse(state: "offer_active", deviceId: nil, session: nil)
        case .claimed:
            return PairingStatusResponse(state: "claimed", deviceId: nil, session: nil)
        case .paired(let deviceId):
            var session: PairingCrypto.Sealed?
            if let token = pendingSessionTokens.removeValue(forKey: deviceId),
               let grant = engine.activeGrant(deviceId: deviceId),
               let sealed = try? PairingCrypto.seal(token, toDevicePublicKeyBase64: grant.devicePublicKeyBase64) {
                engine.markSessionTokenDelivered(deviceId: deviceId)
                persistGrants()
                session = sealed
            }
            return PairingStatusResponse(state: "paired", deviceId: deviceId, session: session)
        case .revoked:
            return PairingStatusResponse(state: "revoked", deviceId: nil, session: nil)
        case .unknown:
            return PairingStatusResponse(state: "unknown", deviceId: nil, session: nil)
        }
    }

    /// The listener also serves paired companions, so it must run while grants
    /// exist, not only during an active offer.
    private func listenerShouldServe() -> Bool {
        engine.listenerShouldRun() || engine.grants.contains(where: { $0.isActive })
    }

    /// Starts the companion listener at gateway startup when grants exist.
    func startIfNeeded() async {
        guard listenerShouldServe(), let address = Self.privateInterfaceAddress() else { return }
        await startListener(on: address)
    }

    // MARK: - Companion-facing claim (network listener)

    private func handleClaim(_ body: ClaimRequest) async -> ClaimResponse {
        do {
            let claim = try engine.applyClaim(
                pairingId: body.pairingId,
                nonce: body.pairingNonce,
                devicePublicKeyBase64: body.devicePublicKey,
                deviceLabel: body.deviceLabel,
                requestedScopes: body.requestedScopes.compactMap(PairingScope.init(rawValue:))
            )
            await auditLog.log(action: "pairing_claimed", agent: "companion", details: [
                "pairingIdHash": AnyCodable(PairingAudit.hashed(body.pairingId)),
                "deviceIdHash": AnyCodable(PairingAudit.hashed(claim.deviceId)),
                "deviceLabel": AnyCodable(claim.deviceLabel),
                "requestedScopes": AnyCodable(claim.requestedScopes.map(\.rawValue)),
                "ok": AnyCodable(true),
            ])
            return ClaimResponse(
                ok: true,
                deviceId: claim.deviceId,
                state: "claimed",
                error: nil,
                message: "Confirm the display code on the desktop to finish pairing."
            )
        } catch let error as PairingError {
            await logFailure(stage: "claim", reason: error.reason, pairingId: body.pairingId)
            return ClaimResponse(ok: false, deviceId: nil, state: nil, error: error.reason.rawValue, message: nil)
        } catch {
            return ClaimResponse(ok: false, deviceId: nil, state: nil, error: "claim_failed", message: nil)
        }
    }

    // MARK: - Approval forwarding

    func forwardApprovalPending(_ summary: CompanionApprovalSummary, extensionId: String) async {
        forwardedApprovals[summary.approvalId] = ForwardedApproval(summary: summary, extensionId: extensionId, resolved: false)
        guard !companionSockets.isEmpty else { return }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        guard let data = try? encoder.encode(CompanionEvent.pending(summary)),
              let text = String(data: data, encoding: .utf8) else { return }
        await broadcast(text)
    }

    func forwardApprovalResolved(approvalId: String, decision: String, decidedBy: String) async {
        if var entry = forwardedApprovals[approvalId] {
            entry.resolved = true
            forwardedApprovals[approvalId] = entry
        }
        guard !companionSockets.isEmpty else { return }
        let encoder = JSONEncoder()
        guard let data = try? encoder.encode(CompanionEvent.resolved(approvalId: approvalId, decision: decision, decidedBy: decidedBy)),
              let text = String(data: data, encoding: .utf8) else { return }
        await broadcast(text)
    }

    private func broadcast(_ text: String) async {
        for sockets in companionSockets.values {
            for socket in sockets {
                try? await socket.send(text)
            }
        }
    }

    private func handleCompanionText(deviceId: String, ws: WebSocket, text: String) async {
        guard companionSockets[deviceId]?.contains(where: { $0 === ws }) == true else { return }
        guard let data = text.data(using: .utf8),
              let message = try? JSONDecoder().decode(CompanionDecision.self, from: data),
              message.type == "decision" else { return }
        let reply: CompanionDecisionResult
        if message.decision != "allow" && message.decision != "deny" {
            reply = CompanionDecisionResult(approvalId: message.approvalId, ok: false, error: "bad_decision")
        } else if let entry = forwardedApprovals[message.approvalId], !entry.resolved {
            if Date() >= entry.summary.expiresAt {
                reply = CompanionDecisionResult(approvalId: message.approvalId, ok: false, error: "approval_expired")
            } else if message.decision == "allow" && !entry.summary.canAllow {
                reply = CompanionDecisionResult(approvalId: message.approvalId, ok: false, error: "requires_desktop_gesture")
            } else if let decide = decideHandler {
                let decidedBy = "companion:\(PairingAudit.hashed(deviceId))"
                let outcome = await decide(entry.extensionId, message.approvalId, message.decision, decidedBy)
                if outcome.applied {
                    await auditLog.log(action: "approval_decided_by_companion", agent: decidedBy, details: [
                        "approvalId": AnyCodable(message.approvalId),
                        "decision": AnyCodable(message.decision),
                        "deviceIdHash": AnyCodable(PairingAudit.hashed(deviceId)),
                        "ok": AnyCodable(true),
                    ])
                }
                reply = CompanionDecisionResult(
                    approvalId: message.approvalId,
                    ok: outcome.applied,
                    error: outcome.applied ? nil : (outcome.reason ?? "approval_already_decided")
                )
            } else {
                reply = CompanionDecisionResult(approvalId: message.approvalId, ok: false, error: "gateway_unavailable")
            }
        } else {
            reply = CompanionDecisionResult(approvalId: message.approvalId, ok: false, error: "approval_already_decided")
        }
        let encoder = JSONEncoder()
        if let data = try? encoder.encode(reply), let text = String(data: data, encoding: .utf8) {
            try? await ws.send(text)
        }
    }

    private func registerCompanion(deviceId: String, ws: WebSocket) {
        companionSockets[deviceId, default: []].append(ws)
    }

    private func unregisterCompanion(deviceId: String, ws: WebSocket) {
        companionSockets[deviceId]?.removeAll { $0 === ws }
        if companionSockets[deviceId]?.isEmpty == true {
            companionSockets.removeValue(forKey: deviceId)
        }
    }

    private func closeSessions(deviceId: String) async -> Int {
        let sockets = companionSockets.removeValue(forKey: deviceId) ?? []
        for socket in sockets {
            // Hop to the socket's own event loop: WebSocketKit close is loop-bound.
            socket.eventLoop.execute {
                _ = socket.close(code: .normalClosure)
            }
        }
        let extensionId = Self.safariExtensionId(deviceId: deviceId)
        if let socket = browserSockets.removeValue(forKey: extensionId) {
            browserExtensionIdBySocket.removeValue(forKey: ObjectIdentifier(socket))
            socket.eventLoop.execute {
                _ = socket.close(code: .normalClosure)
            }
            if let browserDisconnectHandler {
                await browserDisconnectHandler(extensionId)
            }
            return sockets.count + 1
        }
        return sockets.count
    }

    // MARK: - Safari tab sharing

    static func safariExtensionId(deviceId: String) -> String {
        "safari-ios:\(deviceId)"
    }

    func sendBrowserCommand(to extensionId: String, command: GatewayCommand) async throws {
        guard let socket = browserSockets[extensionId] else {
            throw NSError(
                domain: "ABG.Pairing",
                code: 4,
                userInfo: [NSLocalizedDescriptionKey: "Safari extension \(extensionId) not connected"]
            )
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(command)
        guard let text = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "ABG.Pairing", code: 5, userInfo: [NSLocalizedDescriptionKey: "encode failed"])
        }
        try await socket.send(text)
    }

    private func handleBrowserText(ws: WebSocket, text: String) async {
        let socketId = ObjectIdentifier(ws)
        if let extensionId = browserExtensionIdBySocket[socketId] {
            let decoder = JSONDecoder()
            decoder.dateDecodingStrategy = .iso8601
            guard let data = text.data(using: .utf8),
                  let message = try? decoder.decode(ExtensionMessage.self, from: data) else { return }
            if case .hello(let claimedExtensionId, _, _, _) = message,
               claimedExtensionId != extensionId {
                try? await ws.close(code: .policyViolation)
                return
            }
            if let browserMessageHandler {
                await browserMessageHandler(message, extensionId)
            }
            return
        }

        guard let data = text.data(using: .utf8),
              let auth = try? JSONDecoder().decode(BrowserSessionAuth.self, from: data),
              auth.type == "authenticate",
              let grant = verifySession(deviceId: auth.deviceId, sessionToken: auth.sessionToken) else {
            await sendBrowserAuthResult(ws: ws, ok: false, extensionId: nil, error: "session_invalid")
            try? await ws.close(code: .policyViolation)
            return
        }
        guard grant.hasScope(.tabSharing) else {
            await sendBrowserAuthResult(ws: ws, ok: false, extensionId: nil, error: "scope_missing")
            try? await ws.close(code: .policyViolation)
            return
        }

        let extensionId = Self.safariExtensionId(deviceId: auth.deviceId)
        if let previous = browserSockets.updateValue(ws, forKey: extensionId), previous !== ws {
            browserExtensionIdBySocket.removeValue(forKey: ObjectIdentifier(previous))
            try? await previous.close(code: .normalClosure)
        }
        browserExtensionIdBySocket[socketId] = extensionId
        await sendBrowserAuthResult(ws: ws, ok: true, extensionId: extensionId, error: nil)
        await auditLog.log(action: "safari_extension_authenticated", extensionId: extensionId, agent: "safari_extension", details: [
            "deviceIdHash": AnyCodable(PairingAudit.hashed(auth.deviceId)),
            "ok": AnyCodable(true),
        ])
    }

    private func sendBrowserAuthResult(ws: WebSocket, ok: Bool, extensionId: String?, error: String?) async {
        let result = BrowserSessionAuthResult(ok: ok, extensionId: extensionId, error: error)
        guard let data = try? JSONEncoder().encode(result),
              let text = String(data: data, encoding: .utf8) else { return }
        try? await ws.send(text)
    }

    private func unregisterBrowser(ws: WebSocket) async {
        let socketId = ObjectIdentifier(ws)
        guard let extensionId = browserExtensionIdBySocket.removeValue(forKey: socketId) else { return }
        if browserSockets[extensionId] === ws {
            browserSockets.removeValue(forKey: extensionId)
            if let browserDisconnectHandler {
                await browserDisconnectHandler(extensionId)
            }
        }
    }

    // MARK: - Listener lifecycle

    private func startListener(on address: String) async {
        if listenerApp != nil, listenerAddress == address { return }
        await shutdownListener()
        do {
            let env = try Environment.detect(arguments: ["abg-pairing"])
            let app = try await Application.make(env)
            app.http.server.configuration.hostname = address
            app.http.server.configuration.port = Self.pairingPort
            app.logger.logLevel = .warning
            app.post("pairings", ":pairingId", "claim") { [weak self] req async throws -> Response in
                guard let self else { throw Abort(.serviceUnavailable) }
                var body = try req.content.decode(ClaimRequest.self)
                if body.pairingId.isEmpty {
                    body.pairingId = req.parameters.get("pairingId") ?? ""
                }
                let result = await self.claimFromListener(body)
                let response = Response(status: result.ok ? .ok : .forbidden)
                try response.content.encode(result, as: .json)
                return response
            }
            app.get("pairings", ":pairingId", "status") { [weak self] req async throws -> Response in
                guard let self else { throw Abort(.serviceUnavailable) }
                let pairingId = req.parameters.get("pairingId") ?? ""
                let payload = await self.statusFromListener(pairingId: pairingId)
                let response = Response(status: .ok)
                try response.content.encode(payload, as: .json)
                return response
            }
            app.webSocket("companion") { [weak self] req, ws in
                // Handler registration must happen synchronously on the socket's
                // event loop; authorization runs on the actor afterwards, and the
                // actor ignores messages from sockets it has not registered.
                let manager = self
                let deviceId = req.headers.first(name: "x-abg-device-id") ?? ""
                let token = req.headers.first(name: "x-abg-session-token") ?? ""
                ws.onText { ws, text in
                    Task { await manager?.handleCompanionText(deviceId: deviceId, ws: ws, text: text) }
                }
                _ = ws.onClose.always { _ in
                    Task { await manager?.unregisterCompanion(deviceId: deviceId, ws: ws) }
                }
                Task {
                    guard let manager,
                          let grant = await manager.verifySession(deviceId: deviceId, sessionToken: token),
                          grant.hasScope(.approvalForwarding) else {
                        try? await ws.close(code: .policyViolation)
                        return
                    }
                    await manager.registerCompanionAuthorized(deviceId: deviceId, ws: ws)
                }
            }
            app.webSocket("browser", maxFrameSize: .init(integerLiteral: 32 * 1024 * 1024)) { [weak self] _, ws in
                let manager = self
                ws.onText { ws, text in
                    Task { await manager?.handleBrowserText(ws: ws, text: text) }
                }
                _ = ws.onClose.always { _ in
                    Task { await manager?.unregisterBrowser(ws: ws) }
                }
            }
            try await app.server.start()
            listenerApp = app
            listenerAddress = address
        } catch {
            listenerApp = nil
            listenerAddress = nil
            await auditLog.log(action: "pairing_failed", agent: "cli", details: [
                "stage": AnyCodable("listener_start"),
                "reason": AnyCodable("listener_bind_failed"),
                "ok": AnyCodable(false),
            ])
        }
    }

    private func claimFromListener(_ body: ClaimRequest) async -> ClaimResponse {
        await handleClaim(body)
    }

    private func statusFromListener(pairingId: String) async -> PairingStatusResponse {
        statusPayload(pairingId: pairingId)
    }

    private func registerCompanionAuthorized(deviceId: String, ws: WebSocket) {
        registerCompanion(deviceId: deviceId, ws: ws)
    }

    private func stopListenerIfIdle() async {
        if !listenerShouldServe() {
            await shutdownListener()
        }
    }

    private func shutdownListener() async {
        expiryTask?.cancel()
        expiryTask = nil
        guard let app = listenerApp else { return }
        listenerApp = nil
        listenerAddress = nil
        await app.server.shutdown()
        try? await app.asyncShutdown()
    }

    private func scheduleExpiry(at date: Date) {
        expiryTask?.cancel()
        expiryTask = Task { [weak self] in
            let interval = date.timeIntervalSinceNow
            if interval > 0 {
                try? await Task.sleep(nanoseconds: UInt64(interval * 1_000_000_000))
            }
            guard !Task.isCancelled else { return }
            await self?.expireNow()
        }
    }

    private func expireNow() async {
        engine.expireActiveOffer()
        await stopListenerIfIdle()
    }

    private func persistGrants() {
        try? CompanionGrantStore.save(engine.grants, to: grantsURL)
    }

    private func logFailure(stage: String, reason: PairingFailureReason, pairingId: String?) async {
        var details: [String: AnyCodable] = [
            "stage": AnyCodable(stage),
            "reason": AnyCodable(reason.rawValue),
            "ok": AnyCodable(false),
        ]
        if let pairingId, !pairingId.isEmpty {
            details["pairingIdHash"] = AnyCodable(PairingAudit.hashed(pairingId))
        }
        await auditLog.log(action: "pairing_failed", agent: "companion", details: details)
    }

    // MARK: - Address selection

    /// Prefers a Tailnet (CGNAT 100.64/10) interface, then a private LAN address.
    /// Public addresses are never used: pairing stays on the user's own network.
    static func privateInterfaceAddress() -> String? {
        var candidates: [String] = []
        var ifaddr: UnsafeMutablePointer<ifaddrs>?
        guard getifaddrs(&ifaddr) == 0, let first = ifaddr else { return nil }
        defer { freeifaddrs(ifaddr) }
        var pointer: UnsafeMutablePointer<ifaddrs>? = first
        while let current = pointer {
            defer { pointer = current.pointee.ifa_next }
            guard let sa = current.pointee.ifa_addr, sa.pointee.sa_family == UInt8(AF_INET) else { continue }
            let flags = Int32(current.pointee.ifa_flags)
            guard flags & IFF_UP != 0, flags & IFF_LOOPBACK == 0 else { continue }
            var host = [CChar](repeating: 0, count: Int(NI_MAXHOST))
            guard getnameinfo(sa, socklen_t(sa.pointee.sa_len), &host, socklen_t(host.count), nil, 0, NI_NUMERICHOST) == 0 else { continue }
            candidates.append(String(cString: host))
        }
        if let tailnet = candidates.first(where: isTailnetAddress) { return tailnet }
        return candidates.first(where: isPrivateLANAddress)
    }

    static func isTailnetAddress(_ address: String) -> Bool {
        let parts = address.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        return parts[0] == 100 && (64...127).contains(parts[1])
    }

    static func isPrivateLANAddress(_ address: String) -> Bool {
        let parts = address.split(separator: ".").compactMap { Int($0) }
        guard parts.count == 4 else { return false }
        if parts[0] == 10 { return true }
        if parts[0] == 172, (16...31).contains(parts[1]) { return true }
        if parts[0] == 192, parts[1] == 168 { return true }
        return false
    }
}

struct ClaimRequest: Content {
    var pairingId: String
    let pairingNonce: String
    let devicePublicKey: String
    let deviceLabel: String
    let requestedScopes: [String]
}

enum CompanionEvent: Encodable {
    case pending(CompanionApprovalSummary)
    case resolved(approvalId: String, decision: String, decidedBy: String)

    enum CodingKeys: String, CodingKey { case type, approval, approvalId, decision, decidedBy }

    func encode(to encoder: Encoder) throws {
        var container = encoder.container(keyedBy: CodingKeys.self)
        switch self {
        case .pending(let summary):
            try container.encode("approval_pending", forKey: .type)
            try container.encode(summary, forKey: .approval)
        case .resolved(let approvalId, let decision, let decidedBy):
            try container.encode("approval_resolved", forKey: .type)
            try container.encode(approvalId, forKey: .approvalId)
            try container.encode(decision, forKey: .decision)
            try container.encode(decidedBy, forKey: .decidedBy)
        }
    }
}

struct CompanionDecision: Decodable {
    let type: String
    let approvalId: String
    let decision: String
}

struct CompanionDecisionResult: Encodable {
    var type = "decision_result"
    let approvalId: String
    let ok: Bool
    let error: String?
}

struct BrowserSessionAuth: Decodable {
    let type: String
    let deviceId: String
    let sessionToken: String
}

struct BrowserSessionAuthResult: Encodable {
    var type = "auth_result"
    let ok: Bool
    let extensionId: String?
    let error: String?
}

struct PairingStatusResponse: Content {
    let state: String
    let deviceId: String?
    let session: PairingCrypto.Sealed?
}

struct ClaimResponse: Content {
    let ok: Bool
    let deviceId: String?
    let state: String?
    let error: String?
    let message: String?
}
