import ArgumentParser
import Foundation
#if canImport(Darwin)
import Darwin
#elseif canImport(Glibc)
import Glibc
#endif
import GatewayCore

func defaultGatewayTimeoutMs() -> Int {
    GatewaySettingsStore.load().defaultTimeoutMs
}

@main
enum ABGMain {
    static func main() async {
        let args = Array(CommandLine.arguments.dropFirst())
        if args == ["--help"] || args == ["-h"] {
            print(ABG.helpMessage())
            printRuntimePluginCommandSummary()
            Foundation.exit(0)
        }
        if shouldRunDynamicPluginCommand(args) {
            do {
                try runDynamicPluginCommand(args)
                Foundation.exit(0)
            } catch is ExitCode {
                Foundation.exit(1)
            } catch {
                printErrorJSON([
                    "error": "plugin_command_cli_failed",
                    "message": error.localizedDescription,
                ])
                Foundation.exit(1)
            }
        }
        await ABG.main()
    }
}

struct ABG: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "abg",
        abstract: "Agent Browser Gateway CLI",
        subcommands: [
            Status.self, Tabs.self, Inspect.self, Raise.self,
            Bookmarks.self, ReadingList.self,
            Frames.self, Read.self, Get.self, Find.self, Snapshot.self, Screenshot.self, PDF.self, Annotate.self, Console.self, Eval.self, Table.self, Describe.self, Network.self, WaitResponse.self, HAR.self, State.self, Framework.self, Sandbox.self, Download.self, Dialog.self,
            IsVisible.self, IsEnabled.self, IsChecked.self,
            Click.self, DblClick.self, Focus.self, Hover.self, SelectOption.self, Check.self, Uncheck.self, Fill.self, ReplaceEditable.self, Paste.self, ClipboardWrite.self, PasteRich.self, Clear.self, Replace.self, Type.self, Key.self, KeyDown.self, KeyUp.self, Keyboard.self, ExecCommand.self, Navigate.self, Scroll.self, ScrollIntoView.self, Drag.self, Upload.self,
            Wait.self,
            Validate.self, Stream.self,
            Record.self, Replay.self,
            Revoke.self, Audit.self, Activity.self, Plugin.self, MCPServer.self, InstallSkill.self,
        ]
    )
}

private let builtInTopLevelCommands: Set<String> = [
    "status", "tabs", "inspect", "raise",
    "bookmarks", "reading-list",
    "frames", "read", "get", "find", "snapshot", "screenshot", "pdf", "annotate", "console", "eval", "table", "describe", "network", "wait-response", "har", "state", "framework", "sandbox", "download", "dialog",
    "is-visible", "is-enabled", "is-checked",
    "click", "dblclick", "focus", "hover", "select", "check", "uncheck", "fill", "replace-editable", "paste", "clipboard-write", "paste-rich", "clear", "replace", "type", "key", "keydown", "keyup", "keyboard", "exec-command", "navigate", "scroll", "scroll-into-view", "drag", "upload",
    "wait", "validate", "stream",
    "record", "replay",
    "revoke", "audit", "activity", "plugin", "mcp-server", "install-skill",
    "help", "completion",
]

private func shouldRunDynamicPluginCommand(_ args: [String]) -> Bool {
    guard let first = args.first, !first.hasPrefix("-") else { return false }
    return !builtInTopLevelCommands.contains(first)
}

private func printRuntimePluginCommandSummary() {
    guard let commands = try? UDSClient().call(method: "plugin_command_list") as? [[String: Any]],
          !commands.isEmpty
    else { return }
    print("\nPLUGIN COMMANDS:")
    for row in commands {
        let plugin = row["plugin"] as? String ?? ""
        let command = row["command"] as? String ?? ""
        let description = row["description"] as? String
        if let description, !description.isEmpty {
            print("  \(plugin) \(command)  \(description)")
        } else {
            print("  \(plugin) \(command)")
        }
    }
}

private func runDynamicPluginCommand(_ rawArgs: [String]) throws {
    let pluginName = rawArgs[0]
    guard rawArgs.count >= 2 else {
        try printPluginHelp(pluginName: pluginName)
        throw ExitCode.failure
    }
    if rawArgs[1] == "--help" || rawArgs[1] == "-h" {
        try printPluginHelp(pluginName: pluginName)
        return
    }
    let commandName = rawArgs[1]
    let trailing = Array(rawArgs.dropFirst(2))
    if trailing.contains("--help") || trailing.contains("-h") {
        try printPluginCommandHelp(pluginName: pluginName, commandName: commandName)
        return
    }
    let parsed = try parsePluginCommandArgs(trailing)
    var params: [String: Any] = [
        "pluginName": pluginName,
        "command": commandName,
        "args": parsed.args,
    ]
    if let tabId = parsed.tabId { params["tabId"] = tabId }
    let result = try UDSClient().call(method: "plugin_command_run", params: params)
    printJSON(result)
}

private func printPluginHelp(pluginName: String) throws {
    let commands = try pluginCommands(pluginName: pluginName)
    guard !commands.isEmpty else {
        try failWithJSON([
            "error": "plugin_not_found",
            "message": "No loaded plugin commands found for \(pluginName).",
            "nextCommand": "abg plugin list --loaded",
        ])
    }
    print("USAGE: abg \(pluginName) <command> [--key value] [--flag] [--json '{...}'] [--stdin]")
    print("\nCOMMANDS:")
    for row in commands {
        let command = row["command"] as? String ?? ""
        let description = row["description"] as? String
        if let description, !description.isEmpty {
            print("  \(command)  \(description)")
        } else {
            print("  \(command)")
        }
    }
}

private func printPluginCommandHelp(pluginName: String, commandName: String) throws {
    let commands = try pluginCommands(pluginName: pluginName)
    guard let row = commands.first(where: { ($0["command"] as? String) == commandName }) else {
        try failWithJSON([
            "error": "plugin_command_not_found",
            "message": "No loaded command \(pluginName) \(commandName).",
            "nextCommand": "abg \(pluginName) --help",
        ])
    }
    print("USAGE: abg \(pluginName) \(commandName) [--key value] [--flag] [--json '{...}'] [--stdin]")
    if let description = row["description"] as? String, !description.isEmpty {
        print("\n\(description)")
    }
    guard let args = row["args"] as? [[String: Any]], !args.isEmpty else { return }
    print("\nARGUMENTS:")
    for arg in args {
        let name = arg["name"] as? String ?? ""
        let type = arg["type"] as? String ?? "string"
        let required = (arg["required"] as? Bool) == true ? "required" : "optional"
        if let defaultValue = arg["default"] {
            print("  --\(name)  \(type), \(required), default: \(defaultValue)")
        } else {
            print("  --\(name)  \(type), \(required)")
        }
    }
}

private func pluginCommands(pluginName: String) throws -> [[String: Any]] {
    let rows = try UDSClient().call(method: "plugin_command_list") as? [[String: Any]] ?? []
    return rows.filter { ($0["plugin"] as? String) == pluginName }
}

private func parsePluginCommandArgs(_ rawArgs: [String]) throws -> (args: [String: Any], tabId: Int?) {
    var args: [String: Any] = [:]
    var tabId: Int?
    var tabToken: String?
    var matchUrl: String?
    var matchTitle: String?
    var first = false
    var index = 0
    while index < rawArgs.count {
        let token = rawArgs[index]
        guard token.hasPrefix("--") else {
            try failWithJSON([
                "error": "unexpected_argument",
                "message": "Unexpected argument: \(token). Use --key value or --flag.",
            ])
        }
        let key = String(token.dropFirst(2))
        guard !key.isEmpty else {
            try failWithJSON(["error": "bad_argument", "message": "Empty option name is not allowed."])
        }
        switch key {
        case "json":
            index += 1
            guard rawArgs.indices.contains(index) else {
                try failWithJSON(["error": "missing_value", "message": "--json requires a JSON object value."])
            }
            let object = try parseJSONObject(rawArgs[index], label: "--json")
            args.merge(object) { _, new in new }
        case "stdin":
            let data = FileHandle.standardInput.readDataToEndOfFile()
            let text = String(data: data, encoding: .utf8) ?? ""
            if let object = try? parseJSONObject(text, label: "--stdin") {
                args.merge(object) { _, new in new }
            } else {
                args["stdin"] = text
            }
        case "tab-id":
            index += 1
            guard rawArgs.indices.contains(index), let parsed = Int(rawArgs[index]) else {
                try failWithJSON(["error": "missing_value", "message": "--tab-id requires an integer value."])
            }
            tabId = parsed
        case "tab":
            index += 1
            guard rawArgs.indices.contains(index) else {
                try failWithJSON(["error": "missing_value", "message": "--tab requires a tab ID/ref value."])
            }
            tabToken = rawArgs[index]
        case "match-url":
            index += 1
            guard rawArgs.indices.contains(index) else {
                try failWithJSON(["error": "missing_value", "message": "--match-url requires a URL glob value."])
            }
            matchUrl = rawArgs[index]
        case "match-title":
            index += 1
            guard rawArgs.indices.contains(index) else {
                try failWithJSON(["error": "missing_value", "message": "--match-title requires a title glob value."])
            }
            matchTitle = rawArgs[index]
        case "first":
            first = true
        default:
            if rawArgs.indices.contains(index + 1), !rawArgs[index + 1].hasPrefix("--") {
                index += 1
                args[key] = parseScalar(rawArgs[index])
            } else {
                args[key] = true
            }
        }
        index += 1
    }
    if tabId == nil, tabToken != nil || matchUrl != nil || matchTitle != nil {
        tabId = try resolveTabId(
            client: UDSClient(),
            tabToken: tabToken,
            matchUrl: matchUrl,
            matchTitle: matchTitle,
            first: first
        )
    }
    return (args, tabId)
}

private func parseJSONObject(_ text: String, label: String) throws -> [String: Any] {
    guard let data = text.data(using: .utf8),
          let object = try JSONSerialization.jsonObject(with: data) as? [String: Any]
    else {
        try failWithJSON(["error": "bad_json", "message": "\(label) must be a JSON object."])
    }
    return object
}

private func parseScalar(_ text: String) -> Any {
    if text == "true" { return true }
    if text == "false" { return false }
    if let int = Int(text) { return int }
    if let double = Double(text) { return double }
    return text
}

struct TabTarget: ParsableArguments {
    @Argument(help: "tab ID or short ref from `abg tabs` (for example: 414636456 or t1)") var tab: String?
    @Option(name: .long, help: "Resolve the shared tab by URL glob (example: \"*kintone*\")") var matchUrl: String?
    @Option(name: .long, help: "Resolve the shared tab by title glob (example: \"*アプリ管理*\")") var matchTitle: String?
    @Flag(name: .long, help: "Use the first matching tab when --match-url/title finds multiple tabs") var first: Bool = false
}

struct TabMatchOptions: ParsableArguments {
    @Option(name: .long, help: "Resolve the shared tab by URL glob (example: \"*kintone*\")") var matchUrl: String?
    @Option(name: .long, help: "Resolve the shared tab by title glob (example: \"*アプリ管理*\")") var matchTitle: String?
    @Flag(name: .long, help: "Use the first matching tab when --match-url/title finds multiple tabs") var first: Bool = false
}

func resolveTabId(client: UDSClient, target: TabTarget) throws -> Int {
    try resolveTabId(
        client: client,
        tabToken: target.tab,
        matchUrl: target.matchUrl,
        matchTitle: target.matchTitle,
        first: target.first
    )
}

func resolveTabId(client: UDSClient, tabToken: String?, match: TabMatchOptions) throws -> Int {
    try resolveTabId(
        client: client,
        tabToken: tabToken,
        matchUrl: match.matchUrl,
        matchTitle: match.matchTitle,
        first: match.first
    )
}

func resolveTabId(client: UDSClient, tabToken: String?, matchUrl: String?, matchTitle: String?, first: Bool) throws -> Int {
    if matchUrl != nil || matchTitle != nil {
        let tabs = try tabsWithRefs(client.call(method: "list_tabs"))
        let matches = tabs.filter { tab in
            let urlOK = matchUrl.map { globMatches(pattern: $0, text: tab["url"] as? String ?? "") } ?? true
            let titleOK = matchTitle.map { globMatches(pattern: $0, text: tab["title"] as? String ?? "") } ?? true
            return urlOK && titleOK
        }
        if matches.isEmpty {
            try failWithJSON([
                "error": "tab_match_not_found",
                "message": "No shared tab matched the supplied URL/title pattern.",
                "userMessage": "条件に一致する共有済みタブがありません。Chrome 拡張機能のアイコンから対象タブを共有して、`abg tabs` で一覧を確認してください。",
                "nextCommand": "abg tabs --compact",
            ])
        }
        if matches.count > 1 && !first {
            try failWithJSON([
                "error": "ambiguous_tab_match",
                "message": "\(matches.count) shared tabs matched. Pass a tab ID/ref, or add --first.",
                "userMessage": "複数の共有済みタブが条件に一致しました。`abg tabs --compact` で確認して tabId/ref を指定するか、先頭でよければ --first を付けてください。",
                "matches": compactTabs(matches),
                "nextCommand": "abg tabs --compact",
            ])
        }
        if let tabId = matches.first?["tabId"] as? Int { return tabId }
    }

    guard let token = tabToken, !token.isEmpty else {
        try failWithJSON([
            "error": "tab_required",
            "message": "tab ID/ref or --match-url/--match-title is required.",
            "userMessage": "操作対象のタブを指定してください。`abg tabs --compact` で ref を確認するか、--match-url / --match-title を使えます。",
            "nextCommand": "abg tabs --compact",
        ])
    }
    if let id = Int(token) { return id }
    if let refIndex = parseTabRef(token) {
        let tabs = try tabsWithRefs(client.call(method: "list_tabs"))
        let index = refIndex - 1
        if tabs.indices.contains(index), let tabId = tabs[index]["tabId"] as? Int {
            return tabId
        }
        try failWithJSON([
            "error": "tab_ref_not_found",
            "message": "No shared tab exists for ref \(token).",
            "userMessage": "指定された ref の共有済みタブが見つかりません。`abg tabs --compact` で最新の一覧を確認してください。",
            "nextCommand": "abg tabs --compact",
        ])
    }
    try failWithJSON([
        "error": "invalid_tab",
        "message": "Invalid tab reference: \(token)",
        "userMessage": "tab は数値の tabId か、`t1` のような ref で指定してください。",
        "nextCommand": "abg tabs --compact",
    ])
}

func tabsWithRefs(_ value: Any?) -> [[String: Any]] {
    guard let tabs = value as? [[String: Any]] else { return [] }
    return tabs.enumerated().map { index, tab in
        var copy = tab
        copy["ref"] = "t\(index + 1)"
        return copy
    }
}

func compactTabs(_ tabs: [[String: Any]]) -> [[String: Any]] {
    tabs.map { tab in
        var compact: [String: Any] = [
            "ref": tab["ref"] ?? "",
            "tabId": tab["tabId"] ?? 0,
            "title": tab["title"] ?? "",
            "url": tab["url"] ?? "",
        ]
        if let accessMode = tab["accessMode"] {
            compact["accessMode"] = accessMode
        }
        return compact
    }
}

func globMatches(pattern: String, text: String) -> Bool {
    let escaped = NSRegularExpression.escapedPattern(for: pattern)
        .replacingOccurrences(of: "\\*", with: ".*")
        .replacingOccurrences(of: "\\?", with: ".")
    let regex = "^\(escaped)$"
    return text.range(of: regex, options: [.regularExpression, .caseInsensitive]) != nil
}

func parseTabRef(_ token: String) -> Int? {
    guard token.first?.lowercased() == "t" else { return nil }
    return Int(token.dropFirst()).flatMap { $0 > 0 ? $0 : nil }
}

func failWithJSON(_ payload: [String: Any]) throws -> Never {
    printErrorJSON(payload)
    throw ExitCode.failure
}

func requireArg(_ args: [String], index: Int, error: [String: Any]) throws -> String {
    guard args.indices.contains(index) else { try failWithJSON(error) }
    return args[index]
}

func screenshotDirectory() throws -> URL {
    let base = ABGConstants.screenshotsDir
    try FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
    return base
}

func defaultScreenshotPath(tabLabel: String) throws -> String {
    let formatter = DateFormatter()
    formatter.locale = Locale(identifier: "en_US_POSIX")
    formatter.dateFormat = "yyyyMMdd-HHmmss"
    let ts = formatter.string(from: Date())
    let safeLabel = tabLabel.replacingOccurrences(of: #"[^A-Za-z0-9_.-]"#, with: "-", options: .regularExpression)
    return try screenshotDirectory().appendingPathComponent("\(safeLabel)-\(ts).png").path
}

func latestScreenshotMarker() throws -> URL {
    try screenshotDirectory().appendingPathComponent("latest.txt")
}

func abgStateDirectory() throws -> URL {
    let url = ABGConstants.abgUserDir
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

func recordingStatePath() throws -> URL {
    try abgStateDirectory().appendingPathComponent("recording.json")
}

func saveScreenshotResult(_ result: Any?, outPath: String) throws -> [String: Any] {
    guard let dict = result as? [String: Any], let dataUrl = dict["dataUrl"] as? String else {
        FileHandle.standardError.write(Data("unexpected response: \(String(describing: result))\n".utf8))
        throw ExitCode.failure
    }
    guard let comma = dataUrl.firstIndex(of: ",") else {
        FileHandle.standardError.write(Data("invalid dataUrl\n".utf8))
        throw ExitCode.failure
    }
    let b64 = String(dataUrl[dataUrl.index(after: comma)...])
    guard let png = Data(base64Encoded: b64) else {
        FileHandle.standardError.write(Data("base64 decode failed\n".utf8))
        throw ExitCode.failure
    }
    try png.write(to: URL(fileURLWithPath: outPath))
    try outPath.write(to: latestScreenshotMarker(), atomically: true, encoding: .utf8)
    return ["path": outPath, "bytes": png.count]
}

func savePDFResult(_ result: Any?, outPath: String) throws -> [String: Any] {
    guard let dict = result as? [String: Any], let dataUrl = dict["dataUrl"] as? String else {
        FileHandle.standardError.write(Data("unexpected response: \(String(describing: result))\n".utf8))
        throw ExitCode.failure
    }
    guard let comma = dataUrl.firstIndex(of: ",") else {
        FileHandle.standardError.write(Data("invalid dataUrl\n".utf8))
        throw ExitCode.failure
    }
    let b64 = String(dataUrl[dataUrl.index(after: comma)...])
    guard let pdf = Data(base64Encoded: b64) else {
        FileHandle.standardError.write(Data("base64 decode failed\n".utf8))
        throw ExitCode.failure
    }
    try pdf.write(to: URL(fileURLWithPath: outPath))
    var response: [String: Any] = [
        "path": outPath,
        "bytes": pdf.count,
    ]
    if let url = dict["url"] { response["url"] = url }
    if let title = dict["title"] { response["title"] = title }
    return response
}

func appendRecordedStep(_ step: [String: Any]) {
    guard ProcessInfo.processInfo.environment["ABG_DISABLE_RECORDING"] != "1",
          let stateData = try? Data(contentsOf: recordingStatePath()),
          let state = try? JSONSerialization.jsonObject(with: stateData) as? [String: Any],
          let recordingTabId = state["tabId"] as? Int,
          let stepTabId = step["tabId"] as? Int,
          recordingTabId == stepTabId,
          let logPath = state["logPath"] as? String
    else { return }

    var payload = step
    payload.removeValue(forKey: "tabId")
    guard JSONSerialization.isValidJSONObject(payload),
          let data = try? JSONSerialization.data(withJSONObject: payload),
          let line = String(data: data, encoding: .utf8)
    else { return }

    let url = URL(fileURLWithPath: logPath)
    if !FileManager.default.fileExists(atPath: url.path) {
        FileManager.default.createFile(atPath: url.path, contents: nil)
    }
    guard let handle = try? FileHandle(forWritingTo: url) else { return }
    defer { try? handle.close() }
    _ = try? handle.seekToEnd()
    try? handle.write(contentsOf: Data((line + "\n").utf8))
}

func readJSONFile(_ path: String) throws -> Any {
    let data = try Data(contentsOf: URL(fileURLWithPath: (path as NSString).expandingTildeInPath))
    return try JSONSerialization.jsonObject(with: data)
}

func writeJSONObject(_ value: Any, to path: String) throws {
    let expanded = (path as NSString).expandingTildeInPath
    let data = try JSONSerialization.data(withJSONObject: value, options: [.prettyPrinted, .sortedKeys])
    try data.write(to: URL(fileURLWithPath: expanded))
}

func stringValue(_ dict: [String: Any], _ key: String) -> String? {
    dict[key] as? String
}

func doubleValue(_ dict: [String: Any], _ key: String) -> Double? {
    if let value = dict[key] as? Double { return value }
    if let value = dict[key] as? Int { return Double(value) }
    return nil
}

func intValue(_ dict: [String: Any], _ key: String) -> Int? {
    if let value = dict[key] as? Int { return value }
    if let value = dict[key] as? Double { return Int(value) }
    return nil
}

func boolValue(_ dict: [String: Any], _ key: String) -> Bool? {
    dict[key] as? Bool
}

struct Status: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Gateway 起動状況と接続中拡張を表示")
    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "status")
        printJSON(result)
    }
}

struct Tabs: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "共有中タブ一覧を表示")
    @Flag(name: .long, help: "ref/tabId/title/url だけに絞って表示") var compact: Bool = false
    @Option(name: .long, help: "出力形式: json / text") var format: String = "json"

    func run() async throws {
        let client = UDSClient()
        let tabs = tabsWithRefs(try client.call(method: "list_tabs"))
        let outputTabs = compact ? compactTabs(tabs) : tabs
        switch format {
        case "json":
            if outputTabs.isEmpty {
                printJSON([
                    "tabs": [],
                    "permittedTabCount": 0,
                    "userMessage": "共有中のタブがありません。Chrome で対象タブを開き、ABG 拡張機能のアイコンから「このタブを共有」を有効にしてください。",
                    "nextCommand": "abg status",
                ])
            } else {
                printJSON(outputTabs)
            }
        case "text":
            if outputTabs.isEmpty {
                print("No permitted tabs.")
                print("Open Chrome, click the ABG extension icon on the target tab, and choose \"このタブを共有\".")
                print("Then run: abg tabs --compact")
            } else {
                for tab in outputTabs {
                    let mode = (tab["accessMode"] as? String).map { "\($0)\t" } ?? ""
                    print("\(tab["ref"] ?? "")\t\(tab["tabId"] ?? "")\t\(mode)[\(tab["title"] ?? "")]\t\(tab["url"] ?? "")")
                }
            }
        default:
            try failWithJSON(["error": "bad_format", "message": "--format must be json or text"])
        }
    }
}

struct Inspect: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "Gateway 状態と共有中タブをまとめて表示")
    @Flag(name: .long, help: "tabs を全フィールドで表示") var full: Bool = false

    func run() async throws {
        let client = UDSClient()
        var status = (try client.call(method: "status") as? [String: Any]) ?? [:]
        let tabs = tabsWithRefs(try client.call(method: "list_tabs"))
        status["extensionCount"] = (status["extensions"] as? [Any])?.count ?? 0
        status["permittedTabCount"] = tabs.count
        status["tabs"] = full ? tabs : compactTabs(tabs)
        if tabs.isEmpty {
            status["userMessage"] = "共有中のタブがありません。Chrome で対象タブを開き、ABG 拡張機能のアイコンから「このタブを共有」を有効にしてください。"
            status["nextCommand"] = "abg tabs --compact"
        }
        printJSON(status)
    }
}

struct Raise: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Bring an already-shared tab and its browser window to the front"
    )
    @OptionGroup var target: TabTarget

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "raise_tab", params: ["tabId": tabId])
        printJSON(result)
    }
}

struct Read: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "共有中タブの DOM テキスト + HTML を取得",
        discussion: """
        オプションでタブ全体ではなく特定要素だけ、HTML を Markdown 化して返すこともできる。
        エージェントのコンテキスト効率のため、長いページでは --selector か --as-markdown を推奨。
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "対象を絞る CSS selector (例: \"main\", \"#content\")") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector. Cross-origin frames are listed but not selector-addressable.") var frame: String?
    @Flag(name: .long, help: "HTML を Markdown に変換 (token 効率)") var asMarkdown: Bool = false
    @Option(name: .long, help: "出力形式: json / markdown / text / html") var format: String = "json"
    @Flag(name: .long, help: "Markdown 出力で画像 URL を残す") var keepImages: Bool = false
    @Flag(name: .long, help: "Markdown 出力を local redaction plugin でマスク") var redact: Bool = false
    @Option(name: .customLong("redact-regex"), help: "追加でマスクする regex。複数回指定可") var redactRegexes: [String] = []
    @Flag(name: .long, help: "selector の editable value を input/textarea/contenteditable aware に返す") var editableValue: Bool = false

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        if editableValue {
            guard let selector else {
                try failWithJSON(["error": "selector_required", "message": "--editable-value requires --selector."])
            }
            var editableParams: [String: Any] = [
                "tabId": tabId,
                "kind": "editable-value",
                "selector": selector,
            ]
            if let frame { editableParams["frame"] = frame }
            let result = try client.call(method: "get_tab", params: editableParams)
            printJSON(result)
            return
        }
        var params: [String: Any] = ["tabId": tabId]
        if let s = selector { params["selector"] = s }
        if let frame { params["frame"] = frame }
        let wantsMarkdown = asMarkdown || format == "markdown"
        if wantsMarkdown {
            params["asMarkdown"] = true
            params["keepImages"] = keepImages
            if redact { params["redact"] = true }
            if !redactRegexes.isEmpty { params["redactRegexes"] = redactRegexes }
        }
        let result = try client.call(method: "read_tab", params: params)
        var step: [String: Any] = ["op": "read", "tabId": tabId, "format": format]
        if let selector { step["selector"] = selector }
        if let frame { step["frame"] = frame }
        if asMarkdown { step["asMarkdown"] = true }
        if keepImages { step["keepImages"] = true }
        if redact { step["redact"] = true }
        if !redactRegexes.isEmpty { step["redactRegexes"] = redactRegexes }
        appendRecordedStep(step)
        guard let dict = result as? [String: Any] else {
            printJSON(result)
            return
        }
        switch format {
        case "json":
            printJSON(dict)
        case "markdown":
            print(dict["markdown"] as? String ?? "")
        case "text":
            print(dict["text"] as? String ?? "")
        case "html":
            print(dict["html"] as? String ?? "")
        default:
            try failWithJSON(["error": "bad_format", "message": "--format must be json, markdown, text, or html"])
        }
    }
}

struct Screenshot: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "共有中タブのスクリーンショット (PNG)",
        discussion: """
        フル領域 (デフォルト) または --x/--y/--width/--height で部分キャプチャ。
        部分キャプチャはエージェントのトークン効率に大きく効く。
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "出力 PNG パス (省略時 $TMPDIR/abg/screenshots/<tab>-<ts>.png)") var out: String?
    @Flag(name: .long, help: "最後に保存したスクリーンショットのパスだけを表示") var latest: Bool = false
    @Option(name: .long, help: "部分キャプチャ X (px)") var x: Double?
    @Option(name: .long, help: "部分キャプチャ Y (px)") var y: Double?
    @Option(name: .long, help: "部分キャプチャ幅 (px)") var width: Double?
    @Option(name: .long, help: "部分キャプチャ高さ (px)") var height: Double?

    func run() async throws {
        if latest {
            let marker = try latestScreenshotMarker()
            guard let path = try? String(contentsOf: marker, encoding: .utf8).trimmingCharacters(in: .whitespacesAndNewlines),
                  !path.isEmpty else {
                try failWithJSON([
                    "error": "latest_screenshot_not_found",
                    "message": "No latest screenshot marker exists.",
                    "userMessage": "まだスクリーンショットが保存されていません。先に `abg screenshot <tab>` を実行してください。",
                ])
            }
            printJSON(["path": path])
            return
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        let clipFlags = [x, y, width, height].map { $0 != nil }
        let clipCount = clipFlags.filter { $0 }.count
        if clipCount != 0 && clipCount != 4 {
            FileHandle.standardError.write(Data("--x, --y, --width, --height are all required when clipping\n".utf8))
            throw ExitCode.failure
        }
        if clipCount == 4 {
            params["clip"] = ["x": x!, "y": y!, "width": width!, "height": height!]
        }
        let result = try client.call(method: "screenshot_tab", params: params)
        let outPath: String = {
            if let o = out { return (o as NSString).expandingTildeInPath }
            return (try? defaultScreenshotPath(tabLabel: target.tab ?? "tab-\(tabId)")) ?? "/tmp/abg-screenshot-\(tabId)-\(Int(Date().timeIntervalSince1970)).png"
        }()
        let resultJson = try saveScreenshotResult(result, outPath: outPath)
        var step: [String: Any] = ["op": "screenshot", "tabId": tabId]
        if let out { step["out"] = out }
        if clipCount == 4 {
            step["clip"] = ["x": x!, "y": y!, "width": width!, "height": height!]
        }
        appendRecordedStep(step)
        printJSON(resultJson)
    }
}

struct Annotate: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "DOM/スクショ領域を自動判定する注釈を開始/追加/取得",
        discussion: """
        共有中タブに拡張機能の overlay を表示し、ユーザーがカーソルで示した対象を DOM 注釈かスクショ領域注釈に自動分類する。
        CLI からは --selector で DOM 注釈、--x/--y/--width/--height で自動分類の領域注釈を追加できる。
        引数なしでは現在の注釈一覧を JSON で返す。注釈には kind(dom/screenshot)、viewport/page 座標、コメント、selector/text/style が含まれる。

        例:
          abg annotate t1 --start
          abg annotate t1 --selector "button.save" --comment "保存ボタン"
          abg annotate t1 --x 120 --y 240 --width 360 --height 180 --comment "この領域"
          abg annotate t1
          abg annotate t1 --stop
          abg annotate t1 --clear
        """
    )
    @OptionGroup var target: TabTarget
    @Flag(name: .long, help: "注釈 overlay を開始") var start: Bool = false
    @Flag(name: .long, help: "注釈 overlay のキャプチャを停止 (既存注釈は残す)") var stop: Bool = false
    @Flag(name: .long, help: "既存注釈を削除") var clear: Bool = false
    @Option(name: .long, help: "DOM 注釈として追加する CSS selector") var selector: String?
    @Option(name: .long, help: "注釈コメント") var comment: String?
    @Option(name: .long, help: "自動分類する領域 X (viewport px)") var x: Double?
    @Option(name: .long, help: "自動分類する領域 Y (viewport px)") var y: Double?
    @Option(name: .long, help: "自動分類する領域幅 (viewport px)") var width: Double?
    @Option(name: .long, help: "自動分類する領域高さ (viewport px)") var height: Double?
    @Option(name: .long, help: "スクショ領域注釈だった場合に保存する PNG パス") var out: String?
    @Option(name: .long, help: "出力形式: json / text") var format: String = "json"

    func run() async throws {
        let hasRegionFlag = [x, y, width, height].contains { $0 != nil }
        let hasFullRegion = x != nil && y != nil && width != nil && height != nil
        if hasRegionFlag && !hasFullRegion {
            try failWithJSON([
                "error": "bad_params",
                "message": "--x, --y, --width, and --height are all required for a region annotation.",
            ])
        }
        let selectedActions = [start, stop, clear, selector != nil, hasFullRegion].filter { $0 }.count
        if selectedActions > 1 {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass at most one of --start, --stop, --clear, --selector, or region coordinates.",
            ])
        }
        if comment != nil && selector == nil && !hasFullRegion {
            try failWithJSON([
                "error": "bad_params",
                "message": "--comment requires --selector or --x/--y/--width/--height.",
            ])
        }
        let action: String = {
            if start { return "start" }
            if stop { return "stop" }
            if clear { return "clear" }
            if selector != nil { return "add_selector" }
            if hasFullRegion { return "add_region" }
            return "list"
        }()
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "action": action]
        if let selector { params["selector"] = selector }
        if let comment { params["comment"] = comment }
        if hasFullRegion {
            params["x"] = x!
            params["y"] = y!
            params["width"] = width!
            params["height"] = height!
        }
        var result = try client.call(method: "annotate_tab", params: params)
        if let out, action == "add_region" {
            result = try attachRegionScreenshotIfNeeded(client: client, tabId: tabId, result: result, out: out)
        }
        if format == "json" {
            printJSON(result)
            return
        }
        guard format == "text" else {
            try failWithJSON(["error": "bad_format", "message": "--format must be json or text"])
        }
        guard let dict = result as? [String: Any] else {
            print(String(describing: result))
            return
        }
        let enabled = (dict["enabled"] as? Bool) ?? false
        let count = (dict["count"] as? Int) ?? 0
        print("annotation mode: \(enabled ? "on" : "off"), \(count) annotation\(count == 1 ? "" : "s")")
        if let annotations = dict["annotations"] as? [[String: Any]] {
            for (index, annotation) in annotations.enumerated() {
                let number = annotation["displayNumber"] ?? (index + 1)
                let kind = annotation["kind"] ?? "?"
                let selector = (annotation["selector"] as? String).map { " selector=\($0)" } ?? ""
                let comment = (annotation["comment"] as? String).map { $0.isEmpty ? "" : " - \($0)" } ?? ""
                let rect = annotation["viewportRect"] as? [String: Any] ?? [:]
                let x = rect["x"] ?? "?"
                let y = rect["y"] ?? "?"
                let width = rect["width"] ?? "?"
                let height = rect["height"] ?? "?"
                print("[\(number)] \(kind) x=\(x) y=\(y) w=\(width) h=\(height)\(selector)\(comment)")
            }
        }
    }

    private func attachRegionScreenshotIfNeeded(client: UDSClient, tabId: Int, result: Any?, out: String) throws -> Any? {
        guard var dict = result as? [String: Any],
              let annotations = dict["annotations"] as? [[String: Any]],
              let annotation = annotations.last,
              (annotation["kind"] as? String) == "screenshot",
              let rect = annotation["viewportRect"] as? [String: Any]
        else {
            return result
        }
        let outPath = (out as NSString).expandingTildeInPath
        let clip = [
            "x": rect["x"] ?? 0,
            "y": rect["y"] ?? 0,
            "width": rect["width"] ?? 0,
            "height": rect["height"] ?? 0,
        ]
        let screenshot = try client.call(method: "screenshot_tab", params: ["tabId": tabId, "clip": clip])
        dict["screenshot"] = try saveScreenshotResult(screenshot, outPath: outPath)
        return dict
    }
}

struct Console: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "共有中タブの console ログ")
    @OptionGroup var target: TabTarget

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "console_tab", params: ["tabId": tabId])
        printJSON(result)
    }
}

struct Eval: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Run a gated JavaScript eval on a shared tab",
        discussion: """
        Eval is an escape hatch. It is disabled by default in the extension popup. When Trusted automation / AutoMode is off, pass --approve to open a local approval window with the exact script. When AutoMode is on, the extension may skip the popup for already-shared tabs while still auditing the script.
        Prefer named primitives such as read/get/find/wait when they cover the workflow.
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "JavaScript source to evaluate") var script: String?
    @Option(name: .long, help: "Read JavaScript source from a local file") var scriptFile: String?
    @Flag(name: .long, help: "Read JavaScript source from stdin") var stdin: Bool = false
    @Flag(name: .long, help: "Required unless Trusted automation / AutoMode is enabled in the extension popup") var approve: Bool = false
    @Option(name: .long, help: "Maximum sanitized result JSON bytes (default 65536, hard cap 262144)") var maxBytes: Int = 65_536

    func run() async throws {
        let script = try readScriptSource()
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "eval_tab", params: [
            "tabId": tabId,
            "script": script,
            "approve": approve,
            "maxBytes": maxBytes,
        ])
        printJSON(result)
        if let dict = result as? [String: Any], (dict["ok"] as? Bool) == false {
            throw ExitCode.failure
        }
    }

    private func readScriptSource() throws -> String {
        let sourceCount = [script != nil, scriptFile != nil, stdin].filter { $0 }.count
        guard sourceCount == 1 else {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one script source: --script, --script-file, or --stdin.",
            ])
        }
        if let script { return script }
        if let scriptFile {
            return try readHostTextFile((scriptFile as NSString).expandingTildeInPath, option: "--script-file")
        }
        let data = FileHandle.standardInput.readDataToEndOfFile()
        return String(data: data, encoding: .utf8) ?? ""
    }
}

struct Table: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "HTML table のヘッダー・行・セルを抽出")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "対象 table または table を含む CSS selector") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    @Option(name: .long, help: "出力形式: json / markdown") var format: String = "json"

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if let selector { params["selector"] = selector }
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "table_tab", params: params)
        if format == "json" {
            printJSON(result)
        } else if format == "markdown" {
            print(tableMarkdown(result))
        } else {
            try failWithJSON(["error": "bad_format", "message": "--format must be json or markdown"])
        }
    }
}

struct Describe: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "viewport 内のクリック可能要素を bbox 座標付きで列挙")
    @OptionGroup var target: TabTarget
    @Flag(name: .long, help: "viewport 外の要素も含める") var all: Bool = false
    @Option(name: .long, help: "最大件数 (デフォルト 80)") var limit: Int = 80
    @Option(name: .long, help: "kind フィルタ (button/input/link/clickable など)") var kind: String?
    @Option(name: .long, help: "viewport を NxM に分割した座標も出す (例: 10x10)") var grid: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "all": all, "limit": limit]
        if let kind { params["kind"] = kind }
        if let grid { params["grid"] = grid }
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "describe_tab", params: params)
        printJSON(result)
    }
}

struct Network: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "共有中タブのネットワークリクエストを表示")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "URL glob フィルタ") var url: String?
    @Option(name: .long, help: "URL regex filter for wait-response workflows") var urlRegex: String?
    @Option(name: .long, help: "HTTP method フィルタ (GET/POST など)") var method: String?
    @Option(name: .long, help: "最小 HTTP status (例: 400)") var statusMin: Int?
    @Option(name: .long, help: "Maximum HTTP status") var statusMax: Int?
    @Option(name: .long, help: "type フィルタ (xhr,fetch,document など。カンマ区切り可)") var type: String?
    @Option(name: .long, help: "個別 requestId") var requestId: String?
    @Flag(name: .long, help: "requestId のレスポンス body を取得") var body: Bool = false
    @Option(name: .long, help: "最大件数 (デフォルト 100)") var limit: Int = 100
    @Flag(name: .long, help: "Wait for a matching response instead of listing buffered requests") var waitResponse: Bool = false
    @Option(name: .long, help: "wait-response timeout in milliseconds") var timeout: Int = defaultGatewayTimeoutMs()
    @Option(name: .long, help: "Maximum response body preview bytes when --body is set") var maxBytes: Int = 16_384

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "limit": limit]
        if let url { params["urlPattern"] = url }
        if let urlRegex { params["urlRegex"] = urlRegex }
        if let method { params["method"] = method }
        if let statusMin { params["statusMin"] = statusMin }
        if let statusMax { params["statusMax"] = statusMax }
        if let type { params["type"] = type }
        if let requestId { params["requestId"] = requestId }
        if body { params["body"] = true }
        if waitResponse {
            params["wait"] = true
            params["timeoutMs"] = timeout
        }
        if body { params["maxBytes"] = maxBytes }
        let result = try client.call(method: "network_tab", params: params)
        printJSON(result)
    }
}

struct WaitResponse: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "wait-response",
        abstract: "Wait for a network response matching URL, method, and status filters",
        discussion: """
        Waits for a buffered or future response from a shared tab. Timeout results are returned as
        stable JSON with ok=false and error=timeout. Response body preview is local-only, opt-in via
        --body, and capped by --max-bytes.
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "URL glob filter") var url: String?
    @Option(name: .long, help: "URL regex filter") var urlRegex: String?
    @Option(name: .long, help: "HTTP method filter such as GET or POST") var method: String?
    @Option(name: .long, help: "Minimum HTTP status") var statusMin: Int?
    @Option(name: .long, help: "Maximum HTTP status") var statusMax: Int?
    @Option(name: .long, help: "Resource type filter, comma-separated") var type: String?
    @Option(name: .long, help: "Timeout in milliseconds, clamped by the extension") var timeout: Int = 30_000
    @Flag(name: .long, help: "Opt in to a bounded response body preview") var body: Bool = false
    @Option(name: .long, help: "Maximum response body preview bytes when --body is set") var maxBytes: Int = 16_384

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "wait": true,
            "timeoutMs": timeout,
        ]
        if let url { params["urlPattern"] = url }
        if let urlRegex { params["urlRegex"] = urlRegex }
        if let method { params["method"] = method }
        if let statusMin { params["statusMin"] = statusMin }
        if let statusMax { params["statusMax"] = statusMax }
        if let type { params["type"] = type }
        if body {
            params["body"] = true
            params["maxBytes"] = maxBytes
        }
        let result = try client.call(method: "network_tab", params: params)
        printJSON(result)
    }
}

func tableMarkdown(_ value: Any?) -> String {
    guard let dict = value as? [String: Any],
          let tables = dict["tables"] as? [[String: Any]],
          let table = tables.first
    else { return "" }
    let headers = table["headers"] as? [String] ?? []
    let rows = table["rows"] as? [[String]] ?? []
    let columnCount = max(headers.count, rows.map(\.count).max() ?? 0)
    guard columnCount > 0 else { return "" }
    let normalizedHeaders = (0..<columnCount).map { idx in
        idx < headers.count && !headers[idx].isEmpty ? headers[idx] : "Column \(idx + 1)"
    }
    var lines: [String] = []
    lines.append("| " + normalizedHeaders.map(escapeMarkdownCell).joined(separator: " | ") + " |")
    lines.append("| " + Array(repeating: "---", count: columnCount).joined(separator: " | ") + " |")
    for row in rows {
        let cells = (0..<columnCount).map { idx in idx < row.count ? row[idx] : "" }
        lines.append("| " + cells.map(escapeMarkdownCell).joined(separator: " | ") + " |")
    }
    return lines.joined(separator: "\n")
}

func escapeMarkdownCell(_ value: String) -> String {
    value.replacingOccurrences(of: "|", with: "\\|").replacingOccurrences(of: "\n", with: " ")
}

// MARK: - Operation tools (v0.1.1)

struct Click: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "要素をクリック (CSS selector / describe id / xy 座標)")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "クリック対象の CSS selector") var selector: String?
    @Option(name: .long, help: "`abg describe` の element id") var id: Int?
    @Option(name: .long, help: "`abg snapshot` の element ref (例: @e1)") var ref: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector. Required to act on selectors inside a frame.") var frame: String?
    @Flag(name: .long, help: "`abg describe --all` 由来の id を解決") var all: Bool = false
    @Option(name: .long, help: "`abg describe --grid` 由来の id を解決 (例: 10x10)") var grid: String?
    @Option(name: .long, help: "`abg describe --limit` と同じ件数で id を解決") var limit: Int?
    @Option(name: .long, help: "X 座標 (px、ビューポート左上から)") var x: Double?
    @Option(name: .long, help: "Y 座標") var y: Double?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if let s = selector { params["selector"] = s }
        if let id { params["id"] = id }
        if let ref { params["ref"] = ref }
        if let frame { params["frame"] = frame }
        if all { params["all"] = true }
        if let grid { params["grid"] = grid }
        if let limit { params["limit"] = limit }
        if let xx = x { params["x"] = xx }
        if let yy = y { params["y"] = yy }
        guard selector != nil || id != nil || ref != nil || (x != nil && y != nil) else {
            try failWithJSON([
                "error": "bad_params",
                "message": "specify --selector, --id, --ref, or both --x and --y",
            ])
        }
        let result = try client.call(method: "click_tab", params: params)
        var step: [String: Any] = ["op": "click", "tabId": tabId]
        if let selector { step["selector"] = selector }
        if let id { step["id"] = id }
        if let ref { step["ref"] = ref }
        if let frame { step["frame"] = frame }
        if all { step["all"] = true }
        if let grid { step["grid"] = grid }
        if let limit { step["limit"] = limit }
        if let x { step["x"] = x }
        if let y { step["y"] = y }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Fill: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "input/textarea/contenteditable にテキスト入力 (selector 必須)")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "対象の CSS selector") var selector: String
    @Option(name: .long, help: "入力する値") var value: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    @Flag(name: .long, help: "対象種別と置換予定サイズだけを返し、DOM は変更しない") var dryRun: Bool = false
    @Flag(name: .customLong("diff"), help: "Capture compact redacted before/after text/HTML diff metadata in the result and audit log") var diff: Bool = false

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "selector": selector, "value": value, "dryRun": dryRun]
        if let frame { params["frame"] = frame }
        if diff { params["auditDiff"] = true }
        let result = try client.call(method: "fill_tab", params: params)
        if !dryRun {
            var step: [String: Any] = ["op": "fill", "tabId": tabId, "selector": selector, "value": value]
            if let frame { step["frame"] = frame }
            if diff { step["diff"] = true }
            appendRecordedStep(step)
        }
        printJSON(result)
    }
}

struct ReplaceEditable: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "replace-editable",
        abstract: "Replace an input, textarea, or contenteditable target without clipboard dependence"
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target editable CSS selector") var selector: String
    @Option(name: .long, help: "Replacement text") var value: String?
    @Option(name: .long, help: "Read replacement text from a file") var textFile: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    @Flag(name: .long, help: "Read replacement text from stdin") var stdin: Bool = false
    @Flag(name: .long, help: "Preview target metadata and replacement length without changing the page") var dryRun: Bool = false
    @Flag(name: .customLong("diff"), help: "Capture compact redacted before/after text/HTML diff metadata in the result and audit log") var diff: Bool = false

    func run() async throws {
        let sources = [value != nil, textFile != nil, stdin].filter { $0 }.count
        guard sources == 1 else {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one of --value, --text-file, or --stdin.",
            ])
        }
        let text: String
        if let value {
            text = value
        } else if let textFile {
            text = try readHostTextFile((textFile as NSString).expandingTildeInPath, option: "--text-file")
        } else {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            text = String(data: data, encoding: .utf8) ?? ""
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "selector": selector,
            "value": text,
            "replaceEditable": true,
            "dryRun": dryRun,
        ]
        if let frame { params["frame"] = frame }
        if diff { params["auditDiff"] = true }
        let result = try client.call(method: "fill_tab", params: params)
        if !dryRun {
            var step: [String: Any] = ["op": "fill", "tabId": tabId, "selector": selector, "value": text]
            if let frame { step["frame"] = frame }
            if diff { step["diff"] = true }
            appendRecordedStep(step)
        }
        printJSON(result)
    }
}

struct Paste: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Paste text through the system clipboard and native paste shortcut",
        discussion: """
        Writes the provided text to the clipboard, focuses the selected editable element,
        then dispatches Cmd+V on macOS or Ctrl+V on other platforms. This is intended for
        rich editors such as Lexical, ProseMirror, Slate, and Quill.

        Examples:
          abg paste t1 --selector '[contenteditable="true"]' --value "hello"
          echo "long text" | abg paste t1 --selector '[contenteditable="true"]' --stdin
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target editable CSS selector") var selector: String
    @Option(name: .long, help: "Text to paste") var value: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    @Flag(name: .long, help: "Read text to paste from standard input") var stdin: Bool = false

    func run() async throws {
        if stdin == (value != nil) {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one of --value or --stdin.",
            ])
        }
        let text: String
        if stdin {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            text = String(data: data, encoding: .utf8) ?? ""
        } else {
            text = value ?? ""
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "selector": selector, "value": text]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "paste_tab", params: params)
        var step: [String: Any] = ["op": "paste", "tabId": tabId, "selector": selector, "value": text]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct ClipboardWrite: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "clipboard-write",
        abstract: "Write a MIME payload to the local system clipboard",
        discussion: """
        Writes one MIME payload to the OS clipboard through the local Gateway. The audit log
        records the MIME type and byte length, not the raw content.

        Examples:
          abg clipboard-write --mime "text/html" --value "<b>Hello</b>"
          abg clipboard-write --mime "application/x-vnd.google-docs-sheets-clip+wrapped" --file sheets.clip
        """
    )
    @Option(name: .long, help: "Clipboard MIME type to write") var mime: String
    @Option(name: .long, help: "Clipboard payload") var value: String?
    @Option(name: .long, help: "Read clipboard payload from a UTF-8 file") var file: String?
    @Flag(name: .long, help: "Read clipboard payload from standard input") var stdin: Bool = false

    func run() async throws {
        let text = try readPayload(value: value, file: file, stdin: stdin)
        let client = UDSClient()
        let result = try client.call(method: "clipboard_write", params: [
            "mime": mime,
            "value": text,
        ])
        printJSON(result)
    }
}

struct PasteRich: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "paste-rich",
        abstract: "Paste the current rich clipboard payload into a shared tab",
        discussion: """
        Dispatches a native paste shortcut into the focused target, or first focuses --selector.
        Pass --mime plus --value/--file/--stdin to write a MIME payload immediately before paste.

        Examples:
          abg paste-rich t1 --selector canvas
          abg paste-rich t1 --mime "text/html" --value "<b>Hello</b>"
          abg paste-rich t1 --mime "application/x-vnd.google-docs-sheets-clip+wrapped" --file sheets.clip
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Optional target CSS selector to focus before native paste") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    @Option(name: .long, help: "Optional clipboard MIME type to write before paste") var mime: String?
    @Option(name: .long, help: "Clipboard payload to write before paste") var value: String?
    @Option(name: .long, help: "Read clipboard payload from a UTF-8 file before paste") var file: String?
    @Flag(name: .long, help: "Read clipboard payload from standard input before paste") var stdin: Bool = false

    func run() async throws {
        let wantsWrite = mime != nil || value != nil || file != nil || stdin
        if wantsWrite && mime == nil {
            try failWithJSON([
                "error": "bad_params",
                "message": "--mime is required when passing --value, --file, or --stdin.",
            ])
        }
        if !wantsWrite && (value != nil || file != nil || stdin) {
            try failWithJSON([
                "error": "bad_params",
                "message": "--mime is required when writing clipboard content.",
            ])
        }

        let text = wantsWrite ? try readPayload(value: value, file: file, stdin: stdin) : nil
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if let selector { params["selector"] = selector }
        if let frame { params["frame"] = frame }
        if let mime { params["mime"] = mime }
        if let text { params["value"] = text }
        let result = try client.call(method: "paste_rich_tab", params: params)
        var step: [String: Any] = ["op": "paste_rich", "tabId": tabId]
        if let selector { step["selector"] = selector }
        if let frame { step["frame"] = frame }
        if let mime { step["mime"] = mime }
        if let text { step["value"] = text }
        appendRecordedStep(step)
        printJSON(result)
    }
}

func readPayload(value: String?, file: String?, stdin: Bool) throws -> String {
    let sources = [value != nil, file != nil, stdin].filter { $0 }.count
    guard sources == 1 else {
        try failWithJSON([
            "error": "bad_params",
            "message": "Pass exactly one of --value, --file, or --stdin.",
        ])
    }
    if let value { return value }
    if let file {
        return try String(contentsOfFile: (file as NSString).expandingTildeInPath, encoding: .utf8)
    }
    let data = FileHandle.standardInput.readDataToEndOfFile()
    return String(data: data, encoding: .utf8) ?? ""
}

struct Clear: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "Clear an editable element",
        discussion: """
        Focuses the selected editable element, selects its contents, and deletes them.
        Use this before `abg paste` when you want to replace rich-editor content.

        Example:
          abg clear t1 --selector '[contenteditable="true"]'
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "Target editable CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "selector": selector]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "clear_tab", params: params)
        var step: [String: Any] = ["op": "clear", "tabId": tabId, "selector": selector]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Type: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "現在フォーカスがある場所にテキストを送る (canvas 等にも有効)")
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and text, or just text when --match-url/title is used") var args: [String] = []

    func run() async throws {
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg type <tab> <text> or abg type --match-url <glob> <text>",
        ])
        let textStart = hasMatch ? 0 : 1
        guard args.count > textStart else {
            try failWithJSON(["error": "text_required", "message": "text is required"])
        }
        let text = args[textStart...].joined(separator: " ")
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        let result = try client.call(method: "type_tab", params: ["tabId": tabId, "text": text])
        appendRecordedStep(["op": "type", "tabId": tabId, "text": text])
        printJSON(result)
    }
}

struct Replace: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "CSS selector に一致する DOM 要素を指定 HTML に差し替え",
        discussion: """
        現在のタブ上だけの一時的な DOM 書き換え。通常の write operation と同じく、
        popup の承認設定が ON の場合は実行前に承認を求める。

        例:
          abg replace t1 --selector 'svg[aria-label="github logo"]' --html '<span>★</span>'
          abg replace t1 --selector '#logo' --html-file ./replacement.html
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "置換対象の CSS selector") var selector: String
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?
    @Option(name: .long, help: "差し替え HTML") var html: String?
    @Option(name: .long, help: "差し替え HTML を読むファイルパス") var htmlFile: String?

    func run() async throws {
        if (html == nil) == (htmlFile == nil) {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one of --html or --html-file.",
            ])
        }
        let replacementHtml: String
        if let html {
            replacementHtml = html
        } else {
            let path = (htmlFile! as NSString).expandingTildeInPath
            replacementHtml = try String(contentsOfFile: path, encoding: .utf8)
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = [
            "tabId": tabId,
            "selector": selector,
            "html": replacementHtml,
        ]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "replace_tab", params: params)
        var step: [String: Any] = [
            "op": "replace",
            "tabId": tabId,
            "selector": selector,
            "html": replacementHtml,
        ]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Key: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "キー入力 (Enter / Space / ArrowDown / 単一文字 等)")
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and key, or just key when --match-url/title is used") var args: [String] = []
    @Option(name: .long, help: "modifiers をカンマ区切り (alt,ctrl,cmd,shift)") var modifiers: String?

    func run() async throws {
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg key <tab> <key> or abg key --match-url <glob> <key>",
        ])
        let key = try requireArg(args, index: hasMatch ? 0 : 1, error: [
            "error": "key_required",
            "message": "key is required",
        ])
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        var params: [String: Any] = ["tabId": tabId, "key": key]
        if let m = modifiers {
            params["modifiers"] = m.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
        }
        let result = try client.call(method: "key_tab", params: params)
        var step: [String: Any] = ["op": "key", "tabId": tabId, "key": key]
        if let modifiers { step["modifiers"] = modifiers }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Navigate: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "タブを別 URL に遷移 (別 origin だと許可は自動失効する)")
    @OptionGroup var match: TabMatchOptions
    @Argument(help: "tab ID/ref and URL, or just URL when --match-url/title is used") var args: [String] = []

    func run() async throws {
        let client = UDSClient()
        let hasMatch = match.matchUrl != nil || match.matchTitle != nil
        let tabToken = hasMatch ? nil : try requireArg(args, index: 0, error: [
            "error": "tab_required",
            "message": "Usage: abg navigate <tab> <url> or abg navigate --match-url <glob> <url>",
        ])
        let url = try requireArg(args, index: hasMatch ? 0 : 1, error: [
            "error": "url_required",
            "message": "url is required",
        ])
        let tabId = try resolveTabId(client: client, tabToken: tabToken, match: match)
        let result = try client.call(method: "navigate_tab", params: ["tabId": tabId, "url": url])
        appendRecordedStep(["op": "navigate", "tabId": tabId, "url": url])
        printJSON(result)
    }
}

struct Scroll: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "ページをホイールスクロール (delta指定)",
        discussion: """
        マウスホイールイベント (CDP Input.dispatchMouseEvent type=mouseWheel) として送る。
        ブラウザがカーソル位置の祖先 scrollable 要素を自動で選ぶので、内側 div の
        overflow:auto エリア (Gemini / ChatGPT / Slack 等のチャット履歴) にも効く。

        --at-x / --at-y を省略するとビューポート中央でホイールが発生する。

        例:
          abg scroll 328 --dy 800              # 800px 下にスクロール
          abg scroll 328 --dy -800             # 800px 上に
          abg scroll 328 --selector ".c-virtual_list__scroll_container" --dy -5000
          abg scroll 328 --dy 800 --at-x 1200 --at-y 400  # 右側パネルだけスクロール
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "縦 delta px (正で下、負で上、デフォルト 0)") var dy: Double = 0
    @Option(name: .long, help: "横 delta px (正で右、負で左、デフォルト 0)") var dx: Double = 0
    @Option(name: .long, help: "ホイール位置 X (省略時ビューポート中央)") var atX: Double?
    @Option(name: .long, help: "ホイール位置 Y (省略時ビューポート中央)") var atY: Double?
    @Option(name: .long, help: "内側 scrollable element の CSS selector") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` when using --selector") var frame: String?
    @Option(name: .long, help: "selector scrollBy の繰り返し回数 (1-100)") var steps: Int = 1

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "deltaX": dx, "deltaY": dy]
        if selector != nil, atX != nil || atY != nil {
            try failWithJSON([
                "error": "bad_params",
                "message": "--selector cannot be combined with --at-x or --at-y.",
            ])
        }
        if let selector { params["selector"] = selector }
        if let frame { params["frame"] = frame }
        if selector != nil { params["steps"] = steps }
        if let v = atX { params["atX"] = v }
        if let v = atY { params["atY"] = v }
        let result = try client.call(method: "scroll_tab", params: params)
        var step: [String: Any] = ["op": "scroll", "tabId": tabId, "dx": dx, "dy": dy]
        if let selector { step["selector"] = selector }
        if let frame { step["frame"] = frame }
        if selector != nil { step["steps"] = steps }
        if let atX { step["atX"] = atX }
        if let atY { step["atY"] = atY }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Drag: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "mousedown -> mousemove -> mouseup のドラッグ操作")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "ドラッグ元 CSS selector") var fromSelector: String?
    @Option(name: .long, help: "ドロップ先 CSS selector") var toSelector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for selector endpoints only)") var frame: String?
    @Option(name: .long, help: "ドラッグ元 X") var fromX: Double?
    @Option(name: .long, help: "ドラッグ元 Y") var fromY: Double?
    @Option(name: .long, help: "ドロップ先 X") var toX: Double?
    @Option(name: .long, help: "ドロップ先 Y") var toY: Double?
    @Option(name: .long, help: "mousemove 補間ステップ数 (デフォルト 12)") var steps: Int = 12

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "steps": steps]
        if let fromSelector { params["fromSelector"] = fromSelector }
        if let toSelector { params["toSelector"] = toSelector }
        if let frame { params["frame"] = frame }
        if let fromX { params["fromX"] = fromX }
        if let fromY { params["fromY"] = fromY }
        if let toX { params["toX"] = toX }
        if let toY { params["toY"] = toY }
        let hasSelectorPair = fromSelector != nil && toSelector != nil
        let hasCoordPair = fromX != nil && fromY != nil && toX != nil && toY != nil
        guard hasSelectorPair || hasCoordPair else {
            try failWithJSON([
                "error": "bad_params",
                "message": "Specify --from-selector/--to-selector or --from-x/--from-y/--to-x/--to-y.",
            ])
        }
        let result = try client.call(method: "drag_tab", params: params)
        var step: [String: Any] = ["op": "drag", "tabId": tabId, "steps": steps]
        if let fromSelector { step["fromSelector"] = fromSelector }
        if let toSelector { step["toSelector"] = toSelector }
        if let frame { step["frame"] = frame }
        if let fromX { step["fromX"] = fromX }
        if let fromY { step["fromY"] = fromY }
        if let toX { step["toX"] = toX }
        if let toY { step["toY"] = toY }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Upload: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "input[type=file] にローカルファイルを添付")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "対象の input[type=file] CSS selector") var selector: String
    @Option(name: .long, help: "添付するローカルファイル。複数添付するには --file を繰り返す（input に multiple 属性が必要）") var file: [String]
    @Option(name: .long, help: "Frame ref from `abg frames` (for example @f1) or an iframe CSS selector") var frame: String?

    func run() async throws {
        guard !file.isEmpty else {
            try failWithJSON([
                "error": "file_required",
                "message": "No --file provided",
                "userMessage": "添付するファイルを --file で1つ以上指定してください。",
            ])
        }
        var expandedFiles: [String] = []
        for path in file {
            let expanded = (path as NSString).expandingTildeInPath
            var isDir: ObjCBool = false
            guard FileManager.default.fileExists(atPath: expanded, isDirectory: &isDir), !isDir.boolValue else {
                if ABGConstants.isSandboxed {
                    try failWithJSON(sandboxUnsupportedError(option: "--file", path: expanded))
                }
                try failWithJSON([
                    "error": "file_not_found",
                    "message": "File does not exist: \(expanded)",
                    "userMessage": "指定されたファイルが見つかりません。パスを確認してから再実行してください。",
                ])
            }
            expandedFiles.append(expanded)
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "selector": selector, "files": expandedFiles]
        if let frame { params["frame"] = frame }
        let result = try client.call(method: "upload_tab", params: params)
        var step: [String: Any] = ["op": "upload", "tabId": tabId, "selector": selector, "files": expandedFiles]
        if let frame { step["frame"] = frame }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Wait: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "セレクタが現れる/消えるまで or 一定時間待つ",
        discussion: """
        --selector を指定すると、その要素が visible になるまで polling (profile default timeout)。
        --hidden 付きなら逆に消えるまで待つ。--ms だけ指定すると単純な sleep。
        polling 間隔は 200ms 固定。timeout 時はエラーを返す。

        例:
          abg wait 445 --selector ".loaded"           # .loaded が出るまで待つ
          abg wait 445 --selector ".spinner" --hidden # .spinner が消えるまで待つ
          abg wait 445 --ms 1500                       # 1.5s 待つだけ
          abg wait 445 --selector "h1" --timeout 30000 # 30s タイムアウト
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "待つ CSS selector") var selector: String?
    @Option(name: .long, help: "Frame ref from `abg frames` (for selector/text/predicate waits)") var frame: String?
    @Flag(name: .long, help: "selector が消えるのを待つ (デフォルトは現れるのを待つ)") var hidden: Bool = false
    @Option(name: .long, help: "document visible text に含まれるまで待つ") var text: String?
    @Option(name: .long, help: "current URL が glob に一致するまで待つ") var url: String?
    @Option(name: .long, help: "load state: networkidle / load / domcontentloaded") var load: String?
    @Option(name: .long, help: "JavaScript predicate expression が truthy になるまで待つ") var fn: String?
    @Option(name: .long, help: "固定 sleep ミリ秒 (selector を使わないとき)") var ms: Int?
    @Option(name: .long, help: "selector のタイムアウト ms (profile default)") var timeout: Int = defaultGatewayTimeoutMs()

    func run() async throws {
        let client = UDSClient()
        let nonLoadModes = [selector != nil, text != nil, url != nil, fn != nil, ms != nil].filter { $0 }.count
        if let load {
            guard validWaitLoadStates.contains(load) else {
                try failWithJSON([
                    "error": "bad_params",
                    "message": "Unsupported --load value. Use networkidle, load, or domcontentloaded.",
                ])
            }
            guard nonLoadModes == 0 || (selector != nil && nonLoadModes == 1) else {
                try failWithJSON([
                    "error": "bad_params",
                    "message": "Compose --load only with --selector, or pass --load by itself.",
                ])
            }
        } else {
            guard nonLoadModes == 1 else {
                try failWithJSON([
                    "error": "bad_params",
                    "message": "Pass exactly one wait mode: --selector, --text, --url, --load, --fn, or --ms.",
                ])
            }
        }

        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "timeoutMs": timeout]
        let result: Any?
        if let load {
            params["loadState"] = load
            let loadResult = try client.call(method: "wait_tab", params: params)
            if let selector {
                guard waitResultOK(loadResult) else {
                    result = combinedLoadSelectorWaitResult(load: loadResult, selector: nil)
                    printJSON(result)
                    appendRecordedStep(waitRecordedStep(
                        tabId: tabId,
                        timeout: timeout,
                        selector: selector,
                        hidden: hidden,
                        frame: frame,
                        load: load
                    ))
                    return
                }
                var selectorParams: [String: Any] = [
                    "tabId": tabId,
                    "timeoutMs": timeout,
                    "selector": selector,
                    "hidden": hidden,
                ]
                if let frame { selectorParams["frame"] = frame }
                let selectorResult = try client.call(method: "wait_tab", params: selectorParams)
                result = combinedLoadSelectorWaitResult(load: loadResult, selector: selectorResult)
            } else {
                result = loadResult
            }
        } else if let s = selector {
            params["selector"] = s
            params["hidden"] = hidden
            if let frame { params["frame"] = frame }
            result = try client.call(method: "wait_tab", params: params)
        } else if let text {
            params["text"] = text
            if let frame { params["frame"] = frame }
            result = try client.call(method: "wait_tab", params: params)
        } else if let url {
            params["urlPattern"] = url
            result = try client.call(method: "wait_tab", params: params)
        } else if let fn {
            params["predicate"] = fn
            if let frame { params["frame"] = frame }
            result = try client.call(method: "wait_tab", params: params)
        } else if let m = ms {
            params["sleepMs"] = m
            result = try client.call(method: "wait_tab", params: params)
        } else {
            try failWithJSON([
                "error": "bad_params",
                "message": "Pass exactly one wait mode: --selector, --text, --url, --load, --fn, or --ms.",
            ])
        }
        appendRecordedStep(waitRecordedStep(
            tabId: tabId,
            timeout: timeout,
            selector: selector,
            hidden: hidden,
            frame: frame,
            ms: ms,
            text: text,
            url: url,
            load: load,
            fn: fn
        ))
        printJSON(result)
    }
}

let validWaitLoadStates: Set<String> = ["networkidle", "load", "domcontentloaded"]

func waitResultOK(_ value: Any?) -> Bool {
    guard let dict = value as? [String: Any] else { return false }
    return dict["ok"] as? Bool == true
}

func combinedLoadSelectorWaitResult(load: Any?, selector: Any?) -> [String: Any] {
    let selectorOK = selector.map(waitResultOK) ?? false
    return [
        "ok": selectorOK,
        "mode": "load_then_selector",
        "phase": selectorOK ? "complete" : (selector == nil ? "load" : "selector"),
        "load": load ?? NSNull(),
        "selector": selector ?? NSNull(),
    ]
}

func waitRecordedStep(
    tabId: Int,
    timeout: Int,
    selector: String? = nil,
    hidden: Bool = false,
    frame: String? = nil,
    ms: Int? = nil,
    text: String? = nil,
    url: String? = nil,
    load: String? = nil,
    fn: String? = nil
) -> [String: Any] {
    var step: [String: Any] = ["op": "wait", "tabId": tabId, "timeout": timeout]
    if let selector {
        step["selector"] = selector
        if hidden { step["hidden"] = true }
        if let frame { step["frame"] = frame }
    }
    if let ms { step["ms"] = ms }
    if let text {
        step["text"] = text
        if let frame { step["frame"] = frame }
    }
    if let url { step["url"] = url }
    if let load { step["load"] = load }
    if let fn {
        step["fn"] = fn
        if let frame { step["frame"] = frame }
    }
    return step
}

struct Record: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "record",
        abstract: "ABG 操作の flow 記録 (既定) / タブ映像の録画 (start/stop/status)",
        subcommands: [RecordStart.self, RecordStop.self, RecordStatus.self, RecordFlow.self],
        defaultSubcommand: RecordFlow.self
    )
}

struct RecordStart: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "start",
        abstract: "共有中タブの録画を開始 (webm・タブ音声、任意でマイク)",
        discussion: """
        承認ウィンドウで「Allow」を押すと録画が始まる。承認のクリックが tabCapture の
        user gesture を兼ねる。録画中はタブに REC バッジが出る。`abg record stop` で停止すると
        Gateway が webm を書き出してパスを返す。--mic を付けると物理的な部屋の音も録音する。
        """
    )
    @OptionGroup var target: TabTarget
    @Flag(name: .long, help: "マイク音声も録音する (物理的な部屋の音)。既定は off") var mic: Bool = false
    @Option(name: .long, help: "出力 webm パス (省略時 $TMPDIR/abg/recordings/<tab>-<ts>.webm)") var out: String?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "mic": mic]
        if let out { params["outputPath"] = (out as NSString).expandingTildeInPath }
        let result = try client.call(method: "record_start", params: params)
        printJSON(result)
    }
}

struct RecordStop: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "stop",
        abstract: "録画を停止し、webm を書き出してパスを返す"
    )

    func run() async throws {
        let result = try UDSClient().call(method: "record_stop")
        printJSON(result)
    }
}

struct RecordStatus: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "status",
        abstract: "現在の録画状態を表示"
    )

    func run() async throws {
        let result = try UDSClient().call(method: "record_status")
        printJSON(result)
    }
}

struct RecordFlow: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "flow",
        abstract: "CLI 由来の ABG 操作を flow JSON に記録",
        discussion: """
        別 terminal/agent から実行した click/fill/type/key/navigate/scroll/drag/upload/wait/read/screenshot を記録する。
        Ctrl+C で停止すると --out の flow JSON が書き出される。
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "出力 flow JSON パス") var out: String
    @Option(name: .long, help: "flow 名") var name: String?
    @Flag(name: .long, help: "既存の recording state を上書き") var force: Bool = false

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let stateURL = try recordingStatePath()
        if FileManager.default.fileExists(atPath: stateURL.path), !force {
            try failWithJSON([
                "error": "recording_already_running",
                "message": "A recording session already exists. Stop it or re-run with --force.",
            ])
        }
        let logURL = try abgStateDirectory().appendingPathComponent("recording-\(UUID().uuidString).jsonl")
        let match: [String: Any] = {
            var dict: [String: Any] = ["tabId": tabId]
            if let url = target.matchUrl { dict["url"] = url }
            if let title = target.matchTitle { dict["title"] = title }
            if target.first { dict["first"] = true }
            return dict
        }()
        let state: [String: Any] = [
            "tabId": tabId,
            "out": (out as NSString).expandingTildeInPath,
            "name": name ?? URL(fileURLWithPath: out).deletingPathExtension().lastPathComponent,
            "startedAt": ISO8601DateFormatter().string(from: Date()),
            "logPath": logURL.path,
            "match": match,
        ]
        try writeJSONObject(state, to: stateURL.path)
        FileManager.default.createFile(atPath: logURL.path, contents: nil)

        print("recording tab \(tabId) -> \((out as NSString).expandingTildeInPath)")
        print("Run ABG commands in another terminal/agent. Press Ctrl+C here to stop.")
        try await waitForRecordStop(stateURL: stateURL, logURL: logURL, state: state)
    }
}

struct Replay: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "flow JSON を再生")
    @Argument(help: "flow JSON path") var file: String
    @Option(name: .long, help: "tab ID/ref override") var tab: String?
    @OptionGroup var match: TabMatchOptions
    @Flag(name: .long, help: "実行せずステップだけ表示") var dryRun: Bool = false

    func run() async throws {
        guard let flow = try readJSONFile(file) as? [String: Any],
              let steps = flow["steps"] as? [[String: Any]]
        else {
            try failWithJSON(["error": "invalid_flow", "message": "flow JSON must contain steps array"])
        }

        let client = UDSClient()
        let tabId = try resolveReplayTabId(client: client, flow: flow)
        if dryRun {
            printJSON(["tabId": tabId, "steps": steps])
            return
        }

        var results: [[String: Any]] = []
        for (index, step) in steps.enumerated() {
            let result = try executeReplayStep(client: client, tabId: tabId, step: step)
            results.append([
                "index": index + 1,
                "op": step["op"] ?? "",
                "result": result ?? NSNull(),
            ])
        }
        printJSON(["ok": true, "tabId": tabId, "results": results])
    }

    private func resolveReplayTabId(client: UDSClient, flow: [String: Any]) throws -> Int {
        if tab != nil || match.matchUrl != nil || match.matchTitle != nil {
            return try resolveTabId(client: client, tabToken: tab, match: match)
        }
        if let flowMatch = flow["match"] as? [String: Any] {
            let url = flowMatch["url"] as? String
            let title = flowMatch["title"] as? String
            if url != nil || title != nil {
                return try resolveTabId(
                    client: client,
                    tabToken: nil,
                    matchUrl: url,
                    matchTitle: title,
                    first: (flowMatch["first"] as? Bool) ?? false
                )
            }
            if let tabId = flowMatch["tabId"] as? Int { return tabId }
        }
        if let tabId = flow["tabId"] as? Int { return tabId }
        try failWithJSON([
            "error": "tab_required",
            "message": "flow has no match/tabId. Pass --tab or --match-url/--match-title.",
        ])
    }
}

func waitForRecordStop(stateURL: URL, logURL: URL, state: [String: Any]) async throws {
    try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
        var didFinish = false
        var intSource: DispatchSourceSignal?
        var termSource: DispatchSourceSignal?
        let finish = {
            guard !didFinish else { return }
            didFinish = true
            do {
                let steps = try readRecordedSteps(from: logURL)
                var flow = state
                flow.removeValue(forKey: "logPath")
                flow["finishedAt"] = ISO8601DateFormatter().string(from: Date())
                flow["steps"] = steps
                if let out = state["out"] as? String {
                    try writeJSONObject(flow, to: out)
                }
                try? FileManager.default.removeItem(at: stateURL)
                try? FileManager.default.removeItem(at: logURL)
                intSource?.cancel()
                termSource?.cancel()
                continuation.resume()
            } catch {
                intSource?.cancel()
                termSource?.cancel()
                continuation.resume(throwing: error)
            }
        }

        signal(SIGINT, SIG_IGN)
        signal(SIGTERM, SIG_IGN)
        intSource = DispatchSource.makeSignalSource(signal: SIGINT, queue: .main)
        termSource = DispatchSource.makeSignalSource(signal: SIGTERM, queue: .main)
        intSource?.setEventHandler(handler: finish)
        termSource?.setEventHandler(handler: finish)
        intSource?.resume()
        termSource?.resume()
    }
}

func readRecordedSteps(from url: URL) throws -> [[String: Any]] {
    guard let text = try? String(contentsOf: url, encoding: .utf8) else { return [] }
    return try text.split(separator: "\n").map { line in
        let data = Data(line.utf8)
        guard let step = try JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            throw CLIError.decodeError("invalid recorded step")
        }
        return step
    }
}

func executeReplayStep(client: UDSClient, tabId: Int, step: [String: Any]) throws -> Any? {
    guard let op = step["op"] as? String else {
        try failWithJSON(["error": "invalid_step", "message": "step is missing op"])
    }
    var params: [String: Any] = ["tabId": tabId]
    switch op {
    case "read":
        if let selector = stringValue(step, "selector") { params["selector"] = selector }
        let format = stringValue(step, "format") ?? "json"
        if format == "markdown" || boolValue(step, "asMarkdown") == true {
            params["asMarkdown"] = true
        }
        if boolValue(step, "keepImages") == true { params["keepImages"] = true }
        if boolValue(step, "redact") == true { params["redact"] = true }
        if let redactRegexes = step["redactRegexes"] as? [String], !redactRegexes.isEmpty {
            params["redactRegexes"] = redactRegexes
        }
        return try client.call(method: "read_tab", params: params)
    case "screenshot":
        if let clip = step["clip"] as? [String: Any] { params["clip"] = clip }
        let result = try client.call(method: "screenshot_tab", params: params)
        let outPath = stringValue(step, "out").map { ($0 as NSString).expandingTildeInPath }
            ?? (try? defaultScreenshotPath(tabLabel: "replay-\(tabId)"))
            ?? "/tmp/abg-replay-\(tabId)-\(Int(Date().timeIntervalSince1970)).png"
        return try saveScreenshotResult(result, outPath: outPath)
    case "click":
        for key in ["selector", "id", "ref", "all", "grid", "limit", "x", "y"] {
            if let value = step[key] { params[key] = value }
        }
        return try client.call(method: "click_tab", params: params)
    case "dblclick":
        params["selector"] = try requiredString(step, "selector", op: op)
        return try client.call(method: "dblclick_tab", params: params)
    case "focus":
        params["selector"] = try requiredString(step, "selector", op: op)
        return try client.call(method: "focus_tab", params: params)
    case "hover":
        params["selector"] = try requiredString(step, "selector", op: op)
        return try client.call(method: "hover_tab", params: params)
    case "select":
        params["selector"] = try requiredString(step, "selector", op: op)
        if let value = stringValue(step, "value") { params["value"] = value }
        if let label = stringValue(step, "label") { params["label"] = label }
        return try client.call(method: "select_tab", params: params)
    case "check", "uncheck":
        params["selector"] = try requiredString(step, "selector", op: op)
        params["checked"] = op == "check"
        return try client.call(method: "checked_state_tab", params: params)
    case "find":
        for key in ["locator", "role", "query", "action", "value", "exact", "indexModifier", "index"] {
            if let value = step[key] { params[key] = value }
        }
        return try client.call(method: "find_tab", params: params)
    case "fill":
        params["selector"] = try requiredString(step, "selector", op: op)
        params["value"] = stringValue(step, "value") ?? ""
        if boolValue(step, "diff") == true { params["auditDiff"] = true }
        return try client.call(method: "fill_tab", params: params)
    case "paste":
        params["selector"] = try requiredString(step, "selector", op: op)
        params["value"] = stringValue(step, "value") ?? ""
        return try client.call(method: "paste_tab", params: params)
    case "paste_rich":
        if let selector = stringValue(step, "selector") { params["selector"] = selector }
        if let frame = stringValue(step, "frame") { params["frame"] = frame }
        if let mime = stringValue(step, "mime") { params["mime"] = mime }
        if let value = stringValue(step, "value") { params["value"] = value }
        return try client.call(method: "paste_rich_tab", params: params)
    case "clear":
        params["selector"] = try requiredString(step, "selector", op: op)
        return try client.call(method: "clear_tab", params: params)
    case "replace":
        params["selector"] = try requiredString(step, "selector", op: op)
        params["html"] = try requiredString(step, "html", op: op)
        return try client.call(method: "replace_tab", params: params)
    case "type":
        params["text"] = try requiredString(step, "text", op: op)
        return try client.call(method: "type_tab", params: params)
    case "key":
        params["key"] = try requiredString(step, "key", op: op)
        if let modifiers = stringValue(step, "modifiers") {
            params["modifiers"] = modifiers.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
        }
        return try client.call(method: "key_tab", params: params)
    case "keydown", "keyup":
        params["key"] = try requiredString(step, "key", op: op)
        if let modifiers = stringValue(step, "modifiers") {
            params["modifiers"] = modifiers.split(separator: ",").map { String($0).trimmingCharacters(in: .whitespaces) }
        }
        return try client.call(method: op == "keydown" ? "key_down_tab" : "key_up_tab", params: params)
    case "keyboard_insert_text":
        params["text"] = try requiredString(step, "text", op: op)
        return try client.call(method: "keyboard_insert_text_tab", params: params)
    case "exec_command":
        params["command"] = try requiredString(step, "command", op: op)
        if let value = stringValue(step, "value") { params["value"] = value }
        return try client.call(method: "exec_command_tab", params: params)
    case "navigate":
        params["url"] = try requiredString(step, "url", op: op)
        return try client.call(method: "navigate_tab", params: params)
    case "scroll":
        params["deltaX"] = doubleValue(step, "dx") ?? 0
        params["deltaY"] = doubleValue(step, "dy") ?? 0
        if let selector = stringValue(step, "selector") { params["selector"] = selector }
        if let frame = stringValue(step, "frame") { params["frame"] = frame }
        if let steps = intValue(step, "steps") { params["steps"] = steps }
        if let atX = doubleValue(step, "atX") { params["atX"] = atX }
        if let atY = doubleValue(step, "atY") { params["atY"] = atY }
        return try client.call(method: "scroll_tab", params: params)
    case "scroll-into-view":
        params["selector"] = try requiredString(step, "selector", op: op)
        return try client.call(method: "scroll_into_view_tab", params: params)
    case "drag":
        for key in ["fromSelector", "toSelector", "fromX", "fromY", "toX", "toY", "steps"] {
            if let value = step[key] { params[key] = value }
        }
        return try client.call(method: "drag_tab", params: params)
    case "upload":
        params["selector"] = try requiredString(step, "selector", op: op)
        if let files = step["files"] as? [String], !files.isEmpty {
            params["files"] = files
        } else if let file = step["file"] as? String, !file.isEmpty {
            // Legacy single-file recorded step.
            params["files"] = [file]
        } else {
            params["files"] = [try requiredString(step, "files", op: op)]
        }
        return try client.call(method: "upload_tab", params: params)
    case "wait":
        params["timeoutMs"] = intValue(step, "timeout") ?? 10_000
        let load = stringValue(step, "load")
        if let selector = stringValue(step, "selector") {
            if let load {
                guard validWaitLoadStates.contains(load) else {
                    try failWithJSON(["error": "bad_params", "message": "Unsupported wait load state in replay: \(load)"])
                }
                var loadParams = params
                loadParams["loadState"] = load
                let loadResult = try client.call(method: "wait_tab", params: loadParams)
                guard waitResultOK(loadResult) else {
                    return combinedLoadSelectorWaitResult(load: loadResult, selector: nil)
                }
                params["selector"] = selector
                if boolValue(step, "hidden") == true { params["hidden"] = true }
                if let frame = stringValue(step, "frame") { params["frame"] = frame }
                let selectorResult = try client.call(method: "wait_tab", params: params)
                return combinedLoadSelectorWaitResult(load: loadResult, selector: selectorResult)
            } else {
                params["selector"] = selector
                if boolValue(step, "hidden") == true { params["hidden"] = true }
                if let frame = stringValue(step, "frame") { params["frame"] = frame }
            }
        } else if let ms = intValue(step, "ms") {
            params["sleepMs"] = ms
        } else if let text = stringValue(step, "text") {
            params["text"] = text
        } else if let url = stringValue(step, "url") {
            params["urlPattern"] = url
        } else if let load {
            guard validWaitLoadStates.contains(load) else {
                try failWithJSON(["error": "bad_params", "message": "Unsupported wait load state in replay: \(load)"])
            }
            params["loadState"] = load
        } else if let fn = stringValue(step, "fn") {
            params["predicate"] = fn
        }
        params["timeoutMs"] = intValue(step, "timeout") ?? defaultGatewayTimeoutMs()
        return try client.call(method: "wait_tab", params: params)
    default:
        try failWithJSON(["error": "unknown_replay_op", "message": "Unknown replay op: \(op)"])
    }
}

func requiredString(_ step: [String: Any], _ key: String, op: String) throws -> String {
    guard let value = stringValue(step, key) else {
        try failWithJSON(["error": "invalid_step", "message": "\(op) step requires \(key)"])
    }
    return value
}

struct PersonalDataOptions: ParsableArguments {
    @Option(name: .long, help: "Read browser-owned personal data from this connected extension/profile. Required when multiple extensions are connected.") var extensionId: String?
    @Option(name: .long, help: "Maximum number of rows to return") var limit: Int?

    func params() -> [String: Any] {
        var params: [String: Any] = [:]
        if let extensionId { params["extensionId"] = extensionId }
        if let limit { params["limit"] = limit }
        return params
    }
}

struct Bookmarks: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "bookmarks",
        abstract: "Inspect browser-owned bookmarks after separate explicit permission",
        discussion: """
        Bookmarks are browser-owned personal data, not shared-tab page state. These commands require
        the separate Bookmarks access toggle in the ABG extension popup. Audit logs record the command,
        count, ids, and byte lengths, but not full bookmark URLs.
        """,
        subcommands: [
            BookmarkList.self,
            BookmarkSearch.self,
            BookmarkGet.self,
            BookmarkOpen.self,
        ]
    )
}

struct BookmarkList: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "list", abstract: "List bookmarks")
    @OptionGroup var options: PersonalDataOptions
    @Flag(name: .long, help: "Include bookmark folders in the output") var includeFolders: Bool = false

    func run() async throws {
        var params = options.params()
        if includeFolders { params["includeFolders"] = true }
        let result = try UDSClient().call(method: "bookmarks_list", params: params)
        printJSON(result)
    }
}

struct BookmarkSearch: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "search", abstract: "Search bookmarks by title or URL")
    @Argument(help: "Search query. The query is sent to the browser extension, but audit logs store only its byte length.") var query: String
    @OptionGroup var options: PersonalDataOptions
    @Flag(name: .long, help: "Include matching folders in the output") var includeFolders: Bool = false

    func run() async throws {
        var params = options.params()
        params["query"] = query
        if includeFolders { params["includeFolders"] = true }
        let result = try UDSClient().call(method: "bookmarks_search", params: params)
        printJSON(result)
    }
}

struct BookmarkGet: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "get", abstract: "Get one bookmark or folder subtree by id")
    @Argument(help: "Bookmark node id") var bookmarkId: String
    @OptionGroup var options: PersonalDataOptions

    func run() async throws {
        var params = options.params()
        params["bookmarkId"] = bookmarkId
        let result = try UDSClient().call(method: "bookmarks_get", params: params)
        printJSON(result)
    }
}

struct BookmarkOpen: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "open",
        abstract: "Open one bookmark URL in the browser through an explicit command"
    )
    @Argument(help: "Bookmark node id") var bookmarkId: String
    @Option(name: .long, help: "Read browser-owned personal data from this connected extension/profile. Required when multiple extensions are connected.") var extensionId: String?

    func run() async throws {
        var params: [String: Any] = ["bookmarkId": bookmarkId]
        if let extensionId { params["extensionId"] = extensionId }
        let result = try UDSClient().call(method: "bookmarks_open", params: params)
        printJSON(result)
    }
}

struct ReadingList: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "reading-list",
        abstract: "Inspect browser-owned Reading List entries after separate explicit permission",
        discussion: """
        Reading List entries are browser-owned personal data, not shared-tab page state. These commands
        require the separate Reading List access toggle in the ABG extension popup. Chrome documents
        chrome.readingList for Chrome 120+; browsers that do not expose it return an unsupported error.
        Audit logs record command metadata and counts, but not full entry URLs.
        """,
        subcommands: [
            ReadingListList.self,
            ReadingListSearch.self,
        ]
    )
}

struct ReadingListList: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "list", abstract: "List Reading List entries")
    @OptionGroup var options: PersonalDataOptions
    @Flag(name: .long, help: "Return entries that have been read") var read: Bool = false
    @Flag(name: .long, help: "Return entries that have not been read") var unread: Bool = false

    func run() async throws {
        if read && unread {
            try failWithJSON(["error": "bad_params", "message": "Use only one of --read or --unread."])
        }
        var params = options.params()
        if read { params["hasBeenRead"] = true }
        if unread { params["hasBeenRead"] = false }
        let result = try UDSClient().call(method: "reading_list_list", params: params)
        printJSON(result)
    }
}

struct ReadingListSearch: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "search", abstract: "Search Reading List title or URL")
    @Argument(help: "Search query. The query is sent to the browser extension, but audit logs store only its byte length.") var query: String
    @OptionGroup var options: PersonalDataOptions

    func run() async throws {
        var params = options.params()
        params["query"] = query
        let result = try UDSClient().call(method: "reading_list_search", params: params)
        printJSON(result)
    }
}

struct Revoke: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "タブの共有を解除")
    @OptionGroup var target: TabTarget

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "revoke_tab", params: ["tabId": tabId])
        printJSON(result)
    }
}

struct Audit: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "監査ログ閲覧")
    @Option(name: .long, help: "末尾何件 (デフォルト 50)") var lines: Int = 50

    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "audit", params: ["lines": lines])
        printJSON(result)
    }
}

struct Activity: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "ローカル監査ログの日次/週次サマリー")
    @Option(name: .long, help: "集計期間: day または week (デフォルト day)") var period: String = "day"

    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "activity_digest", params: ["period": period])
        printJSON(result)
    }
}

struct Plugin: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "plugin",
        abstract: "ABG plugin をインストール/一覧/削除/更新",
        subcommands: [
            PluginList.self,
            PluginInstall.self,
            PluginUninstall.self,
            PluginUpdate.self,
            PluginEnable.self,
            PluginDisable.self,
            PluginReload.self,
        ]
    )
}

struct PluginManifest: Codable {
    struct CommandArgSpec: Codable {
        let name: String
        let type: String?
        let required: Bool?
        let `default`: AnyCodable?
    }

    struct CommandSpec: Codable {
        let name: String
        let description: String?
        let args: [CommandArgSpec]?

        init(from decoder: Decoder) throws {
            let single = try decoder.singleValueContainer()
            if let name = try? single.decode(String.self) {
                self.name = name
                self.description = nil
                self.args = nil
                return
            }
            let keyed = try decoder.container(keyedBy: CodingKeys.self)
            self.name = try keyed.decode(String.self, forKey: .name)
            self.description = try keyed.decodeIfPresent(String.self, forKey: .description)
            self.args = try keyed.decodeIfPresent([CommandArgSpec].self, forKey: .args)
        }
    }

    let name: String?
    let version: String?
    let author: String?
    let description: String?
    let domains: [String]?
    let transforms: [String]?
    let commands: [CommandSpec]?
}

struct PluginList: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "list", abstract: "plugin 一覧を表示")
    @Flag(name: .long, help: "起動中 Gateway が実際にロード済みの plugin を表示") var loaded: Bool = false
    @Flag(name: .long, help: "Gateway 経由ではなく CLI ローカル inventory のみを表示") var localOnly: Bool = false

    func run() async throws {
        if loaded {
            let result = try UDSClient().call(method: "plugins")
            printJSON(result)
            return
        }
        // Default: prefer the running Gateway's view (it knows what is actually
        // loaded, including registered commands). Fall back to CLI-local
        // inventory when the daemon is unreachable, or when --local-only is set.
        if !localOnly, let result = try? UDSClient().call(method: "plugins") {
            printJSON(result)
            return
        }
        printJSON(pluginInventory())
    }
}

struct PluginInstall: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "install", abstract: "ABG user plugin directory に plugin をインストール")
    @Argument(help: "GitHub repo (user/repo), git URL, or local plugin directory") var source: String
    @Option(name: .long, help: "インストール名 (省略時 source から推定)") var name: String?
    @Flag(name: .long, help: "既存 plugin を置き換える") var force: Bool = false
    @Flag(name: .long, help: "任意 JS を Gateway にロードする警告を確認済みとして進める") var yes: Bool = false

    func run() async throws {
        guard yes else {
            try failWithJSON([
                "error": "confirmation_required",
                "message": "Plugins run JavaScript inside the local Gateway process. Re-run with --yes if you trust this source.",
                "userMessage": "plugin は Gateway プロセス内で JavaScript として実行されます。信頼できる source の場合だけ --yes を付けて再実行してください。",
            ])
        }

        let userDir = try userPluginsDirectory()
        do {
            let result = try ABGPluginInstaller.install(
                source: source,
                name: name,
                force: force,
                pluginsDirectory: userDir
            )
            printJSON(result.dictionary)
        } catch let error as ABGPluginInstallError {
            try failWithJSON([
                "error": error.code,
                "message": error.localizedDescription,
            ])
        }
    }
}

struct PluginUninstall: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "uninstall", abstract: "user-installed plugin を削除")
    @Argument(help: "plugin name") var name: String

    func run() async throws {
        let pluginsDir = try userPluginsDirectory()
        do {
            let result = try ABGPluginInstaller.uninstall(name: name, pluginsDirectory: pluginsDir)
            printJSON(result.dictionary)
        } catch let error as ABGPluginManagementError {
            try failWithJSON([
                "error": error.code,
                "message": error.localizedDescription,
            ])
        }
    }
}

struct PluginUpdate: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "update", abstract: "git clone された user plugin を更新")
    @Argument(help: "plugin name (省略時は全 user plugin)") var name: String?

    func run() async throws {
        let root = try userPluginsDirectory()
        let results = try ABGPluginInstaller.updatePlugins(name: name, pluginsDirectory: root)
        printJSON(results.map(\.dictionary))
    }
}

struct PluginEnable: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "enable", abstract: "disabled user plugin を有効化")
    @Argument(help: "plugin install name") var name: String

    func run() async throws {
        if shouldUseRunningGatewayForPluginState(),
           let result = try? UDSClient().call(
            method: "plugin_enable",
            params: ["pluginName": name],
            suppressErrors: true
           ) {
            printJSON(result)
            return
        }
        let root = try userPluginsDirectory()
        do {
            let result = try ABGPluginStateStore.enable(name: name, pluginsDirectory: root, userDirectory: ABGConstants.abgUserDir)
            printJSON(result.dictionary)
        } catch let error as ABGPluginManagementError {
            try failWithJSON([
                "error": error.code,
                "message": error.localizedDescription,
            ])
        }
    }
}

struct PluginDisable: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "disable", abstract: "user plugin を削除せず無効化")
    @Argument(help: "plugin install name") var name: String

    func run() async throws {
        if shouldUseRunningGatewayForPluginState(),
           let result = try? UDSClient().call(
            method: "plugin_disable",
            params: ["pluginName": name],
            suppressErrors: true
           ) {
            printJSON(result)
            return
        }
        let root = try userPluginsDirectory()
        do {
            let result = try ABGPluginStateStore.disable(name: name, pluginsDirectory: root, userDirectory: ABGConstants.abgUserDir)
            printJSON(result.dictionary)
        } catch let error as ABGPluginManagementError {
            try failWithJSON([
                "error": error.code,
                "message": error.localizedDescription,
            ])
        }
    }
}

struct PluginReload: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "reload", abstract: "起動中 Gateway の plugin を再読み込み")
    @Argument(help: "plugin name (省略時は全 plugin)") var name: String?

    func run() async throws {
        var params: [String: Any] = [:]
        if let name { params["pluginName"] = name }
        let result = try UDSClient().call(method: "plugin_reload", params: params)
        printJSON(result)
    }
}

func userPluginsDirectory() throws -> URL {
    let url = ABGConstants.userPluginsDir
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
}

func shouldUseRunningGatewayForPluginState(environment: [String: String] = ProcessInfo.processInfo.environment) -> Bool {
    let override = environment["ABG_USER_DIR"]?.trimmingCharacters(in: .whitespacesAndNewlines)
    return override?.isEmpty ?? true
}

func bundledPluginDirectories() -> [URL] {
    var roots: [URL] = []
    let cwdPlugins = URL(fileURLWithPath: FileManager.default.currentDirectoryPath)
        .appendingPathComponent("plugins", isDirectory: true)
    if FileManager.default.fileExists(atPath: cwdPlugins.path) {
        roots.append(cwdPlugins)
    }
    if let resourcePlugins = Bundle.main.resourceURL?.appendingPathComponent("plugins", isDirectory: true),
       FileManager.default.fileExists(atPath: resourcePlugins.path),
       !roots.contains(resourcePlugins) {
        roots.append(resourcePlugins)
    }
    // CLI binaries are commonly installed standalone (e.g. /usr/local/bin/abg,
    // Homebrew shims) where Bundle.main.resourceURL does not point inside the
    // menubar app. Probe known menubar app installation paths so plugins
    // shipped inside the .app bundle still surface in `abg plugin list`.
    let homeApp = NSHomeDirectory() + "/Applications/Agent Browser Gateway.app"
    for appPath in ["/Applications/Agent Browser Gateway.app", homeApp] {
        let appPlugins = URL(fileURLWithPath: appPath)
            .appendingPathComponent("Contents/Resources/plugins", isDirectory: true)
        if FileManager.default.fileExists(atPath: appPlugins.path),
           !roots.contains(appPlugins) {
            roots.append(appPlugins)
        }
    }
    return roots
}

func pluginInventory() -> [[String: Any]] {
    var rows: [[String: Any]] = []
    for root in bundledPluginDirectories() {
        rows.append(contentsOf: pluginInfos(in: root, source: "bundled"))
    }
    if let userRoot = try? userPluginsDirectory() {
        rows.append(contentsOf: pluginInfos(in: userRoot, source: "user"))
    }
    return rows
}

func pluginInfos(in root: URL, source: String) -> [[String: Any]] {
    let entries = (try? FileManager.default.contentsOfDirectory(
        at: root,
        includingPropertiesForKeys: [.isDirectoryKey]
    )) ?? []
    return entries
        .sorted(by: { $0.lastPathComponent < $1.lastPathComponent })
        .compactMap { pluginInfo(at: $0, source: source) }
}

func pluginInfo(at dir: URL, source: String) -> [String: Any]? {
    guard FileManager.default.fileExists(atPath: dir.appendingPathComponent("index.js").path) else { return nil }
    let manifest = readPluginManifest(at: dir)
    var dict: [String: Any] = [
        "name": manifest?.name ?? dir.lastPathComponent,
        "source": source,
        "path": dir.path,
    ]
    if source == "user" {
        dict["enabled"] = !ABGPluginStateStore.isDisabled(
            installName: dir.lastPathComponent,
            userDirectory: dir.deletingLastPathComponent().deletingLastPathComponent()
        )
    } else {
        dict["enabled"] = true
    }
    if let version = manifest?.version { dict["version"] = version }
    if let author = manifest?.author { dict["author"] = author }
    if let description = manifest?.description { dict["description"] = description }
    if let domains = manifest?.domains { dict["domains"] = domains }
    if let transforms = manifest?.transforms { dict["transforms"] = transforms }
    if let commands = manifest?.commands {
        dict["commands"] = commands.map { command in
            var commandDict: [String: Any] = ["name": command.name]
            if let description = command.description { commandDict["description"] = description }
            if let args = command.args {
                commandDict["args"] = args.map { arg in
                    var argDict: [String: Any] = ["name": arg.name]
                    if let type = arg.type { argDict["type"] = type }
                    if let required = arg.required { argDict["required"] = required }
                    if let defaultValue = arg.default { argDict["default"] = defaultValue.value }
                    return argDict
                }
            }
            return commandDict
        }
    }
    return dict
}

func readPluginManifest(at dir: URL) -> PluginManifest? {
    let url = dir.appendingPathComponent("plugin.json")
    guard let data = try? Data(contentsOf: url) else { return nil }
    return try? JSONDecoder().decode(PluginManifest.self, from: data)
}

func localPluginSourceExists(_ source: String) -> Bool {
    ABGPluginInstaller.localPluginSourceExists(source)
}

func normalizedGitSource(_ source: String) -> String {
    ABGPluginInstaller.normalizedGitSource(source)
}

func inferredPluginName(from source: String) -> String {
    ABGPluginInstaller.inferredPluginName(from: source)
}

func sanitizePluginName(_ name: String) -> String {
    ABGPluginInstaller.sanitizePluginName(name)
}

@discardableResult
func runProcess(_ executable: String, _ arguments: [String]) throws -> String {
    let process = Process()
    process.executableURL = URL(fileURLWithPath: executable)
    process.arguments = arguments
    let output = Pipe()
    process.standardOutput = output
    process.standardError = output
    try process.run()
    process.waitUntilExit()
    let data = output.fileHandleForReading.readDataToEndOfFile()
    let text = String(data: data, encoding: .utf8) ?? ""
    guard process.terminationStatus == 0 else {
        throw CLIError.ioError(text.trimmingCharacters(in: .whitespacesAndNewlines))
    }
    return text.trimmingCharacters(in: .whitespacesAndNewlines)
}

struct MCPServer: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "mcp-server",
        abstract: "Run a stdio MCP server that exposes the abg CLI as a thin tool wrapper"
    )

    @Option(name: .long, help: "Path to the abg executable. Defaults to ABG_MCP_ABG_PATH or the current executable.") var abgPath: String?

    func run() async throws {
        let resolvedPath = abgPath
            ?? ProcessInfo.processInfo.environment["ABG_MCP_ABG_PATH"]
            ?? URL(fileURLWithPath: CommandLine.arguments[0]).standardizedFileURL.path
        try ABGMCPStdioServer(abgPath: resolvedPath).run()
    }
}

struct ABGMCPStdioServer {
    let abgPath: String
    private let supportedProtocolVersions = [
        "2025-11-25",
        "2025-06-18",
        "2025-03-26",
        "2024-11-05",
        "2024-10-07",
    ]

    func run() throws {
        while let line = readLine(strippingNewline: true) {
            let trimmed = line.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { continue }
            if let response = handleLine(trimmed) {
                print(response)
                fflush(stdout)
            }
        }
    }

    private func handleLine(_ line: String) -> String? {
        guard let data = line.data(using: .utf8),
              let request = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else {
            return jsonRPCError(id: NSNull(), code: -32700, message: "Parse error")
        }
        let id = request["id"]
        guard let method = request["method"] as? String else {
            return id == nil ? nil : jsonRPCError(id: id, code: -32600, message: "Invalid request")
        }
        if id == nil, method.hasPrefix("notifications/") {
            return nil
        }

        switch method {
        case "initialize":
            let params = request["params"] as? [String: Any]
            let protocolVersion = negotiatedProtocolVersion(params?["protocolVersion"] as? String)
            return jsonRPCResult(id: id, result: [
                "protocolVersion": protocolVersion,
                "capabilities": [
                    "tools": [
                        "listChanged": false,
                    ],
                ],
                "serverInfo": [
                    "name": "agent-browser-gateway",
                    "version": ABGConstants.version,
                ],
            ])
        case "ping":
            return jsonRPCResult(id: id, result: [:])
        case "tools/list":
            return jsonRPCResult(id: id, result: [
                "tools": [
                    abgCLIToolDescription(),
                ],
            ])
        case "tools/call":
            return handleToolCall(id: id, params: request["params"] as? [String: Any])
        default:
            return jsonRPCError(id: id, code: -32601, message: "Method not found")
        }
    }

    private func handleToolCall(id: Any?, params: [String: Any]?) -> String {
        guard let name = params?["name"] as? String else {
            return jsonRPCError(id: id, code: -32602, message: "Missing tool name")
        }
        guard name == "abg_cli" else {
            return jsonRPCError(id: id, code: -32602, message: "Unknown tool: \(name)")
        }
        guard let arguments = params?["arguments"] as? [String: Any],
              let rawArgs = arguments["args"] as? [Any] else {
            return jsonRPCError(id: id, code: -32602, message: "abg_cli requires arguments.args")
        }
        let cliArgs = rawArgs.compactMap { $0 as? String }
        guard cliArgs.count == rawArgs.count, !cliArgs.isEmpty else {
            return jsonRPCError(id: id, code: -32602, message: "arguments.args must be a non-empty string array")
        }
        guard cliArgs.first != "mcp-server" else {
            return jsonRPCError(id: id, code: -32602, message: "abg_cli cannot launch mcp-server recursively")
        }

        do {
            let result = try runABGCLI(args: cliArgs)
            return jsonRPCResult(id: id, result: toolResult(from: result))
        } catch {
            return jsonRPCResult(id: id, result: [
                "content": [
                    [
                        "type": "text",
                        "text": "Failed to run abg: \(error.localizedDescription)",
                    ],
                ],
                "isError": true,
            ])
        }
    }

    private func negotiatedProtocolVersion(_ clientVersion: String?) -> String {
        guard let clientVersion else { return supportedProtocolVersions[0] }
        return supportedProtocolVersions.contains(clientVersion) ? clientVersion : supportedProtocolVersions[0]
    }

    private func abgCLIToolDescription() -> [String: Any] {
        [
            "name": "abg_cli",
            "description": """
            Run the local abg CLI by passing argv tokens after `abg`. This MCP wrapper does not
            bypass ABG permissions: tab sharing, operation approval, audit logging, and plugin
            execution all remain enforced by the existing CLI/Gateway path. Examples: ["status"],
            ["tabs", "--compact"], ["read", "t1", "--format", "markdown"].
            """,
            "inputSchema": [
                "type": "object",
                "properties": [
                    "args": [
                        "type": "array",
                        "items": ["type": "string"],
                        "minItems": 1,
                        "description": "Command-line arguments to pass after `abg`; shell expansion is not performed.",
                    ],
                ],
                "required": ["args"],
                "additionalProperties": false,
            ],
        ]
    }

    private func runABGCLI(args: [String]) throws -> ABGCLIExecutionResult {
        let process = Process()
        if abgPath.contains("/") {
            process.executableURL = URL(fileURLWithPath: abgPath)
            process.arguments = args
        } else {
            process.executableURL = URL(fileURLWithPath: "/usr/bin/env")
            process.arguments = [abgPath] + args
        }
        process.environment = ProcessInfo.processInfo.environment

        let stdoutURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-mcp-\(UUID().uuidString).stdout")
        let stderrURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("abg-mcp-\(UUID().uuidString).stderr")
        FileManager.default.createFile(atPath: stdoutURL.path, contents: nil)
        FileManager.default.createFile(atPath: stderrURL.path, contents: nil)
        let stdoutHandle = try FileHandle(forWritingTo: stdoutURL)
        let stderrHandle = try FileHandle(forWritingTo: stderrURL)
        defer {
            try? stdoutHandle.close()
            try? stderrHandle.close()
            try? FileManager.default.removeItem(at: stdoutURL)
            try? FileManager.default.removeItem(at: stderrURL)
        }

        process.standardOutput = stdoutHandle
        process.standardError = stderrHandle
        try process.run()
        process.waitUntilExit()
        try? stdoutHandle.close()
        try? stderrHandle.close()

        let stdout = String(data: (try? Data(contentsOf: stdoutURL)) ?? Data(), encoding: .utf8) ?? ""
        let stderr = String(data: (try? Data(contentsOf: stderrURL)) ?? Data(), encoding: .utf8) ?? ""
        return ABGCLIExecutionResult(
            exitCode: Int(process.terminationStatus),
            stdout: stdout.trimmingCharacters(in: .whitespacesAndNewlines),
            stderr: stderr.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    private func toolResult(from execution: ABGCLIExecutionResult) -> [String: Any] {
        let text = [execution.stdout, execution.stderr]
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
        var result: [String: Any] = [
            "content": [
                [
                    "type": "text",
                    "text": text.isEmpty ? "(no output)" : text,
                ],
            ],
            "structuredContent": execution.structuredContent,
        ]
        if execution.exitCode != 0 {
            result["isError"] = true
        }
        return result
    }

    private func jsonRPCResult(id: Any?, result: [String: Any]) -> String {
        stringify([
            "jsonrpc": "2.0",
            "id": id ?? NSNull(),
            "result": result,
        ])
    }

    private func jsonRPCError(id: Any?, code: Int, message: String) -> String {
        stringify([
            "jsonrpc": "2.0",
            "id": id ?? NSNull(),
            "error": [
                "code": code,
                "message": message,
            ],
        ])
    }

    private func stringify(_ object: [String: Any]) -> String {
        guard JSONSerialization.isValidJSONObject(object),
              let data = try? JSONSerialization.data(withJSONObject: object),
              let text = String(data: data, encoding: .utf8) else {
            return #"{"jsonrpc":"2.0","id":null,"error":{"code":-32603,"message":"Internal JSON encoding error"}}"#
        }
        return text
    }
}

struct ABGCLIExecutionResult {
    let exitCode: Int
    let stdout: String
    let stderr: String

    var structuredContent: [String: Any] {
        var content: [String: Any] = ["exitCode": exitCode]
        if !stderr.isEmpty {
            content["stderr"] = stderr
        }
        if let data = stdout.data(using: .utf8),
           let json = try? JSONSerialization.jsonObject(with: data) {
            content["json"] = json
        }
        return content
    }
}

struct InstallSkill: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "install-skill",
        abstract: "廃止されました。skills CLI (npx skills add) でインストールしてください",
        shouldDisplay: false
    )
    @Flag(name: .long, help: .hidden) var noUpgrade: Bool = false
    @Option(name: .long, help: .hidden) var target: String = "both"

    func run() async throws {
        printErrorJSON([
            "error": "command_removed",
            "message": "abg install-skill was removed in 0.4.4. Skills are now installed with the skills CLI.",
            "userMessage": "install-skill は廃止されました。npx skills add で ABG スキルをインストールしてください。",
            "nextCommand": "npx skills add arcmanagement/agent-browser-gateway -g",
        ])
        throw ExitCode.failure
    }
}
