import Foundation
import GatewayCore

/// The `{token, port}` rendezvous file for the CLI's loopback WebSocket fallback.
/// Written on every gateway launch to the gateway's own state dir and to the shared
/// app-group container so both unsandboxed and bundled sandboxed CLIs can find it.
enum CLIEndpoint {
    struct Payload: Codable {
        let token: String
        let port: Int
    }

    static func generateToken() -> String {
        var bytes = [UInt8](repeating: 0, count: 32)
        for i in bytes.indices {
            bytes[i] = UInt8.random(in: .min ... .max)
        }
        return bytes.map { String(format: "%02x", $0) }.joined()
    }

    /// Writes the endpoint file (0600) to every rendezvous directory. Returns the
    /// paths actually written; failures are non-fatal because the UDS transport can
    /// still serve the CLI.
    @discardableResult
    static func write(token: String, port: Int,
                      environment: [String: String] = ProcessInfo.processInfo.environment) -> [String] {
        let encoder = JSONEncoder()
        encoder.outputFormatting = [.sortedKeys]
        guard let data = try? encoder.encode(Payload(token: token, port: port)) else { return [] }
        var written: [String] = []
        for path in ABGConstants.cliEndpointCandidates(environment: environment) {
            let dir = (path as NSString).deletingLastPathComponent
            try? FileManager.default.createDirectory(atPath: dir, withIntermediateDirectories: true)
            chmod(dir, 0o700)
            do {
                try data.write(to: URL(fileURLWithPath: path), options: .atomic)
                chmod(path, 0o600)
                written.append(path)
            } catch {
                // Keep going: the state-dir copy failing must not block the group copy
                // (or vice versa), and UDS remains available.
            }
        }
        return written
    }

    static func constantTimeEquals(_ a: String, _ b: String) -> Bool {
        let lhs = Array(a.utf8)
        let rhs = Array(b.utf8)
        guard lhs.count == rhs.count else { return false }
        var diff: UInt8 = 0
        for i in lhs.indices {
            diff |= lhs[i] ^ rhs[i]
        }
        return diff == 0
    }
}
