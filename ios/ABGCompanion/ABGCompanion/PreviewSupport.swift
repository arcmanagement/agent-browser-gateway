import Foundation

#if DEBUG
/// Launch argument used to populate the approval list with representative
/// requests for App Store screenshots. Never active in a Release build.
enum ScreenshotMode {
    static var isEnabled: Bool {
        ProcessInfo.processInfo.arguments.contains("-ABGScreenshotMode")
    }

    static var gateway: PairedGateway {
        PairedGateway(
            deviceId: "preview-device",
            gatewayBaseUrl: "http://100.64.0.5:8767",
            gatewayLabel: "studio-mac",
            pairedAt: Date()
        )
    }

    static var approvals: [ApprovalSummary] {
        let now = Date()
        return [
            ApprovalSummary(
                approvalId: "preview-1",
                method: "click_selector",
                intent: "Click the element matching selector \"button.save\".",
                targetOrigin: "https://admin.example.com",
                targetTabRef: "t3",
                requester: "cli",
                gatewayLabel: "studio-mac",
                createdAt: now,
                expiresAt: now.addingTimeInterval(48),
                scriptPreview: nil,
                canAllow: true
            ),
            ApprovalSummary(
                approvalId: "preview-2",
                method: "personal_data_mutation",
                intent: "PERMANENTLY DELETE bookmark \"Old release notes\".",
                targetOrigin: "https://news.example.com",
                targetTabRef: "t5",
                requester: "cli",
                gatewayLabel: "studio-mac",
                createdAt: now,
                expiresAt: now.addingTimeInterval(41),
                scriptPreview: nil,
                canAllow: true
            ),
        ]
    }
}
#endif
