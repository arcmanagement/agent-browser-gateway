import Foundation
import SwiftUI

@MainActor
final class CompanionModel: ObservableObject {
    enum Phase: Equatable {
        case unpaired
        case claiming
        case awaitingConfirmation(displayCode: String)
        case paired
    }

    @Published private(set) var phase: Phase = .unpaired
    @Published private(set) var gateway: PairedGateway?
    @Published private(set) var pending: [ApprovalSummary] = []
    @Published private(set) var connected = false
    @Published var errorMessage: String?
    @Published private(set) var lastOutcome: String?

    private let store: PairingStore
    private let client: GatewayClient
    private var pairingTask: Task<Void, Never>?

    init(store: PairingStore = PairingStore(), client: GatewayClient? = nil) {
        self.store = store
        self.client = client ?? GatewayClient(store: store)
        #if DEBUG
        if ScreenshotMode.isEnabled {
            gateway = ScreenshotMode.gateway
            pending = ScreenshotMode.approvals
            connected = true
            phase = .paired
            return
        }
        #endif
        if let saved = store.loadGateway() {
            gateway = saved
            phase = .paired
        }
    }

    // MARK: - Pairing

    func pair(with offer: PairingOfferPayload, deviceLabel: String) {
        pairingTask?.cancel()
        errorMessage = nil
        phase = .claiming
        pairingTask = Task { [weak self] in
            guard let self else { return }
            do {
                let deviceId = try await self.client.claim(offer: offer, deviceLabel: deviceLabel)
                self.phase = .awaitingConfirmation(displayCode: offer.displayCode)
                let token = try await self.client.awaitConfirmation(offer: offer, deviceId: deviceId)
                let paired = PairedGateway(
                    deviceId: deviceId,
                    gatewayBaseUrl: offer.gatewayBaseUrl,
                    gatewayLabel: URL(string: offer.gatewayBaseUrl)?.host ?? offer.gatewayBaseUrl,
                    pairedAt: Date()
                )
                self.store.saveGateway(paired, sessionToken: token)
                self.gateway = paired
                self.phase = .paired
                self.connect()
            } catch is CancellationError {
                self.phase = .unpaired
            } catch {
                self.errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
                self.phase = .unpaired
            }
        }
    }

    func cancelPairing() {
        pairingTask?.cancel()
        pairingTask = nil
        phase = gateway == nil ? .unpaired : .paired
    }

    func unpair() {
        Task { await client.disconnect() }
        store.clearPairing()
        gateway = nil
        pending = []
        connected = false
        phase = .unpaired
    }

    // MARK: - Session

    func connect() {
        guard let gateway else { return }
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.client.connect(gateway) { [weak self] event in
                    Task { @MainActor in self?.apply(event) }
                } onClose: { [weak self] reason in
                    Task { @MainActor in
                        self?.connected = false
                        if reason != nil {
                            self?.errorMessage = "The connection to your Gateway ended. Reopen this app to reconnect. Pair again only if this device was revoked on the desktop."
                        }
                    }
                }
                self.connected = true
                self.errorMessage = nil
            } catch {
                self.connected = false
                self.errorMessage = (error as? LocalizedError)?.errorDescription ?? error.localizedDescription
            }
        }
    }

    func disconnect() {
        Task { await client.disconnect() }
        connected = false
    }

    func decide(_ approval: ApprovalSummary, decision: String) {
        Task { [weak self] in
            guard let self else { return }
            do {
                try await self.client.decide(approvalId: approval.approvalId, decision: decision)
            } catch {
                self.errorMessage = "Could not send the decision. Check the connection to your Gateway."
            }
        }
    }

    /// Drops approvals whose desktop window has already timed out.
    func pruneExpired(now: Date = Date()) {
        pending.removeAll { $0.isExpired(at: now) }
    }

    private func apply(_ event: CompanionEvent) {
        switch event {
        case .pending(let summary):
            guard !summary.isExpired() else { return }
            if !pending.contains(where: { $0.approvalId == summary.approvalId }) {
                pending.append(summary)
            }
        case .resolved(let approvalId, let decision, let decidedBy):
            pending.removeAll { $0.approvalId == approvalId }
            let source = decidedBy.hasPrefix("companion:") ? "this phone" : decidedBy == "timeout" ? "timing out" : "the desktop"
            lastOutcome = "Request \(decision == "allow" ? "allowed" : "denied") by \(source)."
        case .decisionResult(let approvalId, let ok, let error):
            if !ok {
                pending.removeAll { $0.approvalId == approvalId }
                errorMessage = Self.message(forDecisionError: error)
            }
        }
    }

    static func message(forDecisionError error: String?) -> String {
        switch error {
        case "approval_expired":
            return "That request expired before the decision arrived."
        case "approval_already_decided":
            return "That request was already decided somewhere else."
        case "requires_desktop_gesture":
            return "Recording must be allowed on the desktop: the capture permission is tied to that window."
        default:
            return "The Gateway could not apply that decision."
        }
    }
}
