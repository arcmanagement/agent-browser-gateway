---
name: agent-browser-gateway
version: 0.4.5
description: 普段使いの Chrome タブは per-tab 明示許可、隔離プロファイルでは opt-in の all-tabs mode で AI に渡すゲートウェイ。ユーザーが「いま見てる画面を見て」「このタブの DOM/スクショ/コンソールを取って」「ここをクリックして」のように現在の Chrome タブの内容や操作に言及したとき、`abg` CLI で共有中タブを観測・操作する
---

# Agent Browser Gateway

ユーザーは Chrome 拡張アイコンをクリックして「このタブを共有」を**明示的に許可**したタブだけを、`abg` CLI 経由で参照できる。許可されていないタブには触れない (エラーになる)。

例外として、隔離した Chrome プロファイル / sandbox マシンでは、拡張 popup の `Share all tabs in this profile` をユーザーが明示的に ON にできる。この場合のみ Chrome の optional `<all_urls>` 権限を要求し、`abg tabs` に `accessMode: "all_tabs"` のタブが並ぶ。普段使いプロファイルでは per-tab 明示許可を前提にする。

## 基本フロー

1. `abg status` で Gateway が起動しているか確認 (running: true なら OK)
2. `abg tabs --compact` で共有中タブの安定 ref (`t1` など)、profile、URL、`accessMode` を確認
3. 必要に応じて `abg read <ref>` / `abg screenshot <ref>` / `abg annotate <ref>` / `abg console <ref>` を呼ぶ
4. タブが共有されていない場合は、ユーザーに「Chrome 拡張のアイコンをクリックして対象タブを共有してください」と案内する

## CLI コマンド

```bash
# 観測系
abg status                              # Gateway 起動状況、接続中拡張、共有タブ数
abg tabs --compact                      # 共有中タブ一覧 (ref/tabId/title/url/accessMode)
abg inspect                             # status + tabs をまとめて確認
abg raise <tab|ref>                     # 共有済みタブをアクティブ化し、既存ウィンドウを前面化
abg bookmarks list                      # browser-owned personal data。別途 Bookmarks access が必要
abg bookmarks search "reference"        # 明示許可後に bookmark title/URL を検索
abg bookmarks get <bookmark-id>
abg bookmarks open <bookmark-id>        # 保存済み URL を明示コマンドで開く
abg reading-list list                   # Chrome 120+ chrome.readingList。別途 Reading List access が必要
abg reading-list search "saved page"
abg read <tab|ref> [--selector "<css>"] [--format markdown|text|html|json]
abg read <tab|ref> --selector "<css>" --editable-value
abg get text <tab|ref> "<css>"          # text/html/value/attr/title/url/count/box/styles
abg get editable-value <tab|ref> "<css>"
abg get attr <tab|ref> "<css>" --name href
abg get styles <tab|ref> "<css>" --props display,color
abg frames <tab|ref>                         # iframe/frame refs (@f1, @f2, ...)
abg read <tab|ref> --frame @f1 --selector "<css>"
abg find role <tab|ref> button click --name "Submit"
abg find text <tab|ref> "Welcome" text
abg find label <tab|ref> "Email" fill --value "me@example.com"
abg find first <tab|ref> "button" click
abg find nth <tab|ref> 2 ".result" text          # zero-based index
abg snapshot <tab|ref> --interactive-only --compact
abg snapshot --tabs "post:t1:.editor,preview:t2:main,template:t3:.template"
abg click <tab|ref> --ref @e1                    # 最新 snapshot の ref
abg is-visible <tab|ref> --selector "<css>"      # false も正常JSONで返す
abg is-enabled <tab|ref> --selector "<css>"
abg is-checked <tab|ref> --selector "<css>"
abg screenshot <tab|ref> [--out <path>] [--x N --y N --width N --height N]  # 全体 or 領域
abg pdf <tab|ref> --out page.pdf         # 現在ページを PDF 保存
abg wait-response <tab|ref> --url "*api/save*" --method POST --status-min 200 --status-max 299
abg wait-response <tab|ref> --url-regex "/api/items/\\d+$" --body --max-bytes 8192
abg network <tab|ref> --wait-response --url "*api/save*" --method POST --status-min 200 --status-max 299
abg network <tab|ref> --wait-response --url-regex "/api/items/\\d+$" --body --max-bytes 8192
abg har <tab|ref> --out /tmp/session.har         # redacted one-shot HAR export
abg state <tab|ref> --kind cookies --name "sid*" # cookie/storage keys; values redacted
abg state <tab|ref> --kind local-storage --key "user*" --values
abg framework <tab|ref> --kind react             # React tree when hooks are available
abg framework <tab|ref> --kind web-vitals        # Performance/Web Vitals snapshot
abg sandbox <tab|ref> viewport --width 390 --height 844 --mobile
abg sandbox <tab|ref> storage-set --storage local-storage --key feature --value on
abg download <tab|ref>                   # tab に紐づく download metadata
abg download <tab|ref> --wait --timeout 30000
abg dialog <tab|ref>                     # pending alert/confirm/prompt を確認
abg dialog <tab|ref> --accept            # 承認して accept
abg dialog <tab|ref> --dismiss           # 承認して dismiss
abg dialog <tab|ref> --prompt-value "ok" # 承認して prompt text を送信
abg screenshot --latest                 # 最後に保存したスクショパス
abg record start <tab|ref> [--mic] [--out out.webm] # 共有中タブを webm 録画 (tab audio、--mic で部屋の音も録音)
abg record stop                         # 録画を停止し、webm の path/bytes/duration を返す
abg record status                       # 現在の録画状態を確認
abg annotate <tab|ref> [--start|--stop|--clear]  # Area/Text 注釈 overlay。DOM/スクショを自動判定
abg annotate <tab|ref> [--format json|text]      # 現在の注釈一覧を取得
abg annotate <tab|ref> --selector "<css>" --comment "..."  # DOM 注釈を明示追加
abg annotate <tab|ref> --x N --y N --width N --height N --comment "..." [--out shot.png]
abg console <tab|ref>                   # console ログ
abg table <tab|ref> [--selector "table"] [--format json|markdown]  # HTML table 抽出
abg describe <tab|ref> [--grid 10x10]   # クリック可能要素の bbox/selector
abg network <tab|ref> [--url "*api*"] [--status-min 400]  # Network ログ

# tab 指定ショートカット
abg read --match-url "*kintone*" --format markdown
abg click --match-title "アプリ管理" --selector "button.save"

# 操作系
abg click <tab|ref> --selector "<css>"           # CSS selector でクリック
abg click <tab|ref> --id <n>                     # describe の id でクリック
abg click <tab|ref> --x <px> --y <px>            # 座標でクリック (canvas にも有効)
abg dblclick <tab|ref> --selector "<css>"        # CSS selector でダブルクリック
abg focus <tab|ref> --selector "<css>"           # クリックせず focus する
abg hover <tab|ref> --selector "<css>"           # 要素中心へ mouseMoved
abg select <tab|ref> --selector "select" --value "x"
abg select <tab|ref> --selector "select" --label "Visible label"
abg check <tab|ref> --selector "input[type=checkbox]"
abg uncheck <tab|ref> --selector "input[type=checkbox]"
abg fill <tab|ref> --selector "<css>" --value "<text>"  # input/textarea/contenteditable に入力
abg fill <tab|ref> --selector "<css>" --value "<text>" --dry-run
abg fill <tab|ref> --selector "<css>" --value "<text>" --diff
abg replace-editable <tab|ref> --selector "<css>" --text-file payload.txt
abg replace-editable <tab|ref> --selector "<css>" --text-file payload.txt --diff
abg paste <tab|ref> --selector "<css>" --value "<text>"  # Clipboard + native paste for rich editors
abg clipboard-write --mime "text/html" --value "<b>Hello</b>"
abg paste-rich <tab|ref> --selector "<css>"      # Native paste with the current rich clipboard
abg paste-rich <tab|ref> --mime "application/x-vnd.google-docs-sheets-clip+wrapped" --file sheets.clip
abg clear <tab|ref> --selector "<css>"           # Clear an editable target before paste
abg replace <tab|ref> --selector "<css>" --html "<span>...</span>"  # 現在のタブ上で一時的に DOM 差し替え
abg upload <tab|ref> --selector "input[type=file]" --file "/path/to/file.zip"
abg upload <tab|ref> --selector "input[type=file]" --file a.png --file b.png  # 複数ファイル (input に multiple 属性が必要)
abg type <tab|ref> "<text>"              # 現在フォーカスにテキスト送信 (Sheets セル等)
abg key <tab|ref> <key> [--modifiers ctrl,shift] # キー入力 (Enter/Space/ArrowDown/a 等)
abg keydown <tab|ref> Shift              # keyDown のみ。hold-key 操作用
abg keyup <tab|ref> Shift                # keyUp のみ
abg keyboard inserttext <tab|ref> "<text>"       # keydown/char/keyup なしで直接 text insert
abg exec-command <tab|ref> --command insertText --value $'line1\nline2'  # focused edit-mode target
printf 'line1\nline2\n' | abg exec-command <tab|ref> --command insertText --stdin
abg exec-command <tab|ref> --command selectAll   # allowlist: insertText/delete/selectAll/undo/redo
abg navigate <tab|ref> "<url>"           # タブを遷移 (別 origin で許可失効)
abg scroll <tab|ref> [--dy 800] [--dx 0] [--at-x N --at-y N]  # ホイールスクロール
abg scroll <tab|ref> --selector ".scroll-pane" --dy -5000  # virtual list の内側 scrollable element を直接 scrollBy。動かなければ scrollable な子孫/祖先へ fallback し、moved/movedX/movedY を返す。moved: false + warning なら別手段に切り替える
abg scroll-into-view <tab|ref> --selector "<css>" # 要素を viewport 中央へスクロール
abg drag <tab|ref> --from-selector ".a" --to-selector ".b"    # DnD

# 待機系
abg wait <tab|ref> --selector "<css>"            # 要素が出現するまで (デフォルト 10s)
abg wait <tab|ref> --selector "<css>" --hidden   # 要素が消えるまで
abg wait <tab|ref> --ms 1500                     # 単純 sleep
abg wait <tab|ref> --text "Welcome"
abg wait <tab|ref> --url "**/dashboard"
abg wait <tab|ref> --load networkidle            # networkidle / load / domcontentloaded
abg wait <tab|ref> --load networkidle --selector ".ready"  # network idle 後に selector visible を待つ
abg wait <tab|ref> --fn "window.ready === true"  # readiness predicate only, not general eval
abg eval <tab|ref> --script "return window.__STATE__" --timeout 75000 --approve  # AutoMode OFF では --approve + popup 承認が必要
abg eval <tab|ref> --script-file task.js --timeout 120000 --approve
abg stream enable <tab|ref>                      # local ws://127.0.0.1:8765/stream
abg stream status
abg stream disable
abg validate editable <tab|ref> --selector "<css>" --rules html-attrs,shortcodes
abg validate editable <tab|ref> --selection

# 反復フロー
abg record flow <tab|ref> --out flow.json        # Ctrl+C まで CLI 由来操作を記録
abg record <tab|ref> --out flow.json             # flow は default subcommand。既存互換
abg replay flow.json --dry-run                   # 実行前プレビュー
abg replay flow.json --match-url "*kintone*"     # flow を再生

# 管理系
abg revoke <tab|ref>                    # タブの共有を解除
abg audit [--lines 50]                  # 監査ログ閲覧
abg activity --period day|week          # ローカルの日次/週次 activity digest
abg mcp-server                          # 同じ abg CLI を包む stdio MCP server
abg plugin list                         # plugin 一覧
abg plugin install user/repo --yes      # repo URL / user/repo から user plugin を追加
abg plugin reload [name]                # Gateway 再起動なしで plugin を再読み込み
abg <plugin> <command> [--key value | --flag | --stdin | --json '{"...":"..."}']
```

`abg activity` は opt-in の local-only 要約。on-device audit log から action、tab ID、origin、
timestamp、approval outcome を集計し、貼り付け値、clipboard payload、plugin args、raw audit
details は出さない。正確なイベント列が必要な debug / review では `abg audit` を使う。

`abg record start` は通常操作の承認設定に関係なく必ず approval window を出す。タブ音声と、
`--mic` 指定時は物理的な部屋の音も扱うため、silent auto-approval にはしない。Allow のクリックは
Chrome の `tabCapture.getMediaStreamId` に必要な user gesture も兼ねる。録画中は対象タブに赤い
`REC` badge が出る。詳細な設計と実機確認手順は `docs/RECORDING.md` を参照する。

`abg bookmarks` と `abg reading-list` は共有タブの page state ではなく、browser-owned personal
data を扱う。拡張 popup の `Bookmarks access` / `Reading List access` を別々に ON にした時だけ
使う。Reading List は Chrome 120+ の `chrome.readingList` がある browser だけ対応し、非対応
browser では明示的な unsupported error を返す。audit log は command boundary、件数、id、
query byte length を残すが、保存済み URL 全文は残さない。

## Authoring a user plugin

Use a user plugin when a repeated ABG workflow needs a stable local command or a site-specific transform.
User plugins live under `~/.abg/plugins/<name>/` by default (`~/.abg-dev/plugins/<name>/`
for `ABG_PORT=8766` dev runs). First-party bundled plugins live under
`Agent Browser Gateway.app/Contents/Resources/plugins/` and, in this repo, under `plugins/`.
The macOS plugin browser and `abg plugin install` both accept `user/repo`, HTTPS GitHub URLs, SSH
Git URLs, or local directories. Private repositories use local git authentication such as SSH keys,
git credential helpers, or GitHub CLI-backed credentials; ABG does not store GitHub tokens.
The plugin browser can update or uninstall only user plugins under that directory. Built-in plugins
come from the app bundle, and Local Dev plugins are external working copies, so the browser never
removes them.
User plugins can also be disabled without deleting their directories. Disabled state is stored as
profile-local filesystem state in `plugin-state.json` under `~/.abg/` or `~/.abg-dev/`; ABG does not
use an app database for plugin enablement.

Recommended layout:

```text
hello-plugin/
  index.js      # required
  plugin.json   # recommended for help/list metadata
  README.md     # encouraged for human context
```

`plugin.json` describes the plugin for `abg plugin list`, `abg <plugin> --help`, and command help:

```json
{
  "name": "hello",
  "version": "0.1.0",
  "author": "your-name",
  "description": "Minimal ABG command plugin.",
  "domains": ["https://example.com/*"],
  "transforms": ["example-clean-markdown"],
  "commands": [
    {
      "name": "greet",
      "description": "Return a greeting.",
      "args": [
        { "name": "name", "type": "string", "required": false, "default": "ABG" },
        { "name": "loud", "type": "boolean", "required": false, "default": false }
      ]
    }
  ]
}
```

Command arg `type` may be `"string"`, `"boolean"`, `"number"`, or `"object"`. Registering the command
in `index.js` is the source of truth; manifest command metadata is for discovery and help.

The host API available in `index.js` is intentionally small:

```js
abg.log("loaded " + abg.plugin.name + " on ABG " + abg.version);

abg.registerTransform("example-clean-markdown", function (input) {
  return String(input).trim();
});

abg.registerCommand("greet", async function (args, context) {
  const name = args.name || "ABG";
  const message = args.loud ? ("HELLO, " + name).toUpperCase() : "Hello, " + name;
  return {
    ok: true,
    message,
    plugin: context.plugin.name,
    pluginVersion: context.plugin.version || null
  };
});
```

- `abg.log(msg)` writes a plugin startup/runtime line to stderr. Do not log prompts, credentials,
  payloads, or raw argument values.
- `abg.plugin.name`, `abg.plugin.version`, and `abg.version` expose plugin/Gateway metadata.
- `abg.registerTransform(name, fn)` registers a synchronous string-to-string transform. Domain
  Markdown transforms declared in `plugin.json` can run before generic `read --format markdown`.
- `abg.registerCommand(name, handler)` registers a dynamic CLI command. The handler
  signature is `(args, context) => result | Promise<result>`.
- `context.plugin.name` is always present. `context.plugin.version` is present when the manifest has
  `version`. `context.tabId` is present when the caller passes `--tab-id` / `--tab` / `--match-url`,
  or when the Gateway can auto-bind exactly one shared tab matching the plugin manifest `domains`.
  Zero matches returns `no_matching_tab`; multiple matches returns `ambiguous_tab` with candidates.
- `context.tab.<action>(options)` exposes Promise-based tab primitives when `context.tabId` exists:
  `paste`, `clear`, `fill`, `click`, `key`, `read`, `describe`, `wait`, `screenshot`, and `navigate`.
  See `docs/PLUGINS.md` for the full Tab API surface and examples.

Invoke commands as dynamic ABG subcommands:

```bash
abg hello greet --name "world"
abg hello greet --tab t1
abg hello greet --match-url "*example.com*"
abg hello greet --json '{"name":"world","loud":true}'
printf '{"name":"world"}' | abg hello greet --stdin
abg hello --help
abg plugin list
abg plugin reload hello
```

Both ABG skills (`agent-browser-gateway` for ABG usage and `abg-plugin-creator` for scaffolding ABG
plugins) are installed and updated with the skills CLI: `npx skills add arcmanagement/agent-browser-gateway -g`.

`abg mcp-server` starts a stdio MCP server for Codex, Claude Code, and other MCP clients. It exposes
one `abg_cli` tool that accepts argv tokens after `abg`, for example `{"args":["tabs","--compact"]}`.
The wrapper launches the local CLI as a child process, so tab sharing, operation approval, audit
logging, and plugin execution stay on the same permission boundary. Codex config:

```toml
[mcp_servers.abg]
command = "abg"
args = ["mcp-server"]
```

Claude Code:

```bash
claude mcp add abg -- abg mcp-server
```

`--key value` becomes a string/number/boolean value in `args`, `--flag` becomes `true`, JSON
`--stdin` and `--json` merge object values into `args`, and non-JSON stdin is passed as
`args.stdin`. `abg <plugin> --help` shows manifest-driven command and arg specs. `abg plugin list`
prefers the running Gateway view and shows registered commands per plugin; use `--local-only` only
when you need filesystem metadata without the daemon. `abg plugin reload [name]` re-reads
`index.js` and `plugin.json` without quitting ABG.app, preserving current tab shares. A failed reload
keeps the previous loaded version active.

Audit logs for plugin commands record `argsKeys`, `argsBytes`, and tab binding mode only. Argument values are never
recorded. Plugin authors must preserve that invariant by not echoing argument values into `abg.log`.

Use `abg clipboard-write` and `abg paste-rich` for app-specific clipboard formats such as Google
Sheets wrapped cell payloads or Figma layer payloads. The combined `paste-rich --mime ... --file`
form writes the clipboard and pastes into the shared tab while auditing only the MIME type and byte
length, not the raw clipboard payload. For Google Sheets edit-mode cells, focus the target cell and
run `abg paste-rich t1 --mime "application/x-vnd.google-docs-sheets-clip+wrapped" --file
sheets-multiline-cell.clip`. For rich editors that accept HTML clipboard data, run `abg paste-rich
t1 --selector '[contenteditable="true"]' --mime "text/html" --value '<p>First
line</p><p><strong>Second line</strong></p>'`.

Use `abg exec-command` only after focusing the actual edit-mode surface, such as a double-clicked
Google Sheets cell or a contenteditable rich editor. `insertText` preserves multiline values through
the browser editing path; audit logs record the command and value byte length, not the inserted text.

Use `abg read <tab> --format markdown --redact` only when opt-in local masking is desired. The
bundled `redaction` plugin masks common email, phone-like, and credit-card-like strings. Add
repeatable `--redact-regex '<pattern>'` for caller-supplied deterministic masks. Redaction audit logs
record transform names and regex count, not raw matched values.

Plugins can drive a shared tab directly through `context.tab` when the command has a tab context:

```js
abg.registerCommand("clear-and-paste", async function (args, context) {
  if (context.tabId == null) {
    return { ok: false, error: "no_tab_context" };
  }
  await context.tab.clear({ selector: args.selector });
  await context.tab.paste({ selector: args.selector, value: args.value });
  return { ok: true };
});
```

Bundled command examples include `workflow clear-and-paste` and `workflow read-wait-click`. Treat
plugin command output as JSON with stable keys, and keep raw argument values out of logs.

Plugin-issued tab actions use the same Gateway dispatch path as normal ABG primitives. Do not shell
out from plugin JavaScript, bypass ABG's configured tab access mode, or log raw argument values.

Minimal worked example mirroring the bundled `plugins/info-plugin` `ping` command. See
`plugins/info-plugin/index.js` and `plugins/info-plugin/plugin.json` in this repo for the first-party
example.

```js
// ~/.abg/plugins/hello-plugin/index.js (or ~/.abg-dev/plugins/... in a dev run)
abg.registerCommand("greet", async function (args, context) {
  const name = args.name || "ABG";
  return {
    ok: true,
    message: "Hello, " + name,
    plugin: context.plugin.name
  };
});
```

```json
{
  "name": "hello",
  "version": "0.1.0",
  "author": "your-name",
  "description": "Minimal ABG command plugin.",
  "domains": [],
  "transforms": [],
  "commands": [
    {
      "name": "greet",
      "description": "Return a greeting.",
      "args": [
        { "name": "name", "type": "string", "required": false, "default": "ABG" }
      ]
    }
  ]
}
```

```bash
abg hello greet --name "world"
```

```json
{
  "message": "Hello, world",
  "ok": true,
  "plugin": "hello"
}
```

For deeper details, examples, and installation/update commands, see `docs/PLUGINS.md`.

## ABG learnings を GitHub Discussions に残す

ユーザーに「このABGの学びを残して」「再利用できる形で共有して」と頼まれたら、コード変更が必要な
Issueではなく GitHub Discussions が適切な場合がある。特に、共有済みタブの使い方、同一originでの
API replay、cookieをexportしない調査手順、auditしやすいagent workflowのような再利用レシピは
`arcmanagement/agent-browser-gateway` の Discussions に短く残す。

カテゴリは実際のrepo設定を確認して選ぶ。動く例、再利用レシピ、調査から得た実践知は
`Show and tell` を優先する。仕様提案や未決の設計相談は `Ideas` / `General` 等の近いカテゴリを選び、
質問回答の保存なら `Q&A` 系カテゴリを使う。

投稿前のpublic hygiene checklist:

- local absolute paths、local usernames、machine names、private branch names を削る
- credentials、tokens、cookies、authorization headers、API keys、session IDs を載せない
- customer names、private URLs、internal project names、非公開Slack/Backlog/Chatwork本文を載せない
- raw request bodies / raw response bodies / screenshots that expose private data を貼らない
- コマンド例は必要なら `<repo>`, `<tab-ref>`, `<origin>`, `<redacted>` のように置換する
- ABG固有の学びは「ユーザーが明示共有したtab」「same-origin operation」「local audit log」
  「cookie exportを避ける」の境界で説明する

`gh discussion` が使えない環境では GitHub GraphQL API を使う。まずrepo IDとcategory IDを取得する:

```bash
gh repo view arcmanagement/agent-browser-gateway --json id,nameWithOwner

gh api graphql \
  -f owner=arcmanagement \
  -f name=agent-browser-gateway \
  -f query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    discussionCategories(first: 25) {
      nodes { id name slug }
    }
  }
}'
```

本文をscrub済みのMarkdownとして保存してから投稿する:

```bash
REPO_ID="$(gh repo view arcmanagement/agent-browser-gateway --json id -q .id)"
CATEGORY_ID="<Show and tell category id>"

gh api graphql \
  -f repositoryId="$REPO_ID" \
  -f categoryId="$CATEGORY_ID" \
  -f title="Reusable ABG recipe: replay same-origin API shape from a shared tab" \
  -f body="$(cat discussion.md)" \
  -f query='
mutation($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
  createDiscussion(input: {
    repositoryId: $repositoryId,
    categoryId: $categoryId,
    title: $title,
    body: $body
  }) {
    discussion { url }
  }
}'
```

投稿本文は、何が再利用可能なのか、前提となるABG access mode、使ったCLI primitives、避けた危険な
近道(cookie export、hidden browser state dump、raw payload sharingなど)、最小の再現手順を含める。
既存例として Discussion #208 のように、共有済みtabのoriginを使ってアプリ自身のAPI request shapeを
再現するレシピは `Show and tell` 向け。

## 注意点

- `abg` の出力は基本 JSON。値を取り出すときは `jq` 等でパースする
- `abg tabs` の結果が空なら、まずユーザーに共有を依頼する。**勝手にタブを覗こうとしない**
- `abg tabs --compact` の `ref` は Gateway 起動中の pin 相当で、profile と Chrome tabId の組へ固定される。他のタブが増減しても同じ ref を連続操作に使う。Gateway 再起動、タブ close、共有 revoke、別 origin 遷移後は一覧を取り直す
- `tabId` は Chrome profile 内の ID で、複数 profile では同じ値が衝突しうる。衝突時は `ambiguous_tab_id` になるため、通常は安定 `ref` か `--match-url` / `--match-title` を使う
- `abg raise <tab|ref>` は共有済みタブと、そのタブを含む既存ウィンドウだけを前面化する。未共有 URL の open、新規ウィンドウ作成、全 Chrome タブの URL 検索は行わない。共有失効後は通常の `tab_not_permitted` で失敗する
- iframe 内を対象にする場合は、先に `abg frames <ref>` で `@f1` などの frame ref を確認し、`read` / `get` / `find` / `snapshot` / predicate / wait / selector action に `--frame @f1` を付ける。cross-origin frame は一覧には出るが selector 操作は `frame_not_accessible` で明示的に失敗し、top document へ黙って fallback しない
- `abg fill ... --diff` / `abg replace-editable ... --diff` は high-risk editor change 用。selector scoped text / HTML の hash、length、redacted bounded excerpt を result と local audit log に残す。full before/after content、replacement value、plugin args は default では保存しない
- JavaScript dialog は `abg dialog <ref>` で pending 状態を読む。accept / dismiss / prompt-value は write-like action として通常の operation approval と audit log を通る。pending dialog がなければ `no_dialog_pending` で明示的に失敗する
- Download は `abg download <ref>` / `abg download <ref> --wait` で metadata と Chrome が公開する final path だけを返す。ABG は downloaded file content を読まない。path が取れない場合は `unavailableReason` を確認する
- Network response 待ちは `abg wait-response <ref>` を使う。URL glob / regex、method、status range、type で絞り込む。timeout は `ok: false`, `error: "timeout"` の安定 JSON を返す。response body は `--body` 指定時だけ `--max-bytes` 上限で preview される。headers / response body は audit log に保存しない。`abg network <ref> --wait-response` も互換表記として残す
- HAR export は `abg har <ref> --out file.har` を使う。one-shot / local-only で、cookies、authorization headers、request headers、request bodies、response bodies は default で省略する。`--limit` は最大 1000 件に bounded され、Gateway は tab、filter、byte size、redaction mode、output path を local audit log に記録する
- Cookie / Web Storage inspection は `abg state <ref>` を使う。shared tab origin の cookies / localStorage / sessionStorage を read-only で列挙し、値は default redacted。`--values` を明示した場合だけ full values を返し、Gateway audit log に values requested と count が残る。write/delete は提供しない
- Framework / Web Vitals inspection は `abg framework <ref>` を使う。React は page が compatible React DevTools hook を露出している場合だけ bounded tree を返し、hook がなければ unavailable と DOM marker summary を返す。Web Vitals は Performance API snapshot、SPA navigation は Navigation API がある場合のみ。pre-page-load instrumentation、component patch、telemetry collector は入れない
- Advanced automation parity は `docs/ADVANCED_AUTOMATION_POLICY.md` の mode 境界に従う。normal per-tab / sandbox all-tabs / self-hosted / official non-goal を混同しない。cookie/storage mutation、network mocking、init scripts、emulation、tab/window の作成・閉鎖は normal personal-profile per-tab には出さない。共有済みタブの `raise` は既存ウィンドウの前面化に限定する
- Sandbox browser-owned controls は `abg sandbox <ref> ...` を使う。Gateway は `accessMode: all_tabs` 以外では拒否する。viewport emulation、localStorage/sessionStorage set/delete、sandbox tab create/close は local approval と Gateway audit を通る。mixed personal profile では all-tabs mode を有効にしない
- Official ABG non-goals: ABG-operated cloud relay、ABG operators への telemetry、明示的な per-call approval または Trusted automation / AutoMode なしの hidden general JS execution。#71 の remote pairing は user-controlled Tailnet/LAN path であり ABG-operated relay ではない。self-hosted metrics は user/team-owned endpoint に限定する
- 共有はユーザーが明示的に許可した時だけ。CLI から `permit` で勝手に許可することはできない
- screenshot / console / click_at / type / key は Chrome の DevTools Protocol を使うため、対象タブには「このタブはデバッグ中です」の黄色バーが表示される (透明性の担保)
- `abg eval` は最終手段。通常は `read` / `get` / `find` / `wait --fn` / plugin command を優先する。eval は extension popup で default OFF。Trusted automation / AutoMode OFF では CLI の `--approve` と正確な script を表示する per-call approval が必要。AutoMode ON では共有済み tab に限って approval popup を省略できる。audit には script source、approval mode、result type/bytes summary が残る
- eval の既定 timeout は 75 秒またはそれより長い profile 既定値で、`--timeout` は 1〜300 秒に clamp される。script は 64 KiB 以下を推奨し、256 KiB が hard limit。超過は送信前に `script_too_large`、実行時間超過は `command_timeout` で失敗する。大きな処理は分割するか named primitive / plugin にする
- **Annotation mode**:
  - ユーザーが「ここにコメントした」「注釈を確認して」と言ったら、まず `abg tabs --compact` で ref を確認し、`abg annotate <ref>` で注釈一覧を取得する
  - 注釈には `comment`、`kind` (`dom` / `screenshot` / `text`)、`viewportRect`、`rect` が入る。DOM 注釈なら `selector` / `element.text` / style 情報、Text 注釈なら top-level の `text` と追従用 `textAnchor` メタデータが入る
  - Area 由来の注釈は、安定した DOM を指せる場合は `kind: "dom"`、任意範囲・canvas・動画・曖昧な wrapper は `kind: "screenshot"` になる。Text 由来の注釈は必ず `kind: "text"` として扱い、選択文字列を純粋なテキストデータとして読む
  - `abg annotate <ref> --start` で overlay を出す。ユーザーは Area でドラッグ範囲作成、Text で複数 DOM をまたぐページ本文の選択範囲作成、コメント入力、スクショ注釈の DnD 移動、スクショ注釈の端/角 resize、選択中注釈の Delete/Backspace 削除、Done/Escape で停止ができる。Text 注釈は四角枠ではなくテキスト選択ハイライトとして表示する。DOM / Text 注釈は selector 追従を壊さないため移動/resize できない
  - popup の `Annotate this tab` は overlay 開始後に閉じる。Done 後も注釈は残るので、確認は `abg annotate <ref>` で行う
  - DOM 注釈を深掘りするときは `selector` を使って `abg read <ref> --selector "<selector>"`。スクショ注釈の視覚確認が必要なときだけ `viewportRect` を使って `abg screenshot <ref> --x ... --y ... --width ... --height ...` を保存する
- **canvas ベースのアプリ (Google Sheets, Figma, Google Docs 等) の操作**:
  - まず `abg describe <tab> --grid 10x10` や `abg screenshot <tab>` で座標を把握する
  - DOM ベースの `click --selector` は効かない。`click --x --y` か `click --id` でクリック
  - 文字入力は `type` (Input.insertText 経由)。事前に対象セルにフォーカスを当てる
  - 例: Sheets の D1 チェックボックス ON → describe/screenshot で D1 の座標確認 → `abg click <tab> --x N --y M`
  - もしくは Sheets のキーボードナビ: `abg key <tab> Space` で選択中セルのチェック切替 (要事前にセル選択)
- 操作系 (`click` / `fill` / `replace` / `upload` / `type` / `key` / `navigate` / `scroll` / `drag`) を呼ぶ前に、必ず screenshot/read/describe で**現状を確認**する。盲目的に操作しない
- **ファイル添付は v0.4.3 以降の `abg upload` を使う**。事前に `chrome://extensions` の Agent Browser Gateway 詳細で **Allow access to file URLs** を有効にする。Chrome は debugger による local file 添付にもこの明示許可を適用し、対象 page が HTTP / HTTPS でも必要になる。複数画像は `--file` を繰り返して 1 回の `upload` で渡し、対象 input に `multiple` 属性が必要。selector は top-document の `input[type=file]` を指し、file path は絶対パスかつ browser から読めるものにする。custom upload button は背後の input を `read` / `snapshot` で探す。cross-origin iframe 内や input を公開しない widget は未対応なので、サイトの手動添付 UI を使う。`eval` で `DataTransfer` / `DragEvent` を合成しない
- local file access が無効なら `file_access_required` と recovery step を返す。v0.4.2 以前は transient CDP nodeId が DOM lookup と attach の間に無効化され、同じ raw `{"code":-32000,"message":"Not allowed"}` になる場合もあった。v0.4.3 以降は stable backendNodeId を使い、残る debugger rejection は selector / frame / path の確認を促す `file_attach_failed` になる
- `replace` は外部ページを永続変更しない。一時的な DOM 差し替えで、承認付き write operation として扱う。注釈コメントが「このロゴを変えて」のような DOM 見た目変更なら、注釈の `selector` / `element.selector` を使って `abg replace <ref> --selector ... --html ...` を使える
- ページ遷移後など要素出現を待つときは `abg wait <tabId> --selector "..."` を使う。`sleep` を bash で書かない
- read は出力が大きいので、可能なら `--selector` で絞るか `--format markdown` / `--format text` で圧縮する。token 効率に直結
- `--format markdown` は generic `markdown-plugin` を使う。共有タブ URL が `notion.so` / `notion.site` / Gmail / Slack / Linear に一致する場合は bundled domain plugin が先に適用され、各アプリの chrome を落としてから Markdown 化する。`--redact` を付けた場合だけ bundled `redaction` plugin が Markdown をローカルマスクする
