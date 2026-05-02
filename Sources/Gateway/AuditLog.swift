import Foundation
import GatewayCore

actor AuditLog {
    private let path: String
    private let encoder: JSONEncoder = {
        let e = JSONEncoder()
        e.dateEncodingStrategy = .iso8601
        return e
    }()

    init(path: String = ABGConstants.auditLogPath) {
        self.path = path
        if !FileManager.default.fileExists(atPath: path) {
            FileManager.default.createFile(atPath: path, contents: nil)
        }
    }

    struct Entry: Codable {
        let ts: Date
        let extensionId: String?
        let tabId: Int?
        let url: String?
        let action: String
        let agent: String?
        let details: [String: String]?
    }

    func log(action: String, extensionId: String? = nil, tabId: Int? = nil, url: String? = nil, agent: String? = nil, details: [String: String]? = nil) {
        let entry = Entry(ts: Date(), extensionId: extensionId, tabId: tabId, url: url, action: action, agent: agent, details: details)
        guard let data = try? encoder.encode(entry) else { return }
        guard let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: path)) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
        try? handle.write(contentsOf: Data([0x0A])) // newline
    }

    func tail(lines: Int = 50) -> [Entry] {
        guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return raw.split(separator: "\n").suffix(lines).compactMap {
            try? decoder.decode(Entry.self, from: Data($0.utf8))
        }
    }
}
