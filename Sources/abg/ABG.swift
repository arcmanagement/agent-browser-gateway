import ArgumentParser
import Foundation
import GatewayCore

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
            Status.self, Tabs.self, Inspect.self,
            Read.self, Screenshot.self, PDF.self, Annotate.self, Console.self, Table.self, Describe.self, Network.self,
            Click.self, DblClick.self, Focus.self, Hover.self, SelectOption.self, Check.self, Uncheck.self, Fill.self, ReplaceEditable.self, Paste.self, Clear.self, Replace.self, Type.self, Key.self, KeyDown.self, KeyUp.self, Keyboard.self, Navigate.self, Scroll.self, ScrollIntoView.self, Drag.self, Upload.self,
            Wait.self,
            Record.self, Replay.self,
            Revoke.self, Audit.self, Plugin.self, InstallSkill.self,
        ]
    )
}

private let builtInTopLevelCommands: Set<String> = [
    "status", "tabs", "inspect",
    "read", "screenshot", "pdf", "annotate", "console", "table", "describe", "network",
    "click", "dblclick", "focus", "hover", "select", "check", "uncheck", "fill", "replace-editable", "paste", "clear", "replace", "type", "key", "keydown", "keyup", "keyboard", "navigate", "scroll", "scroll-into-view", "drag", "upload",
    "wait",
    "record", "replay",
    "revoke", "audit", "plugin", "install-skill",
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
        [
            "ref": tab["ref"] ?? "",
            "tabId": tab["tabId"] ?? 0,
            "title": tab["title"] ?? "",
            "url": tab["url"] ?? "",
        ]
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
    let base = FileManager.default.temporaryDirectory
        .appendingPathComponent("abg", isDirectory: true)
        .appendingPathComponent("screenshots", isDirectory: true)
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
    let url = FileManager.default.homeDirectoryForCurrentUser.appendingPathComponent(".abg", isDirectory: true)
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
                    print("\(tab["ref"] ?? "")\t\(tab["tabId"] ?? "")\t[\(tab["title"] ?? "")]\t\(tab["url"] ?? "")")
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
    @Flag(name: .long, help: "HTML を Markdown に変換 (token 効率)") var asMarkdown: Bool = false
    @Option(name: .long, help: "出力形式: json / markdown / text / html") var format: String = "json"
    @Flag(name: .long, help: "Markdown 出力で画像 URL を残す") var keepImages: Bool = false

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if let s = selector { params["selector"] = s }
        let wantsMarkdown = asMarkdown || format == "markdown"
        if wantsMarkdown {
            params["asMarkdown"] = true
            params["keepImages"] = keepImages
        }
        let result = try client.call(method: "read_tab", params: params)
        var step: [String: Any] = ["op": "read", "tabId": tabId, "format": format]
        if let selector { step["selector"] = selector }
        if asMarkdown { step["asMarkdown"] = true }
        if keepImages { step["keepImages"] = true }
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

struct Table: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "HTML table のヘッダー・行・セルを抽出")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "対象 table または table を含む CSS selector") var selector: String?
    @Option(name: .long, help: "出力形式: json / markdown") var format: String = "json"

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId]
        if let selector { params["selector"] = selector }
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

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "all": all, "limit": limit]
        if let kind { params["kind"] = kind }
        if let grid { params["grid"] = grid }
        let result = try client.call(method: "describe_tab", params: params)
        printJSON(result)
    }
}

struct Network: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "共有中タブのネットワークリクエストを表示")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "URL glob フィルタ") var url: String?
    @Option(name: .long, help: "HTTP method フィルタ (GET/POST など)") var method: String?
    @Option(name: .long, help: "最小 HTTP status (例: 400)") var statusMin: Int?
    @Option(name: .long, help: "type フィルタ (xhr,fetch,document など。カンマ区切り可)") var type: String?
    @Option(name: .long, help: "個別 requestId") var requestId: String?
    @Flag(name: .long, help: "requestId のレスポンス body を取得") var body: Bool = false
    @Option(name: .long, help: "最大件数 (デフォルト 100)") var limit: Int = 100

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "limit": limit]
        if let url { params["urlPattern"] = url }
        if let method { params["method"] = method }
        if let statusMin { params["statusMin"] = statusMin }
        if let type { params["type"] = type }
        if let requestId { params["requestId"] = requestId }
        if body { params["body"] = true }
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
        if all { params["all"] = true }
        if let grid { params["grid"] = grid }
        if let limit { params["limit"] = limit }
        if let xx = x { params["x"] = xx }
        if let yy = y { params["y"] = yy }
        guard selector != nil || id != nil || (x != nil && y != nil) else {
            try failWithJSON([
                "error": "bad_params",
                "message": "specify --selector, --id, or both --x and --y",
            ])
        }
        let result = try client.call(method: "click_tab", params: params)
        var step: [String: Any] = ["op": "click", "tabId": tabId]
        if let selector { step["selector"] = selector }
        if let id { step["id"] = id }
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
    @Flag(name: .long, help: "対象種別と置換予定サイズだけを返し、DOM は変更しない") var dryRun: Bool = false

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "fill_tab", params: ["tabId": tabId, "selector": selector, "value": value, "dryRun": dryRun])
        if !dryRun {
            appendRecordedStep(["op": "fill", "tabId": tabId, "selector": selector, "value": value])
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
    @Flag(name: .long, help: "Read replacement text from stdin") var stdin: Bool = false
    @Flag(name: .long, help: "Preview target metadata and replacement length without changing the page") var dryRun: Bool = false

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
            text = try String(contentsOfFile: (textFile as NSString).expandingTildeInPath, encoding: .utf8)
        } else {
            let data = FileHandle.standardInput.readDataToEndOfFile()
            text = String(data: data, encoding: .utf8) ?? ""
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "fill_tab", params: [
            "tabId": tabId,
            "selector": selector,
            "value": text,
            "replaceEditable": true,
            "dryRun": dryRun,
        ])
        if !dryRun {
            appendRecordedStep(["op": "fill", "tabId": tabId, "selector": selector, "value": text])
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
        let result = try client.call(method: "paste_tab", params: ["tabId": tabId, "selector": selector, "value": text])
        appendRecordedStep(["op": "paste", "tabId": tabId, "selector": selector, "value": text])
        printJSON(result)
    }
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

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "clear_tab", params: ["tabId": tabId, "selector": selector])
        appendRecordedStep(["op": "clear", "tabId": tabId, "selector": selector])
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
        let result = try client.call(method: "replace_tab", params: [
            "tabId": tabId,
            "selector": selector,
            "html": replacementHtml,
        ])
        appendRecordedStep([
            "op": "replace",
            "tabId": tabId,
            "selector": selector,
            "html": replacementHtml,
        ])
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
          abg scroll 328 --dy 800 --at-x 1200 --at-y 400  # 右側パネルだけスクロール
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "縦 delta px (正で下、負で上、デフォルト 0)") var dy: Double = 0
    @Option(name: .long, help: "横 delta px (正で右、負で左、デフォルト 0)") var dx: Double = 0
    @Option(name: .long, help: "ホイール位置 X (省略時ビューポート中央)") var atX: Double?
    @Option(name: .long, help: "ホイール位置 Y (省略時ビューポート中央)") var atY: Double?

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "deltaX": dx, "deltaY": dy]
        if let v = atX { params["atX"] = v }
        if let v = atY { params["atY"] = v }
        let result = try client.call(method: "scroll_tab", params: params)
        var step: [String: Any] = ["op": "scroll", "tabId": tabId, "dx": dx, "dy": dy]
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
    @Option(name: .long, help: "添付するローカルファイル") var file: String

    func run() async throws {
        let expanded = (file as NSString).expandingTildeInPath
        var isDir: ObjCBool = false
        guard FileManager.default.fileExists(atPath: expanded, isDirectory: &isDir), !isDir.boolValue else {
            try failWithJSON([
                "error": "file_not_found",
                "message": "File does not exist: \(expanded)",
                "userMessage": "指定されたファイルが見つかりません。パスを確認してから再実行してください。",
            ])
        }
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "upload_tab", params: ["tabId": tabId, "selector": selector, "file": expanded])
        appendRecordedStep(["op": "upload", "tabId": tabId, "selector": selector, "file": expanded])
        printJSON(result)
    }
}

struct Wait: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        abstract: "セレクタが現れる/消えるまで or 一定時間待つ",
        discussion: """
        --selector を指定すると、その要素が visible になるまで polling (デフォルト 10s タイムアウト)。
        --hidden 付きなら逆に消えるまで待つ。--ms だけ指定すると単純な sleep。
        polling 間隔は 200ms 固定。timeout 時はエラーを返す。

        例:
          abg wait 445 --selector ".loaded"           # .loaded が出るまで最大 10s
          abg wait 445 --selector ".spinner" --hidden # .spinner が消えるまで最大 10s
          abg wait 445 --ms 1500                       # 1.5s 待つだけ
          abg wait 445 --selector "h1" --timeout 30000 # 30s タイムアウト
        """
    )
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "待つ CSS selector") var selector: String?
    @Flag(name: .long, help: "selector が消えるのを待つ (デフォルトは現れるのを待つ)") var hidden: Bool = false
    @Option(name: .long, help: "固定 sleep ミリ秒 (selector を使わないとき)") var ms: Int?
    @Option(name: .long, help: "selector のタイムアウト ms (デフォルト 10000)") var timeout: Int = 10_000

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        var params: [String: Any] = ["tabId": tabId, "timeoutMs": timeout]
        if let s = selector {
            params["selector"] = s
            params["hidden"] = hidden
        } else if let m = ms {
            params["sleepMs"] = m
        } else {
            FileHandle.standardError.write(Data("specify --selector or --ms\n".utf8))
            throw ExitCode.failure
        }
        let result = try client.call(method: "wait_tab", params: params)
        var step: [String: Any] = ["op": "wait", "tabId": tabId, "timeout": timeout]
        if let selector {
            step["selector"] = selector
            if hidden { step["hidden"] = true }
        }
        if let ms { step["ms"] = ms }
        appendRecordedStep(step)
        printJSON(result)
    }
}

struct Record: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
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
        return try client.call(method: "read_tab", params: params)
    case "screenshot":
        if let clip = step["clip"] as? [String: Any] { params["clip"] = clip }
        let result = try client.call(method: "screenshot_tab", params: params)
        let outPath = stringValue(step, "out").map { ($0 as NSString).expandingTildeInPath }
            ?? (try? defaultScreenshotPath(tabLabel: "replay-\(tabId)"))
            ?? "/tmp/abg-replay-\(tabId)-\(Int(Date().timeIntervalSince1970)).png"
        return try saveScreenshotResult(result, outPath: outPath)
    case "click":
        for key in ["selector", "id", "all", "grid", "limit", "x", "y"] {
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
    case "fill":
        params["selector"] = try requiredString(step, "selector", op: op)
        params["value"] = stringValue(step, "value") ?? ""
        return try client.call(method: "fill_tab", params: params)
    case "paste":
        params["selector"] = try requiredString(step, "selector", op: op)
        params["value"] = stringValue(step, "value") ?? ""
        return try client.call(method: "paste_tab", params: params)
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
    case "navigate":
        params["url"] = try requiredString(step, "url", op: op)
        return try client.call(method: "navigate_tab", params: params)
    case "scroll":
        params["deltaX"] = doubleValue(step, "dx") ?? 0
        params["deltaY"] = doubleValue(step, "dy") ?? 0
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
        params["file"] = try requiredString(step, "file", op: op)
        return try client.call(method: "upload_tab", params: params)
    case "wait":
        if let selector = stringValue(step, "selector") {
            params["selector"] = selector
            if boolValue(step, "hidden") == true { params["hidden"] = true }
        } else if let ms = intValue(step, "ms") {
            params["sleepMs"] = ms
        }
        params["timeoutMs"] = intValue(step, "timeout") ?? 10_000
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

struct Plugin: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "plugin",
        abstract: "ABG plugin をインストール/一覧/削除/更新",
        subcommands: [
            PluginList.self,
            PluginInstall.self,
            PluginUninstall.self,
            PluginUpdate.self,
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
    static let configuration = CommandConfiguration(commandName: "install", abstract: "~/.abg/plugins に plugin をインストール")
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
        let installName = sanitizePluginName(name ?? inferredPluginName(from: source))
        let destination = userDir.appendingPathComponent(installName, isDirectory: true)
        let fm = FileManager.default
        if fm.fileExists(atPath: destination.path) {
            guard force else {
                try failWithJSON([
                    "error": "plugin_exists",
                    "message": "\(installName) is already installed. Use --force to replace it.",
                ])
            }
            try fm.removeItem(at: destination)
        }

        if localPluginSourceExists(source) {
            try fm.copyItem(at: URL(fileURLWithPath: (source as NSString).expandingTildeInPath), to: destination)
        } else {
            let cloneSource = normalizedGitSource(source)
            try runProcess("/usr/bin/env", ["git", "clone", "--depth", "1", cloneSource, destination.path])
        }

        guard fm.fileExists(atPath: destination.appendingPathComponent("index.js").path) else {
            try? fm.removeItem(at: destination)
            try failWithJSON([
                "error": "invalid_plugin",
                "message": "Installed source does not contain index.js at plugin root.",
            ])
        }

        printJSON(pluginInfo(at: destination, source: "user") ?? [
            "name": installName,
            "path": destination.path,
            "source": "user",
        ])
    }
}

struct PluginUninstall: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "uninstall", abstract: "user-installed plugin を削除")
    @Argument(help: "plugin name") var name: String

    func run() async throws {
        let destination = try userPluginsDirectory().appendingPathComponent(sanitizePluginName(name), isDirectory: true)
        guard FileManager.default.fileExists(atPath: destination.path) else {
            try failWithJSON(["error": "plugin_not_found", "message": "\(name) is not installed in ~/.abg/plugins"])
        }
        try FileManager.default.removeItem(at: destination)
        printJSON(["ok": true, "removed": destination.path])
    }
}

struct PluginUpdate: AsyncParsableCommand {
    static let configuration = CommandConfiguration(commandName: "update", abstract: "git clone された user plugin を更新")
    @Argument(help: "plugin name (省略時は全 user plugin)") var name: String?

    func run() async throws {
        let root = try userPluginsDirectory()
        let targets: [URL]
        if let name {
            targets = [root.appendingPathComponent(sanitizePluginName(name), isDirectory: true)]
        } else {
            targets = (try? FileManager.default.contentsOfDirectory(
                at: root,
                includingPropertiesForKeys: [.isDirectoryKey]
            )) ?? []
        }

        var results: [[String: Any]] = []
        for target in targets.sorted(by: { $0.lastPathComponent < $1.lastPathComponent }) {
            guard FileManager.default.fileExists(atPath: target.appendingPathComponent(".git").path) else {
                results.append(["name": target.lastPathComponent, "status": "skipped", "reason": "not a git checkout"])
                continue
            }
            do {
                let output = try runProcess("/usr/bin/env", ["git", "-C", target.path, "pull", "--ff-only"])
                results.append(["name": target.lastPathComponent, "status": "updated", "output": output])
            } catch {
                results.append(["name": target.lastPathComponent, "status": "failed", "error": "\(error)"])
            }
        }
        printJSON(results)
    }
}

func userPluginsDirectory() throws -> URL {
    let url = FileManager.default.homeDirectoryForCurrentUser
        .appendingPathComponent(".abg", isDirectory: true)
        .appendingPathComponent("plugins", isDirectory: true)
    try FileManager.default.createDirectory(at: url, withIntermediateDirectories: true)
    return url
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
    var isDir: ObjCBool = false
    return FileManager.default.fileExists(
        atPath: (source as NSString).expandingTildeInPath,
        isDirectory: &isDir
    ) && isDir.boolValue
}

func normalizedGitSource(_ source: String) -> String {
    if source.contains("://") || source.hasPrefix("git@") { return source }
    if source.split(separator: "/").count == 2 { return "https://github.com/\(source).git" }
    return source
}

func inferredPluginName(from source: String) -> String {
    let trimmed = source.trimmingCharacters(in: CharacterSet(charactersIn: "/"))
    let last = trimmed.split(separator: "/").last.map(String.init) ?? "plugin"
    return last.hasSuffix(".git") ? String(last.dropLast(4)) : last
}

func sanitizePluginName(_ name: String) -> String {
    let sanitized = name.replacingOccurrences(of: #"[^A-Za-z0-9_.-]"#, with: "-", options: .regularExpression)
    return sanitized.isEmpty ? "plugin" : sanitized
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

struct InstallSkill: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "install-skill",
        abstract: "Claude Code / Codex 用 Skill を ~/.claude/skills/ と ~/.codex/skills/ にインストール (デフォルトで両方、ABG バージョンに追従)"
    )
    @Flag(name: .long, help: "古いバージョンでも上書きしない (通常は不要)") var noUpgrade: Bool = false
    @Option(name: .long, help: "インストール先 (claude / codex / both, デフォルト both)") var target: String = "both"

    func run() async throws {
        let dirs: [URL]
        switch target {
        case "claude": dirs = [ABGConstants.claudeSkillsDir]
        case "codex":  dirs = [ABGConstants.codexSkillsDir]
        case "both":   dirs = [ABGConstants.claudeSkillsDir, ABGConstants.codexSkillsDir]
        default:
            print("error: --target は claude / codex / both のいずれか")
            throw ExitCode.failure
        }

        let bundledVersion = SkillBundle.version
        for base in dirs {
            try installOne(into: base, version: bundledVersion)
        }

        // Migrate away from the legacy single-file install path.
        let legacy = ABGConstants.claudeSkillsDir.appendingPathComponent("agent-browser-gateway.md")
        if FileManager.default.fileExists(atPath: legacy.path) {
            try? FileManager.default.removeItem(at: legacy)
            print("removed legacy: \(legacy.path)")
        }
    }

    private func installOne(into base: URL, version: String) throws {
        let skillDir = base.appendingPathComponent("agent-browser-gateway", isDirectory: true)
        try FileManager.default.createDirectory(at: skillDir, withIntermediateDirectories: true)
        let dest = skillDir.appendingPathComponent("SKILL.md")
        let installedVersion = readInstalledVersion(at: dest)
        let installedMarkdown = (try? String(contentsOf: dest, encoding: .utf8))

        if let installed = installedVersion, installed == version, installedMarkdown == SkillBundle.markdown {
            print("up-to-date: \(dest.path) (v\(version))")
            return
        }

        if let installed = installedVersion, installed != version, noUpgrade {
            print("skipped: installed v\(installed), bundled v\(version) at \(dest.path). Re-run without --no-upgrade to overwrite.")
            return
        }

        try SkillBundle.markdown.write(to: dest, atomically: true, encoding: .utf8)
        if let installed = installedVersion {
            if installed == version {
                print("updated: content changed at \(dest.path) (v\(version))")
            } else {
                print("upgraded: v\(installed) -> v\(version) at \(dest.path)")
            }
        } else {
            print("installed: v\(version) at \(dest.path)")
        }
    }

    /// Look at the YAML frontmatter for `version: <x>` so we can compare upgrades.
    /// Returns nil if no installed file or no version found.
    private func readInstalledVersion(at url: URL) -> String? {
        guard let data = try? Data(contentsOf: url),
              let text = String(data: data, encoding: .utf8) else { return nil }
        let lines = text.split(separator: "\n").prefix(20)
        for line in lines {
            let trimmed = line.trimmingCharacters(in: .whitespaces)
            if let range = trimmed.range(of: "version:") {
                return String(trimmed[range.upperBound...]).trimmingCharacters(in: .whitespaces)
            }
        }
        return nil
    }
}
