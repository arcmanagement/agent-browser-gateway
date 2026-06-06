import ArgumentParser
import Foundation

struct Keyboard: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keyboard",
        abstract: "Keyboard primitives that mirror browser automation APIs",
        subcommands: [KeyboardInsertText.self]
    )
}

struct PDF: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "pdf",
        abstract: "Save the current page as a PDF"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Output PDF path") var out: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "pdf_tab", params: ["tabId": tabId])
        let outPath = (out as NSString).expandingTildeInPath
        let saved = try savePDFResult(result, outPath: outPath)
        printJSON(saved)
    }
}

struct Frames: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "frames",
        abstract: "List iframe/frame targets for a shared tab with stable @f refs",
        discussion: """
        Use --frame @fN on read/get/find/snapshot and selector actions to target a same-origin frame explicitly.
        Cross-origin frames are listed, but selector access returns frame_not_accessible instead of falling back to the top document.
        """
    )
    @OptionGroup var target: TabTarget

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "frames_tab", params: ["tabId": tabId])
        printJSON(result)
    }
}

struct Dialog: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "dialog",
        abstract: "Inspect or handle a pending JavaScript alert/confirm/prompt dialog",
        discussion: """
        With no action flags, this is read-only and returns whether a JavaScript dialog is pending.
        Use --accept, --dismiss, or --prompt-value to handle a pending dialog through the normal operation approval path.
        """
    )
    @OptionGroup var target: TabTarget
    @Flag(name: .long, help: "Accept the pending dialog") var accept: Bool = false
    @Flag(name: .long, help: "Dismiss the pending dialog") var dismiss: Bool = false
    @Option(name: .long, help: "Prompt text to submit; implies --accept") var promptValue: String?

    func run() async throws {
        let selectedActions = [accept, dismiss, promptValue != nil].filter { $0 }.count
        if selectedActions > 1 && !(accept && promptValue != nil && !dismiss) {
            try failWithJSON([
                "error": "bad_params",
                "message": "Use at most one dialog action: --accept, --dismiss, or --prompt-value.",
            ])
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        let action: String?
        if dismiss {
            action = "dismiss"
        } else if accept || promptValue != nil {
            action = "accept"
        } else {
            action = nil
        }
        if let action { params["action"] = action }
        if let promptValue { params["promptText"] = promptValue }
        let result = try client.call(method: "dialog_tab", params: params)
        if let action {
            var step: [String: Any] = ["op": "dialog", "tabId": tabId, "action": action]
            if let promptValue { step["promptTextBytes"] = promptValue.utf8.count }
            appendRecordedStep(step)
        }
        printJSON(result)
    }
}

struct Download: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "download",
        abstract: "Inspect or wait for downloads associated with a shared tab",
        discussion: """
        Returns Chrome download metadata and final local paths when Chrome exposes them.
        ABG does not read downloaded file contents.
        """
    )
    @OptionGroup var target: TabTarget
    @Flag(name: .long, help: "Wait until the latest/current download reaches complete or interrupted state") var wait: Bool = false
    @Option(name: .long, help: "Wait timeout in milliseconds") var timeout: Int = defaultGatewayTimeoutMs()

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if wait {
            params["wait"] = true
            params["timeoutMs"] = timeout
        }
        let result = try client.call(method: "download_tab", params: params)
        printJSON(result)
    }
}

struct HAR: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "har",
        abstract: "Export a redacted HAR snapshot for a shared tab",
        discussion: """
        Exports a one-shot HAR file from the tab's buffered network metadata.
        ABG's default HAR redaction omits cookies, authorization headers, request bodies, response bodies, and sensitive headers.
        The Gateway writes the file to --out or to a local ABG temporary directory and records audit metadata for the export.
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Output HAR path. Defaults to an ABG temp directory.") var out: String?
    @Option(name: .long, help: "URL glob filter") var url: String?
    @Option(name: .long, help: "URL regex filter") var urlRegex: String?
    @Option(name: .long, help: "HTTP method filter") var method: String?
    @Option(name: .long, help: "Minimum HTTP status") var statusMin: Int?
    @Option(name: .long, help: "Maximum HTTP status") var statusMax: Int?
    @Option(name: .long, help: "Resource type filter (xhr,fetch,document, etc.; comma-separated)") var type: String?
    @Option(name: .long, help: "Maximum entries to export. Defaults to 200 and caps at 1000.") var limit: Int = 200

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "limit": limit]
        if let out {
            params["outputPath"] = (out as NSString).expandingTildeInPath
        }
        if let url { params["urlPattern"] = url }
        if let urlRegex { params["urlRegex"] = urlRegex }
        if let method { params["method"] = method }
        if let statusMin { params["statusMin"] = statusMin }
        if let statusMax { params["statusMax"] = statusMax }
        if let type { params["type"] = type }
        let result = try client.call(method: "har_tab", params: params)
        printJSON(result)
    }
}

struct State: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "state",
        abstract: "Inspect read-only cookies and Web Storage for a shared tab",
        discussion: """
        Lists cookies, localStorage keys, and sessionStorage keys for the shared tab origin.
        Values are redacted by default. Use --values only when the workflow explicitly needs secret/session values; the Gateway audit log records that values were requested.
        This command never writes or deletes cookies or storage.
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "State kind: cookies, local-storage, session-storage, or all") var kind: String = "all"
    @Option(name: .long, help: "Cookie name glob filter") var name: String?
    @Option(name: .long, help: "Storage key glob filter") var key: String?
    @Flag(name: .long, help: "Return full cookie/storage values. Values are redacted unless this flag is set.") var values: Bool = false
    @Option(name: .long, help: "Maximum entries per state category. Defaults to 200 and caps at 500.") var limit: Int = 200

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "kind": kind, "limit": limit]
        if let name { params["name"] = name }
        if let key { params["storageKey"] = key }
        if values { params["includeValues"] = true }
        let result = try client.call(method: "state_tab", params: params)
        printJSON(result)
    }
}

struct Framework: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "framework",
        abstract: "Inspect React, Web Vitals, and SPA navigation signals from a shared tab",
        discussion: """
        Read-only framework inspection for real browser sessions.
        React tree data is returned only when the page exposes a compatible React DevTools hook; missing hooks fail gracefully.
        Web Vitals are reported from browser Performance API snapshots, not ABG telemetry.
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Inspection kind: react, web-vitals, spa, or all") var kind: String = "all"
    @Option(name: .long, help: "Maximum React nodes or Performance entries. Defaults to 80 and caps at 500.") var limit: Int = 80
    @Option(name: .long, help: "Maximum React tree depth. Defaults to 4 and caps at 10.") var depth: Int = 4

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let params: [String: Any] = ["tabId": tabId, "kind": kind, "limit": limit, "depth": depth]
        let result = try client.call(method: "framework_tab", params: params)
        printJSON(result)
    }
}

struct Sandbox: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "sandbox",
        abstract: "Run sandbox/all-tabs-only browser-owned automation controls",
        discussion: """
        These controls are rejected unless the target tab is shared through all-tabs profile mode.
        Supported actions: viewport, viewport-clear, storage-set, storage-delete, tab-create, tab-close.
        Every action goes through operation approval and Gateway audit logging.
        """
    )
    @OptionGroup var target: TabTarget
    @Argument(help: "Action: viewport, viewport-clear, storage-set, storage-delete, tab-create, tab-close") var action: String
    @Option(name: .long, help: "Viewport width") var width: Int?
    @Option(name: .long, help: "Viewport height") var height: Int?
    @Option(name: .long, help: "Device scale factor for viewport emulation") var deviceScaleFactor: Double?
    @Flag(name: .long, help: "Use mobile viewport emulation") var mobile: Bool = false
    @Option(name: .long, help: "Storage kind: local-storage or session-storage") var storage: String?
    @Option(name: .long, help: "Storage key for storage-set/storage-delete") var key: String?
    @Option(name: .long, help: "Storage value for storage-set") var value: String?
    @Option(name: .long, help: "URL for tab-create") var url: String?
    @Option(name: .long, help: "Target tab id for tab-close. Defaults to the resolved tab.") var targetTab: Int?

    func run() async throws {
        let normalizedAction = action.lowercased()
        let allowed = ["viewport", "viewport-clear", "storage-set", "storage-delete", "tab-create", "tab-close"]
        guard allowed.contains(normalizedAction) else {
            try failWithJSON([
                "error": "bad_sandbox_action",
                "message": "Action must be one of viewport, viewport-clear, storage-set, storage-delete, tab-create, or tab-close.",
            ])
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "action": normalizedAction]
        if let width { params["width"] = width }
        if let height { params["height"] = height }
        if let deviceScaleFactor { params["deviceScaleFactor"] = deviceScaleFactor }
        if mobile { params["mobile"] = true }
        if let storage { params["storageKind"] = storage }
        if let key { params["storageKey"] = key }
        if let value { params["value"] = value }
        if let url { params["url"] = url }
        if let targetTab { params["targetTabId"] = targetTab }
        let result = try client.call(method: "sandbox_tab", params: params)
        printJSON(result)
    }
}

struct Get: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "get",
        abstract: "Small read-only getters for text, html, value, attr, title, url, count, box, and styles"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "Getter kind: text/html/value/attr/title/url/count/box/styles") var kind: String
    @Argument(help: "tab ID/ref and optional selector, or selector only when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "CSS selector (alternative to positional selector)") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector. Cross-origin frames are listed but not selector-addressable.") var frame: String?
    @Option(name: .long, help: "Attribute name for `get attr`") var name: String?
    @Option(name: .long, help: "Comma-separated computed style properties for `get styles`") var props: String?

    func run() async throws {
        let normalizedKind = kind.lowercased()
        guard ["text", "html", "value", "editable-value", "attr", "title", "url", "count", "box", "styles"].contains(normalizedKind) else {
            try failWithJSON([
                "error": "bad_getter",
                "message": "Getter must be one of text/html/value/editable-value/attr/title/url/count/box/styles.",
            ])
        }
        if normalizedKind == "attr", name == nil {
            try failWithJSON(["error": "bad_params", "message": "`abg get attr` requires --name."])
        }
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg get <kind> <tab> [selector]",
        ])
        let positionalSelectorIndex = hasMatch ? 0 : 1
        let resolvedSelector = selector ?? (args.indices.contains(positionalSelectorIndex) ? args[positionalSelectorIndex] : nil)
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        var params: [String: Any] = ["tabId": tabId, "kind": normalizedKind]
        if let resolvedSelector { params["selector"] = resolvedSelector }
        if let frame { params["frame"] = frame }
        if let name { params["name"] = name }
        if let props {
            params["props"] = props.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        }
        let result = try client.call(method: "get_tab", params: params)
        printJSON(result)
    }
}

struct Find: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "find",
        abstract: "Find elements by semantic locators and optionally act on them"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "Locator kind: role/text/label/placeholder/alt/title/testid") var locator: String
    @Argument(help: "tab, query pieces, and optional action") var args: [String] = []
    @Option(name: .long, help: "Accessible name for role locators") var name: String?
    @Option(name: .long, help: "Value used by fill/type actions") var value: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector. Cross-origin frames are listed but not selector-addressable.") var frame: String?
    @Flag(name: .long, help: "Use exact text matching instead of case-insensitive contains") var exact: Bool = false
    @Option(name: .long, help: "Maximum matches to return") var limit: Int = 20

    func run() async throws {
        let normalizedLocator = locator.lowercased()
        guard ["role", "text", "label", "placeholder", "alt", "title", "testid", "first", "last", "nth"].contains(normalizedLocator) else {
            try failWithJSON([
                "error": "bad_locator",
                "message": "Locator must be one of role/text/label/placeholder/alt/title/testid/first/last/nth.",
            ])
        }
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg find <locator> <tab> <query> [action]",
        ])
        let offset = hasMatch ? 0 : 1
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        var params: [String: Any] = [
            "tabId": tabId,
            "locator": normalizedLocator,
            "exact": exact,
            "limit": max(1, min(limit, 100)),
        ]

        let action: String
        if ["first", "last", "nth"].contains(normalizedLocator) {
            params["locator"] = "css"
            params["indexModifier"] = normalizedLocator
            let queryIndex: Int
            if normalizedLocator == "nth" {
                let rawIndex = try requireArg(args, index: offset, error: [
                    "error": "index_required",
                    "message": "Usage: abg find nth <tab> <zero-based-index> <selector> [action]",
                ])
                guard let index = Int(rawIndex), index >= 0 else {
                    try failWithJSON(["error": "bad_index", "message": "nth index must be a zero-based integer."])
                }
                params["index"] = index
                queryIndex = offset + 1
            } else {
                queryIndex = offset
            }
            let query = try requireArg(args, index: queryIndex, error: [
                "error": "query_required",
                "message": "Usage: abg find \(normalizedLocator) <tab> <selector> [action]",
            ])
            params["query"] = query
            action = args.indices.contains(queryIndex + 1) ? args[queryIndex + 1].lowercased() : "inspect"
        } else if normalizedLocator == "role" {
            let role = try requireArg(args, index: offset, error: [
                "error": "role_required",
                "message": "Usage: abg find role <tab> <role> [action] --name <accessible name>",
            ])
            params["role"] = role
            if let name { params["query"] = name }
            action = args.indices.contains(offset + 1) ? args[offset + 1].lowercased() : "inspect"
        } else {
            let query = try requireArg(args, index: offset, error: [
                "error": "query_required",
                "message": "Usage: abg find \(normalizedLocator) <tab> <query> [action]",
            ])
            params["query"] = query
            action = args.indices.contains(offset + 1) ? args[offset + 1].lowercased() : "inspect"
        }
        params["action"] = action
        if let value { params["value"] = value }
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "find_tab", params: params)
        if action != "inspect" && action != "text" {
            var step: [String: Any] = ["op": "find", "tabId": tabId, "locator": normalizedLocator, "action": action]
            if let query = params["query"] { step["query"] = query }
            if let role = params["role"] { step["role"] = role }
            if let indexModifier = params["indexModifier"] { step["indexModifier"] = indexModifier }
            if let index = params["index"] { step["index"] = index }
            if let value { step["value"] = value }
            if let frame { step["frame"] = frame }
            if exact { step["exact"] = true }
            appendRecordedStep(step)
        }
        printJSON(result)
    }
}

struct Snapshot: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "snapshot",
        abstract: "Capture an AI-oriented accessibility snapshot with stable refs"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Limit snapshot to a CSS selector subtree") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector. Cross-origin frames are listed but not selector-addressable.") var frame: String?
    @Option(name: .long, help: "Maximum DOM ancestor depth to include in selectors") var depth: Int = 5
    @Flag(name: .long, help: "Only include interactive elements") var interactiveOnly: Bool = false
    @Flag(name: .long, help: "Omit verbose selector/html-adjacent details") var compact: Bool = false
    @Option(name: .long, help: "Comma-separated name:tab:selector targets for multi-tab selector snapshots") var tabs: String?

    func run() async throws {
        let client = UDSClient()
        if let tabs {
            let result = try runMultiTabSnapshot(client: client, spec: tabs)
            printJSON(result)
            return
        }
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "depth": max(1, min(depth, 12)),
            "interactiveOnly": interactiveOnly,
            "compact": compact,
        ]
        if let selector { params["selector"] = selector }
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "snapshot_tab", params: params)
        printJSON(result)
    }

    private func runMultiTabSnapshot(client: UDSClient, spec: String) throws -> [String: Any] {
        let targets = try parseSnapshotTargets(spec)
        var results: [[String: Any]] = []
        for target in targets {
            var row: [String: Any] = [
                "name": target.name,
                "tab": target.tab,
                "selector": target.selector,
                "capturedAt": ISO8601DateFormatter().string(from: Date()),
            ]
            do {
                let tabId = try resolveTabId(client: client, tabToken: target.tab, matchUrl: nil, matchTitle: nil, first: false)
                row["tabId"] = tabId
                let read = try client.call(method: "read_tab", params: [
                    "tabId": tabId,
                    "selector": target.selector,
                ]) as? [String: Any] ?? [:]
                let count = try client.call(method: "get_tab", params: [
                    "tabId": tabId,
                    "kind": "count",
                    "selector": target.selector,
                ]) as? [String: Any] ?? [:]
                row["ok"] = true
                row["url"] = read["url"] ?? ""
                row["title"] = read["title"] ?? ""
                row["matchCount"] = count["value"] ?? 0
                row["text"] = read["text"] ?? ""
                row["html"] = read["html"] ?? ""
            } catch {
                row["ok"] = false
                row["error"] = error.localizedDescription
            }
            results.append(row)
        }
        return [
            "ok": results.allSatisfy { ($0["ok"] as? Bool) == true },
            "targetCount": results.count,
            "targets": results,
        ]
    }

    private func parseSnapshotTargets(_ spec: String) throws -> [(name: String, tab: String, selector: String)] {
        try spec.split(separator: ",").map { raw in
            let parts = raw.split(separator: ":", maxSplits: 2).map(String.init)
            guard parts.count == 3, !parts[0].isEmpty, !parts[1].isEmpty, !parts[2].isEmpty else {
                try failWithJSON([
                    "error": "bad_tabs_spec",
                    "message": "--tabs entries must be name:tab:selector, separated by commas.",
                ])
            }
            return (name: parts[0], tab: parts[1], selector: parts[2])
        }
    }
}

struct Stream: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "stream",
        abstract: "Manage local runtime event streaming",
        subcommands: [StreamEnable.self, StreamStatus.self, StreamDisable.self]
    )
}

struct StreamEnable: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "enable", abstract: "Enable runtime stream for one shared tab")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Requested stream port. Current Gateway stream uses the Gateway WebSocket port.") var port: Int?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if let port { params["port"] = port }
        let result = try client.call(method: "stream_enable", params: params)
        printJSON(result)
    }
}

struct StreamStatus: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "status", abstract: "Show runtime stream state")
    func run() async throws {
        let result = try UDSClient().call(method: "stream_status")
        printJSON(result)
    }
}

struct StreamDisable: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "disable", abstract: "Disable runtime stream")
    func run() async throws {
        let result = try UDSClient().call(method: "stream_disable")
        printJSON(result)
    }
}

struct Validate: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "validate",
        abstract: "Read-only validators for editable content",
        subcommands: [ValidateEditable.self]
    )
}

struct ValidateEditable: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "editable", abstract: "Validate selector or selection editable text")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Editable CSS selector") var selector: String?
    @Flag(name: .long, help: "Validate current selected text") var selection: Bool = false
    @Option(name: .long, help: "Comma-separated rules: html-attrs,shortcodes") var rules: String = "html-attrs,shortcodes"

    func run() async throws {
        guard selection || selector != nil else {
            try failWithJSON(["error": "bad_params", "message": "Pass --selector or --selection."])
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "rules": rules,
            "selection": selection,
        ]
        if let selector { params["selector"] = selector }
        let result = try client.call(method: "validate_editable_tab", params: params)
        printJSON(result)
    }
}

struct IsVisible: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "is-visible", abstract: "Return whether a selector is visible")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    func run() async throws {
        try runPredicate(kind: "visible", target: target, selector: selector, frame: frame)
    }
}

struct IsEnabled: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "is-enabled", abstract: "Return whether a selector is enabled")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    func run() async throws {
        try runPredicate(kind: "enabled", target: target, selector: selector, frame: frame)
    }
}

struct IsChecked: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "is-checked", abstract: "Return whether a checkbox is checked")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    func run() async throws {
        try runPredicate(kind: "checked", target: target, selector: selector, frame: frame)
    }
}

func runPredicate(kind: String, target: TabTarget, selector: String, frame: String?) throws {
    let client = UDSClient()
    let tabId = try resolveTabId(client: client, target: target)
    var params: [String: Any] = [
        "tabId": tabId,
        "kind": kind,
        "selector": selector,
    ]
    if let frame { params["frame"] = frame }
    let result = try client.call(method: "predicate_tab", params: params)
    printJSON(result)
}

struct KeyboardInsertText: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "inserttext",
        abstract: "Insert text into the currently focused target through CDP Input.insertText"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and text, or just text when --match-url/title is used") var args: [String] = []

    func run() async throws {
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg keyboard inserttext <tab> <text> or abg keyboard inserttext --match-url <glob> <text>",
        ])
        let textStart = hasMatch ? 0 : 1
        guard args.count > textStart else {
            try failWithJSON(["error": "text_required", "message": "text is required"])
        }
        let text = args[textStart...].joined(separator: " ")
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        let result = try client.call(method: "keyboard_insert_text_tab", params: [
            "tabId": tabId,
            "text": text,
        ])
        appendRecordedStep(["op": "keyboard_insert_text", "tabId": tabId, "text": text])
        printJSON(result)
    }
}

struct KeyDown: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keydown",
        abstract: "Dispatch a keyDown event without a matching keyUp"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and key, or just key when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "modifiers をカンマ区切り (alt,ctrl,cmd,shift)") var modifiers: String?

    func run() async throws {
        try runKeyEdge(method: "key_down_tab", op: "keydown", match: match, args: args, modifiers: modifiers)
    }
}

struct KeyUp: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "keyup",
        abstract: "Dispatch a keyUp event without a preceding keyDown"
    )
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and key, or just key when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "modifiers をカンマ区切り (alt,ctrl,cmd,shift)") var modifiers: String?

    func run() async throws {
        try runKeyEdge(method: "key_up_tab", op: "keyup", match: match, args: args, modifiers: modifiers)
    }
}

func runKeyEdge(
    method: String,
    op: String,
    match: TabMatchOptions,
    args: [String],
    modifiers: String?
) throws {
    let client = UDSClient()
    let hasMatch = match.matchUrl != nil || match.matchTitle != nil
    let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
        "error": "tab_required",
        "message": "Usage: abg \(op) <tab> <key> or abg \(op) --match-url <glob> <key>",
    ])
    let key = try requireArg(args, index: hasMatch ? 0 : 1, error: [
        "error": "key_required",
        "message": "key is required",
    ])
    let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
    var params: [String: Any] = ["tabId": tabId, "key": key]
    if let modifiers {
        params["modifiers"] = modifiers.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
    }
    let result = try client.call(method: method, params: params)
    var step: [String: Any] = ["op": op, "tabId": tabId, "key": key]
    if let modifiers { step["modifiers"] = modifiers }
    appendRecordedStep(step)
    printJSON(result)
}

struct DblClick: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "dblclick",
        abstract: "Double-click an element selected by CSS"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Double-click target CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "selector": selector,
        ]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "dblclick_tab", params: params)
        var step: [String: Any] = ["op": "dblclick", "tabId": tabId, "selector": selector]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Focus: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "focus",
        abstract: "Focus an element without clicking it"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Focus target CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "selector": selector,
        ]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "focus_tab", params: params)
        var step: [String: Any] = ["op": "focus", "tabId": tabId, "selector": selector]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Hover: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "hover",
        abstract: "Move the mouse to the center of an element"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Hover target CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "selector": selector,
        ]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "hover_tab", params: params)
        var step: [String: Any] = ["op": "hover", "tabId": tabId, "selector": selector]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct SelectOption: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "select",
        abstract: "Select a native dropdown option by value or visible label"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target select element CSS selector") var selector: String
    @Option(name: .long, help: "Option value to select") var value: String?
    @Option(name: .long, help: "Visible option label to select") var label: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        guard (value == nil) != (label == nil) else {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one of --value or --label.",
            ])
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "selector": selector]
        if let value { params["value"] = value }
        if let label { params["label"] = label }
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "select_tab", params: params)
        var step: [String: Any] = ["op": "select", "tabId": tabId, "selector": selector]
        if let value { step["value"] = value }
        if let label { step["label"] = label }
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Check: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "check",
        abstract: "Ensure a checkbox is checked"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target checkbox CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        try runCheckedState(commandName: "check", checked: true, target: target, selector: selector, frame: frame)
    }
}

struct Uncheck: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "uncheck",
        abstract: "Ensure a checkbox is unchecked"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target checkbox CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        try runCheckedState(commandName: "uncheck", checked: false, target: target, selector: selector, frame: frame)
    }
}

func runCheckedState(commandName: String, checked: Bool, target: TabTarget, selector: String, frame: String?) throws {
    let client = UDSClient()
    let tabId = try resolveTabId(client: client, target: target)
    var params: [String: Any] = [
        "tabId": tabId,
        "selector": selector,
        "checked": checked,
    ]
    if let frame { params["frame"] = frame }
    let result = try client.call(method: "checked_state_tab", params: params)
    var step: [String: Any] = ["op": commandName, "tabId": tabId, "selector": selector]
    if let frame { step["frame"] = frame }
    appendRecordedStep(step)
    printJSON(result)
}

struct ScrollIntoView: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "scroll-into-view",
        abstract: "Scroll an element into the viewport"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "selector": selector,
        ]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "scroll_into_view_tab", params: params)
        var step: [String: Any] = ["op": "scroll-into-view", "tabId": tabId, "selector": selector]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}
