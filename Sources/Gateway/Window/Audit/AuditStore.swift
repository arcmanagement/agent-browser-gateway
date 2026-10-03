import Foundation
import Observation
import GatewayCore

/// Loads the tail of the local audit log off the main thread and holds the Audit view's
/// filters. Read-only: the Gateway app never rewrites audit.jsonl.
@MainActor
@Observable
final class AuditStore {
    static let entryLoadLimit = 500

    private(set) var entries: [AuditLogViewEntry] = []
    private(set) var loadError: String?
    private(set) var isReloading = false
    private(set) var hasLoaded = false

    var searchText = ""
    var timeFilter: AuditTimeFilter = .all
    var commandFilter = AuditLogViewEntry.allFilterValue
    var tabFilter = AuditLogViewEntry.allFilterValue
    var selection: AuditLogViewEntry.ID?

    var filteredEntries: [AuditLogViewEntry] {
        let query = searchText.trimmingCharacters(in: .whitespacesAndNewlines)
        return entries
            .filter { timeFilter.includes($0.timestamp) }
            .filter { commandFilter == AuditLogViewEntry.allFilterValue || $0.command == commandFilter || $0.action == commandFilter }
            .filter { tabFilter == AuditLogViewEntry.allFilterValue || $0.tabFilterValue == tabFilter }
            .filter { entry in
                guard !query.isEmpty else { return true }
                return entry.searchBlob.localizedCaseInsensitiveContains(query)
            }
    }

    var selectedEntry: AuditLogViewEntry? {
        guard let selection else { return nil }
        return entries.first { $0.id == selection }
    }

    var commandOptions: [String] {
        Array(Set(entries.flatMap { [$0.command, $0.action] }))
            .filter { !$0.isEmpty }
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    var tabOptions: [String] {
        Array(Set(entries.map(\.tabFilterValue)))
            .sorted { $0.localizedCaseInsensitiveCompare($1) == .orderedAscending }
    }

    var isFiltered: Bool {
        timeFilter != .all
            || commandFilter != AuditLogViewEntry.allFilterValue
            || tabFilter != AuditLogViewEntry.allFilterValue
            || !searchText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var logIsOwnerOnly: Bool {
        guard let permissions = try? FileManager.default.attributesOfItem(atPath: ABGConstants.auditLogPath)[.posixPermissions] as? NSNumber else {
            return false
        }
        return permissions.intValue & 0o077 == 0
    }

    func clearFilters() {
        timeFilter = .all
        commandFilter = AuditLogViewEntry.allFilterValue
        tabFilter = AuditLogViewEntry.allFilterValue
        searchText = ""
    }

    func reload() {
        guard !isReloading else { return }
        let path = ABGConstants.auditLogPath
        let limit = Self.entryLoadLimit
        isReloading = true
        Task {
            let result = await Task.detached(priority: .userInitiated) {
                AuditLogViewEntry.loadRecent(from: path, limit: limit)
            }.value
            entries = result.entries
            loadError = result.error
            isReloading = false
            hasLoaded = true
            if let selection, !result.entries.contains(where: { $0.id == selection }) {
                self.selection = nil
            }
            if self.selection == nil {
                self.selection = filteredEntries.first?.id
            }
        }
    }
}
