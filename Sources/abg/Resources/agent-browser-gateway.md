---
name: agent-browser-gateway
version: 0.3.6
description: 普段使いの Chrome タブを per-tab 明示許可で AI に渡すゲートウェイ。ユーザーが「いま見てる画面を見て」「このタブの DOM/スクショ/コンソールを取って」「ここをクリックして」のように現在の Chrome タブの内容や操作に言及したとき、`abg` CLI で共有中タブを観測・操作する
---

# Agent Browser Gateway

ユーザーは Chrome 拡張アイコンをクリックして「このタブを共有」を**明示的に許可**したタブだけを、`abg` CLI 経由で参照できる。許可されていないタブには触れない (エラーになる)。

## 基本フロー

1. `abg status` で Gateway が起動しているか確認 (running: true なら OK)
2. `abg tabs --compact` で共有中タブの ref (`t1` など) と URL を確認
3. 必要に応じて `abg read <ref>` / `abg screenshot <ref>` / `abg annotate <ref>` / `abg console <ref>` を呼ぶ
4. タブが共有されていない場合は、ユーザーに「Chrome 拡張のアイコンをクリックして対象タブを共有してください」と案内する

## CLI コマンド

```bash
# 観測系
abg status                              # Gateway 起動状況、接続中拡張、共有タブ数
abg tabs --compact                      # 共有中タブ一覧 (ref/tabId/title/url)
abg inspect                             # status + tabs をまとめて確認
abg read <tab|ref> [--selector "<css>"] [--format markdown|text|html|json]
abg screenshot <tab|ref> [--out <path>] [--x N --y N --width N --height N]  # 全体 or 領域
abg screenshot --latest                 # 最後に保存したスクショパス
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
abg fill <tab|ref> --selector "<css>" --value "<text>"  # input/textarea/contenteditable に入力
abg fill <tab|ref> --selector "<css>" --value "<text>" --dry-run
abg replace-editable <tab|ref> --selector "<css>" --text-file payload.txt
abg paste <tab|ref> --selector "<css>" --value "<text>"  # Clipboard + native paste for rich editors
abg clear <tab|ref> --selector "<css>"           # Clear an editable target before paste
abg replace <tab|ref> --selector "<css>" --html "<span>...</span>"  # 現在のタブ上で一時的に DOM 差し替え
abg upload <tab|ref> --selector "input[type=file]" --file "/path/to/file.zip"
abg type <tab|ref> "<text>"              # 現在フォーカスにテキスト送信 (Sheets セル等)
abg key <tab|ref> <key> [--modifiers ctrl,shift] # キー入力 (Enter/Space/ArrowDown/a 等)
abg keydown <tab|ref> Shift              # keyDown のみ。hold-key 操作用
abg keyup <tab|ref> Shift                # keyUp のみ
abg keyboard inserttext <tab|ref> "<text>"       # keydown/char/keyup なしで直接 text insert
abg navigate <tab|ref> "<url>"           # タブを遷移 (別 origin で許可失効)
abg scroll <tab|ref> [--dy 800] [--dx 0] [--at-x N --at-y N]  # ホイールスクロール (内側 div も可)
abg drag <tab|ref> --from-selector ".a" --to-selector ".b"    # DnD

# 待機系
abg wait <tab|ref> --selector "<css>"            # 要素が出現するまで (デフォルト 10s)
abg wait <tab|ref> --selector "<css>" --hidden   # 要素が消えるまで
abg wait <tab|ref> --ms 1500                     # 単純 sleep

# 反復フロー
abg record <tab|ref> --out flow.json             # Ctrl+C まで CLI 由来操作を記録
abg replay flow.json --dry-run                   # 実行前プレビュー
abg replay flow.json --match-url "*kintone*"     # flow を再生

# 管理系
abg revoke <tab|ref>                    # タブの共有を解除
abg audit [--lines 50]                  # 監査ログ閲覧
abg plugin list                         # plugin 一覧
abg plugin install user/repo --yes      # user plugin を ~/.abg/plugins に追加
abg <plugin> <command> [--key value | --flag | --stdin | --json '{"...":"..."}']
```

## Authoring a user plugin

Use a user plugin when a repeated ABG workflow needs a stable local command or a site-specific transform.
User plugins live under `~/.abg/plugins/<name>/`. First-party bundled plugins live under
`Agent Browser Gateway.app/Contents/Resources/plugins/` and, in this repo, under `plugins/`.

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
- `abg.registerCommand(name, handler)` registers a dynamic CLI command in v0.3.6. The handler
  signature is `(args, context) => result | Promise<result>`.
- `context.plugin.name` is always present. `context.plugin.version` is present when the manifest has
  `version`. `context.tabId` is present only when the caller passes `--tab-id`; do not assume a shared
  tab exists otherwise.
- `context.tab.<action>(options)` exposes Promise-based tab primitives when `context.tabId` exists:
  `paste`, `clear`, `fill`, `click`, `key`, `read`, `describe`, `wait`, and `screenshot`.
  See `docs/PLUGINS.md` for the full Tab API surface and examples.

Invoke commands as dynamic ABG subcommands:

```bash
abg hello greet --name "world"
abg hello greet --json '{"name":"world","loud":true}'
printf '{"name":"world"}' | abg hello greet --stdin
abg hello --help
abg plugin list
```

`--key value` becomes a string/number/boolean value in `args`, `--flag` becomes `true`, JSON
`--stdin` and `--json` merge object values into `args`, and non-JSON stdin is passed as
`args.stdin`. `abg <plugin> --help` shows manifest-driven command and arg specs. `abg plugin list`
prefers the running Gateway view and shows registered commands per plugin; use `--local-only` only
when you need filesystem metadata without the daemon.

Audit logs for plugin commands record `argsKeys` and `argsBytes` only. Argument values are never
recorded. Plugin authors must preserve that invariant by not echoing argument values into `abg.log`.

Plugins can drive a shared tab directly through `context.tab` when the command is invoked with
`--tab-id`:

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

Plugin-issued tab actions use the same Gateway dispatch path as normal ABG primitives. Do not shell
out from plugin JavaScript, bypass per-tab consent, or log raw argument values.

Minimal worked example mirroring the bundled `plugins/info-plugin` `ping` command. See
`plugins/info-plugin/index.js` and `plugins/info-plugin/plugin.json` in this repo for the first-party
example.

```js
// ~/.abg/plugins/hello-plugin/index.js
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

## 注意点

- `abg` の出力は基本 JSON。値を取り出すときは `jq` 等でパースする
- `abg tabs` の結果が空なら、まずユーザーに共有を依頼する。**勝手にタブを覗こうとしない**
- `tabId` は Chrome 内部のタブ ID で、ブラウザ再起動で変わる。通常は `abg tabs --compact` の `ref` (`t1` など) か `--match-url` / `--match-title` を使う
- 共有はユーザーが明示的に許可した時だけ。CLI から `permit` で勝手に許可することはできない
- screenshot / console / click_at / type / key は Chrome の DevTools Protocol を使うため、対象タブには「このタブはデバッグ中です」の黄色バーが表示される (透明性の担保)
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
- `replace` は外部ページを永続変更しない。一時的な DOM 差し替えで、承認付き write operation として扱う。注釈コメントが「このロゴを変えて」のような DOM 見た目変更なら、注釈の `selector` / `element.selector` を使って `abg replace <ref> --selector ... --html ...` を使える
- ページ遷移後など要素出現を待つときは `abg wait <tabId> --selector "..."` を使う。`sleep` を bash で書かない
- read は出力が大きいので、可能なら `--selector` で絞るか `--format markdown` / `--format text` で圧縮する。token 効率に直結
- `--format markdown` は generic `markdown-plugin` を使う。共有タブ URL が `notion.so` / `notion.site` に一致する場合は bundled `notion-plugin` が先に適用され、Notion の sidebar/topbar/popover 等を落としてから Markdown 化する
