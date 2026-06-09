import Foundation
import GatewayCore

struct ActivityDigest: Sendable {
    let period: String
    let localOnly: Bool
    let generatedAt: String
    let startAt: String
    let endAt: String
    let firstEventAt: String?
    let lastEventAt: String?
    let eventCount: Int
    let uniqueTabCount: Int
    let actions: [ActivityDigestNamedRow]
    let origins: [ActivityDigestNamedRow]
    let tabs: [ActivityDigestTabRow]
    let outcomes: [ActivityDigestNamedRow]
    let privacy: String

    func asJSONObject() -> [String: Any] {
        [
            "ok": true,
            "period": period,
            "localOnly": localOnly,
            "generatedAt": generatedAt,
            "startAt": startAt,
            "endAt": endAt,
            "firstEventAt": firstEventAt ?? NSNull(),
            "lastEventAt": lastEventAt ?? NSNull(),
            "eventCount": eventCount,
            "uniqueTabCount": uniqueTabCount,
            "actions": actions.map { $0.asJSONObject(nameKey: "action") },
            "origins": origins.map { $0.asJSONObject(nameKey: "origin") },
            "tabs": tabs.map { $0.asJSONObject() },
            "outcomes": outcomes.map { $0.asJSONObject(nameKey: "outcome") },
            "privacy": privacy,
        ]
    }
}

struct ActivityDigestNamedRow: Sendable {
    let name: String
    let count: Int

    func asJSONObject(nameKey: String) -> [String: Any] {
        [nameKey: name, "count": count]
    }
}

struct ActivityDigestTabRow: Sendable {
    let tabId: Int
    let count: Int

    func asJSONObject() -> [String: Any] {
        ["tabId": tabId, "count": count]
    }
}

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
        chmod(path, 0o600)
    }

    struct Entry: Codable {
        let ts: Date
        let extensionId: String?
        let tabId: Int?
        let url: String?
        let action: String
        let agent: String?
        let details: [String: AnyCodable]?
    }

    func log(action: String, extensionId: String? = nil, tabId: Int? = nil, url: String? = nil, agent: String? = nil, details: [String: AnyCodable]? = nil) {
        let entry = Entry(ts: Date(), extensionId: extensionId, tabId: tabId, url: url, action: action, agent: agent, details: details)
        guard let data = try? encoder.encode(entry) else { return }
        guard let handle = try? FileHandle(forWritingTo: URL(fileURLWithPath: path)) else { return }
        defer { try? handle.close() }
        _ = try? handle.seekToEnd()
        try? handle.write(contentsOf: data)
        try? handle.write(contentsOf: Data([0x0A])) // newline
    }

    func tail(lines: Int = 50) -> [Entry] {
        guard lines > 0 else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let rawLines = try? Self.tailLineData(from: path, maxLines: lines) else {
            return []
        }
        return rawLines.compactMap {
            try? decoder.decode(Entry.self, from: $0.data)
        }
    }

    struct TailLine: Sendable {
        let data: Data
        let byteOffset: UInt64
    }

    nonisolated static func tailLineData(from path: String, maxLines: Int) throws -> [TailLine] {
        guard maxLines > 0 else { return [] }

        let url = URL(fileURLWithPath: path)
        let handle = try FileHandle(forReadingFrom: url)
        defer { try? handle.close() }

        let chunkSize: UInt64 = 64 * 1024
        let fileSize = try handle.seekToEnd()
        guard fileSize > 0 else { return [] }

        var offset = fileSize
        var newlineCount = 0
        var chunks: [(offset: UInt64, data: Data)] = []

        while offset > 0 && newlineCount <= maxLines {
            let readSize = min(chunkSize, offset)
            offset -= readSize
            try handle.seek(toOffset: offset)
            let chunk = try handle.read(upToCount: Int(readSize)) ?? Data()
            newlineCount += chunk.reduce(0) { count, byte in
                count + (byte == 0x0A ? 1 : 0)
            }
            chunks.append((offset: offset, data: chunk))
        }

        guard let firstOffset = chunks.last?.offset else { return [] }

        var buffer = Data()
        buffer.reserveCapacity(chunks.reduce(0) { $0 + $1.data.count })
        for chunk in chunks.reversed() {
            buffer.append(chunk.data)
        }

        return lines(in: buffer, baseOffset: firstOffset).suffix(maxLines).map { $0 }
    }

    static func normalizeDigestPeriod(_ period: String) -> String? {
        switch period.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "day", "daily":
            return "day"
        case "week", "weekly":
            return "week"
        default:
            return nil
        }
    }

    func digest(period: String, now: Date = Date(), calendar: Calendar = .current) -> ActivityDigest? {
        guard let normalizedPeriod = Self.normalizeDigestPeriod(period) else {
            return nil
        }

        let start: Date
        switch normalizedPeriod {
        case "day":
            start = calendar.startOfDay(for: now)
        case "week":
            start = calendar.dateInterval(of: .weekOfYear, for: now)?.start
                ?? calendar.date(byAdding: .day, value: -7, to: now)
                ?? now
        default:
            start = now
        }

        let entries = readEntries()
            .filter { $0.ts >= start && $0.ts <= now }
            .sorted { $0.ts < $1.ts }
        let formatter = ISO8601DateFormatter()
        var actionCounts: [String: Int] = [:]
        var originCounts: [String: Int] = [:]
        var outcomeCounts: [String: Int] = [:]
        var tabCounts: [Int: Int] = [:]
        var tabIds = Set<Int>()

        for entry in entries {
            actionCounts[entry.action, default: 0] += 1
            if let tabId = entry.tabId {
                tabIds.insert(tabId)
                tabCounts[tabId, default: 0] += 1
            }
            let origin = originLabel(for: entry.url)
            originCounts[origin, default: 0] += 1
            outcomeCounts[outcomeLabel(for: entry), default: 0] += 1
        }

        return ActivityDigest(
            period: normalizedPeriod,
            localOnly: true,
            generatedAt: formatter.string(from: now),
            startAt: formatter.string(from: start),
            endAt: formatter.string(from: now),
            firstEventAt: entries.first.map { formatter.string(from: $0.ts) },
            lastEventAt: entries.last.map { formatter.string(from: $0.ts) },
            eventCount: entries.count,
            uniqueTabCount: tabIds.count,
            actions: actionCounts.sortedDigestRows(),
            origins: originCounts.sortedDigestRows(),
            tabs: tabCounts.sortedDigestRows(),
            outcomes: outcomeCounts.sortedDigestRows(),
            privacy: "Deterministic local summary. Raw pasted values, clipboard payloads, plugin arguments, and raw audit details are not included."
        )
    }

    private func readEntries() -> [Entry] {
        guard let raw = try? String(contentsOfFile: path, encoding: .utf8) else { return [] }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        return raw.split(separator: "\n").compactMap {
            try? decoder.decode(Entry.self, from: Data($0.utf8))
        }
    }

    private nonisolated static func lines(in data: Data, baseOffset: UInt64) -> [TailLine] {
        var result: [TailLine] = []
        var lineStart = data.startIndex
        var lineStartOffset = baseOffset

        for index in data.indices {
            guard data[index] == 0x0A else { continue }
            if lineStart < index {
                result.append(TailLine(data: Data(data[lineStart..<index]), byteOffset: lineStartOffset))
            }
            let nextIndex = data.index(after: index)
            lineStart = nextIndex
            let nextDistance = data.distance(from: data.startIndex, to: nextIndex)
            lineStartOffset = baseOffset + UInt64(nextDistance)
        }

        if lineStart < data.endIndex {
            result.append(TailLine(data: Data(data[lineStart..<data.endIndex]), byteOffset: lineStartOffset))
        }

        return result
    }

    private func originLabel(for url: String?) -> String {
        guard let url, let host = URL(string: url)?.host, !host.isEmpty else {
            return "(no origin)"
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private func outcomeLabel(for entry: Entry) -> String {
        if let details = entry.details {
            if let ok = details["ok"]?.value as? Bool {
                return ok ? "ok" : "failed"
            }
            if details["error"] != nil {
                return "failed"
            }
            if let approval = details["approval"]?.value as? [String: Any],
               let decision = approval["decision"] as? String,
               !decision.isEmpty {
                return "approval:\(decision)"
            }
            if let approvalMode = details["approvalMode"]?.value as? String,
               !approvalMode.isEmpty {
                return "approval-mode:\(approvalMode)"
            }
        }
        return "recorded"
    }
}

private extension Dictionary where Key == String, Value == Int {
    func sortedDigestRows() -> [ActivityDigestNamedRow] {
        sorted { lhs, rhs in
            if lhs.value == rhs.value { return lhs.key < rhs.key }
            return lhs.value > rhs.value
        }.map { ActivityDigestNamedRow(name: $0.key, count: $0.value) }
    }
}

private extension Dictionary where Key == Int, Value == Int {
    func sortedDigestRows() -> [ActivityDigestTabRow] {
        sorted { lhs, rhs in
            if lhs.value == rhs.value { return lhs.key < rhs.key }
            return lhs.value > rhs.value
        }.map { ActivityDigestTabRow(tabId: $0.key, count: $0.value) }
    }
}
