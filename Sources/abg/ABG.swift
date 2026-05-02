import ArgumentParser
import Foundation
import GatewayCore

@main
struct ABG: AsyncParsableCommand {
    static let configuration = CommandConfiguration(
        commandName: "abg",
        abstract: "Agent Browser Gateway CLI",
        subcommands: [
            Status.self, Tabs.self,
            Read.self, Screenshot.self, Console.self,
            Click.self, Fill.self, Type.self, Key.self, Navigate.self, Scroll.self,
            Wait.self,
            Revoke.self, Audit.self, InstallSkill.self,
        ]
    )
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
    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "list_tabs")
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
    @Argument(help: "tab ID (abg tabs で確認)") var tabId: Int
    @Option(name: .long, help: "対象を絞る CSS selector (例: \"main\", \"#content\")") var selector: String?
    @Flag(name: .long, help: "HTML を Markdown に変換 (token 効率)") var asMarkdown: Bool = false

    func run() async throws {
        let client = UDSClient()
        var params: [String: Any] = ["tabId": tabId]
        if let s = selector { params["selector"] = s }
        if asMarkdown { params["asMarkdown"] = true }
        let result = try client.call(method: "read_tab", params: params)
        printJSON(result)
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
    @Argument(help: "tab ID") var tabId: Int
    @Option(name: .long, help: "出力 PNG パス (省略時 /tmp/abg-screenshot-<tabId>-<ts>.png)") var out: String?
    @Option(name: .long, help: "部分キャプチャ X (px)") var x: Double?
    @Option(name: .long, help: "部分キャプチャ Y (px)") var y: Double?
    @Option(name: .long, help: "部分キャプチャ幅 (px)") var width: Double?
    @Option(name: .long, help: "部分キャプチャ高さ (px)") var height: Double?

    func run() async throws {
        let client = UDSClient()
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
            let ts = Int(Date().timeIntervalSince1970)
            return "/tmp/abg-screenshot-\(tabId)-\(ts).png"
        }()
        try png.write(to: URL(fileURLWithPath: outPath))
        let resultJson: [String: Any] = ["path": outPath, "bytes": png.count]
        printJSON(resultJson)
    }
}

struct Console: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "共有中タブの console ログ")
    @Argument(help: "tab ID") var tabId: Int

    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "console_tab", params: ["tabId": tabId])
        printJSON(result)
    }
}

// MARK: - Operation tools (v0.1.1)

struct Click: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "要素をクリック (CSS selector または xy 座標)")
    @Argument(help: "tab ID") var tabId: Int
    @Option(name: .long, help: "クリック対象の CSS selector") var selector: String?
    @Option(name: .long, help: "X 座標 (px、ビューポート左上から)") var x: Double?
    @Option(name: .long, help: "Y 座標") var y: Double?

    func run() async throws {
        let client = UDSClient()
        var params: [String: Any] = ["tabId": tabId]
        if let s = selector { params["selector"] = s }
        if let xx = x { params["x"] = xx }
        if let yy = y { params["y"] = yy }
        guard selector != nil || (x != nil && y != nil) else {
            FileHandle.standardError.write(Data("specify either --selector or both --x and --y\n".utf8))
            throw ExitCode.failure
        }
        let result = try client.call(method: "click_tab", params: params)
        printJSON(result)
    }
}

struct Fill: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "input/textarea にテキスト入力 (selector 必須)")
    @Argument(help: "tab ID") var tabId: Int
    @Option(name: .long, help: "対象の CSS selector") var selector: String
    @Option(name: .long, help: "入力する値") var value: String

    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "fill_tab", params: ["tabId": tabId, "selector": selector, "value": value])
        printJSON(result)
    }
}

struct Type: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "現在フォーカスがある場所にテキストを送る (canvas 等にも有効)")
    @Argument(help: "tab ID") var tabId: Int
    @Argument(help: "送信するテキスト") var text: String

    func run() async throws {
        let client = UDSClient()
        let result = try client.call(method: "type_tab", params: ["tabId": tabId, "text": text])
        printJSON(result)
    }
}

struct Key: AsyncParsableCommand {
    static let configuration = CommandConfiguration(abstract: "キー入力 (Enter / Space / ArrowDown / 単一文字 等)")
    @Argument(help: "tab ID") var tabId: Int
    @Argument(help: "キー名 (例: Enter, Space, ArrowDown, a)") var key: String
    @Option(name: .long, help: "modifiers をカンマ区切り (alt,ctrl,cmd,shift)") var modifiers: String?

    func run() async throws {
        let client = UDSClient()
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
    @Argument(help: "tab ID") var tabId: Int
    @Argument(help: "遷移先 URL") var url: String

    func run() async throws {
        let client = UDSClient()
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
    @Argument(help: "tab ID") var tabId: Int
    @Option(name: .long, help: "縦 delta px (正で下、負で上、デフォルト 0)") var dy: Double = 0
    @Option(name: .long, help: "横 delta px (正で右、負で左、デフォルト 0)") var dx: Double = 0
    @Option(name: .long, help: "ホイール位置 X (省略時ビューポート中央)") var atX: Double?
    @Option(name: .long, help: "ホイール位置 Y (省略時ビューポート中央)") var atY: Double?

    func run() async throws {
        let client = UDSClient()
        var params: [String: Any] = ["tabId": tabId, "deltaX": dx, "deltaY": dy]
        if let v = atX { params["atX"] = v }
        if let v = atY { params["atY"] = v }
        let result = try client.call(method: "scroll_tab", params: params)
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
    @Argument(help: "tab ID") var tabId: Int
    @Option(name: .long, help: "待つ CSS selector") var selector: String?
    @Flag(name: .long, help: "selector が消えるのを待つ (デフォルトは現れるのを待つ)") var hidden: Bool = false
    @Option(name: .long, help: "固定 sleep ミリ秒 (selector を使わないとき)") var ms: Int?
    @Option(name: .long, help: "selector のタイムアウト ms (デフォルト 10000)") var timeout: Int = 10_000

    func run() async throws {
        let client = UDSClient()
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
    @Argument(help: "tab ID") var tabId: Int

    func run() async throws {
        let client = UDSClient()
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
        abstract: "Claude Code 用 Skill を ~/.claude/skills/ にインストール (デフォルトで上書き、ABG バージョンに追従)"
    )
    @Flag(name: .long, help: "古いバージョンでも上書きしない (通常は不要)") var noUpgrade: Bool = false

    func run() async throws {
        let dir = ABGConstants.skillsDir
        try FileManager.default.createDirectory(at: dir, withIntermediateDirectories: true)
        let dest = dir.appendingPathComponent("agent-browser-gateway.md")

        let bundledVersion = SkillBundle.version
        let installedVersion = readInstalledVersion(at: dest)

        if let installed = installedVersion, installed == bundledVersion {
            print("up-to-date: \(dest.path) (v\(bundledVersion))")
            return
        }

        if let installed = installedVersion, installed != bundledVersion, noUpgrade {
            print("skipped: installed v\(installed), bundled v\(bundledVersion). Re-run without --no-upgrade to overwrite.")
            return
        }

        try SkillBundle.markdown.write(to: dest, atomically: true, encoding: .utf8)
        if let installed = installedVersion {
            print("upgraded: v\(installed) -> v\(bundledVersion) at \(dest.path)")
        } else {
            print("installed: v\(bundledVersion) at \(dest.path)")
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
