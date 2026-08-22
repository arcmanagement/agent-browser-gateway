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
            let grant = try engine.confirm(pairingId: pairingId)
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
        await auditLog.log(action: "pairing_revoked", agent: by, details: [
            "deviceIdHash": AnyCodable(PairingAudit.hashed(deviceId)),
            "revokedScopes": AnyCodable(grant.scopes.map(\.rawValue)),
            "revokedBy": AnyCodable(by),
            "activeSessionsClosed": AnyCodable(0),
            "ok": AnyCodable(true),
        ])
        return grant
    }

    func activeGrant(deviceId: String) -> CompanionGrant? {
        engine.activeGrant(deviceId: deviceId)
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

    private func stopListenerIfIdle() async {
        if !engine.listenerShouldRun() {
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

struct ClaimResponse: Content {
    let ok: Bool
    let deviceId: String?
    let state: String?
    let error: String?
    let message: String?
}
