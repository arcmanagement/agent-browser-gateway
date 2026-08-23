import CryptoKit
import Foundation

/// Talks to the user's own desktop Gateway on their private network: claims a
/// pairing offer, polls for the desktop confirmation, and holds the companion
/// WebSocket session that carries approval summaries and decisions.
actor GatewayClient {
    private let store: PairingStore
    private let session: URLSession
    private var socket: URLSessionWebSocketTask?
    private var receiveTask: Task<Void, Never>?

    init(store: PairingStore, session: URLSession = .shared) {
        self.store = store
        self.session = session
    }

    // MARK: - Pairing

    func claim(offer: PairingOfferPayload, deviceLabel: String) async throws -> String {
        guard Date() < offer.expiresAt else { throw PairingClientError.offerExpired }
        guard let url = URL(string: "\(offer.gatewayBaseUrl)/pairings/\(offer.pairingId)/claim") else {
            throw PairingClientError.malformedOffer
        }
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.timeoutInterval = 15
        let body: [String: Any] = [
            "pairingId": offer.pairingId,
            "pairingNonce": offer.pairingNonce,
            "devicePublicKey": store.devicePublicKeyBase64,
            "deviceLabel": deviceLabel,
            "requestedScopes": ["approval_forwarding", "pairing_status", "tab_sharing"],
        ]
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, _) = try await send(request)
        let response = try JSONDecoder().decode(ClaimResponse.self, from: data)
        guard response.ok, let deviceId = response.deviceId else {
            throw PairingClientError.claimRejected(response.error ?? "claim_failed")
        }
        return deviceId
    }

    /// Polls the pairing status until the desktop user confirms the display code.
    /// Returns the session token, opened from the sealed payload.
    func awaitConfirmation(offer: PairingOfferPayload, deviceId: String) async throws -> String {
        guard let url = URL(string: "\(offer.gatewayBaseUrl)/pairings/\(offer.pairingId)/status") else {
            throw PairingClientError.malformedOffer
        }
        let decoder = JSONDecoder()
        while Date() < offer.expiresAt.addingTimeInterval(30) {
            try Task.checkCancellation()
            var request = URLRequest(url: url)
            request.timeoutInterval = 10
            if let (data, _) = try? await send(request),
               let status = try? decoder.decode(PairingStatusResponse.self, from: data) {
                switch status.state {
                case "paired":
                    guard let sealed = status.session else {
                        // The desktop already handed the token to someone; a fresh
                        // offer is the only safe recovery.
                        throw PairingClientError.sessionUnavailable
                    }
                    return try SessionSealing.open(sealed, privateKey: store.devicePrivateKey())
                case "revoked":
                    throw PairingClientError.claimRejected("pairing_revoked")
                case "unknown":
                    throw PairingClientError.offerExpired
                default:
                    break
                }
            }
            try await Task.sleep(nanoseconds: 1_500_000_000)
        }
        throw PairingClientError.offerExpired
    }

    // MARK: - Companion session

    func connect(_ gateway: PairedGateway, onEvent: @escaping @Sendable (CompanionEvent) -> Void, onClose: @escaping @Sendable (String?) -> Void) throws {
        guard let token = store.sessionToken() else { throw PairingClientError.notPaired }
        let wsBase = gateway.gatewayBaseUrl
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
        guard let url = URL(string: "\(wsBase)/companion") else { throw PairingClientError.notPaired }
        var request = URLRequest(url: url)
        request.setValue(gateway.deviceId, forHTTPHeaderField: "x-abg-device-id")
        request.setValue(token, forHTTPHeaderField: "x-abg-session-token")
        let task = session.webSocketTask(with: request)
        socket = task
        task.resume()
        receiveTask?.cancel()
        receiveTask = Task { [weak self] in
            await self?.receiveLoop(task: task, onEvent: onEvent, onClose: onClose)
        }
    }

    func disconnect() {
        receiveTask?.cancel()
        receiveTask = nil
        socket?.cancel(with: .goingAway, reason: nil)
        socket = nil
    }

    func decide(approvalId: String, decision: String, nativeResult: NativeResult? = nil) async throws {
        guard let socket else { throw PairingClientError.notPaired }
        var payload: [String: Any] = ["type": "decision", "approvalId": approvalId, "decision": decision]
        if let nativeResult {
            var result: [String: Any] = ["ok": nativeResult.ok]
            if let url = nativeResult.url { result["url"] = url }
            if let error = nativeResult.error { result["error"] = error }
            payload["nativeResult"] = result
        }
        let data = try JSONSerialization.data(withJSONObject: payload)
        guard let text = String(data: data, encoding: .utf8) else { return }
        try await socket.send(.string(text))
    }

    private func receiveLoop(task: URLSessionWebSocketTask, onEvent: @escaping @Sendable (CompanionEvent) -> Void, onClose: @escaping @Sendable (String?) -> Void) async {
        while !Task.isCancelled {
            do {
                let message = try await task.receive()
                switch message {
                case .string(let text):
                    if let event = CompanionEvent.decode(text) { onEvent(event) }
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8), let event = CompanionEvent.decode(text) {
                        onEvent(event)
                    }
                @unknown default:
                    break
                }
            } catch {
                guard !Task.isCancelled else { return }
                // A revoked pairing closes the socket from the desktop side; the
                // UI treats an unexpected close as "reconnect or re-pair".
                onClose(error.localizedDescription)
                return
            }
        }
    }

    private func send(_ request: URLRequest) async throws -> (Data, URLResponse) {
        do {
            return try await session.data(for: request)
        } catch {
            throw PairingClientError.transport(
                "Could not reach the Gateway at \(request.url?.host ?? "the desktop"). Check that both devices are on the same private network."
            )
        }
    }
}
