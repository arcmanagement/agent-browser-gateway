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
    private lazy var pairingManager = PairingManager(auditLog: auditLog)
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
    private var stableTabTargets = StableTabTargetRegistry()
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
        let manager = pairingManager
        Task { [weak self] in
            await manager.setBrowserHandlers(
                onMessage: { [weak self] message, extensionId in
                    await MainActor.run {
                        self?.handleExtensionMessage(message, from: extensionId)
                    }
                },
                onDisconnect: { [weak self] extensionId in
                    await MainActor.run {
                        self?.extensionDisconnected(extensionId)
                    }
                }
            )
            await manager.setDecideHandler { [weak self] extensionId, approvalId, decision, decidedBy in
                guard let self else { return (false, "gateway_unavailable") }
                do {
                    let result = try await self.sendCommand(
                        to: extensionId,
                        method: "approval_decide",
                        params: AnyCodable(["approvalId": approvalId, "decision": decision, "decidedBy": decidedBy] as [String: Any])
                    )
                    let dict = result?.value as? [String: Any]
                    let applied = dict?["applied"] as? Bool ?? false
                    return (applied, dict?["reason"] as? String)
                } catch {
                    return (false, "extension_unreachable")
                }
            }
            await manager.startIfNeeded()
            _ = self
        }
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
        stableTabTargets.remove(extensionId: extensionId)
        if streamExtensionId == extensionId {
            streamTabId = nil
            streamExtensionId = nil
        }
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
                stableTabTargets.remove(
                    StableTabIdentity(extensionId: extensionId, tabId: tabId)
                )
                if streamTabId == tabId, streamExtensionId == extensionId {
                    streamTabId = nil
                    streamExtensionId = nil
                }
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
                stableTabTargets.remove(
                    StableTabIdentity(extensionId: extensionId, tabId: tabId)
                )
                if streamTabId == tabId, streamExtensionId == extensionId {
                    streamTabId = nil
                    streamExtensionId = nil
                }
                Task { await auditLog.log(action: "tab_closed", extensionId: extensionId, tabId: tabId, url: url) }
            }
        case .runtimeEvent(let tabId, let event):
            guard streamTabId == tabId, streamExtensionId == extensionId else { return }
            var payload: [String: Any] = [
                "tabId": tabId,
                "ts": ISO8601DateFormatter().string(from: Date()),
            ]
            if let tab = permittedTabs.first(where: {
                $0.extensionId == extensionId && $0.tabId == tabId
            }) {
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
        case .approvalPending(let approval):
            func numeric(_ value: Any?) -> Double? {
                if let d = value as? Double { return d }
                if let i = value as? Int { return Double(i) }
                return nil
            }
            guard let dict = approval.value as? [String: Any],
                  let approvalId = dict["approvalId"] as? String,
                  let method = dict["method"] as? String,
                  let intent = dict["intent"] as? String,
                  let createdAtMs = numeric(dict["createdAt"]),
                  let timeoutMs = numeric(dict["timeoutMs"]) else { return }
            let tabId = dict["tabId"] as? Int ?? -1
            let origin = dict["origin"] as? String ?? ""
            let tabRef: String
            if let tab = permittedTabs.first(where: { $0.extensionId == extensionId && $0.tabId == tabId }) {
                tabRef = stableTarget(for: tab).ref
            } else {
                tabRef = ""
            }
            let createdAt = Date(timeIntervalSince1970: createdAtMs / 1000)
            let summary = CompanionApprovalSummary(
                approvalId: approvalId,
                method: method,
                intent: intent,
                targetOrigin: origin,
                targetTabRef: tabRef,
                requester: "cli",
                gatewayLabel: "\(ABGConstants.runtimeProfileLabel)@\(Host.current().localizedName ?? "mac")",
                createdAt: createdAt,
                expiresAt: createdAt.addingTimeInterval(timeoutMs / 1000),
                scriptPreview: dict["scriptPreview"] as? String,
                canAllow: method != "record_start"
            )
            let manager = pairingManager
            Task { await manager.forwardApprovalPending(summary, extensionId: extensionId) }
        case .approvalResolved(let approvalId, let decision, let decidedBy):
            let manager = pairingManager
            Task { await manager.forwardApprovalResolved(approvalId: approvalId, decision: decision, decidedBy: decidedBy) }
        case .response(let id, let result, let error):
            if let cont = inflight.removeValue(forKey: id) {
                if let error = error {
                    cont.resume(throwing: ExtensionResponseError(payload: error))
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
        case "raise_tab":
            return await dispatch(req: req, method: "raise_tab")
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
        case "pairing_offer_create":
            return await handlePairingOfferCreate(req: req)
        case "pairing_pending":
            return await handlePairingPending(req: req)
        case "pairing_confirm":
            return await handlePairingConfirm(req: req)
        case "pairing_reject":
            return await handlePairingReject(req: req)
        case "companion_list":
            return await handleCompanionList(req: req)
        case "companion_revoke":
            return await handleCompanionRevoke(req: req)
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
        case "bookmarks_create", "bookmarks_update", "bookmarks_move", "bookmarks_remove",
             "reading_list_add", "reading_list_update", "reading_list_remove":
            return await handlePersonalDataCommand(req: req, method: req.method)
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
            guard let requestedId = (req.params?.value as? [String: Any])?["tabId"] as? Int else {
                return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
            }
            let resolution = resolveTabTarget(requestedId)
            guard let tab = resolution.tab else {
                return CLIResponse(id: req.id, error: resolution.error)
            }
            _ = try? await sendCommand(
                to: tab.extensionId,
                method: "revoke",
                params: AnyCodable(["tabId": tab.tabId])
            )
            permittedTabs.removeAll { $0.extensionId == tab.extensionId && $0.tabId == tab.tabId }
            stableTabTargets.remove(
                StableTabIdentity(extensionId: tab.extensionId, tabId: tab.tabId)
            )
            await auditLog.log(
                action: "revoke_via_cli",
                extensionId: tab.extensionId,
                tabId: tab.tabId,
                url: tab.url
            )
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
        let mutationKinds: [String: String] = [
            "bookmarks_create": "create", "bookmarks_update": "update",
            "bookmarks_move": "move", "bookmarks_remove": "remove",
            "reading_list_add": "add", "reading_list_update": "update",
            "reading_list_remove": "remove",
        ]
        if let mutation = mutationKinds[method] {
            details["mutation"] = AnyCodable(mutation)
            if let title = params["title"] as? String {
                details["titleBytes"] = AnyCodable(title.utf8.count)
            }
            if let url = params["url"] as? String {
                details["urlBytes"] = AnyCodable(url.utf8.count)
                if let origin = URL(string: url).flatMap({ $0.host }) {
                    details["urlHost"] = AnyCodable(origin)
                }
            }
            if let parentId = params["parentId"] as? String {
                details["parentId"] = AnyCodable(parentId)
            }
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

        let matchingTabs = permittedTabs.filter {
            !$0.isExpired && pluginHost.matchesManifestDomain(plugin: pluginName, url: $0.url)
        }
        let matches = matchingTabs.map { tab in
            ErrorPayload.TabCandidate(
                ref: stableTarget(for: tab).ref,
                tabId: tab.tabId,
                title: tab.title,
                url: tab.url,
                accessMode: tab.accessMode
            )
        }

        if matches.count == 1 {
            resolvedTabId = stableTarget(for: matchingTabs[0]).targetId
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
        guard let params = req.params?.value as? [String: Any], let requestedId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "stream_control") {
            return response
        }
        do {
            _ = try await sendCommand(to: tab.extensionId, method: "stream_control", params: AnyCodable(["tabId": tab.tabId, "enabled": true]))
            streamTabId = tab.tabId
            streamExtensionId = tab.extensionId
            await auditLog.log(action: "stream_enable", extensionId: tab.extensionId, tabId: tab.tabId, url: tab.url, agent: "cli")
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
            "authHeader": "x-abg-token",
            "tokenFile": ABGConstants.cliEndpointCandidates().first ?? "",
        ]
        if let streamTabId { status["tabId"] = streamTabId }
        return status
    }

    // MARK: - Recording

    private func handleRecordStart(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any], let requestedId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "record_start") {
            return response
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
        if let unwritable = unwritableOutputPathError(outputPath) {
            return CLIResponse(id: req.id, error: unwritable)
        }

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
                guard FileManager.default.createFile(atPath: session.outputPath, contents: nil) else {
                    throw NSError(domain: "ABG", code: 7, userInfo: [NSLocalizedDescriptionKey: "could not create \(session.outputPath)"])
                }
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
        let url = permittedTabs.first(where: {
            $0.extensionId == extensionId && $0.tabId == tabId
        })?.url ?? ""
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
        guard var params = req.params?.value as? [String: Any], let requestedId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        params = extensionParams(params, for: tab)
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "read_dom") {
            return response
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
            let result = try await sendCommand(to: tab.extensionId, method: "read_dom", params: AnyCodable(params), timeoutMs: commandTimeoutMs(for: tab))
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
        guard var params = req.params?.value as? [String: Any], let requestedId = params["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        params = extensionParams(params, for: tab)
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "har_export") {
            return response
        }
        do {
            let rawOutputPath = try (params["outputPath"] as? String) ?? defaultHAROutputPath(tabId: tabId)
            let outputPath = rawOutputPath as NSString
            let expandedOutputPath = outputPath.expandingTildeInPath
            params["outputPath"] = expandedOutputPath
            if let unwritable = unwritableOutputPathError(expandedOutputPath) {
                return CLIResponse(id: req.id, error: unwritable)
            }

            let result = try await sendCommand(to: tab.extensionId, method: "har_export", params: AnyCodable(params), timeoutMs: commandTimeoutMs(for: tab))
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
        guard let rawParams = req.params?.value as? [String: Any], let requestedId = rawParams["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        let params = extensionParams(rawParams, for: tab)
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "state_inspect") {
            return response
        }
        do {
            let result = try await sendCommand(
                to: tab.extensionId,
                method: "state_inspect",
                params: AnyCodable(params),
                timeoutMs: commandTimeoutMs(for: tab)
            )
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
        guard let rawParams = req.params?.value as? [String: Any], let requestedId = rawParams["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        var params = extensionParams(rawParams, for: tab)
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "sandbox_action") {
            return response
        }
        if let requestedTargetTabId = params["targetTabId"] as? Int {
            let targetResolution = resolveTabTarget(requestedTargetTabId)
            guard let targetTab = targetResolution.tab else {
                return CLIResponse(id: req.id, error: targetResolution.error)
            }
            if let response = await policyBlockedResponse(req: req, tab: targetTab, method: "sandbox_action") {
                return response
            }
            guard targetTab.extensionId == tab.extensionId else {
                return CLIResponse(
                    id: req.id,
                    error: ErrorPayload(
                        code: "cross_profile_target",
                        message: "Sandbox tab actions cannot target a different browser profile."
                    )
                )
            }
            params["targetTabId"] = targetTab.tabId
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
            let result = try await sendCommand(
                to: tab.extensionId,
                method: "sandbox_action",
                params: AnyCodable(params),
                timeoutMs: commandTimeoutMs(for: tab)
            )
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
        guard let rawParams = req.params?.value as? [String: Any], let requestedId = rawParams["tabId"] as? Int else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        let params = extensionParams(rawParams, for: tab)
        if let response = await policyBlockedResponse(req: req, tab: tab, method: method) {
            return response
        }
        do {
            // Pass through all params (selector, value, x/y, etc.) so extension handlers can read them.
            let result = try await sendCommand(
                to: tab.extensionId,
                method: method,
                params: AnyCodable(params),
                timeoutMs: commandTimeoutMs(for: tab)
            )
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
            return CLIResponse(id: req.id, error: extensionErrorPayload(from: error))
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
              let requestedId = params["tabId"] as? Int
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId required"))
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        params = extensionParams(params, for: tab)
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "paste_rich") {
            return response
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
            let result = try await sendCommand(
                to: tab.extensionId,
                method: "paste_rich",
                params: AnyCodable(params),
                timeoutMs: commandTimeoutMs(for: tab)
            )
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
        guard var params = req.params?.value as? [String: Any],
              let requestedId = params["tabId"] as? Int,
              let script = params["script"] as? String
        else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "tabId and script required"))
        }
        let scriptBytes = script.utf8.count
        guard scriptBytes <= EvalScriptLimits.maximumBytes else {
            return CLIResponse(
                id: req.id,
                error: ErrorPayload(
                    code: "script_too_large",
                    message: "Eval script is \(scriptBytes) bytes; the hard limit is \(EvalScriptLimits.maximumBytes) bytes.",
                    userMessage: "大きな eval script は分割するか、upload・read・wait・plugin などの正規 primitive に置き換えてください。",
                    nextCommand: "abg eval --help",
                    hint: "Recommended maximum: \(EvalScriptLimits.recommendedBytes) bytes."
                )
            )
        }
        let resolution = resolveTabTarget(requestedId)
        guard let tab = resolution.tab else {
            return CLIResponse(id: req.id, error: resolution.error)
        }
        let tabId = tab.tabId
        if let response = await policyBlockedResponse(req: req, tab: tab, method: "eval_script") {
            return response
        }
        let policy = GatewaySettingsStore.load().policy(for: tab.url)
        let requestedTimeout = params["timeoutMs"] as? Int
        let timeoutMs = GatewaySettings.clampedTimeout(
            requestedTimeout
                ?? policy?.timeoutMs
                ?? max(GatewaySettingsStore.load().defaultTimeoutMs, EvalScriptLimits.defaultTimeoutMs)
        )
        params = extensionParams(params, for: tab)
        params["timeoutMs"] = timeoutMs
        if policy?.action == .ask {
            params["approve"] = true
        }
        var auditDetails: [String: AnyCodable] = [
            "script": AnyCodable(script),
            "scriptBytes": AnyCodable(scriptBytes),
            "approvalRequested": AnyCodable((params["approve"] as? Bool) ?? false),
            "tabTitle": AnyCodable(tab.title),
            "timeoutMs": AnyCodable(timeoutMs),
        ]
        if let policy {
            auditDetails["policyDomain"] = AnyCodable(policy.domain)
            auditDetails["policyAction"] = AnyCodable(policy.action.rawValue)
        }
        if let maxBytes = params["maxBytes"] as? Int {
            auditDetails["maxBytes"] = AnyCodable(maxBytes)
        }
        do {
            let result = try await sendCommand(
                to: tab.extensionId,
                method: "eval_script",
                params: AnyCodable(params),
                timeoutMs: timeoutMs
            )
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
            if error.localizedDescription == "command timeout" {
                return CLIResponse(
                    id: req.id,
                    error: ErrorPayload(
                        code: "command_timeout",
                        message: "Eval command timed out after \(timeoutMs) ms for a \(scriptBytes)-byte script.",
                        userMessage: "対象タブの共有状態と profile を確認してください。必要なら script を \(EvalScriptLimits.recommendedBytes) bytes 以下に分割し、--timeout は最大 \(GatewaySettings.maximumTimeoutMs) ms まで指定できます。",
                        nextCommand: "abg tabs --compact",
                        hint: "Recommended script size: \(EvalScriptLimits.recommendedBytes) bytes; hard limit: \(EvalScriptLimits.maximumBytes) bytes."
                    )
                )
            }
            return CLIResponse(id: req.id, error: extensionErrorPayload(from: error))
        }
    }

    /// Carries the extension's structured error through the inflight continuation so
    /// optional fields such as `matchCount` survive the relay to the CLI response.
    private struct ExtensionResponseError: LocalizedError {
        let payload: ErrorPayload

        var errorDescription: String? { "\(payload.code): \(payload.message)" }
    }


    // MARK: - Companion pairing (local CLI transport only)

    private func handlePairingOfferCreate(req: CLIRequest) async -> CLIResponse {
        switch await pairingManager.createOffer() {
        case .success(let payload):
            let formatter = ISO8601DateFormatter()
            return CLIResponse(id: req.id, result: AnyCodable([
                "ok": true,
                "gatewayBaseUrl": payload.gatewayBaseUrl,
                "pairingId": payload.pairingId,
                "pairingNonce": payload.pairingNonce,
                "desktopPublicKey": payload.desktopPublicKey,
                "expiresAt": formatter.string(from: payload.expiresAt),
                "displayCode": payload.displayCode,
                "requestedScopes": payload.requestedScopes,
                "manualCode": payload.manualCode,
                "claimUrl": "\(payload.gatewayBaseUrl)/pairings/\(payload.pairingId)/claim",
            ] as [String: Any]))
        case .failure(let error):
            return CLIResponse(id: req.id, error: ErrorPayload(
                code: error.reason.rawValue,
                message: "Could not create a pairing offer.",
                userMessage: "Tailnet または private LAN の IPv4 アドレスが見つからないため、pairing offer を開始できません。ネットワーク接続を確認してください。"
            ))
        }
    }

    private func handlePairingPending(req: CLIRequest) async -> CLIResponse {
        if let pending = await pairingManager.pendingClaim() {
            return CLIResponse(id: req.id, result: AnyCodable([
                "pending": true,
                "pairingId": pending.pairingId,
                "displayCode": pending.displayCode,
                "deviceLabel": pending.deviceLabel,
            ] as [String: Any]))
        }
        return CLIResponse(id: req.id, result: AnyCodable(["pending": false]))
    }

    private func handlePairingConfirm(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let pairingId = params["pairingId"] as? String, !pairingId.isEmpty else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "pairingId required"))
        }
        switch await pairingManager.confirm(pairingId: pairingId) {
        case .success(let grant):
            return CLIResponse(id: req.id, result: AnyCodable([
                "ok": true,
                "deviceId": grant.deviceId,
                "deviceLabel": grant.deviceLabel,
                "scopes": grant.scopes.map(\.rawValue),
            ] as [String: Any]))
        case .failure(let error):
            return CLIResponse(id: req.id, error: ErrorPayload(code: error.reason.rawValue, message: "Pairing confirmation failed."))
        }
    }

    private func handlePairingReject(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let pairingId = params["pairingId"] as? String, !pairingId.isEmpty else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "pairingId required"))
        }
        await pairingManager.reject(pairingId: pairingId)
        return CLIResponse(id: req.id, result: AnyCodable(["ok": true] as [String: Any]))
    }

    private func handleCompanionList(req: CLIRequest) async -> CLIResponse {
        let formatter = ISO8601DateFormatter()
        let rows = await pairingManager.listGrants().map { grant -> [String: Any] in
            var row: [String: Any] = [
                "deviceId": grant.deviceId,
                "deviceLabel": grant.deviceLabel,
                "scopes": grant.scopes.map(\.rawValue),
                "pairedAt": formatter.string(from: grant.pairedAt),
                "active": grant.isActive,
            ]
            if let revokedAt = grant.revokedAt { row["revokedAt"] = formatter.string(from: revokedAt) }
            if let revokedBy = grant.revokedBy { row["revokedBy"] = revokedBy }
            return row
        }
        return CLIResponse(id: req.id, result: AnyCodable(rows))
    }

    private func handleCompanionRevoke(req: CLIRequest) async -> CLIResponse {
        guard let params = req.params?.value as? [String: Any],
              let deviceId = params["deviceId"] as? String, !deviceId.isEmpty else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "bad_params", message: "deviceId required"))
        }
        guard let grant = await pairingManager.revoke(deviceId: deviceId, by: "cli") else {
            return CLIResponse(id: req.id, error: ErrorPayload(code: "device_not_found", message: "no active companion with deviceId \(deviceId)"))
        }
        return CLIResponse(id: req.id, result: AnyCodable([
            "ok": true,
            "deviceId": grant.deviceId,
            "revoked": true,
        ] as [String: Any]))
    }

    private func extensionErrorPayload(from error: Error) -> ErrorPayload {
        if let responseError = error as? ExtensionResponseError {
            return responseError.payload
        }
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
        let target = stableTarget(for: tab)
        var dict: [String: Any] = [
            "extensionId": tab.extensionId,
            "tabId": tab.tabId,
            "targetId": target.targetId,
            "ref": target.ref,
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
        if let policy = GatewaySettingsStore.load().policy(for: tab.url) {
            dict["policy"] = [
                "domain": policy.domain,
                "action": policy.action.rawValue,
                "approvalMode": policy.approvalMode.rawValue,
                "timeoutMs": policy.timeoutMs,
            ]
        }
        return dict
    }

    private func tabSummaries() -> [[String: Any]] {
        permittedTabs.map(tabSummary)
    }

    private func stableTarget(for tab: PermittedTab) -> StableTabTarget {
        stableTabTargets.target(
            for: StableTabIdentity(extensionId: tab.extensionId, tabId: tab.tabId)
        )
    }

    private func resolveTabTarget(_ requestedId: Int) -> (tab: PermittedTab?, error: ErrorPayload?) {
        if requestedId < 0 {
            guard let identity = stableTabTargets.identity(forTargetId: requestedId),
                  let tab = permittedTabs.first(where: {
                      $0.extensionId == identity.extensionId && $0.tabId == identity.tabId
                  })
            else {
                return (nil, tabUnavailableError(tabId: requestedId))
            }
            return (tab, nil)
        }

        let matches = permittedTabs.filter { $0.tabId == requestedId }
        if matches.count == 1 {
            return (matches[0], nil)
        }
        if matches.count > 1 {
            var candidates: [ErrorPayload.TabCandidate] = []
            for tab in matches {
                let target = stableTarget(for: tab)
                candidates.append(
                    ErrorPayload.TabCandidate(
                        ref: target.ref,
                        tabId: tab.tabId,
                        title: tab.title,
                        url: tab.url,
                        accessMode: tab.accessMode
                    )
                )
            }
            return (
                nil,
                ErrorPayload(
                    code: "ambiguous_tab_id",
                    message: "tabId \(requestedId) exists in multiple connected browser profiles. Use a stable ref from `abg tabs --compact`.",
                    userMessage: "複数 profile に同じ Chrome tabId があります。`abg tabs --compact` の ref を指定してください。",
                    nextCommand: "abg tabs --compact",
                    tabId: requestedId,
                    candidates: candidates
                )
            )
        }
        return (nil, tabUnavailableError(tabId: requestedId))
    }

    private func extensionParams(_ params: [String: Any], for tab: PermittedTab) -> [String: Any] {
        var routed = params
        routed["tabId"] = tab.tabId
        return routed
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
        // ABGConstants.harDir resolves into the app-group container for the sandboxed
        // gateway, where the CLI and the user can actually read the file; the gateway's
        // own container temp dir is invisible to both.
        let base = ABGConstants.harDir
        try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.dateFormat = "yyyyMMdd-HHmmss"
        let timestamp = formatter.string(from: Date())
        return base.appendingPathComponent("tab-\(tabId)-\(timestamp).har").path
    }

    /// Rejects an output path the gateway cannot actually write before any capture or
    /// approval starts. Under the App Store sandbox an arbitrary user path fails only
    /// at write time, which would otherwise surface as a mid-recording failure.
    private func unwritableOutputPathError(_ path: String) -> ErrorPayload? {
        let dir = URL(fileURLWithPath: path).deletingLastPathComponent()
        guard !ABGConstants.canWriteInDirectory(dir) else { return nil }
        return ErrorPayload(
            code: "output_path_unwritable",
            message: "cannot write to \(dir.path)\(ABGConstants.isSandboxed ? " from the sandboxed gateway" : "")",
            userMessage: ABGConstants.isSandboxed
                ? "App Store 版 Gateway はこの場所へ書き込めません。--output を省略すると読み取り可能な共有コンテナへ保存されます。"
                : "指定した出力先ディレクトリへ書き込めません。パスを確認してください。",
            hint: "default output dir: \(ABGConstants.isSandboxed ? ABGConstants.harDir.deletingLastPathComponent().path : FileManager.default.temporaryDirectory.path)"
        )
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

    private func policyBlockedResponse(req: CLIRequest, tab: PermittedTab, method: String) async -> CLIResponse? {
        guard let policy = GatewaySettingsStore.load().policy(for: tab.url),
              policy.action == .deny
        else {
            return nil
        }
        await auditLog.log(
            action: "policy_deny",
            extensionId: tab.extensionId,
            tabId: tab.tabId,
            url: tab.url,
            agent: "gateway",
            details: [
                "command": AnyCodable(method),
                "policyDomain": AnyCodable(policy.domain),
                "policyAction": AnyCodable(policy.action.rawValue),
                "ok": AnyCodable(false),
            ]
        )
        return CLIResponse(
            id: req.id,
            error: ErrorPayload(
                code: "domain_policy_denied",
                message: "Domain policy denies \(method) for \(policy.domain).",
                userMessage: "Gateway settings deny this domain. Change the matching policy to Allow or Ask before retrying.",
                nextCommand: "Open Gateway Settings",
                tabId: tab.tabId
            )
        )
    }

    private func commandTimeoutMs(for tab: PermittedTab) -> Int {
        GatewaySettingsStore.load().policy(for: tab.url)?.timeoutMs ?? GatewaySettingsStore.load().defaultTimeoutMs
    }

    func sendCommand(to extensionId: String, method: String, params: AnyCodable?, timeoutMs timeoutOverrideMs: Int? = nil) async throws -> AnyCodable? {
        let id = UUID().uuidString
        let cmd = GatewayCommand(id: id, method: method, params: params)
        let timeoutMs = GatewaySettings.clampedTimeout(timeoutOverrideMs ?? GatewaySettingsStore.load().defaultTimeoutMs)
        return try await withCheckedThrowingContinuation { (cont: CheckedContinuation<AnyCodable?, Error>) in
            inflight[id] = cont
            Task {
                do {
                    if let ws = wsServer {
                        do {
                            try await ws.send(to: extensionId, command: cmd)
                            return
                        } catch {
                            try await pairingManager.sendBrowserCommand(to: extensionId, command: cmd)
                        }
                    } else {
                        try await pairingManager.sendBrowserCommand(to: extensionId, command: cmd)
                    }
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
