import SwiftUI

/// The latest audit lines in monospace: the product's evidence, readable at a glance.
struct RecentActivityView: View {
    var store: AuditStore
    var openAudit: () -> Void

    private static let limit = 6

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space3) {
            HStack {
                SectionLabel(title: "Recent activity")
                Spacer()
                Button("Open Audit", action: openAudit)
                    .buttonStyle(.link)
            }

            if store.entries.isEmpty {
                Text(store.hasLoaded ? "Nothing yet. Every command an agent runs on a shared tab is logged here and in audit.jsonl." : "Loading the audit log…")
                    .font(.callout)
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, minHeight: 120, alignment: .topLeading)
            } else {
                VStack(spacing: 0) {
                    ForEach(store.entries.prefix(Self.limit)) { entry in
                        AuditEvidenceLine(entry: entry)
                        if entry.id != store.entries.prefix(Self.limit).last?.id {
                            Divider()
                        }
                    }
                }
            }
        }
        .gateCard()
    }
}

/// One audit entry as a single scannable line: time, action, tab, result.
struct AuditEvidenceLine: View {
    var entry: AuditLogViewEntry

    var body: some View {
        HStack(spacing: GateMetrics.space3) {
            Text(verbatim: entry.shortTimeText)
                .foregroundStyle(.secondary)
                .lineLimit(1)
                .fixedSize()
                .frame(minWidth: 64, alignment: .leading)
            Text(verbatim: entry.command)
                .foregroundStyle(entry.actionTone == .neutral ? AnyShapeStyle(.primary) : entry.actionTone.text)
                .lineLimit(1)
                .frame(maxWidth: .infinity, alignment: .leading)
            Text(verbatim: entry.tabId.map { "tab \($0)" } ?? "—")
                .foregroundStyle(.secondary)
                .lineLimit(1)
            AuditOutcomeLabel(entry: entry, compact: true)
                .frame(width: 92, alignment: .leading)
        }
        .font(.callout.monospaced())
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
    }
}
