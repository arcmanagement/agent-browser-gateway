import SafariServices

final class SafariWebExtensionHandler: NSObject, NSExtensionRequestHandling {
    func beginRequest(with context: NSExtensionContext) {
        let request = context.inputItems.first as? NSExtensionItem
        let message = request?.userInfo?[SFExtensionMessageKey] as? [String: Any]

        let payload: [String: Any]
        if message?["type"] as? String == "get_gateway_session" {
            payload = gatewaySessionPayload()
        } else {
            payload = ["ok": false, "error": "unsupported_message"]
        }

        let response = NSExtensionItem()
        response.userInfo = [SFExtensionMessageKey: payload]
        context.completeRequest(returningItems: [response], completionHandler: nil)
    }

    private func gatewaySessionPayload() -> [String: Any] {
        let store = PairingStore()
        guard let gateway = store.loadGateway(), let sessionToken = store.sessionToken() else {
            return ["ok": false, "paired": false, "error": "not_paired"]
        }
        let websocketBase = gateway.gatewayBaseUrl
            .replacingOccurrences(of: "http://", with: "ws://")
            .replacingOccurrences(of: "https://", with: "wss://")
        return [
            "ok": true,
            "paired": true,
            "deviceId": gateway.deviceId,
            "gatewayLabel": gateway.gatewayLabel,
            "gatewayBaseUrl": gateway.gatewayBaseUrl,
            "websocketUrl": "\(websocketBase)/browser",
            "sessionToken": sessionToken,
        ]
    }
}
