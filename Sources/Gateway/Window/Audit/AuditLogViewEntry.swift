import Foundation
import GatewayCore

// Read model for one audit.jsonl line, shown by the Audit view and the Overview's recent
// activity. Parsing is read-only and mirrors the on-disk format written by `AuditLog`.

struct AuditLogDetailRow: Identifiable, Hashable {
    let key: String
    let value: String

    var id: String { "\(key)=\(value)" }
}

struct AuditLogViewEntry: Identifiable {
    static let allFilterValue = "__all__"

    let id: String
    let timestamp: Date
    let action: String
    let command: String
    let extensionId: String?
    let tabId: Int?
    let url: String?
    let agent: String?
    let origin: String
    let outcome: String
    let selectedTarget: String
    let resultSummary: String
    let detailRows: [AuditLogDetailRow]
    let rawDetails: String?
    let auditDiffPreview: [String]
    let searchBlob: String

    var timeText: String {
        timestamp.formatted(.dateTime.month().day().hour().minute().second())
    }

    var tabDisplay: String {
        tabId.map { String($0) } ?? "—"
    }

    var tabFilterValue: String {
        tabId.map { "Tab \($0)" } ?? "(no tab)"
    }

    var symbol: String {
        switch action {
        case "permit": return "checkmark.shield"
        case "revoke", "revoke_via_cli": return "xmark.shield"
        case "fill", "paste", "clear", "replace_dom", "type_text", "keyboard_insert_text": return "square.and.pencil"
        case "click_selector", "click_ref", "click_described", "click_at": return "cursorarrow.click"
        case "eval_script": return "chevron.left.forwardslash.chevron.right"
        case "plugin_command_run": return "puzzlepiece.extension"
        case "har_export", "state_inspect", "read_dom": return "doc.text.magnifyingglass"
        default: return "waveform.path.ecg"
        }
    }

    /// Outcome tone. Only decisions that grant or refuse access carry signal or danger.
    var outcomeTone: GateTone {
        switch outcome {
        case "failed", "denied", "deny", "rejected": return .danger
        case "approved", "allowed", "allow": return .signal
        default: return .neutral
        }
    }

    var outcomeSymbol: String {
        switch outcome {
        case "failed": return "xmark.octagon"
        case "denied", "deny", "rejected": return "hand.raised"
        case "approved", "allowed", "allow": return "checkmark.shield"
        case "changed": return "pencil"
        case "unchanged": return "equal"
        case "ok": return "checkmark"
        case "closed": return "lock"
        default: return "circle.dotted"
        }
    }

    /// Access changes keep their meaning in the action column: permit opens the gate,
    /// revoke closes it.
    var actionTone: GateTone {
        switch action {
        case "permit": return .signal
        case "revoke", "revoke_via_cli", "policy_deny": return .danger
        default: return .neutral
        }
    }

    /// Site for display: the host, or an em dash for entries without a page (Gateway events).
    var siteDisplay: String {
        url == nil ? "—" : origin
    }

    var agentDisplay: String {
        guard let agent, !agent.isEmpty else { return "—" }
        return agent
    }

    /// Compact time for list columns: time only for today, date and time otherwise.
    var shortTimeText: String {
        if Calendar.current.isDateInToday(timestamp) {
            return timestamp.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits).second(.twoDigits))
        }
        let day = timestamp.formatted(.dateTime.month(.defaultDigits).day())
        let time = timestamp.formatted(.dateTime.hour(.twoDigits(amPM: .omitted)).minute(.twoDigits))
        return "\(day) \(time)"
    }


    var isoTimeText: String {
        timestamp.formatted(.iso8601)
    }

    static func loadRecent(from path: String, limit: Int) -> (entries: [AuditLogViewEntry], error: String?) {
        guard FileManager.default.fileExists(atPath: path) else {
            return ([], nil)
        }
        guard let lines = try? AuditLog.tailLineData(from: path, maxLines: limit) else {
            return ([], "Cannot read \(path)")
        }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        let entries = lines.compactMap { line -> AuditLogViewEntry? in
            guard let entry = try? decoder.decode(AuditLog.Entry.self, from: line.data) else {
                return nil
            }
            return AuditLogViewEntry(entry: entry, idSeed: "offset-\(line.byteOffset)")
        }
        return (entries.reversed(), nil)
    }

    init(entry: AuditLog.Entry, idSeed: String) {
        let details = entry.details?.mapValues(\.value)
        let rawDetails = details.flatMap(Self.prettyJSONString)
        let rows = Self.detailRows(from: details)
        let command = (details?["command"] as? String) ?? entry.action
        let origin = Self.originLabel(for: entry.url)
        let outcome = Self.outcomeLabel(action: entry.action, details: details)
        let selectedTarget = Self.selectedTargetLabel(tabId: entry.tabId, details: details)
        let resultSummary = Self.resultSummaryLabel(outcome: outcome, details: details)
        let auditDiffPreview = ((details?["auditDiff"] as? [String: Any])?["preview"] as? [String]) ?? []
        let tabIDText = entry.tabId.map(String.init) ?? ""
        let detailSearchText = rows.map { "\($0.key) \($0.value)" }.joined(separator: " ")
        let searchBlobParts: [String] = [
            entry.action,
            command,
            entry.extensionId ?? "",
            tabIDText,
            entry.url ?? "",
            entry.agent ?? "",
            origin,
            outcome,
            selectedTarget,
            resultSummary,
            rawDetails ?? "",
            detailSearchText,
        ]
        let searchBlob = searchBlobParts.joined(separator: " ")

        self.id = "\(idSeed)-\(entry.ts.timeIntervalSince1970)-\(entry.action)"
        self.timestamp = entry.ts
        self.action = entry.action
        self.command = command
        self.extensionId = entry.extensionId
        self.tabId = entry.tabId
        self.url = entry.url
        self.agent = entry.agent
        self.origin = origin
        self.outcome = outcome
        self.selectedTarget = selectedTarget
        self.resultSummary = resultSummary
        self.detailRows = rows
        self.rawDetails = rawDetails
        self.auditDiffPreview = auditDiffPreview
        self.searchBlob = searchBlob
    }

    private static func originLabel(for url: String?) -> String {
        guard let url, let host = URL(string: url)?.host, !host.isEmpty else {
            return "(no origin)"
        }
        return host.hasPrefix("www.") ? String(host.dropFirst(4)) : host
    }

    private static func outcomeLabel(action: String, details: [String: Any]?) -> String {
        if let auditDiff = details?["auditDiff"] as? [String: Any],
           let changed = auditDiff["changed"] as? Bool {
            return changed ? "changed" : "unchanged"
        }
        if let ok = details?["ok"] as? Bool {
            return ok ? "ok" : "failed"
        }
        if details?["error"] != nil {
            return "failed"
        }
        if let approval = details?["approval"] as? [String: Any],
           let decision = approval["decision"] as? String,
           !decision.isEmpty {
            return decision
        }
        if action.contains("disconnect") || action.contains("revoke") {
            return "closed"
        }
        return "recorded"
    }

    private static func selectedTargetLabel(tabId: Int?, details: [String: Any]?) -> String {
        if let selector = details?["selector"] as? String, !selector.isEmpty {
            return selector
        }
        if let targetTabId = details?["targetTabId"] as? Int {
            return "Tab \(targetTabId)"
        }
        if let targetUrl = details?["targetUrl"] as? String, !targetUrl.isEmpty {
            return targetUrl
        }
        if let id = details?["id"] as? Int {
            return "Element \(id)"
        }
        if let x = details?["x"] as? Int, let y = details?["y"] as? Int {
            return "Point \(x),\(y)"
        }
        return tabId.map { "Tab \($0)" } ?? "Gateway"
    }

    private static func resultSummaryLabel(outcome: String, details: [String: Any]?) -> String {
        if let error = details?["error"] as? String, !error.isEmpty {
            return clipped(error)
        }
        if let policyAction = details?["policyAction"] as? String,
           let policyDomain = details?["policyDomain"] as? String {
            return "\(outcome) by \(policyAction) \(policyDomain)"
        }
        if let auditDiff = details?["auditDiff"] as? [String: Any],
           let changed = auditDiff["changed"] as? Bool {
            return changed ? "changed" : "unchanged"
        }
        return outcome
    }

    private static func detailRows(from details: [String: Any]?) -> [AuditLogDetailRow] {
        guard let details else { return [] }
        return flatten(details, prefix: nil).prefix(36).map { AuditLogDetailRow(key: $0.key, value: $0.value) }
    }

    private static func flatten(_ value: Any, prefix: String?) -> [(key: String, value: String)] {
        if let dict = value as? [String: Any] {
            return dict.keys.sorted().flatMap { key in
                flatten(dict[key] ?? NSNull(), prefix: [prefix, key].compactMap { $0 }.joined(separator: "."))
            }
        }
        if let array = value as? [Any] {
            return [(prefix ?? "value", compactJSONString(array))]
        }
        return [(prefix ?? "value", clipped(displayValue(value)))]
    }

    private static func displayValue(_ value: Any) -> String {
        switch value {
        case let string as String:
            return string
        case let bool as Bool:
            return bool ? "true" : "false"
        case let int as Int:
            return String(int)
        case let double as Double:
            return String(double)
        case is NSNull:
            return "null"
        default:
            return compactJSONString(value)
        }
    }

    private static func prettyJSONString(_ value: Any) -> String? {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
        else { return nil }
        return String(data: data, encoding: .utf8)
    }

    private static func compactJSONString(_ value: Any) -> String {
        guard JSONSerialization.isValidJSONObject(value),
              let data = try? JSONSerialization.data(withJSONObject: value, options: [.sortedKeys]),
              let text = String(data: data, encoding: .utf8)
        else { return String(describing: value) }
        return clipped(text)
    }

    private static func clipped(_ value: String, limit: Int = 260) -> String {
        value.count > limit ? "\(value.prefix(limit))..." : value
    }
}
