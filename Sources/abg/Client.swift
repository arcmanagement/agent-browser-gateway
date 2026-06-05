import ArgumentParser
import Foundation
import Darwin
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

struct UDSClient {
    let path: String

    init(path: String = ABGConstants.udsPath) {
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
        let sock = socket(AF_UNIX, SOCK_STREAM, 0)
        guard sock >= 0 else { throw CLIError.ioError("socket() failed") }
        defer { close(sock) }

        var addr = sockaddr_un()
        addr.sun_family = sa_family_t(AF_UNIX)
        let cstr = path.cString(using: .utf8)!
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
            throw CLIError.gatewayNotRunning("\(path): \(err)")
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
    for key in ["userMessage", "nextCommand", "hint", "tabId", "plugin", "command", "expectedDomains", "candidates"] {
        if let value = errObj[key] {
            out[key] = value
        }
    }
    return out
}
