import ArgumentParser
import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
import GatewayCore

enum CLIError: Error, LocalizedError {
    case gatewayNotRunning(String)
    case ioError(String)
    case decodeError(String)
    case responseError(String)

    var errorDescription: String? {
        switch self {
        case .gatewayNotRunning(let s): return "Gateway not running: \(s)"
        case .ioError(let s): return "I/O error: \(s)"
        case .decodeError(let s): return "Decode error: \(s)"
        case .responseError(let s): return "Response error: \(s)"
        }
    }
}

/// Gateway client for the CLI. Tries the Unix socket rendezvous points in order
/// (standard state dir, then the app-group container used by the sandboxed Store
/// gateway) and falls back to the token-authenticated loopback WebSocket `/cli`
/// route when no socket is reachable.
typealias UDSClient = GatewayClient

struct GatewayClient {
    /// Explicit socket path override; when set, only that socket is tried.
    let path: String?

    init(path: String? = nil) {
        self.path = path
    }

    func call(method: String, params: [String: Any]? = nil, suppressErrors: Bool = false) throws -> Any? {
        let id = UUID().uuidString
        let req: [String: Any] = {
            var d: [String: Any] = ["id": id, "method": method]
            if let p = params { d["params"] = p }
            return d
        }()
        let reqData = try JSONSerialization.data(withJSONObject: req)
        let respData: Data
        do {
            respData = try sendAndReceive(reqData)
        } catch CLIError.gatewayNotRunning(let message) {
            guard !suppressErrors else {
                throw CLIError.gatewayNotRunning(message)
            }
            printErrorJSON([
                "error": "gateway_not_running",
                "message": message,
                "userMessage": "Gateway が起動していません。Agent Browser Gateway.app を起動してから、もう一度コマンドを実行してください。",
                "nextCommand": gatewayStartCommand(),
            ])
            throw ExitCode.failure
        }
        guard let json = try JSONSerialization.jsonObject(with: respData) as? [String: Any] else {
            throw CLIError.decodeError("invalid JSON")
        }
        if let errObj = json["error"] as? [String: Any] {
            guard !suppressErrors else {
                let code = errObj["code"] as? String ?? errObj["error"] as? String ?? "gateway_error"
                let message = errObj["message"] as? String ?? code
                throw CLIError.responseError(message)
            }
            printErrorJSON(normalizedErrorObject(errObj))
            throw ExitCode.failure
        }
        return json["result"]
    }

    private func sendAndReceive(_ payload: Data) throws -> Data {
        if let explicit = path {
            return try udsSendAndReceive(payload, socketPath: explicit)
        }

        var attempts: [String] = []
        for candidate in ABGConstants.cliSocketCandidates() {
            guard ABGConstants.fitsUnixSocketPath(candidate) else {
                attempts.append("\(candidate): socket path too long")
                continue
            }
            guard FileManager.default.fileExists(atPath: candidate) else {
                attempts.append("\(candidate): no socket")
                continue
            }
            do {
                return try udsSendAndReceive(payload, socketPath: candidate)
            } catch CLIError.gatewayNotRunning(let message) {
                attempts.append(message)
            }
        }

        #if os(macOS)
        if let endpoint = Self.readCLIEndpoint() {
            do {
                return try wsSendAndReceive(payload, endpoint: endpoint)
            } catch CLIError.gatewayNotRunning(let message) {
                attempts.append(message)
            }
        } else {
            attempts.append("no cli-endpoint file for the ws fallback")
        }
        #endif

        throw CLIError.gatewayNotRunning(attempts.joined(separator: "; "))
    }

    // MARK: - Unix socket transport

    private func udsSendAndReceive(_ payload: Data, socketPath: String) throws -> Data {
        #if canImport(Glibc)
        let sock = socket(AF_UNIX, Int32(SOCK_STREAM.rawValue), 0)
        #else
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        #endif
        guard sock >= 0 else { throw CLIError.ioError("socket() failed") }
        defer { close(sock) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let cstr = socketPath.cString(using: .utf8)!
        let cap = MemoryLayout.size(ofValue: addr.sun_path)
        guard cstr.count <= cap else { throw CLIError.ioError("socket path too long") }
        withUnsafeMutablePointer(to: &addr.sun_path) { tuplePtr in
            tuplePtr.withMemoryRebound(to: CChar.self, capacity: cap) { ptr in
                for (i, b) in cstr.enumerated() { ptr[i] = b }
            }
        }
        let len = socklen_t(MemoryLayout<sockaddr_un>.size)
        let connResult = withUnsafePointer(to: &addr) { addrPtr in
            addrPtr.withMemoryRebound(to: sockaddr.self, capacity: 1) { sa in
                connect(sock, sa, len)
            }
        }
        guard connResult == 0 else {
            let err = String(cString: strerror(errno))
            throw CLIError.gatewayNotRunning("\(socketPath): \(err)")
        }

        // Send: payload + newline
        var bytes = Array(payload)
        bytes.append(0x0A)
        var sent = 0
        while sent < bytes.count {
            let n = bytes.withUnsafeBufferPointer { buf in
                write(sock, buf.baseAddress!.advanced(by: sent), bytes.count - sent)
            }
            if n <= 0 { throw CLIError.ioError("write failed") }
            sent += n
        }

        // Receive until newline
        var out = Data()
        var chunk = [UInt8](repeating: 0, count: 8192)
        while true {
            let n = chunk.withUnsafeMutableBufferPointer { buf in
                read(sock, buf.baseAddress, buf.count)
            }
            if n <= 0 { break }
            for i in 0..<n {
                if chunk[i] == 0x0A {
                    out.append(contentsOf: chunk[0..<i])
                    return out
                }
            }
            out.append(contentsOf: chunk[0..<n])
        }
        return out
    }

    // MARK: - Loopback WebSocket transport (URLSession only; no server-side deps)

    #if os(macOS)
    struct CLIEndpoint: Codable {
        let token: String
        let port: Int
    }

    /// Reads the freshest `{token, port}` rendezvous file the gateway published.
    static func readCLIEndpoint() -> CLIEndpoint? {
        for path in ABGConstants.cliEndpointCandidates() {
            guard let data = FileManager.default.contents(atPath: path),
                  let endpoint = try? JSONDecoder().decode(CLIEndpoint.self, from: data) else {
                continue
            }
            return endpoint
        }
        return nil
    }

    private func wsSendAndReceive(_ payload: Data, endpoint: CLIEndpoint) throws -> Data {
        guard let text = String(data: payload, encoding: .utf8),
              let url = URL(string: "ws://\(ABGConstants.wsHost):\(endpoint.port)/cli") else {
            throw CLIError.ioError("invalid CLI request payload")
        }
        var request = URLRequest(url: url)
        request.setValue(endpoint.token, forHTTPHeaderField: "x-abg-token")

        let config = URLSessionConfiguration.ephemeral
        // Long-running commands (wait/eval with generous timeouts) are bounded by the
        // gateway, not by the transport.
        config.timeoutIntervalForRequest = 3600
        config.timeoutIntervalForResource = 7200
        let session = URLSession(configuration: config)
        defer { session.finishTasksAndInvalidate() }

        let task = session.webSocketTask(with: request)
        // Default is 1 MiB, which truncates screenshot/read payloads; match the
        // server-side 256 MiB frame budget.
        task.maximumMessageSize = 256 * 1024 * 1024
        task.resume()

        let sendSemaphore = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var sendError: Error?
        task.send(.string(text)) { error in
            sendError = error
            sendSemaphore.signal()
        }
        sendSemaphore.wait()
        if let sendError {
            task.cancel(with: .abnormalClosure, reason: nil)
            throw CLIError.gatewayNotRunning("\(url.absoluteString): \(sendError.localizedDescription)")
        }

        let receiveSemaphore = DispatchSemaphore(value: 0)
        nonisolated(unsafe) var received: Result<URLSessionWebSocketTask.Message, Error>?
        task.receive { result in
            received = result
            receiveSemaphore.signal()
        }
        receiveSemaphore.wait()
        task.cancel(with: .normalClosure, reason: nil)

        switch received {
        case .success(.string(let response)):
            return Data(response.utf8)
        case .success(.data(let data)):
            return data
        case .success:
            throw CLIError.decodeError("unexpected WebSocket message type")
        case .failure(let error):
            throw CLIError.gatewayNotRunning("\(url.absoluteString): \(error.localizedDescription)")
        case nil:
            throw CLIError.ioError("WebSocket receive returned nothing")
        }
    }
    #endif
}

/// Reads a user-supplied host file, converting sandbox denials in the App Store CLI
/// into an explicit error instead of a misleading read failure.
func readHostTextFile(_ path: String, option: String) throws -> String {
    do {
        return try String(contentsOfFile: path, encoding: .utf8)
    } catch {
        if ABGConstants.isSandboxed, !FileManager.default.isReadableFile(atPath: path) {
            printErrorJSON(sandboxUnsupportedError(option: option, path: path))
            throw ExitCode.failure
        }
        throw error
    }
}

func sandboxUnsupportedError(option: String, path: String) -> [String: Any] {
    [
        "error": "sandbox_unsupported",
        "message": "The App Store abg CLI is sandboxed and cannot read host files (\(option): \(path)).",
        "userMessage": "App Store 版の abg CLI はサンドボックスのためローカルファイルを読めません。--stdin を使うか、Homebrew 版 CLI を利用してください。",
    ]
}

private func gatewayStartCommand() -> String {
    let environment = ProcessInfo.processInfo.environment
    let envKeys = ["ABG_PORT", "ABG_PROFILE", "ABG_STATE_DIR", "ABG_LOGS_DIR", "ABG_USER_DIR"]
    let envAssignments = envKeys.compactMap { key -> String? in
        guard let value = environment[key]?.trimmingCharacters(in: .whitespacesAndNewlines),
              !value.isEmpty else {
            return nil
        }
        return "\(key)=\(shellQuoted(value))"
    }
    guard !envAssignments.isEmpty else {
        return "open \"Agent Browser Gateway.app\" && abg status"
    }
    return "\(envAssignments.joined(separator: " ")) swift run Gateway"
}

private func shellQuoted(_ value: String) -> String {
    guard value.rangeOfCharacter(from: CharacterSet(charactersIn: " \t\n'\"\\$`")) != nil else {
        return value
    }
    return "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
}

// Pretty-print helpers
func printJSON(_ value: Any?) {
    guard let v = value else { print("null"); return }
    if let data = try? JSONSerialization.data(withJSONObject: v, options: [.prettyPrinted, .sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        print(str)
    } else if let str = v as? String {
        print(str)
    } else {
        print(String(describing: v))
    }
}

func printErrorJSON(_ value: [String: Any]) {
    if let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys]),
       let str = String(data: data, encoding: .utf8) {
        FileHandle.standardError.write(Data((str + "\n").utf8))
    } else {
        FileHandle.standardError.write(Data("\(value)\n".utf8))
    }
}

private func normalizedErrorObject(_ errObj: [String: Any]) -> [String: Any] {
    var out: [String: Any] = [
        "error": errObj["code"] as? String ?? "unknown_error",
        "message": errObj["message"] as? String ?? "Unknown error",
    ]
    for key in CLIJSONContract.stderrErrorKeys where key != "error" && key != "message" {
        if let value = errObj[key] {
            out[key] = value
        }
    }
    return out
}
