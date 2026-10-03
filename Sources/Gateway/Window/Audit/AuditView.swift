import SwiftUI
import AppKit
import GatewayCore

/// The audit log as a native, sortable-by-time table: time, agent, action, tab, site,
/// result. Selecting a row opens the full entry in the inspector.
struct AuditView: View {
    @Bindable var store: AuditStore

    @State private var showsInspector = true

    var body: some View {
        HStack(spacing: 0) {
            VStack(spacing: 0) {
                AuditFilterBar(store: store)
                Divider()
                content
                Divider()
                AuditStatusBar(store: store)
            }
            .frame(minWidth: 420, maxWidth: .infinity, maxHeight: .infinity)

            // A fixed side pane rather than `.inspector`: SwiftUI's inspector next to a
            // Table loops on constraint updates when hosted in this AppKit window.
            if showsInspector {
                Divider()
                inspector
                    .frame(width: 300)
                    .frame(maxHeight: .infinity)
                    .background(.background)
                    .transition(.move(edge: .trailing))
            }
        }
        .navigationTitle("Audit")
        .navigationSubtitle("Local audit.jsonl")
        .searchable(text: $store.searchText, placement: .toolbar, prompt: "Search actions, tabs, sites")
        .toolbar {
            ToolbarItemGroup(placement: .primaryAction) {
                Button("Reload", systemImage: "arrow.clockwise", action: store.reload)
                    .keyboardShortcut("r")
                    .disabled(store.isReloading)
                    .help("Reload the audit log (⌘R)")
                Button("Show in Finder", systemImage: "folder", action: revealLog)
                    .help("Show audit.jsonl in Finder")
                Button(showsInspector ? "Hide Details" : "Show Details", systemImage: "sidebar.right") {
                    showsInspector.toggle()
                }
                .keyboardShortcut("i", modifiers: [.command, .option])
                .help(showsInspector ? "Hide the entry inspector" : "Show the entry inspector")
            }
        }
        .task {
            if !store.hasLoaded { store.reload() }
        }
    }

    @ViewBuilder
    private var inspector: some View {
        if let entry = store.selectedEntry {
            AuditDetailView(entry: entry)
        } else {
            ContentUnavailableView(
                "No Entry Selected",
                systemImage: "sidebar.right",
                description: Text("Select an entry to see its details, diff, and raw JSON.")
            )
        }
    }

    @ViewBuilder
    private var content: some View {
        if let error = store.loadError {
            ContentUnavailableView {
                Label("Audit Log Unavailable", systemImage: "exclamationmark.triangle")
            } description: {
                Text(error)
            } actions: {
                Button("Try Again", action: store.reload)
            }
        } else if store.entries.isEmpty {
            ContentUnavailableView {
                Label("No Audit Entries Yet", systemImage: "list.bullet.rectangle")
            } description: {
                Text(store.hasLoaded
                     ? "Every command an agent runs on a shared tab is written here and to audit.jsonl, on this Mac only."
                     : "Loading the audit log…")
            } actions: {
                CommandLineView(command: GateText.cli("audit --lines 20"))
                    .fixedSize()
            }
        } else if store.filteredEntries.isEmpty {
            ContentUnavailableView {
                Label("No Matching Entries", systemImage: "line.3.horizontal.decrease.circle")
            } description: {
                Text("No loaded entry matches these filters.")
            } actions: {
                Button("Show All Entries", action: store.clearFilters)
            }
        } else {
            AuditTable(entries: store.filteredEntries, selection: $store.selection)
        }
    }

    private func revealLog() {
        NSWorkspace.shared.selectFile(ABGConstants.auditLogPath, inFileViewerRootedAtPath: "")
    }
}

private struct AuditTable: View {
    var entries: [AuditLogViewEntry]
    @Binding var selection: AuditLogViewEntry.ID?

    var body: some View {
        Table(entries, selection: $selection) {
            TableColumn("Time") { entry in
                Text(verbatim: entry.shortTimeText)
                    .monospaced()
                    .foregroundStyle(.secondary)
                    .help(entry.timeText)
            }
            .width(min: 92, ideal: 96, max: 140)

            TableColumn("Agent") { entry in
                Text(verbatim: entry.agentDisplay)
                    .monospaced()
                    .foregroundStyle(entry.agent == nil ? .tertiary : .secondary)
            }
            .width(min: 36, ideal: 40, max: 100)

            TableColumn("Action") { entry in
                Text(verbatim: entry.command)
                    .monospaced()
                    .foregroundStyle(entry.actionTone == .neutral ? AnyShapeStyle(.primary) : entry.actionTone.text)
            }
            .width(min: 90, ideal: 150)

            TableColumn("Tab") { entry in
                Text(verbatim: entry.tabId.map(String.init) ?? "—")
                    .monospaced()
                    .foregroundStyle(entry.tabId == nil ? .tertiary : .secondary)
            }
            .width(min: 40, ideal: 48, max: 110)

            TableColumn("Site") { entry in
                Text(verbatim: entry.siteDisplay)
                    .foregroundStyle(entry.url == nil ? .tertiary : .primary)
                    .lineLimit(1)
                    .truncationMode(.middle)
            }
            .width(min: 60, ideal: 84)

            TableColumn("Result") { entry in
                AuditOutcomeLabel(entry: entry, compact: true)
            }
            .width(min: 70, ideal: 84)
        }
        .tableStyle(.inset)
        .scrollContentBackground(.hidden)
    }
}

private struct AuditFilterBar: View {
    @Bindable var store: AuditStore

    var body: some View {
        HStack(spacing: GateMetrics.space3) {
            Picker("Time range", selection: $store.timeFilter) {
                ForEach(AuditTimeFilter.allCases) { filter in
                    Text(filter.title)
                        .tag(filter)
                        .accessibilityLabel(filter.accessibilityTitle)
                }
            }
            .pickerStyle(.segmented)
            .labelsHidden()
            .fixedSize()
            .help("Time range")

            Picker("Action", selection: $store.commandFilter) {
                Text("All actions").tag(AuditLogViewEntry.allFilterValue)
                Divider()
                ForEach(store.commandOptions, id: \.self) { command in
                    Text(verbatim: command).tag(command)
                }
            }
            .labelsHidden()
            .frame(maxWidth: 170)
            .help("Filter by action")

            Picker("Tab", selection: $store.tabFilter) {
                Text("All tabs").tag(AuditLogViewEntry.allFilterValue)
                Divider()
                ForEach(store.tabOptions, id: \.self) { tab in
                    Text(verbatim: tab).tag(tab)
                }
            }
            .labelsHidden()
            .frame(maxWidth: 130)
            .help("Filter by tab")

            Spacer(minLength: 0)

            if store.isFiltered {
                Button("Clear Filters", action: store.clearFilters)
                    .buttonStyle(.link)
            }
        }
        .controlSize(.regular)
        .padding(.horizontal, GateMetrics.space4)
        .padding(.vertical, GateMetrics.space2)
    }
}

private struct AuditStatusBar: View {
    var store: AuditStore

    var body: some View {
        HStack(spacing: GateMetrics.space2) {
            if store.isReloading {
                ProgressView()
                    .controlSize(.mini)
            }
            Text("\(store.filteredEntries.count) of \(store.entries.count) loaded entries")
            Text(verbatim: "·").accessibilityHidden(true)
            Text("latest \(AuditStore.entryLoadLimit) lines")
            Spacer(minLength: 0)
            Label(store.logIsOwnerOnly ? "Owner-only (0600)" : "Local file", systemImage: "lock")
                .labelStyle(.titleAndIcon)
        }
        .font(.caption)
        .foregroundStyle(.secondary)
        .padding(.horizontal, GateMetrics.space4)
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
