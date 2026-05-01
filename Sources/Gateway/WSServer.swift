import Foundation
import Vapor
import GatewayCore

final class WSServer {
    weak var coordinator: GatewayCoordinator?
    private var app: Application?
    private var sockets: [String: WebSocket] = [:]  // extensionId -> WebSocket
    private let lock = NSLock()

    func start() async throws {
        // Retry the bind in case the previous Gateway process is still releasing the port,
        // or the user just opened a second instance and is closing the old one.
        // Schedule: 0s, 1s, 2s, 4s, 8s, 16s, 30s capped, then surface to UI.
        let backoffs: [UInt64] = [0, 1, 2, 4, 8, 16, 30]
        var lastError: Error?
        for (attempt, secs) in backoffs.enumerated() {
            if secs > 0 {
                await coordinator?.setStatus("WS bind retry in \(secs)s (attempt \(attempt + 1)/\(backoffs.count))…")
                try? await Task.sleep(nanoseconds: secs * 1_000_000_000)
            }
            do {
                try await runOnce()
                return
            } catch {
                lastError = error
                let msg = "bind failed (attempt \(attempt + 1)/\(backoffs.count)): \(error.localizedDescription)"
                print("[ABG WS] \(msg)")
                await coordinator?.setStatus(msg)
            }
        }
        if let lastError = lastError { throw lastError }
    }

    private func runOnce() async throws {
        let env = try Environment.detect(arguments: ["abg-gateway"])
        let app = try await Application.make(env)
        self.app = app
        app.http.server.configuration.hostname = ABGConstants.wsHost
        app.http.server.configuration.port = ABGConstants.wsPort
        app.logger.logLevel = .warning

        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601

        // Vapor's default maxFrameSize is 16KB which silently drops larger frames (incl. our screenshots).
        // 256MB is large enough for any realistic page (full-page screenshots ~5-10MB) without
        // the OOM/crash risk of using Int.max as the per-connection buffer cap.
        app.webSocket("ws", maxFrameSize: .init(integerLiteral: 256 * 1024 * 1024)) { [weak self] req, ws in
            guard let self = self else { return }
            var extensionId: String?

            ws.onText { [weak self] ws, text in
                guard let self = self else { return }
                guard let data = text.data(using: .utf8) else { return }
                do {
                    let msg = try decoder.decode(ExtensionMessage.self, from: data)
                    if case .hello(let extId, _, _, _) = msg {
                        extensionId = extId
                        self.register(extensionId: extId, socket: ws)
                    }
                    if let extId = extensionId {
                        Task { @MainActor in
                            self.coordinator?.handleExtensionMessage(msg, from: extId)
                        }
                    }
                } catch {
                    req.logger.warning("WS decode error: \(error)")
                }
            }

            _ = ws.onClose.always { [weak self] _ in
                if let extId = extensionId {
                    self?.unregister(extensionId: extId)
                    Task { @MainActor in
                        self?.coordinator?.extensionDisconnected(extId)
                    }
                }
            }
        }

        try await app.execute()
    }

    func send(to extensionId: String, command: GatewayCommand) async throws {
        lock.lock()
        let socket = sockets[extensionId]
        lock.unlock()
        guard let socket = socket else {
            throw NSError(domain: "ABG", code: 4, userInfo: [NSLocalizedDescriptionKey: "extension \(extensionId) not connected"])
        }
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        let data = try encoder.encode(command)
        guard let str = String(data: data, encoding: .utf8) else {
            throw NSError(domain: "ABG", code: 5, userInfo: [NSLocalizedDescriptionKey: "encode failed"])
        }
        try await socket.send(str)
    }

    private func register(extensionId: String, socket: WebSocket) {
        lock.lock()
        sockets[extensionId] = socket
        lock.unlock()
    }

    private func unregister(extensionId: String) {
        lock.lock()
        sockets.removeValue(forKey: extensionId)
        lock.unlock()
    }
}
