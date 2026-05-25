import Foundation
import SwiftUI
import GatewayCore

@MainActor
final class GatewayCoordinator: ObservableObject {
    static let shared = GatewayCoordinator()

    @Published var permittedTabs: [PermittedTab] = []
    @Published var connectedExtensionIds: [String] = []
    /// extensionId -> friendly profile label (empty/nil if user hasn't set one)
    @Published var extensionProfiles: [String: String] = [:]
    /// extensionId -> browser kind ("chrome", "edge", future "firefox")
    @Published var extensionBrowsers: [String: String] = [:]
    /// extensionId -> browser extension version reported by the extension hello
    @Published var extensionVersions: [String: String] = [:]
    @Published var statusMessage: String = "Starting…"

    private(set) var auditLog = AuditLog()
    private(set) var wsServer: WSServer?
    private(set) var udsServer: UDSServer?
    private(set) lazy var pluginHost = PluginHost(abgVersion: "0.3.6") { [weak self] method, params in
        guard let self else {
            throw PluginTabAPIError.dispatcherUnavailable
        }
        return try await self.dispatchPluginTabCommand(method: method, params: params)
    }

    // In-flight commands: id -> continuation
    private var inflight: [String: CheckedContinuation<AnyCodable?, Error>] = [:]

    private init() {}

    func start() {
        pluginHost.loadAll(from: PluginHost.defaultSearchPaths())

        let ws = WSServer(coordinator: self)
        wsServer = ws
        Task.detached { [self] in
            do {
                try await ws.start()
            } catch {
                await self.setStatus("WS error: \(error.localizedDescription)")
            }
        }

        let uds = UDSServer()
        udsServer = uds
        Task.detached { [self] in
            do {
                try await uds.start(coordinator: self)
            } catch {
                await self.setStatus("UDS error: \(error.localizedDescription)")
            }
        }

        statusMessage = "Running on \(ABGConstants.wsHost):\(ABGConstants.wsPort)"
    }

    func setStatus(_ msg: String) { statusMessage = msg }

    // MARK: - Extension messages

    func extensionConnected(_ extensionId: String) {
        if !connectedExtensionIds.contains(extensionId) { connectedExtensionIds.append(extensionId) }
        Task { await auditLog.log(action: "extension_connected", extensionId: extensionId) }
    }

    func extensionDisconnected(_ extensionId: String) {
        connectedExtensionIds.removeAll { $0 == extensionId }
        extensionProfiles.removeValue(forKey: extensionId)
        extensionBrowsers.removeValue(forKey: extensionId)
        extensionVersions.removeValue(forKey: extensionId)
        permittedTabs.removeAll { $0.extensionId == extensionId }
        Task { await auditLog.log(action: "extension_disconnected", extensionId: extensionId) }
    }

    func handleExtensionMessage(_ msg: ExtensionMessage, from extensionId: String) {
        switch msg {
        case .hello(_, let version, let profileLabel, let browserKind):
            extensionConnected(extensionId)
            extensionVersions[extensionId] = version
            if let label = profileLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !label.isEmpty {
                extensionProfiles[extensionId] = label
            } else {
                extensionProfiles.removeValue(forKey: extensionId)
            }
            if let kind = browserKind, !kind.isEmpty {
                extensionBrowsers[extensionId] = kind
            }
        case .tabPermitted(let tabId, let url, let title, let origin, let expiresAt):
            permittedTabs.removeAll { $0.extensionId == extensionId && $0.tabId == tabId }
            permittedTabs.append(PermittedTab(extensionId: extensionId, tabId: tabId, url: url, title: title, origin: origin, permittedAt: Date(), expiresAt: expiresAt))
            Task { await auditLog.log(action: "permit", extensionId: extensionId, tabId: tabId, url: url) }
        case .tabRevoked(let tabId, let reason):
            if let idx = permittedTabs.firstIndex(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                let url = permittedTabs[idx].url
                permittedTabs.remove(at: idx)
                Task { await auditLog.log(action: "revoke", extensionId: extensionId, tabId: tabId, url: url, details: ["reason": AnyCodable(reason)]) }
            }
        case .tabUpdated(let tabId, let url, let title, let origin):
            if let idx = permittedTabs.firstIndex(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                permittedTabs[idx].url = url
                permittedTabs[idx].title = title
                permittedTabs[idx].origin = origin
            }
        case .tabClosed(let tabId):
            if let idx = permittedTabs.firstIndex(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                let url = permittedTabs[idx].url
                permittedTabs.remove(at: idx)
                Task { await auditLog.log(action: "tab_closed", extensionId: extensionId, tabId: tabId, url: url) }
            }
        case .response(let id, let result, let error):
            if let cont = inflight.removeValue(forKey: id) {
                if let error = error {
                    cont.resume(throwing: NSError(domain: "ABG", code: 1, userInfo: [NSLocalizedDescriptionKey: "\(error.code): \(error.message)"]))
                } else {
                    cont.resume(returning: result)
                }
            }
        }
    }

    // MARK: - CLI requests

    func handleCLIRequest(_ req: CLIRequest) async -> CLIResponse {
        switch req.method {
        case "status":
            let extDetails = extensionDetails()
            return CLIResponse(id: req.id, result: AnyCodable([
                "running": true,
                "wsHost": ABGConstants.wsHost,
                "wsPort": ABGConstants.wsPort,
                "extensions": extDetails,
                "extensionCount": extDetails.count,
                "permittedTabCount": permittedTabs.count,
            ]))
        case "list_tabs":
            return CLIResponse(id: req.id, result: AnyCodable(tabSummaries()))
        case "inspect":
            return CLIResponse(id: req.id, result: AnyCodable([
                "running": true,
                "wsHost": ABGConstants.wsHost,
                "wsPort": ABGConstants.wsPort,
                "extensions": extensionDetails(),
                "extensionCount": connectedExtensionIds.count,
                "permittedTabCount": permittedTabs.count,
                "tabs": tabSummaries(),
            ]))
        case "read_tab":
            return await handleReadTab(req: req)
        case "get_tab":
            return await dispatch(req: req, method: "get_dom")
        case "screenshot_tab":
            return await dispatch(req: req, method: "screenshot")
        case "pdf_tab":
            return await dispatch(req: req, method: "pdf")
        case "console_tab":
            return await dispatch(req: req, method: "console")
        case "table_tab":
            return await dispatch(req: req, method: "table")
        case "describe_tab":
            return await dispatch(req: req, method: "describe")
        case "network_tab":
            return await dispatch(req: req, method: "network_log")
        case "click_tab":
            // routes to either click_selector or click_at depending on params
            let params = (req.params?.value as? [String: Any]) ?? [:]
            if params["selector"] != nil {
                return await dispatch(req: req, method: "click_selector")
            } else if params["id"] != nil {
                return await dispatch(req: req, method: "click_described")
            } else if params["x"] != nil, params["y"] != nil {
                return await dispatch(req: req, method: "click_at")
            } else {
                return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "selector, id, or (x,y) required"))
            }
        case "dblclick_tab":
            return await dispatch(req: req, method: "dblclick_selector")
        case "focus_tab":
            return await dispatch(req: req, method: "focus_selector")
        case "hover_tab":
            return await dispatch(req: req, method: "hover_selector")
        case "select_tab":
            return await dispatch(req: req, method: "select_option")
        case "checked_state_tab":
            return await dispatch(req: req, method: "set_checked")
        case "fill_tab":
            return await dispatch(req: req, method: "fill")
        case "paste_tab":
            return await dispatch(req: req, method: "paste")
        case "clear_tab":
            return await dispatch(req: req, method: "clear")
        case "replace_tab":
            return await dispatch(req: req, method: "replace_dom")
        case "upload_tab":
            return await dispatch(req: req, method: "upload_file")
        case "type_tab":
            return await dispatch(req: req, method: "type_text")
        case "key_tab":
            return await dispatch(req: req, method: "key_press")
        case "key_down_tab":
            return await dispatch(req: req, method: "key_down")
        case "key_up_tab":
            return await dispatch(req: req, method: "key_up")
        case "keyboard_insert_text_tab":
            return await dispatch(req: req, method: "keyboard_insert_text")
        case "navigate_tab":
            return await dispatch(req: req, method: "navigate")
        case "scroll_tab":
            return await dispatch(req: req, method: "scroll")
        case "scroll_into_view_tab":
            return await dispatch(req: req, method: "scroll_into_view")
        case "drag_tab":
            return await dispatch(req: req, method: "drag")
        case "wait_tab":
            return await dispatch(req: req, method: "wait_for")
        case "annotate_tab":
            return await dispatch(req: req, method: "annotation_mode")
        case "revoke_tab":
            guard let tabId = (req.params?.value as? [String: Any])?["tabId"] as? Int else {
                return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
            }
            // Send revoke to all extensions; the one owning it will act
            for extId in connectedExtensionIds {
                _ = try? await sendCommand(to: extId, method: "revoke", params: AnyCodable(["tabId": tabId]))
            }
            permittedTabs.removeAll { $0.tabId == tabId }
            await auditLog.log(action: "revoke_via_cli", tabId: tabId)
            return CLIResponse(id: req.id, result: AnyCodable(["ok": true]))
        case "audit":
            let lines = (req.params?.value as? [String: Any])?["lines"] as? Int ?? 50
            let entries = await auditLog.tail(lines: lines)
            let summarized: [[String: Any]] = entries.map { e in
                var dict: [String: Any] = ["ts": ISO8601DateFormatter().string(from: e.ts), "action": e.action]
                if let v = e.extensionId { dict["extensionId"] = v }
                if let v = e.tabId { dict["tabId"] = v }
                if let v = e.url { dict["url"] = v }
                if let v = e.details { dict["details"] = v.mapValues(\.value) }
                return dict
            }
            return CLIResponse(id: req.id, result: AnyCodable(summarized))
        case "plugins":
            return CLIResponse(id: req.id, result: AnyCodable(pluginHost.loadedPluginSummaries()))
        case "plugin_command_list":
            return CLIResponse(id: req.id, result: AnyCodable(pluginHost.commandList()))
        case "plugin_command_run":
            return await handlePluginCommandRun(req: req)
        default:
            return CLIResponse(id: req.id, error: ErrorPayload(code: "unknown_method", message: req.method))
        }
    }

    private func handlePluginCommandRun(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let pluginName = params["pluginName"] as? String,
              let commandName = params["command"] as? String
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "pluginName and command are required"))
        }
        let args = params["args"] as? [String: Any] ?? [:]
        let tabId = params["tabId"] as? Int
        do {
            let argsData = try? JSONSerialization.data(withJSONObject: args, options: [])
            await auditLog.log(
                action: "plugin_command_run",
                tabId: tabId,
                agent: "cli",
                details: [
                    "plugin": AnyCodable(pluginName),
                    "command": AnyCodable(commandName),
                    "argsKeys": AnyCodable(args.keys.sorted()),
                    "argsBytes": AnyCodable(argsData?.count ?? 0),
                ]
            )
            let result = try await pluginHost.runCommand(plugin: pluginName, command: commandName, args: args, tabId: tabId)
            return CLIResponse(id: req.id, result: result)
        } catch let error as PluginCommandError {
            return CLIResponse(
                id: req.id,
                error: ErrorPayload(
                    code: "plugin_command_failed",
                    message: error.localizedDescription,
                    plugin: pluginName,
                    command: commandName
                )
            )
        } catch {
            return CLIResponse(
                id: req.id,
                error: ErrorPayload(
                    code: "plugin_command_failed",
                    message: error.localizedDescription,
                    plugin: pluginName,
                    command: commandName
                )
            )
        }
    }

    private func dispatchPluginTabCommand(method: String, params: [String: Any]) async throws -> AnyCodable {
        let response = await handleCLIRequest(
            CLIRequest(id: UUID().uuidString, method: method, params: AnyCodable(params))
        )
        if let error = response.error {
            throw PluginTabAPIError.dispatchFailed(code: error.code, message: error.message)
        }
        return response.result ?? AnyCodable(NSNull())
    }

    /// `read_tab` always asks the extension for raw text+html. When asMarkdown is requested,
    /// the html-to-markdown plugin transformer is invoked here in the Gateway.
    private func handleReadTab(req: CLIRequest) async -> CLIResponse {
        guard var params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        let wantMarkdown = (params["asMarkdown"] as? Bool) ?? false
        let keepImages = (params["keepImages"] as? Bool) ?? false
        params.removeValue(forKey: "asMarkdown")
        params.removeValue(forKey: "keepImages")
        do {
            let result = try await sendCommand(to: tab.extensionId, method: "read_dom", params: AnyCodable(params))
            await auditLog.log(action: "read_dom", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli")
            guard wantMarkdown,
                  var dict = result?.value as? [String: Any],
                  let html = dict["html"] as? String
            else {
                return CLIResponse(id: req.id, result: result)
            }
            if !keepImages, let domainResult = pluginHost.domainTransform(url: tab.url, kind: "markdown", input: html) {
                dict["markdown"] = domainResult.output
                dict["markdownTransform"] = domainResult.name
                dict.removeValue(forKey: "html")
                return CLIResponse(id: req.id, result: AnyCodable(dict))
            }
            guard let markdown = pluginHost.transform(name: keepImages ? "html-to-markdown-keep-images" : "html-to-markdown", input: html) else {
                return CLIResponse(id: req.id, result: result)
            }
            dict["markdown"] = markdown
            dict["markdownTransform"] = keepImages ? "html-to-markdown-keep-images" : "html-to-markdown"
            dict.removeValue(forKey: "html")
            return CLIResponse(id: req.id, result: AnyCodable(dict))
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "command_failed", message: error.localizedDescription))
        }
    }

    private func dispatch(req: CLIRequest, method: String) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        do {
            // Pass through all params (selector, value, x/y, etc.) so extension handlers can read them.
            let result = try await sendCommand(to: tab.extensionId, method: method, params: AnyCodable(params))
            let details: [String: AnyCodable]? = {
                guard method == "paste" || method == "clear" else { return nil }
                var values: [String: AnyCodable] = [:]
                if let selector = params["selector"] as? String {
                    values["selector"] = AnyCodable(selector)
                }
                if method == "paste", let value = params["value"] as? String {
                    values["textBytes"] = AnyCodable(value.utf8.count)
                }
                return values.isEmpty ? nil : values
            }()
            await auditLog.log(action: method, extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli", details: details)
            return CLIResponse(id: req.id, result: result)
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "command_failed", message: error.localizedDescription))
        }
    }

    private func tabSummary(_ tab: PermittedTab) -> [String: Any] {
        var dict: [String: Any] = [
            "extensionId": tab.extensionId,
            "tabId": tab.tabId,
            "url": tab.url,
            "title": tab.title,
            "origin": tab.origin,
            "permittedAt": ISO8601DateFormatter().string(from: tab.permittedAt),
        ]
        if let label = extensionProfiles[tab.extensionId] { dict["profile"] = label }
        if let kind = extensionBrowsers[tab.extensionId] { dict["browser"] = kind }
        if let exp = tab.expiresAt {
            dict["expiresAt"] = ISO8601DateFormatter().string(from: exp)
        }
        return dict
    }

    private func tabSummaries() -> [[String: Any]] {
        permittedTabs.enumerated().map { index, tab in
            var dict = tabSummary(tab)
            dict["ref"] = "t\(index + 1)"
            return dict
        }
    }

    private func extensionDetails() -> [[String: Any]] {
        connectedExtensionIds.map { id in
            var dict: [String: Any] = ["extensionId": id]
            if let label = extensionProfiles[id] { dict["profile"] = label }
            if let kind = extensionBrowsers[id] { dict["browser"] = kind }
            if let version = extensionVersions[id] { dict["version"] = version }
            return dict
        }
    }

    private func tabUnavailableError(tabId: Int) -> ErrorPayload {
        if connectedExtensionIds.isEmpty {
            return ErrorPayload(
                code: "extension_not_connected",
                message: "No browser extension is connected to the Gateway.",
                userMessage: "Chrome 拡張機能が Gateway に接続されていません。拡張機能がインストール/有効化されているか確認し、対象タブで ABG アイコンを開いてください。",
                nextCommand: "abg status",
                tabId: tabId
            )
        }
        if permittedTabs.isEmpty {
            return ErrorPayload(
                code: "no_permitted_tabs",
                message: "No tabs are currently shared with ABG.",
                userMessage: "共有中のタブがありません。Chrome で対象タブを開き、ABG 拡張機能のアイコンから「このタブを共有」を有効にしてください。",
                nextCommand: "abg tabs --compact",
                tabId: tabId
            )
        }
        return ErrorPayload(
            code: "tab_not_permitted",
            message: "tabId \(tabId) is not shared or has expired.",
            userMessage: "このタブは共有許可されていないか、許可が切れています。Chrome 拡張機能のアイコンから対象タブの「このタブを共有」を有効にし、`abg tabs --compact` で最新の ref/tabId を確認してください。",
            nextCommand: "abg tabs --compact",
            tabId: tabId
        )
    }

    func sendCommand(to extensionId: String, method: String, params: AnyCodable?) async throws -> AnyCodable? {
        guard let ws = wsServer else { throw NSError(domain: "ABG", code: 2, userInfo: [NSLocalizedDescriptionKey: "WS server not started"]) }
        let id = UUID().uuidString
        let cmd = GatewayCommand(id: id, method: method, params: params)
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<AnyCodable?, Error>) in
            inflight[id] = cont
            Task {
                do {
                    try await ws.send(to: extensionId, command: cmd)
                } catch {
                    await MainActor.run {
                        if let c = self.inflight.removeValue(forKey: id) { c.resume(throwing: error) }
                    }
                }
            }
            // 30s timeout
            Task {
                try? await Task.sleep(nanoseconds: 30_000_000_000)
                await MainActor.run {
                    if let c = self.inflight.removeValue(forKey: id) {
                        c.resume(throwing: NSError(domain: "ABG", code: 3, userInfo: [NSLocalizedDescriptionKey: "command timeout"]))
                    }
                }
            }
        }
    }
}
