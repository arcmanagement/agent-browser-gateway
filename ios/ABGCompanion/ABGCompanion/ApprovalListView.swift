import SwiftUI

struct ApprovalListView: View {
    @ObservedObject var model: CompanionModel
    @State private var now = Date()
    @State private var selected: ApprovalSummary?

    private let tick = Timer.publish(every: 1, on: .main, in: .common).autoconnect()

    var body: some View {
        List {
            Section("Safari tab sharing") {
                Label("Enable ABG in Safari's Manage Extensions screen", systemImage: "safari")
                Label("Open ABG from the page menu and tap Share this tab", systemImage: "rectangle.and.hand.point.up.left")
                Text("The first release supports tab listing, page reads, element inspection, and visible screenshots. Page-changing commands stay disabled.")
                    .font(.footnote)
                    .foregroundStyle(.secondary)
            }
            Section {
                if model.pending.isEmpty {
                    ContentUnavailableView(
                        "No requests waiting",
                        systemImage: "checkmark.shield",
                        description: Text("Requests from your desktop agent appear here while this app is open.")
                    )
                    .listRowBackground(Color.clear)
                } else {
                    ForEach(model.pending) { approval in
                        Button { selected = approval } label: {
                            ApprovalRow(approval: approval, now: now)
                        }
                        .buttonStyle(.plain)
                    }
                }
            } header: {
                if let gateway = model.gateway {
                    HStack {
                        Circle()
                            .fill(model.connected ? Color.green : Color.gray)
                            .frame(width: 8, height: 8)
                        Text(gateway.gatewayLabel)
                        Spacer()
                        Text(model.connected ? "Connected" : "Not connected")
                    }
                    .font(.footnote)
                    .textCase(nil)
                }
            } footer: {
                if let outcome = model.lastOutcome {
                    Text(outcome).font(.footnote)
                }
            }
        }
        .sheet(item: $selected) { approval in
            ApprovalDetailView(approval: approval, now: now) { decision in
                model.decide(approval, decision: decision)
                selected = nil
            }
        }
        .onReceive(tick) { value in
            now = value
            model.pruneExpired(now: value)
        }
    }
}

struct ApprovalRow: View {
    let approval: ApprovalSummary
    let now: Date

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            HStack(spacing: 8) {
                Image(systemName: approval.isDestructive ? "exclamationmark.triangle.fill" : "hand.raised.fill")
                    .foregroundStyle(approval.isDestructive ? Color.orange : Color.secondary)
                Text(approval.method)
                    .font(.subheadline.weight(.semibold).monospaced())
                Spacer()
                Text(remaining)
                    .font(.caption.monospacedDigit())
                    .foregroundStyle(.secondary)
            }
            Text(approval.intent)
                .font(.body)
                .lineLimit(3)
            Text(approval.targetOrigin)
                .font(.caption)
                .foregroundStyle(.secondary)
        }
        .padding(.vertical, 4)
    }

    private var remaining: String {
        let seconds = max(0, Int(approval.expiresAt.timeIntervalSince(now)))
        return "\(min(seconds, 60))s"
    }
}

struct ApprovalDetailView: View {
    let approval: ApprovalSummary
    let now: Date
    let decide: (String) -> Void

    @State private var confirmingAllow = false
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(approval.intent).font(.body)
                } header: {
                    Text("Request")
                }

                Section("Details") {
                    LabeledContent("Operation", value: approval.method)
                    LabeledContent("Origin", value: approval.targetOrigin)
                    LabeledContent("Tab", value: approval.targetTabRef.isEmpty ? "—" : approval.targetTabRef)
                    LabeledContent("Requested by", value: approval.requester)
                    LabeledContent("Gateway", value: approval.gatewayLabel)
                    LabeledContent("Expires in", value: "\(min(max(0, Int(approval.expiresAt.timeIntervalSince(now))), 60))s")
                }

                if let preview = approval.scriptPreview, !preview.isEmpty {
                    Section("Script") {
                        Text(preview)
                            .font(.caption.monospaced())
                            .textSelection(.enabled)
                    }
                }

                Section {
                    // Standard list actions: the system styles them, and the
                    // destructive role keeps Allow from reading as the safe
                    // default. Allow still needs a second, deliberate tap.
                    if approval.canAllow {
                        Button(confirmingAllow ? allowConfirmLabel : "Allow…") {
                            if confirmingAllow {
                                decide("allow")
                            } else {
                                confirmingAllow = true
                            }
                        }
                    } else {
                        Text("This request can only be allowed on the desktop, where the capture permission is granted.")
                            .font(.footnote)
                            .foregroundStyle(.secondary)
                    }

                    Button("Deny", role: .destructive) {
                        decide("deny")
                    }
                } footer: {
                    if approval.isDestructive {
                        Text("This operation changes or removes data and cannot be undone by ABG. Allow it only if you asked for it just now.")
                            .foregroundStyle(.orange)
                    } else {
                        Text("Allowing runs this operation on the shared tab of your desktop browser.")
                    }
                }
            }
            .navigationTitle("Approve request?")
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .topBarLeading) {
                    Button("Close") { dismiss() }
                }
            }
        }
    }

    private var allowConfirmLabel: String {
        approval.isDestructive ? "Tap again to allow this destructive action" : "Confirm allow"
    }
}
