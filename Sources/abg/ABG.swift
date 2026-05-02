import ArgumentParser
import Foundation
import GatewayCore

@main
struct ABG: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "abg",
        abstract: "Agent Browser Gateway CLI",
        subcommands: [
            Status.self, Tabs.self, Inspect.self,
            Read.self, Screenshot.self, Console.self, Table.self, Describe.self, Network.self,
            Click.self, Fill.self, Type.self, Key.self, Navigate.self, Scroll.self, Drag.self, Upload.self,
            Wait.self,
            Revoke.self, Audit.self, InstallSkill.self,
        ]
    )
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
        guard let dict = result as? [String: Any], let dataUrl = dict["dataUrl"] as? String else {
            FileHandle.standardError.write(Data("unexpected response: \(String(describing: result))\n".utf8))
            throw ExitCode.failure
        }
        // dataUrl: "data:image/png;base64,..."
        guard let comma = dataUrl.firstIndex(of: ",") else {
            FileHandle.standardError.write(Data("invalid dataUrl\n".utf8))
            throw ExitCode.failure
        }
        let b64 = String(dataUrl[dataUrl.index(after: comma)...])
        guard let png = Data(base64Encoded: b64) else {
            FileHandle.standardError.write(Data("base64 decode failed\n".utf8))
            throw ExitCode.failure
        }
        let outPath: String = {
            if let o = out { return (o as NSString).expandingTildeInPath }
            return (try? defaultScreenshotPath(tabLabel: target.tab ?? "tab-\(tabId)")) ?? "/tmp/abg-screenshot-\(tabId)-\(Int(Date().timeIntervalSince1970)).png"
        }()
        try png.write(to: URL(fileURLWithPath: outPath))
        try outPath.write(to: latestScreenshotMarker(), atomically: true, encoding: .utf8)
        let resultJson: [String: Any] = ["path": outPath, "bytes": png.count]
        printJSON(resultJson)
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
        printJSON(result)
    }
}

struct Fill: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "input/textarea にテキスト入力 (selector 必須)")
    @OptionGroup var target: TabTarget
    @Option(name: .long, help: "対象の CSS selector") var selector: String
    @Option(name: .long, help: "入力する値") var value: String

    func run() async throws {
        let client = UDSClient()
        let tabId = try resolveTabId(client: client, target: target)
        let result = try client.call(method: "fill_tab", params: ["tabId": tabId, "selector": selector, "value": value])
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

        if let installed = installedVersion, installed == version {
            print("up-to-date: \(dest.path) (v\(version))")
            return
        }

        if let installed = installedVersion, installed != version, noUpgrade {
            print("skipped: installed v\(installed), bundled v\(version) at \(dest.path). Re-run without --no-upgrade to overwrite.")
            return
        }

        try SkillBundle.markdown.write(to: dest, atomically: true, encoding: .utf8)
        if let installed = installedVersion {
            print("upgraded: v\(installed) -> v\(version) at \(dest.path)")
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
