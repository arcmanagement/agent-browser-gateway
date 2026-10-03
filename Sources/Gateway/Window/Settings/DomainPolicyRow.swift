import SwiftUI
import GatewayCore

struct DomainPolicyRow: View {
    var policy: GatewayDomainPolicy
    var remove: () -> Void

    var body: some View {
        HStack(spacing: GateMetrics.space3) {
            VStack(alignment: .leading, spacing: 2) {
                Text(verbatim: policy.domain)
                    .font(.body.monospaced())
                Text(summary)
                    .font(.caption)
                    .foregroundStyle(.secondary)
            }
            Spacer(minLength: GateMetrics.space2)
            GateBadge(text: policy.action.title, tone: policy.action.tone)
            Button("Remove policy for \(policy.domain)", systemImage: "minus.circle", action: remove)
                .labelStyle(.iconOnly)
                .buttonStyle(.borderless)
                .foregroundStyle(.secondary)
                .help("Remove this policy (takes effect after Save)")
        }
        .accessibilityElement(children: .contain)
    }

    private var summary: String {
        let scope = policy.appliesToSubdomains ? "with subdomains" : "this domain only"
        return "\(policy.approvalMode.displayTitle) · \(policy.timeoutMs / 1000)s timeout · \(scope)"
    }
}

/// Inline form row for adding a policy; Return in the domain field adds it.
struct NewDomainPolicyRow: View {
    @Bindable var model: SettingsModel

    var body: some View {
        VStack(alignment: .leading, spacing: GateMetrics.space2) {
            HStack(spacing: GateMetrics.space2) {
                TextField("Domain", text: $model.newPolicyDomain, prompt: Text(verbatim: "example.com"))
                    .labelsHidden()
                    .font(.body.monospaced())
                    .onSubmit(model.addDomainPolicy)
                Picker("Action", selection: $model.newPolicyAction) {
                    ForEach(GatewayDomainPolicyAction.allCases) { action in
                        Text(action.title).tag(action)
                    }
                }
                .labelsHidden()
                .fixedSize()
                Picker("Approval", selection: $model.newPolicyApprovalMode) {
                    ForEach(GatewayApprovalMode.allCases) { mode in
                        Text(mode.displayTitle).tag(mode)
                    }
                }
                .labelsHidden()
                .fixedSize()
            }
            HStack(spacing: GateMetrics.space2) {
                Toggle("Include subdomains", isOn: $model.newPolicyAppliesToSubdomains)
                    .toggleStyle(.checkbox)
                Spacer(minLength: 0)
                TextField("Policy timeout in milliseconds", value: $model.clampedNewPolicyTimeoutMs, format: .number)
                    .labelsHidden()
                    .monospacedDigit()
                    .multilineTextAlignment(.trailing)
                    .frame(width: 84)
                Text("ms")
                    .foregroundStyle(.secondary)
                Stepper("Policy timeout", value: $model.clampedNewPolicyTimeoutMs, in: SettingsModel.timeoutRange, step: 1_000)
                    .labelsHidden()
                Button("Add Policy", action: model.addDomainPolicy)
                    .disabled(!model.canAddDomainPolicy)
            }
        }
        .padding(.vertical, GateMetrics.space1)
    }
}
