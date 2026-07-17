import Foundation
import Combine
import AppKit
import SwiftUI
import GatewayCore

@MainActor
final class GatewayCoordinator: ObservableObject, GatewayRuntime, @unchecked Sendable {
    static let shared = GatewayCoordinator()

    @Published var permittedTabs: [PermittedTab] = []
    @Published var connectedExtensionIds: [String] = []
    /// extensionId -> friendly profile label (empty/nil if user hasn't set one)
    @Published var extensionProfiles: [String: String] = [:]
    /// extensionId -> browser kind ("chrome", "edge", future "firefox")
    @Published var extensionBrowsers: [String: String] = [:]
    /// extensionId -> browser extension version reported by the extension hello
    @Published var extensionVersions: [String: String] = [:]
    @Published var pluginSummaries: [PluginHost.PluginSummary] = []
    @Published var statusMessage: String = "Starting…"

    private(set) var auditLog = AuditLog()
    private(set) var wsServer: WSServer?
    private(set) var udsServer: UDSServer?
    /// Whether the Unix socket transport is serving the CLI (false = WS /cli only).
    @Published private(set) var cliSocketActive = false
    private(set) lazy var pluginHost = PluginHost(abgVersion: ABGConstants.version) { [weak self] method, params in
        guard let self else {
            throw PluginTabAPIError.dispatcherUnavailable
        }
        return try await self.dispatchPluginTabCommand(method: method, params: params)
    }

    // In-flight commands: id -> continuation
    private var inflight: [String: CheckedContinuation<AnyCodable?, Error>] = [:]
    private var streamTabId: Int?
    private var streamExtensionId: String?

    // Active tab recording (single session, mirrors the stream model).
    private struct RecordingSession {
        let recordingId: String
        let tabId: Int
        let extensionId: String
        let outputPath: String
        let startedAt: Date
        var mic: Bool
        var handle: FileHandle?
        var bytes: Int
        var lastSeq: Int
    }
    private var recording: RecordingSession?
    private var lastFinishedRecording: [String: Any]?
    private var recordingStopWaiters: [String: CheckedContinuation<AnyCodable, Error>] = [:]

    private init() {}

    func start() {
        pluginHost.loadAll(from: PluginHost.defaultSearchPaths())
        refreshPluginSummaries()

        // Rendezvous for the CLI's WS fallback: rotate the token on every launch and
        // publish {token, port} where both unsandboxed and bundled sandboxed CLIs look.
        let cliToken = CLIEndpoint.generateToken()
        CLIEndpoint.write(token: cliToken, port: ABGConstants.wsPort)

        let ws = WSServer(runtime: self, cliToken: cliToken)
        wsServer = ws
        Task.detached { [self] in
            do {
                try await ws.start()
            } catch {
                await self.setStatus("WS error: \(error.localizedDescription)")
            }
        }

        // The socket path can exceed the 104-byte sun_path limit (long usernames,
        // relocated homes). That leaves the WS /cli fallback as the CLI transport —
        // a degraded-but-working state, not a startup error.
        let socketPath = ABGConstants.configuredCLISocketPath()
        if ABGConstants.fitsUnixSocketPath(socketPath) {
            cliSocketActive = true
            let uds = UDSServer()
            udsServer = uds
            Task.detached { [self] in
                do {
                    try await uds.start(runtime: self)
                } catch {
                    await MainActor.run { self.cliSocketActive = false }
                    await self.setStatus("UDS error: \(error.localizedDescription) — CLI stays available over loopback WS")
                }
            }
        } else {
            cliSocketActive = false
            print("[ABG] CLI socket path exceeds the sun_path limit (\(socketPath.utf8.count) bytes); CLI served over loopback WS only")
        }

        statusMessage = "Running on \(ABGConstants.wsHost):\(ABGConstants.wsPort) (\(ABGConstants.runtimeProfileLabel))"
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
        // A recording owned by this extension can no longer be finalized cleanly;
        // flush whatever was captured and fail any pending stop.
        if let session = recording, session.extensionId == extensionId {
            handleRecordInterrupted(recordingId: session.recordingId, reason: "extension_disconnected")
        }
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
        case .tabPermitted(let tabId, let url, let title, let origin, let expiresAt, let accessMode):
            permittedTabs.removeAll { $0.extensionId == extensionId && $0.tabId == tabId }
            permittedTabs.append(PermittedTab(extensionId: extensionId, tabId: tabId, url: url, title: title, origin: origin, permittedAt: Date(), expiresAt: expiresAt, accessMode: accessMode ?? "manual"))
            Task {
                await auditLog.log(
                    action: "permit",
                    extensionId: extensionId,
                    tabId: tabId,
                    url: url,
                    details: ["accessMode": AnyCodable(accessMode ?? "manual")]
                )
            }
        case .tabRevoked(let tabId, let reason):
            if let idx = permittedTabs.firstIndex(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                let url = permittedTabs[idx].url
                permittedTabs.remove(at: idx)
                Task { await auditLog.log(action: "revoke", extensionId: extensionId, tabId: tabId, url: url, details: ["reason": AnyCodable(reason)]) }
            }
        case .tabUpdated(let tabId, let url, let title, let origin, let accessMode):
            if let idx = permittedTabs.firstIndex(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                permittedTabs[idx].url = url
                permittedTabs[idx].title = title
                permittedTabs[idx].origin = origin
                if let accessMode {
                    permittedTabs[idx].accessMode = accessMode
                }
            }
        case .tabClosed(let tabId):
            if let idx = permittedTabs.firstIndex(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                let url = permittedTabs[idx].url
                permittedTabs.remove(at: idx)
                if streamTabId == tabId {
                    streamTabId = nil
                    streamExtensionId = nil
                }
                Task { await auditLog.log(action: "tab_closed", extensionId: extensionId, tabId: tabId, url: url) }
            }
        case .runtimeEvent(let tabId, let event):
            guard streamTabId == tabId else { return }
            var payload: [String: Any] = [
                "tabId": tabId,
                "ts": ISO8601DateFormatter().string(from: Date()),
            ]
            if let tab = permittedTabs.first(where: { $0.tabId == tabId }) {
                payload["url"] = tab.url
                payload["title"] = tab.title
            }
            if let eventDict = event.value as? [String: Any] {
                for (key, value) in eventDict { payload[key] = value }
            } else {
                payload["event"] = event.value
            }
            guard JSONSerialization.isValidJSONObject(payload),
                  let data = try? JSONSerialization.data(withJSONObject: payload),
                  let text = String(data: data, encoding: .utf8)
            else { return }
            Task { await wsServer?.broadcastRuntimeEvent(text) }
        case .recordChunk(let recordingId, let seq, let dataBase64):
            handleRecordChunk(recordingId: recordingId, seq: seq, dataBase64: dataBase64)
        case .recordStopped(let recordingId, let durationMs, let mime, let micUsed, let chunkCount):
            handleRecordStopped(recordingId: recordingId, durationMs: durationMs, mime: mime, micUsed: micUsed, chunkCount: chunkCount)
        case .recordFailed(let recordingId, let error):
            handleRecordFailed(recordingId: recordingId, error: error)
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
                "version": ABGConstants.version,
                "profile": ABGConstants.runtimeProfileLabel,
                "wsHost": ABGConstants.wsHost,
                "wsPort": ABGConstants.wsPort,
                "stateDir": ABGConstants.supportDir.path,
                "userDir": ABGConstants.abgUserDir.path,
                "auditLogPath": ABGConstants.auditLogPath,
                "cliSocketPath": ABGConstants.configuredCLISocketPath(),
                "cliTransports": cliSocketActive ? ["uds", "ws"] : ["ws"],
                "sandboxed": ABGConstants.isSandboxed,
                "extensions": extDetails,
                "extensionCount": extDetails.count,
                "permittedTabCount": permittedTabs.count,
            ]))
        case "list_tabs":
            return CLIResponse(id: req.id, result: AnyCodable(tabSummaries()))
        case "inspect":
            return CLIResponse(id: req.id, result: AnyCodable([
                "running": true,
                "version": ABGConstants.version,
                "profile": ABGConstants.runtimeProfileLabel,
                "wsHost": ABGConstants.wsHost,
                "wsPort": ABGConstants.wsPort,
                "stateDir": ABGConstants.supportDir.path,
                "userDir": ABGConstants.abgUserDir.path,
                "auditLogPath": ABGConstants.auditLogPath,
                "cliSocketPath": ABGConstants.configuredCLISocketPath(),
                "cliTransports": cliSocketActive ? ["uds", "ws"] : ["ws"],
                "sandboxed": ABGConstants.isSandboxed,
                "extensions": extensionDetails(),
                "extensionCount": connectedExtensionIds.count,
                "permittedTabCount": permittedTabs.count,
                "tabs": tabSummaries(),
            ]))
        case "bookmarks_list":
            return await handlePersonalDataCommand(req: req, method: "bookmarks_list")
        case "bookmarks_search":
            return await handlePersonalDataCommand(req: req, method: "bookmarks_search")
        case "bookmarks_get":
            return await handlePersonalDataCommand(req: req, method: "bookmarks_get")
        case "bookmarks_open":
            return await handlePersonalDataCommand(req: req, method: "bookmarks_open")
        case "reading_list_list":
            return await handlePersonalDataCommand(req: req, method: "reading_list_list")
        case "reading_list_search":
            return await handlePersonalDataCommand(req: req, method: "reading_list_search")
        case "frames_tab":
            return await dispatch(req: req, method: "frames")
        case "read_tab":
            return await handleReadTab(req: req)
        case "get_tab":
            return await dispatch(req: req, method: "get_dom")
        case "predicate_tab":
            return await dispatch(req: req, method: "predicate")
        case "find_tab":
            return await dispatch(req: req, method: "find")
        case "snapshot_tab":
            return await dispatch(req: req, method: "snapshot")
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
        case "har_tab":
            return await handleHarTab(req: req)
        case "state_tab":
            return await handleStateTab(req: req)
        case "framework_tab":
            return await dispatch(req: req, method: "framework_inspect")
        case "sandbox_tab":
            return await handleSandboxTab(req: req)
        case "download_tab":
            return await dispatch(req: req, method: "download_state")
        case "click_tab":
            // routes to either click_selector or click_at depending on params
            let params = (req.params?.value as? [String: Any]) ?? [:]
            if params["selector"] != nil {
                return await dispatch(req: req, method: "click_selector")
            } else if params["ref"] != nil {
                return await dispatch(req: req, method: "click_ref")
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
        case "clipboard_write":
            return await handleClipboardWrite(req: req)
        case "paste_rich_tab":
            return await handlePasteRichTab(req: req)
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
        case "exec_command_tab":
            return await dispatch(req: req, method: "exec_command")
        case "navigate_tab":
            return await dispatch(req: req, method: "navigate")
        case "scroll_tab":
            return await dispatch(req: req, method: "scroll")
        case "scroll_into_view_tab":
            return await dispatch(req: req, method: "scroll_into_view")
        case "drag_tab":
            return await dispatch(req: req, method: "drag")
        case "dialog_tab":
            let params = (req.params?.value as? [String: Any]) ?? [:]
            if params["action"] != nil {
                return await dispatch(req: req, method: "dialog_action")
            }
            return await dispatch(req: req, method: "dialog_state")
        case "wait_tab":
            return await dispatch(req: req, method: "wait_for")
        case "eval_tab":
            return await handleEvalTab(req: req)
        case "annotate_tab":
            return await dispatch(req: req, method: "annotation_mode")
        case "validate_editable_tab":
            return await dispatch(req: req, method: "validate_editable")
        case "stream_enable":
            return await handleStreamEnable(req: req)
        case "stream_status":
            return CLIResponse(id: req.id, result: AnyCodable(streamStatus()))
        case "stream_disable":
            return await handleStreamDisable(req: req)
        case "record_start":
            return await handleRecordStart(req: req)
        case "record_stop":
            return await handleRecordStop(req: req)
        case "record_status":
            return CLIResponse(id: req.id, result: AnyCodable(recordStatusPayload()))
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
        case "activity_digest":
            let period = (req.params?.value as? [String: Any])?["period"] as? String ?? "day"
            guard AuditLog.normalizeDigestPeriod(period) != nil else {
                return CLIResponse(
                    id: req.id,
                    error: ErrorPayload(
                        code: "bad_params",
                        message: "period must be day or week",
                        userMessage: "period は day か week を指定してください。",
                        nextCommand: "abg activity --period day"
                    )
                )
            }
            guard let digest = await auditLog.digest(period: period) else {
                return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "period must be day or week"))
            }
            return CLIResponse(id: req.id, result: AnyCodable(digest.asJSONObject()))
        case "plugins":
            return CLIResponse(id: req.id, result: AnyCodable(pluginHost.loadedPluginSummaries()))
        case "plugin_command_list":
            return CLIResponse(id: req.id, result: AnyCodable(pluginHost.commandList()))
        case "plugin_command_run":
            return await handlePluginCommandRun(req: req)
        case "plugin_reload":
            return await handlePluginReload(req: req)
        case "plugin_enable":
            return await handlePluginEnablement(req: req, enabled: true)
        case "plugin_disable":
            return await handlePluginEnablement(req: req, enabled: false)
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
        var resolvedTabId: Int?
        if let error = resolvePluginCommandTabId(pluginName: pluginName, commandName: commandName, explicitTabId: tabId, out: &resolvedTabId) {
            return CLIResponse(id: req.id, error: error)
        }
        do {
            let argsData = try? JSONSerialization.data(withJSONObject: args, options: [])
            await auditLog.log(
                action: "plugin_command_run",
                tabId: resolvedTabId,
                agent: "cli",
                details: [
                    "plugin": AnyCodable(pluginName),
                    "command": AnyCodable(commandName),
                    "argsKeys": AnyCodable(args.keys.sorted()),
                    "argsBytes": AnyCodable(argsData?.count ?? 0),
                    "tabBinding": AnyCodable(tabId == nil && resolvedTabId != nil ? "domain" : (tabId == nil ? "none" : "explicit")),
                ]
            )
            let result = try await pluginHost.runCommand(plugin: pluginName, command: commandName, args: args, tabId: resolvedTabId)
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

    private func handlePersonalDataCommand(req: CLIRequest, method: String) async -> CLIResponse {
        let params = (req.params?.value as? [String: Any]) ?? [:]
        guard let extensionId = resolvePersonalDataExtensionId(params: params) else {
            if connectedExtensionIds.isEmpty {
                return CLIResponse(
                    id: req.id,
                    error: ErrorPayload(
                        code: "extension_not_connected",
                        message: "No browser extension is connected to the Gateway.",
                        userMessage: "Chrome 拡張機能が Gateway に接続されていません。拡張機能を有効にしてから再実行してください。",
                        nextCommand: "abg status"
                    )
                )
            }
            return CLIResponse(
                id: req.id,
                error: ErrorPayload(
                    code: "ambiguous_extension",
                    message: "Multiple browser extensions are connected. Pass --extension-id for browser-owned personal data commands.",
                    userMessage: "複数のブラウザ profile が接続されています。browser-owned personal data を読む profile を --extension-id で明示してください。",
                    nextCommand: "abg status"
                )
            )
        }

        do {
            let result = try await sendCommand(to: extensionId, method: method, params: AnyCodable(params))
            await auditLog.log(
                action: method,
                extensionId: extensionId,
                agent: "cli",
                details: personalDataAuditDetails(method: method, params: params, result: result?.value)
            )
            return CLIResponse(id: req.id, result: result)
        } catch {
            await auditLog.log(
                action: method,
                extensionId: extensionId,
                agent: "cli",
                details: personalDataAuditDetails(method: method, params: params, result: nil, error: error.localizedDescription)
            )
            return CLIResponse(id: req.id, error: extensionErrorPayload(from: error))
        }
    }

    private func resolvePersonalDataExtensionId(params: [String: Any]) -> String? {
        if let extensionId = params["extensionId"] as? String, connectedExtensionIds.contains(extensionId) {
            return extensionId
        }
        if connectedExtensionIds.count == 1 {
            return connectedExtensionIds[0]
        }
        return nil
    }

    private func personalDataAuditDetails(method: String, params: [String: Any], result: Any?, error: String? = nil) -> [String: AnyCodable] {
        var details: [String: AnyCodable] = [
            "boundary": AnyCodable("browser_owned_personal_data"),
            "urlRedaction": AnyCodable("full_urls_not_recorded"),
        ]
        if let limit = params["limit"] as? Int {
            details["limit"] = AnyCodable(limit)
        }
        if let query = params["query"] as? String {
            details["queryBytes"] = AnyCodable(query.utf8.count)
        }
        if let bookmarkId = params["bookmarkId"] as? String {
            details["bookmarkId"] = AnyCodable(bookmarkId)
        }
        if let hasBeenRead = params["hasBeenRead"] as? Bool {
            details["hasBeenRead"] = AnyCodable(hasBeenRead)
        }
        if let dict = result as? [String: Any] {
            if let count = dict["count"] as? Int {
                details["count"] = AnyCodable(count)
            }
            if let ok = dict["ok"] as? Bool {
                details["ok"] = AnyCodable(ok)
            }
            if method == "bookmarks_open" {
                details["opened"] = AnyCodable((dict["opened"] as? Bool) == true)
                if let tabId = dict["tabId"] as? Int {
                    details["openedTabId"] = AnyCodable(tabId)
                }
            }
        }
        if let error {
            details["ok"] = AnyCodable(false)
            details["error"] = AnyCodable(error)
        }
        return details
    }

    private func resolvePluginCommandTabId(
        pluginName: String,
        commandName: String,
        explicitTabId: Int?,
        out resolvedTabId: inout Int?
    ) -> ErrorPayload? {
        if let explicitTabId {
            resolvedTabId = explicitTabId
            return nil
        }
        guard pluginHost.hasPlugin(named: pluginName),
              let domains = pluginHost.domainPatterns(for: pluginName),
              !domains.isEmpty
        else {
            resolvedTabId = nil
            return nil
        }

        let matches = permittedTabs.enumerated().compactMap { index, tab -> ErrorPayload.TabCandidate? in
            guard !tab.isExpired, pluginHost.matchesManifestDomain(plugin: pluginName, url: tab.url) else {
                return nil
            }
            return ErrorPayload.TabCandidate(
                ref: "t\(index + 1)",
                tabId: tab.tabId,
                title: tab.title,
                url: tab.url,
                accessMode: tab.accessMode
            )
        }

        if matches.count == 1 {
            resolvedTabId = matches[0].tabId
            return nil
        }
        if matches.isEmpty {
            return ErrorPayload(
                code: "no_matching_tab",
                message: "No shared tab matches plugin \(pluginName)'s domain list.",
                userMessage: "plugin の domain に一致する共有済みタブがありません。対象タブを共有してから再実行するか、必要なら --tab-id で明示してください。",
                nextCommand: "abg tabs --compact",
                plugin: pluginName,
                command: commandName,
                expectedDomains: domains
            )
        }
        return ErrorPayload(
            code: "ambiguous_tab",
            message: "\(matches.count) shared tabs match plugin \(pluginName)'s domain list. Pass --tab-id to disambiguate.",
            userMessage: "plugin の domain に一致する共有済みタブが複数あります。`abg tabs --compact` で確認して --tab-id を指定してください。",
            nextCommand: "abg tabs --compact",
            plugin: pluginName,
            command: commandName,
            expectedDomains: domains,
            candidates: matches
        )
    }

    private func handlePluginReload(req: CLIRequest) async -> CLIResponse {
        let params = (req.params?.value as? [String: Any]) ?? [:]
        let pluginName = params["pluginName"] as? String
        let result = pluginHost.reload(plugin: pluginName)
        refreshPluginSummaries()
        Task {
            await auditLog.log(
                action: "plugin_reload",
                agent: "cli",
                details: [
                    "plugin": AnyCodable(pluginName ?? "all"),
                    "count": AnyCodable(result.count),
                ]
            )
        }
        return CLIResponse(id: req.id, result: AnyCodable(result))
    }

    private func handlePluginEnablement(req: CLIRequest, enabled: Bool) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let pluginName = params["pluginName"] as? String,
              !pluginName.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "pluginName is required"))
        }

        do {
            let result = if enabled {
                try ABGPluginStateStore.enable(name: pluginName)
            } else {
                try ABGPluginStateStore.disable(name: pluginName)
            }
            var payload = result.dictionary
            if enabled {
                payload["reload"] = pluginHost.reload(plugin: result.name)
            } else {
                payload["unloaded"] = pluginHost.unload(at: URL(fileURLWithPath: result.path))
            }
            refreshPluginSummaries()
            Task {
                await auditLog.log(
                    action: enabled ? "plugin_enable" : "plugin_disable",
                    agent: "cli",
                    details: [
                        "plugin": AnyCodable(result.name),
                        "path": AnyCodable(result.path),
                    ]
                )
            }
            return CLIResponse(id: req.id, result: AnyCodable(payload))
        } catch let error as ABGPluginManagementError {
            return CLIResponse(id: req.id, error: ErrorPayload(code: error.code, message: error.localizedDescription))
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "plugin_state_failed", message: error.localizedDescription))
        }
    }

    func refreshPluginSummaries() {
        pluginSummaries = pluginHost.loadedPluginSummaryModels()
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

    private func handleStreamEnable(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        do {
            _ = try await sendCommand(to: tab.extensionId, method: "stream_control", params: AnyCodable(["tabId": tabId, "enabled": true]))
            streamTabId = tabId
            streamExtensionId = tab.extensionId
            await auditLog.log(action: "stream_enable", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli")
            var status = streamStatus()
            if let requestedPort = params["port"] as? Int, requestedPort != ABGConstants.wsPort {
                status["portNote"] = "Custom stream ports are not started separately yet; use the Gateway stream URL."
            }
            return CLIResponse(id: req.id, result: AnyCodable(status))
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "command_failed", message: error.localizedDescription))
        }
    }

    private func handleStreamDisable(req: CLIRequest) async -> CLIResponse {
        if let tabId = streamTabId, let extensionId = streamExtensionId {
            _ = try? await sendCommand(to: extensionId, method: "stream_control", params: AnyCodable(["tabId": tabId, "enabled": false]))
            await auditLog.log(action: "stream_disable", extensionId: extensionId, tabId: tabId, agent: "cli")
        }
        streamTabId = nil
        streamExtensionId = nil
        return CLIResponse(id: req.id, result: AnyCodable(streamStatus()))
    }

    private func streamStatus() -> [String: Any] {
        var status: [String: Any] = [
            "enabled": streamTabId != nil,
            "wsUrl": "ws://\(ABGConstants.wsHost):\(ABGConstants.wsPort)/stream",
            "events": ["dom_mutation", "network", "console"],
            "localOnly": true,
        ]
        if let streamTabId { status["tabId"] = streamTabId }
        return status
    }

    // MARK: - Recording

    private func handleRecordStart(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        if let existing = recording {
            return CLIResponse(id: req.id, error: ErrorPayload(
                code: "already_recording",
                message: "A recording is already active on tab \(existing.tabId).",
                userMessage: "既に録画中です。`abg record stop` で停止してから再実行してください。",
                nextCommand: "abg record stop"
            ))
        }
        let mic = (params["mic"] as? Bool) ?? false
        let recordingId = UUID().uuidString
        let rawOutputPath = (params["outputPath"] as? String) ?? defaultRecordingOutputPath(tabId: tabId)
        let outputPath = (rawOutputPath as NSString).expandingTildeInPath

        // Register the session before dispatching: the extension begins streaming
        // chunks as soon as the user approves, which can arrive while this command
        // is still awaiting the approval round-trip.
        recording = RecordingSession(
            recordingId: recordingId,
            tabId: tabId,
            extensionId: tab.extensionId,
            outputPath: outputPath,
            startedAt: Date(),
            mic: mic,
            handle: nil,
            bytes: 0,
            lastSeq: -1
        )

        do {
            let commandParams: [String: Any] = ["tabId": tabId, "mic": mic, "recordingId": recordingId]
            // Approval can take up to ~62s; override the default 30s command timeout.
            let result = try await sendCommand(
                to: tab.extensionId,
                method: "record_start",
                params: AnyCodable(commandParams),
                timeoutMs: 75_000
            )
            let dict = result?.value as? [String: Any] ?? [:]
            let micUsed = (dict["mic"] as? Bool) ?? mic
            if var session = recording, session.recordingId == recordingId {
                session.mic = micUsed
                recording = session
            }
            await auditLog.log(
                action: "record_start",
                extensionId: tab.extensionId,
                tabId: tabId,
                url: tab.url,
                details: [
                    "recordingId": AnyCodable(recordingId),
                    "mic": AnyCodable(micUsed),
                    "outputPath": AnyCodable(outputPath),
                ]
            )
            return CLIResponse(id: req.id, result: AnyCodable([
                "ok": true,
                "recordingId": recordingId,
                "tabId": tabId,
                "path": outputPath,
                "mic": micUsed,
                "startedAt": ISO8601DateFormatter().string(from: recording?.startedAt ?? Date()),
            ]))
        } catch {
            finalizeRecordingCleanup(recordingId: recordingId, deleteFile: true)
            return CLIResponse(id: req.id, error: ErrorPayload(
                code: "record_start_failed",
                message: error.localizedDescription,
                userMessage: "録画を開始できませんでした。承認ウィンドウで許可したか、対象タブが録画可能か確認してください。"
            ))
        }
    }

    private func handleRecordStop(req: CLIRequest) async -> CLIResponse {
        guard let session = recording else {
            if let last = lastFinishedRecording {
                return CLIResponse(id: req.id, result: AnyCodable(last))
            }
            return CLIResponse(id: req.id, error: ErrorPayload(
                code: "not_recording",
                message: "No recording is active.",
                userMessage: "録画中のセッションがありません。",
                nextCommand: "abg record status"
            ))
        }
        let recordingId = session.recordingId
        let extensionId = session.extensionId
        do {
            let payload: AnyCodable = try await withCheckedThrowingContinuation { cont in
                recordingStopWaiters[recordingId] = cont
                // Ask the extension to stop; the file is finalized when the
                // record_stopped event arrives (handleRecordStopped resumes us).
                Task {
                    do {
                        _ = try await sendCommand(
                            to: extensionId,
                            method: "record_stop",
                            params: AnyCodable(["recordingId": recordingId]),
                            timeoutMs: 20_000
                        )
                    } catch {
                        await MainActor.run {
                            if let waiter = self.recordingStopWaiters.removeValue(forKey: recordingId) {
                                self.finalizeRecordingCleanup(recordingId: recordingId, deleteFile: false)
                                waiter.resume(throwing: error)
                            }
                        }
                    }
                }
                // Safety net: if the finalize event never arrives, return what we have.
                Task {
                    try? await Task.sleep(nanoseconds: 30_000_000_000)
                    await MainActor.run {
                        if let waiter = self.recordingStopWaiters.removeValue(forKey: recordingId) {
                            let partial = self.finalizeRecordingPayload(recordingId: recordingId, durationMs: nil, mime: nil, micUsed: nil, chunkCount: nil, finalized: false)
                            self.finalizeRecordingCleanup(recordingId: recordingId, deleteFile: false)
                            waiter.resume(returning: AnyCodable(partial ?? ["ok": false, "recordingId": recordingId, "error": "record stop timed out"]))
                        }
                    }
                }
            }
            return CLIResponse(id: req.id, result: payload)
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "record_stop_failed", message: error.localizedDescription))
        }
    }

    private func recordStatusPayload() -> [String: Any] {
        guard let session = recording else {
            var payload: [String: Any] = ["recording": false]
            if let last = lastFinishedRecording { payload["last"] = last }
            return payload
        }
        return [
            "recording": true,
            "recordingId": session.recordingId,
            "tabId": session.tabId,
            "mic": session.mic,
            "path": session.outputPath,
            "bytes": session.bytes,
            "startedAt": ISO8601DateFormatter().string(from: session.startedAt),
        ]
    }

    private func handleRecordChunk(recordingId: String, seq: Int, dataBase64: String) {
        guard var session = recording, session.recordingId == recordingId else { return }
        guard let data = Data(base64Encoded: dataBase64) else { return }
        do {
            if session.handle == nil {
                let url = URL(fileURLWithPath: session.outputPath)
                try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
                FileManager.default.createFile(atPath: session.outputPath, contents: nil)
                session.handle = try FileHandle(forWritingTo: url)
            }
            try session.handle?.write(contentsOf: data)
            session.bytes += data.count
            session.lastSeq = seq
            recording = session
        } catch {
            handleRecordFailed(recordingId: recordingId, error: "failed to write chunk: \(error.localizedDescription)")
        }
    }

    private func handleRecordStopped(recordingId: String, durationMs: Int, mime: String, micUsed: Bool, chunkCount: Int) {
        guard let session = recording, session.recordingId == recordingId else { return }
        try? session.handle?.close()
        let payload = finalizeRecordingPayload(
            recordingId: recordingId,
            durationMs: durationMs,
            mime: mime,
            micUsed: micUsed,
            chunkCount: chunkCount,
            finalized: true
        ) ?? ["ok": true, "recordingId": recordingId]
        let extensionId = session.extensionId
        let tabId = session.tabId
        let url = permittedTabs.first(where: { $0.tabId == tabId })?.url ?? ""
        recording = nil
        lastFinishedRecording = payload
        Task {
            await auditLog.log(
                action: "record_stop",
                extensionId: extensionId,
                tabId: tabId,
                url: url,
                details: [
                    "recordingId": AnyCodable(recordingId),
                    "bytes": AnyCodable((payload["bytes"] as? Int) ?? 0),
                    "durationMs": AnyCodable(durationMs),
                    "mime": AnyCodable(mime),
                    "mic": AnyCodable(micUsed),
                    "chunkCount": AnyCodable(chunkCount),
                ]
            )
        }
        if let waiter = recordingStopWaiters.removeValue(forKey: recordingId) {
            waiter.resume(returning: AnyCodable(payload))
        }
    }

    private func handleRecordFailed(recordingId: String, error: String) {
        guard let session = recording, session.recordingId == recordingId else { return }
        try? session.handle?.close()
        try? FileManager.default.removeItem(atPath: session.outputPath)
        recording = nil
        Task { await auditLog.log(action: "record_failed", tabId: session.tabId, details: ["recordingId": AnyCodable(recordingId), "error": AnyCodable(error)]) }
        if let waiter = recordingStopWaiters.removeValue(forKey: recordingId) {
            waiter.resume(throwing: NSError(domain: "ABG", code: 4, userInfo: [NSLocalizedDescriptionKey: error]))
        }
    }

    /// Extension gone mid-recording: flush what we captured and fail any waiter.
    private func handleRecordInterrupted(recordingId: String, reason: String) {
        guard let session = recording, session.recordingId == recordingId else { return }
        try? session.handle?.close()
        let payload = finalizeRecordingPayload(recordingId: recordingId, durationMs: nil, mime: nil, micUsed: session.mic, chunkCount: nil, finalized: false)
        recording = nil
        if let payload { lastFinishedRecording = payload }
        if let waiter = recordingStopWaiters.removeValue(forKey: recordingId) {
            waiter.resume(throwing: NSError(domain: "ABG", code: 6, userInfo: [NSLocalizedDescriptionKey: "recording interrupted: \(reason)"]))
        }
    }

    private func finalizeRecordingPayload(recordingId: String, durationMs: Int?, mime: String?, micUsed: Bool?, chunkCount: Int?, finalized: Bool) -> [String: Any]? {
        guard let session = recording, session.recordingId == recordingId else { return nil }
        var payload: [String: Any] = [
            "ok": true,
            "recordingId": recordingId,
            "tabId": session.tabId,
            "path": session.outputPath,
            "bytes": session.bytes,
            "mic": micUsed ?? session.mic,
            "finalized": finalized,
        ]
        if let durationMs { payload["durationMs"] = durationMs }
        if let mime { payload["mime"] = mime }
        if let chunkCount { payload["chunkCount"] = chunkCount }
        return payload
    }

    private func finalizeRecordingCleanup(recordingId: String, deleteFile: Bool) {
        guard let session = recording, session.recordingId == recordingId else { return }
        try? session.handle?.close()
        if deleteFile { try? FileManager.default.removeItem(atPath: session.outputPath) }
        recording = nil
    }

    private func defaultRecordingOutputPath(tabId: Int) -> String {
        let base = ABGConstants.recordingsDir
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        return base.appendingPathComponent("tab-\(tabId)-\(formatter.string(from: Date())).webm").path
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
        let redact = (params["redact"] as? Bool) ?? false
        let redactRegexes = params["redactRegexes"] as? [String] ?? []
        params.removeValue(forKey: "asMarkdown")
        params.removeValue(forKey: "keepImages")
        params.removeValue(forKey: "redact")
        params.removeValue(forKey: "redactRegexes")
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
                var markdown = domainResult.output
                if redact, let redaction = pluginHost.redact(kind: "markdown", input: markdown, customRegexes: redactRegexes) {
                    markdown = redaction.output
                    dict["redactionTransforms"] = redaction.names
                    await auditLog.log(
                        action: "redaction_transform",
                        extensionId: tab.extensionId,
                        tabId: tabId,
                        url: tab.url,
                        details: [
                            "kind": AnyCodable("markdown"),
                            "transforms": AnyCodable(redaction.names),
                            "customRegexCount": AnyCodable(redactRegexes.count),
                        ]
                    )
                }
                dict["markdown"] = markdown
                dict["markdownTransform"] = domainResult.name
                dict.removeValue(forKey: "html")
                return CLIResponse(id: req.id, result: AnyCodable(dict))
            }
            guard let markdown = pluginHost.transform(name: keepImages ? "html-to-markdown-keep-images" : "html-to-markdown", input: html) else {
                return CLIResponse(id: req.id, result: result)
            }
            var outputMarkdown = markdown
            if redact, let redaction = pluginHost.redact(kind: "markdown", input: outputMarkdown, customRegexes: redactRegexes) {
                outputMarkdown = redaction.output
                dict["redactionTransforms"] = redaction.names
                await auditLog.log(
                    action: "redaction_transform",
                    extensionId: tab.extensionId,
                    tabId: tabId,
                    url: tab.url,
                    details: [
                        "kind": AnyCodable("markdown"),
                        "transforms": AnyCodable(redaction.names),
                        "customRegexCount": AnyCodable(redactRegexes.count),
                    ]
                )
            }
            dict["markdown"] = outputMarkdown
            dict["markdownTransform"] = keepImages ? "html-to-markdown-keep-images" : "html-to-markdown"
            dict.removeValue(forKey: "html")
            return CLIResponse(id: req.id, result: AnyCodable(dict))
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "command_failed", message: error.localizedDescription))
        }
    }

    private func handleHarTab(req: CLIRequest) async -> CLIResponse {
        guard var params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        do {
            let rawOutputPath = try (params["outputPath"] as? String) ?? defaultHAROutputPath(tabId: tabId)
            let outputPath = rawOutputPath as NSString
            let expandedOutputPath = outputPath.expandingTildeInPath
            params["outputPath"] = expandedOutputPath

            let result = try await sendCommand(to: tab.extensionId, method: "har_export", params: AnyCodable(params))
            guard var dict = result?.value as? [String: Any], let har = dict["har"] else {
                return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_response", message: "extension did not return a HAR object"))
            }
            guard JSONSerialization.isValidJSONObject(har) else {
                return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_response", message: "extension returned a non-JSON HAR object"))
            }
            let data = try JSONSerialization.data(withJSONObject: har, options: [.prettyPrinted, .sortedKeys])
            let url = URL(fileURLWithPath: expandedOutputPath)
            try FileManager.default.createDirectory(at: url.deletingLastPathComponent(), withIntermediateDirectories: true)
            try data.write(to: url)

            let entryCount = dict["entryCount"] as? Int ?? 0
            let redaction = dict["redaction"] as? String ?? "metadata_only"
            var details: [String: AnyCodable] = [
                "outputPath": AnyCodable(expandedOutputPath),
                "bytes": AnyCodable(data.count),
                "entryCount": AnyCodable(entryCount),
                "redaction": AnyCodable(redaction),
            ]
            if let urlPattern = params["urlPattern"] as? String {
                details["urlPattern"] = AnyCodable(urlPattern)
            }
            if let urlRegex = params["urlRegex"] as? String {
                details["urlRegex"] = AnyCodable(urlRegex)
            }
            if let method = params["method"] as? String {
                details["method"] = AnyCodable(method)
            }
            if let type = params["type"] as? String {
                details["type"] = AnyCodable(type)
            }
            if let limit = params["limit"] as? Int {
                details["limit"] = AnyCodable(limit)
            }
            await auditLog.log(action: "har_export", extensionId: tab.extensionId, tabId: tabId, url: tab.url, details: details)

            dict.removeValue(forKey: "har")
            dict["path"] = expandedOutputPath
            dict["bytes"] = data.count
            dict["ok"] = true
            return CLIResponse(id: req.id, result: AnyCodable(dict))
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "har_export_failed", message: error.localizedDescription))
        }
    }

    private func handleStateTab(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        do {
            let result = try await sendCommand(to: tab.extensionId, method: "state_inspect", params: AnyCodable(params))
            var details: [String: AnyCodable] = [
                "kind": AnyCodable((params["kind"] as? String) ?? "all"),
                "includeValues": AnyCodable((params["includeValues"] as? Bool) ?? false),
            ]
            if let name = params["name"] as? String { details["nameFilter"] = AnyCodable(name) }
            if let key = params["storageKey"] as? String { details["keyFilter"] = AnyCodable(key) }
            if let limit = params["limit"] as? Int { details["limit"] = AnyCodable(limit) }
            if let dict = result?.value as? [String: Any] {
                if let cookies = dict["cookies"] as? [String: Any], let count = cookies["count"] as? Int {
                    details["cookieCount"] = AnyCodable(count)
                }
                if let localStorage = dict["localStorage"] as? [String: Any], let count = localStorage["count"] as? Int {
                    details["localStorageCount"] = AnyCodable(count)
                }
                if let sessionStorage = dict["sessionStorage"] as? [String: Any], let count = sessionStorage["count"] as? Int {
                    details["sessionStorageCount"] = AnyCodable(count)
                }
            }
            await auditLog.log(action: "state_inspect", extensionId: tab.extensionId, tabId: tabId, url: tab.url, details: details)
            return CLIResponse(id: req.id, result: result)
        } catch {
            return CLIResponse(id: req.id, error: extensionErrorPayload(from: error))
        }
    }

    private func handleSandboxTab(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any], let tabId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        guard tab.accessMode == "all_tabs" else {
            return CLIResponse(
                id: req.id,
                error: ErrorPayload(
                    code: "sandbox_mode_required",
                    message: "Sandbox browser-owned automation requires a tab shared through all-tabs profile mode."
                )
            )
        }
        var auditDetails: [String: AnyCodable] = [
            "accessMode": AnyCodable(tab.accessMode),
            "action": AnyCodable((params["action"] as? String) ?? ""),
        ]
        if let width = params["width"] as? Int { auditDetails["width"] = AnyCodable(width) }
        if let height = params["height"] as? Int { auditDetails["height"] = AnyCodable(height) }
        if let mobile = params["mobile"] as? Bool { auditDetails["mobile"] = AnyCodable(mobile) }
        if let deviceScaleFactor = params["deviceScaleFactor"] as? Double {
            auditDetails["deviceScaleFactor"] = AnyCodable(deviceScaleFactor)
        }
        if let storageKind = params["storageKind"] as? String {
            auditDetails["storageKind"] = AnyCodable(storageKind)
        }
        if let storageKey = params["storageKey"] as? String {
            auditDetails["storageKey"] = AnyCodable(storageKey)
        }
        if let value = params["value"] as? String {
            auditDetails["valueBytes"] = AnyCodable(value.utf8.count)
        }
        if let url = params["url"] as? String {
            auditDetails["targetUrl"] = AnyCodable(url)
        }
        if let targetTabId = params["targetTabId"] as? Int {
            auditDetails["targetTabId"] = AnyCodable(targetTabId)
        }
        do {
            let result = try await sendCommand(to: tab.extensionId, method: "sandbox_action", params: AnyCodable(params))
            auditDetails["ok"] = AnyCodable(true)
            await auditLog.log(action: "sandbox_action", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli", details: auditDetails)
            return CLIResponse(id: req.id, result: result)
        } catch {
            auditDetails["ok"] = AnyCodable(false)
            auditDetails["error"] = AnyCodable(error.localizedDescription)
            await auditLog.log(action: "sandbox_action", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli", details: auditDetails)
            return CLIResponse(id: req.id, error: extensionErrorPayload(from: error))
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
                if method == "dialog_action" {
                    var values: [String: AnyCodable] = [:]
                    if let action = params["action"] as? String {
                        values["action"] = AnyCodable(action)
                    }
                    if let promptText = params["promptText"] as? String {
                        values["promptTextBytes"] = AnyCodable(promptText.utf8.count)
                    }
                    if let dict = result?.value as? [String: Any],
                       let dialog = dict["dialog"] as? [String: Any] {
                        if let type = dialog["type"] as? String {
                            values["dialogType"] = AnyCodable(type)
                        }
                        if let message = dialog["message"] as? String {
                            values["messagePreview"] = AnyCodable(message)
                        }
                        if let messageBytes = dialog["messageBytes"] as? Int {
                            values["messageBytes"] = AnyCodable(messageBytes)
                        }
                    }
                    return values.isEmpty ? nil : values
                }
                if method == "download_state" {
                    var values: [String: AnyCodable] = [:]
                    if let wait = params["wait"] as? Bool {
                        values["wait"] = AnyCodable(wait)
                    }
                    if let timeoutMs = params["timeoutMs"] as? Int {
                        values["timeoutMs"] = AnyCodable(timeoutMs)
                    }
                    if let dict = result?.value as? [String: Any] {
                        if let count = dict["count"] as? Int {
                            values["count"] = AnyCodable(count)
                        }
                        if let latest = dict["latest"] as? [String: Any] {
                            if let status = latest["status"] as? String {
                                values["latestStatus"] = AnyCodable(status)
                            }
                            if let pathAvailable = latest["pathAvailable"] as? Bool {
                                values["pathAvailable"] = AnyCodable(pathAvailable)
                            }
                            if let unavailableReason = latest["unavailableReason"] as? String {
                                values["unavailableReason"] = AnyCodable(unavailableReason)
                            }
                        }
                    }
                    return values.isEmpty ? nil : values
                }
                if method == "fill" {
                    var values: [String: AnyCodable] = [
                        "command": AnyCodable((params["replaceEditable"] as? Bool) == true ? "replace-editable" : "fill"),
                    ]
                    if let selector = params["selector"] as? String {
                        values["selector"] = AnyCodable(selector)
                    }
                    if let value = params["value"] as? String {
                        values["replacementBytes"] = AnyCodable(value.utf8.count)
                    }
                    if let auditDiff = params["auditDiff"] as? Bool {
                        values["auditDiffRequested"] = AnyCodable(auditDiff)
                    }
                    if let dict = result?.value as? [String: Any] {
                        if let ok = dict["ok"] as? Bool {
                            values["ok"] = AnyCodable(ok)
                        }
                        if let kind = dict["kind"] as? String {
                            values["kind"] = AnyCodable(kind)
                        }
                        if let strategy = dict["strategy"] as? String {
                            values["strategy"] = AnyCodable(strategy)
                        }
                        if let beforeLength = dict["beforeLength"] as? Int {
                            values["beforeLength"] = AnyCodable(beforeLength)
                        }
                        if let afterLength = dict["afterLength"] as? Int {
                            values["afterLength"] = AnyCodable(afterLength)
                        }
                        if let replacementLength = dict["replacementLength"] as? Int {
                            values["replacementLength"] = AnyCodable(replacementLength)
                        }
                        if let auditDiff = dict["auditDiff"] as? [String: Any] {
                            values["auditDiff"] = AnyCodable(auditDiff)
                        }
                    }
                    return values
                }
                if method == "exec_command" {
                    var values: [String: AnyCodable] = [:]
                    if let command = params["command"] as? String {
                        values["command"] = AnyCodable(command)
                    }
                    if let value = params["value"] as? String {
                        values["valueBytes"] = AnyCodable(value.utf8.count)
                    }
                    if let dict = result?.value as? [String: Any],
                       let ok = dict["ok"] as? Bool {
                        values["ok"] = AnyCodable(ok)
                    }
                    return values.isEmpty ? nil : values
                }
                if method == "network_log" {
                    var values: [String: AnyCodable] = [:]
                    if let wait = params["wait"] as? Bool {
                        values["wait"] = AnyCodable(wait)
                    }
                    if let timeoutMs = params["timeoutMs"] as? Int {
                        values["timeoutMs"] = AnyCodable(timeoutMs)
                    }
                    if let body = params["body"] as? Bool {
                        values["bodyRequested"] = AnyCodable(body)
                    }
                    if let maxBytes = params["maxBytes"] as? Int {
                        values["maxBytes"] = AnyCodable(maxBytes)
                    }
                    if let methodFilter = params["method"] as? String {
                        values["method"] = AnyCodable(methodFilter)
                    }
                    if let statusMin = params["statusMin"] as? Int {
                        values["statusMin"] = AnyCodable(statusMin)
                    }
                    if let statusMax = params["statusMax"] as? Int {
                        values["statusMax"] = AnyCodable(statusMax)
                    }
                    if let type = params["type"] as? String {
                        values["type"] = AnyCodable(type)
                    }
                    if params["urlPattern"] is String {
                        values["urlPatternFilter"] = AnyCodable(true)
                    }
                    if params["urlRegex"] is String {
                        values["urlRegexFilter"] = AnyCodable(true)
                    }
                    if let dict = result?.value as? [String: Any] {
                        if let mode = dict["mode"] as? String {
                            values["mode"] = AnyCodable(mode)
                        }
                        if let ok = dict["ok"] as? Bool {
                            values["ok"] = AnyCodable(ok)
                        }
                        if let response = dict["response"] as? [String: Any],
                           let status = response["status"] as? Int {
                            values["matchedStatus"] = AnyCodable(status)
                        }
                    }
                    return values.isEmpty ? nil : values
                }
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

    private func handleClipboardWrite(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let mime = params["mime"] as? String,
              let value = params["value"] as? String,
              !mime.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "mime and value required"))
        }

        let response = writeClipboardPayload(mime: mime, value: value)
        switch response {
        case .success(let result):
            await auditLog.log(
                action: "clipboard_write",
                agent: "cli",
                details: [
                    "mime": AnyCodable(mime),
                    "contentBytes": AnyCodable(value.utf8.count),
                ]
            )
            return CLIResponse(id: req.id, result: AnyCodable(result))
        case .failure(let error):
            return CLIResponse(id: req.id, error: ErrorPayload(code: "clipboard_write_failed", message: error.message))
        }
    }

    private func handlePasteRichTab(req: CLIRequest) async -> CLIResponse {
        guard var params = req.params?.value as? [String: Any],
              let tabId = params["tabId"] as? Int
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }

        let mime = params["mime"] as? String
        let value = params["value"] as? String
        if (mime == nil) != (value == nil) {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "mime and value must be passed together"))
        }

        var details: [String: AnyCodable] = [:]
        if let selector = params["selector"] as? String {
            details["selector"] = AnyCodable(selector)
        }
        if let mime, let value {
            switch writeClipboardPayload(mime: mime, value: value) {
            case .success:
                details["mime"] = AnyCodable(mime)
                details["contentBytes"] = AnyCodable(value.utf8.count)
                params.removeValue(forKey: "value")
                params["contentBytes"] = value.utf8.count
            case .failure(let error):
                return CLIResponse(id: req.id, error: ErrorPayload(code: "clipboard_write_failed", message: error.message))
            }
        }

        do {
            let result = try await sendCommand(to: tab.extensionId, method: "paste_rich", params: AnyCodable(params))
            if let dict = result?.value as? [String: Any] {
                if let focused = dict["focused"] as? Bool { details["focused"] = AnyCodable(focused) }
                if let found = dict["found"] as? Bool { details["found"] = AnyCodable(found) }
            }
            await auditLog.log(action: "paste_rich", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli", details: details.isEmpty ? nil : details)
            return CLIResponse(id: req.id, result: result)
        } catch {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "command_failed", message: error.localizedDescription))
        }
    }

    private struct ClipboardPayloadWriteError: Error {
        let message: String
    }

    private func writeClipboardPayload(mime: String, value: String) -> Result<[String: Any], ClipboardPayloadWriteError> {
        let normalizedMime = mime.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedMime.isEmpty else { return .failure(ClipboardPayloadWriteError(message: "mime is empty")) }

        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        var types = [NSPasteboard.PasteboardType(normalizedMime)]
        switch normalizedMime.lowercased() {
        case "text/plain":
            types.append(.string)
            types.append(NSPasteboard.PasteboardType("public.utf8-plain-text"))
        case "text/html":
            types.append(NSPasteboard.PasteboardType("public.html"))
        default:
            break
        }

        var writtenTypes: [String] = []
        for type in types {
            if !writtenTypes.contains(type.rawValue), pasteboard.setString(value, forType: type) {
                writtenTypes.append(type.rawValue)
            }
        }

        guard !writtenTypes.isEmpty else {
            return .failure(ClipboardPayloadWriteError(message: "failed to write clipboard payload"))
        }

        return .success([
            "ok": true,
            "mime": normalizedMime,
            "contentBytes": value.utf8.count,
            "pasteboardTypes": writtenTypes,
        ])
    }

    private func handleEvalTab(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let tabId = params["tabId"] as? Int,
              let script = params["script"] as? String
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId and script required"))
        }
        guard let tab = permittedTabs.first(where: { $0.tabId == tabId }) else {
            return CLIResponse(id: req.id, error: tabUnavailableError(tabId: tabId))
        }
        var auditDetails: [String: AnyCodable] = [
            "script": AnyCodable(script),
            "scriptBytes": AnyCodable(script.utf8.count),
            "approvalRequested": AnyCodable((params["approve"] as? Bool) ?? false),
            "tabTitle": AnyCodable(tab.title),
        ]
        if let maxBytes = params["maxBytes"] as? Int {
            auditDetails["maxBytes"] = AnyCodable(maxBytes)
        }
        do {
            let result = try await sendCommand(to: tab.extensionId, method: "eval_script", params: AnyCodable(params))
            auditDetails["ok"] = AnyCodable(true)
            if let dict = result?.value as? [String: Any] {
                if let ok = dict["ok"] as? Bool {
                    auditDetails["ok"] = AnyCodable(ok)
                }
                if let summary = dict["resultSummary"] as? [String: Any] {
                    auditDetails["resultSummary"] = AnyCodable(summary)
                }
                if let approval = dict["approval"] as? [String: Any] {
                    auditDetails["approval"] = AnyCodable(approval)
                    if let approvalMode = approval["mode"] as? String {
                        auditDetails["approvalMode"] = AnyCodable(approvalMode)
                    }
                    if let approver = approval["approver"] as? String {
                        auditDetails["approver"] = AnyCodable(approver)
                    }
                }
                if let error = dict["error"] as? String {
                    auditDetails["error"] = AnyCodable(error)
                }
            }
            await auditLog.log(action: "eval_script", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli", details: auditDetails)
            return CLIResponse(id: req.id, result: result)
        } catch {
            auditDetails["ok"] = AnyCodable(false)
            auditDetails["error"] = AnyCodable(error.localizedDescription)
            await auditLog.log(action: "eval_script", extensionId: tab.extensionId, tabId: tabId, url: tab.url, agent: "cli", details: auditDetails)
            return CLIResponse(id: req.id, error: extensionErrorPayload(from: error))
        }
    }

    private func extensionErrorPayload(from error: Error) -> ErrorPayload {
        let message = error.localizedDescription
        if let separator = message.firstIndex(of: ":") {
            let code = String(message[..<separator])
            let body = String(message[message.index(after: separator)...]).trimmingCharacters(in: .whitespacesAndNewlines)
            if code.range(of: #"^[a-z0-9_]+$"#, options: .regularExpression) != nil, !body.isEmpty {
                return ErrorPayload(code: code, message: body)
            }
        }
        return ErrorPayload(code: "command_failed", message: message)
    }

    private func tabSummary(_ tab: PermittedTab) -> [String: Any] {
        var dict: [String: Any] = [
            "extensionId": tab.extensionId,
            "tabId": tab.tabId,
            "url": tab.url,
            "title": tab.title,
            "origin": tab.origin,
            "permittedAt": ISO8601DateFormatter().string(from: tab.permittedAt),
            "accessMode": tab.accessMode,
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

    private func defaultHAROutputPath(tabId: Int) throws -> String {
        let base = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg", isDirectory: true)
            .appendingPathComponent("har", isDirectory: true)
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let timestamp = formatter.string(from: Date())
        return base.appendingPathComponent("tab-\(tabId)-\(timestamp).har").path
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

    func sendCommand(to extensionId: String, method: String, params: AnyCodable?, timeoutMs timeoutOverrideMs: Int? = nil) async throws -> AnyCodable? {
        guard let ws = wsServer else { throw NSError(domain: "ABG", code: 2, userInfo: [NSLocalizedDescriptionKey: "WS server not started"]) }
        let id = UUID().uuidString
        let cmd = GatewayCommand(id: id, method: method, params: params)
        let timeoutMs = timeoutOverrideMs ?? GatewaySettingsStore.load().defaultTimeoutMs
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
            Task {
                try? await Task.sleep(nanoseconds: UInt64(timeoutMs) * 1_000_000)
                await MainActor.run {
                    if let c = self.inflight.removeValue(forKey: id) {
                        c.resume(throwing: NSError(domain: "ABG", code: 3, userInfo: [NSLocalizedDescriptionKey: "command timeout"]))
                    }
                }
            }
        }
    }
}
