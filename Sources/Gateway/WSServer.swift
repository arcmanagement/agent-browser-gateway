import Foundation
import Vapor
import GatewayCore

actor WSServer {
    private weak var runtime: (any GatewayRuntime)?
    private var app: Application?
    private var sockets: [String: WebSocket] = [:]
    private var extensionIdBySocket: [ObjectIdentifier: String] = [:]
    private var runtimeStreamSockets: [ObjectIdentifier: WebSocket] = [:]

    init(runtime: any GatewayRuntime) {
        self.runtime = runtime
    }

    func start() async throws {
        // Retry the bind in case the previous Gateway process is still releasing the port,
        // or the user just opened a second instance and is closing the old one.
        // Schedule: 0s, 1s, 2s, 4s, 8s, 16s, 30s capped, then surface to UI.
        let backoffs: [UInt64] = [0, 1, 2, 4, 8, 16, 30]
        var lastError: Error?
        for (attempt, secs) in backoffs.enumerated() {
            if secs > 0 {
                await runtime?.setStatus("WS bind retry in \(secs)s (attempt \(attempt + 1)/\(backoffs.count))…")
                try? await Task.sleep(nanoseconds: secs * 1_000_000_000)
            }
            do {
                try await runOnce()
                return
            } catch {
                lastError = error
                let msg = "bind failed (attempt \(attempt + 1)/\(backoffs.count)): \(error.localizedDescription)"
                print("[ABG WS] \(msg)")
                await runtime?.setStatus(msg)
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

        // Vapor's default maxFrameSize is 16KB which silently drops larger frames (incl. our screenshots).
        // 256MB is large enough for any realistic page (full-page screenshots ~5-10MB) without
        // the OOM/crash risk of using Int.max as the per-connection buffer cap.
        app.webSocket("ws", maxFrameSize: .init(integerLiteral: 256 * 1024 * 1024)) { req, ws in
            guard Self.isAllowedWebSocketOrigin(req.headers.first(name: .origin)) else {
                app.logger.warning("Rejected WebSocket connection with Origin: \(req.headers.first(name: .origin) ?? "(none)")")
                _ = ws.close()
                return
            }
            ws.onText { ws, text in
                Task { await self.handleText(ws: ws, text: text) }
            }
            _ = ws.onClose.always { _ in
                Task { await self.handleClose(ws: ws) }
            }
        }
        app.webSocket("stream", maxFrameSize: .init(integerLiteral: 16 * 1024 * 1024)) { _, ws in
            Task { await self.handleRuntimeStream(ws: ws) }
            _ = ws.onClose.always { _ in
                Task { await self.handleRuntimeStreamClose(ws: ws) }
            }
        }

        try await app.execute()
    }

    static func isAllowedWebSocketOrigin(_ origin: String?) -> Bool {
        guard let origin = origin?.trimmingCharacters(in: .whitespacesAndNewlines),
              !origin.isEmpty,
              let components = URLComponents(string: origin),
              let scheme = components.scheme?.lowercased(),
              let host = components.host,
              !host.isEmpty,
              components.user == nil,
              components.password == nil,
              components.path.isEmpty,
              components.query == nil,
              components.fragment == nil else {
            return false
        }
        return ["chrome-extension", "moz-extension", "safari-web-extension"].contains(scheme)
    }

    private func handleText(ws: WebSocket, text: String) async {
        guard let data = text.data(using: .utf8) else { return }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let msg: ExtensionMessage
        do {
            msg = try decoder.decode(ExtensionMessage.self, from: data)
        } catch {
            return
        }
        if case .hello(let extId, _, _, _) = msg {
            sockets[extId] = ws
            extensionIdBySocket[ObjectIdentifier(ws)] = extId
        }
        guard let extId = extensionIdBySocket[ObjectIdentifier(ws)] else { return }
        let runtime = runtime
        await MainActor.run {
            runtime?.handleExtensionMessage(msg, from: extId)
        }
    }

    private func handleClose(ws: WebSocket) async {
        let key = ObjectIdentifier(ws)
        guard let extId = extensionIdBySocket.removeValue(forKey: key) else { return }
        sockets.removeValue(forKey: extId)
        let runtime = runtime
        await MainActor.run {
            runtime?.extensionDisconnected(extId)
        }
    }

    private func handleRuntimeStream(ws: WebSocket) async {
        runtimeStreamSockets[ObjectIdentifier(ws)] = ws
    }

    private func handleRuntimeStreamClose(ws: WebSocket) async {
        runtimeStreamSockets.removeValue(forKey: ObjectIdentifier(ws))
    }

    func broadcastRuntimeEvent(_ text: String) async {
        for (id, socket) in runtimeStreamSockets {
            do {
                try await socket.send(text)
            } catch {
                runtimeStreamSockets.removeValue(forKey: id)
            }
        }
    }

    func send(to extensionId: String, command: GatewayCommand) async throws {
        guard let socket = sockets[extensionId] else {
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
}
