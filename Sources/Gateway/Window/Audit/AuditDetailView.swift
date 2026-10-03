import SwiftUI
import AppKit
import GatewayCore

/// Everything recorded for one audit entry, in the inspector.
struct AuditDetailView: View {
    var entry: AuditLogViewEntry

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: GateMetrics.space5) {
                header
                summary
                if !entry.auditDiffPreview.isEmpty {
                    diff
                }
                if !entry.detailRows.isEmpty {
                    details
                }
                if let raw = entry.rawDetails {
                    rawJSON(raw)
                }
                location
            }
            .padding(GateMetrics.space4)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space1) {
            Text(verbatim: entry.command)
                .font(.title3.monospaced().weight(.semibold))
                .foregroundStyle(entry.actionTone == .neutral ? AnyShapeStyle(.primary) : entry.actionTone.text)
                .textSelection(.enabled)
            AuditOutcomeLabel(entry: entry)
            Text(entry.timeText)
                .font(.callout)
                .foregroundStyle(.secondary)
        }
    }

    private var summary: some View {
        Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: GateMetrics.space3, verticalSpacing: GateMetrics.space2) {
            row("Agent", entry.agentDisplay)
            row("Action", entry.action)
            row("Tab", entry.tabDisplay)
            row("Site", entry.siteDisplay)
            if let url = entry.url {
                row("URL", url)
            }
            row("Target", entry.selectedTarget)
            row("Result", entry.resultSummary)
            if let extensionId = entry.extensionId {
                row("Extension", String(extensionId.prefix(8)))
            }
        }
    }

    private func row(_ key: String, _ value: String) -> some View {
        GridRow {
            Text(key)
                .font(.callout)
                .foregroundStyle(.secondary)
                .gridColumnAlignment(.trailing)
            Text(verbatim: value)
                .font(.callout.monospaced())
                .textSelection(.enabled)
                .lineLimit(4)
                .truncationMode(.middle)
        }
    }

    private var diff: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            SectionLabel(title: "Audit diff")
            VStack(alignment: .leading, spacing: 2) {
                ForEach(entry.auditDiffPreview, id: \.self) { line in
                    Text(verbatim: line)
                        .foregroundStyle(diffStyle(line))
                        .textSelection(.enabled)
                }
            }
            .font(.callout.monospaced())
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(GateMetrics.space3)
            .background(GateColor.inset, in: .rect(cornerRadius: GateMetrics.radiusControl))
        }
    }

    private func diffStyle(_ line: String) -> AnyShapeStyle {
        if line.hasPrefix("+") { return AnyShapeStyle(GateColor.signalText) }
        if line.hasPrefix("-") { return AnyShapeStyle(GateColor.dangerText) }
        return AnyShapeStyle(.secondary)
    }

    private var details: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            SectionLabel(title: "Details", count: entry.detailRows.count)
            Grid(alignment: .leadingFirstTextBaseline, horizontalSpacing: GateMetrics.space3, verticalSpacing: GateMetrics.space1) {
                ForEach(entry.detailRows) { detail in
                    GridRow {
                        Text(verbatim: detail.key)
                            .foregroundStyle(.secondary)
                        Text(verbatim: detail.value)
                            .textSelection(.enabled)
                            .lineLimit(5)
                    }
                }
            }
            .font(.callout.monospaced())
        }
    }

    private func rawJSON(_ raw: String) -> some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            HStack {
                SectionLabel(title: "Raw details")
                Spacer()
                CopyButton(label: "Copy raw JSON", value: raw)
            }
            Text(verbatim: raw)
                .font(.caption.monospaced())
                .foregroundStyle(.secondary)
                .textSelection(.enabled)
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(GateMetrics.space3)
                .background(GateColor.inset, in: .rect(cornerRadius: GateMetrics.radiusControl))
        }
    }

    private var location: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            SectionLabel(title: "Stored in")
            HStack(spacing: GateMetrics.space2) {
                Text(verbatim: ABGConstants.auditLogPath)
                    .font(.caption.monospaced())
                    .foregroundStyle(.secondary)
                    .lineLimit(2)
                    .truncationMode(.middle)
                    .textSelection(.enabled)
                Spacer(minLength: 0)
                Button("Show in Finder", systemImage: "arrow.up.forward.app") {
                    NSWorkspace.shared.selectFile(ABGConstants.auditLogPath, inFileViewerRootedAtPath: "")
                }
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .help("Show in Finder")
                CopyButton(label: "Copy path", value: ABGConstants.auditLogPath)
            }
        }
    }
}
