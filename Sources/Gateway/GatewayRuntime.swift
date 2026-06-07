import Foundation
import GatewayCore

@MainActor
protocol GatewayRuntime: AnyObject, Sendable {
    func setStatus(_ message: String)
    func handleExtensionMessage(_ message: ExtensionMessage, from extensionId: String)
    func extensionDisconnected(_ extensionId: String)
    func handleCLIRequest(_ request: CLIRequest) async -> CLIResponse
}
