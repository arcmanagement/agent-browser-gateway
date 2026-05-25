# Agent Browser Gateway (ABG)

> **Bridge your browser to AI agents — without giving up control.**

[![CI](https://github.com/arcmanagement/agent-browser-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/arcmanagement/agent-browser-gateway/actions/workflows/ci.yml)

Patent Pending: JP 2026-080620

- 🔓 **Per-tab consent** — You decide which tabs your agent sees, and for how long
- 🌐 **Any agent** — Works with Claude Code, Codex, Cursor, Cline, or any tool that can run a shell command
- 📖 **Fully open source** — Every line of code that touches your browser is auditable
- 🚫 **Zero telemetry** — No analytics. No phone-home. No cloud dependency
- 💻 **Local first** — Runs entirely on your machine. No account, no subscription
- 🔐 **No vendor lock-in** — Use any AI agent you choose; switch any time

---

## Why ABG?

Browser-AI integrations are powerful. They are also dangerous when you can't see what they do.

Closed-source extensions can change behavior at any time — through updates, acquisitions, or quiet policy changes. By the time you notice telemetry was added, months of your browsing data may already be gone. The Great Suspender, Stylish, Web of Trust, Hover Zoom, the DataSpii incident — all began as "useful" extensions before being weaponised against their users.

ABG is built on a single principle:

> **If your AI can see your browser, you should be able to see your AI's code.**

Anthropic's Claude in Chrome, Google's Gemini in Chrome, Microsoft's Copilot — these may be safe today, but as a structural matter their providers cannot offer **zero telemetry, no backend, no cloud dependency**. Their business models depend on data flowing back. ABG's does not.

ABG provides a value its commercial counterparts **structurally cannot**: code-level verifiability of exactly what your AI agent does in your browser.

---

## How it works

ABG is a Mac menubar app + a Chrome extension + a small `abg` CLI. The CLI is the primary interface for AI agents.

```
┌──────────────────────────┐
│ Chrome (your everyday)   │
│  ├─ Tab A                │
│  ├─ Tab B 🔓 (shared)    │
│  └─ Tab C                │
│  + ABG extension         │
└────────┬─────────────────┘
         │ WebSocket (127.0.0.1:8765)
         ↓
┌──────────────────────────────┐
│ Agent Browser Gateway.app    │
│  - Permission Manager        │
│  - Audit Log (JSONL)         │
└────────┬─────────────────────┘
         │ Unix Domain Socket
         ↓
┌──────────────────────────────┐
│ abg CLI                      │
└────────┬─────────────────────┘
         │ shell call
         ↓
┌──────────────────────────────┐
│ Coding Agent                 │
│ (Claude Code + Skill / etc.) │
└──────────────────────────────┘
```

Nothing leaves your machine. The Gateway listens **only on `127.0.0.1`**. The extension declares **zero `host_permissions`**.

---

## Per-tab consent model

The core security model:

1. By default, the agent sees **nothing**. No tabs are shared.
2. To share a tab, **you click the extension icon → Share this tab with agent**.
3. The agent can now read / screenshot / operate **only that tab**, via `abg`.
4. The share is automatically revoked when:
   - The tab navigates to a different origin
   - You close the tab
   - You explicitly revoke (via the popup or `abg revoke`)

There is no "share all tabs" button. There is no `<all_urls>` permission. There is no way for an agent to see a tab you did not explicitly share.

Operation approval mode adds a second local checkpoint for write operations. By default, `click`, `fill`, `paste`, `clear`, `replace`, `upload`, `type`, `key`, `navigate`, `scroll`, and `drag` open a Chrome approval window before they run. Read-only tools and `revoke` never prompt. The toggle lives in the extension popup and is stored locally per extension install.

Every operation an agent performs is recorded to a local audit log (`~/Library/Logs/AgentBrowserGateway/audit.jsonl`).

---

## CLI

```bash
# Observation (read-only)
abg status                                       # Gateway state, connected extensions, shared tab count
abg tabs [--compact] [--format text]             # List shared tabs with short refs (t1, t2, ...)
abg inspect                                      # status + shared tabs in one JSON response
abg read <tab|ref> [--selector "<css>"] [--format markdown|text|html|json]
abg get text <tab|ref> "<css>"                   # Fine-grained getters: text/html/value/attr/title/url/count/box/styles
abg get attr <tab|ref> "<css>" --name href
abg get styles <tab|ref> "<css>" --props display,color
abg is-visible <tab|ref> --selector "<css>"      # Boolean predicates for shell flows
abg is-enabled <tab|ref> --selector "<css>"
abg is-checked <tab|ref> --selector "<css>"
abg screenshot <tab|ref> [--out <path>]          # defaults to $TMPDIR/abg/screenshots/
abg pdf <tab|ref> --out page.pdf                 # Page.printToPDF capture
abg screenshot --latest                          # latest screenshot path
abg annotate <tab|ref> [--start|--stop|--clear]  # area/text annotations auto-classified as DOM or screenshot
abg annotate <tab|ref> [--format json|text]      # list current annotations
abg annotate <tab|ref> --selector "<css>" --comment "..."  # explicit DOM annotation
abg annotate <tab|ref> --x N --y N --width N --height N --comment "..." [--out shot.png]
abg console <tab|ref>                            # console messages
abg table <tab|ref> [--selector "table"] [--format json|markdown]
abg describe <tab|ref> [--grid 10x10]            # clickable elements with viewport bboxes
abg network <tab|ref> [--url "*api*"] [--status-min 400]

# Tab targeting shortcuts
abg read --match-url "*kintone*" --format markdown
abg click --match-title "アプリ管理" --selector "button.save"

# Operation
abg click <tab|ref> --selector "<css>"            # CSS selector click
abg click <tab|ref> --id <n>                      # click an element from `abg describe`
abg click <tab|ref> --x <px> --y <px>             # Coordinate click (works on canvas apps)
abg dblclick <tab|ref> --selector "<css>"         # Selector double-click via CDP
abg focus <tab|ref> --selector "<css>"            # Focus without click side effects
abg hover <tab|ref> --selector "<css>"            # Move mouse over an element
abg select <tab|ref> --selector "select" --value "x"
abg select <tab|ref> --selector "select" --label "Visible label"
abg check <tab|ref> --selector "input[type=checkbox]"
abg uncheck <tab|ref> --selector "input[type=checkbox]"
abg fill <tab|ref> --selector "<css>" --value "<text>"  # input/textarea/contenteditable replacement
abg fill <tab|ref> --selector "<css>" --value "<text>" --dry-run
abg replace-editable <tab|ref> --selector "<css>" --text-file payload.txt
abg paste <tab|ref> --selector "<css>" --value "<text>"  # Clipboard + native paste for rich editors
echo "long text" | abg paste <tab|ref> --selector "<css>" --stdin
abg clear <tab|ref> --selector "<css>"           # Select all content in an editable target and delete it
abg replace <tab|ref> --selector "<css>" --html "<span>...</span>"  # Temporary DOM replacement
abg upload <tab|ref> --selector "input[type=file]" --file "/path/to/file.zip"
abg type <tab|ref> "<text>"                       # Send text to current focus
abg key <tab|ref> <key> [--modifiers ctrl,shift]  # Enter / Space / ArrowDown / etc.
abg keydown <tab|ref> Shift
abg keyup <tab|ref> Shift
abg keyboard inserttext <tab|ref> "<text>"        # CDP Input.insertText without key events
abg navigate <tab|ref> "<url>"                    # cross-origin auto-revokes
abg scroll <tab|ref> [--dy 800] [--dx 0]          # Wheel scroll (delta px); works on inner-scroll containers
abg scroll-into-view <tab|ref> --selector "<css>" # Center a known element in the viewport
abg drag <tab|ref> --from-selector ".a" --to-selector ".b"

# Repeatable flows
abg record <tab|ref> --out flow.json              # record CLI-originated ABG steps until Ctrl+C
abg replay flow.json --dry-run
abg replay flow.json --match-url "*kintone*"

# Management
abg revoke <tab|ref>                    # Stop sharing
abg audit [--lines 50]                  # Local audit log
abg install-skill                       # Install/update Claude Code + Codex Skills
```

Use `fill` for native `input`, `textarea`, and plain `contenteditable` targets when one explicit
replacement command is enough. It dispatches `beforeinput`, `input`, and `change` metadata, avoids
clipboard dependence, and returns the detected editable kind plus replacement lengths. Use
`replace-editable` when the stronger command name makes a CMS/rich-editor workflow clearer; it uses
the same replacement path and can read from `--text-file` or `--stdin`. Use `type` when the target
already has focus and needs per-character keyboard events. Use `paste` for rich editors that ignore
synthetic value updates or character events, including Lexical, ProseMirror, Slate, Quill, and many
native editable surfaces. `paste` writes the text to the clipboard, focuses the selected editable
element, and sends Cmd+V on macOS or Ctrl+V elsewhere; the audit log records the action, tab id,
selector, and byte length only, never the pasted text.

Use `clear` as the single-purpose primitive for emptying rich editors. It focuses the editable
target, selects its content, and deletes it. The result includes `clearStrategy`, one of
`execCommand`, `selectionRange`, `syntheticInput`, `keyboardShortcut`, or `null`.

Use `get` when a script needs one compact value instead of a larger `read` payload. `get text/html`
returns one selector-scoped value, `get count` returns a match count, `get box` returns a viewport
rect, and `get styles --props display,color` keeps computed-style reads small.
Use `is-visible`, `is-enabled`, and `is-checked` for conditionals; a false predicate still exits
successfully and returns `{ "value": false }`.

For Lexical-class editors and other rich editors that still ignore synthetic `fill`, the fallback
"set this editor's content to X" sequence stays explicit:

```bash
abg clear t1 --selector 'div[aria-label="Gemini へのプロンプトを入力"]'
abg paste t1 --selector 'div[aria-label="Gemini へのプロンプトを入力"]' --value "new prompt"
```

---

## Annotation mode

Annotation mode lets the human mark the current tab the way they would point at a screenshot in chat, while still preserving structured context for the agent.

- Start from the extension popup with **Annotate this tab**, or from the CLI with `abg annotate t1 --start`.
- Use **Area** to drag a rectangle, or **Text** to select page text, including text that spans multiple DOM elements, and turn the selected text into a numbered annotation. Add a comment, then click **Done** or press Escape when finished.
- Text annotations render as text-selection highlights instead of rectangular boxes. Screenshot annotations can be moved with drag-and-drop and resized from their edges/corners. DOM and text annotations stay locked to their selector so they keep following the page layout. Any selected annotation can be deleted with Delete/Backspace.
- **Area** annotations are auto-classified as `kind: "dom"` when a stable DOM target is available, otherwise `kind: "screenshot"`. **Text** annotations are always `kind: "text"` and keep the selected text as first-class data.
- Agents retrieve the current state with `abg annotate t1`; the JSON includes comments, viewport/page rectangles, selector/text/style metadata for DOM targets, top-level `text` plus `textAnchor` metadata for text annotations, and screenshot-region coordinates for visual targets.
- For explicit additions, use `abg annotate t1 --selector "button.save" --comment "..."` or `abg annotate t1 --x 120 --y 240 --width 360 --height 180 --comment "..."`.

---

## Why CLI + Skill instead of MCP?

The agent talks to ABG by running `abg` from the shell. This is not the only design — MCP wrappers can come later — but as the primary interface it has unique advantages:

- **No HTTP/MCP client required** — any agent that can run a shell command works
- **Trivially debuggable** — run `abg screenshot 445` yourself and see exactly what the agent sees
- **Agent-agnostic** — Claude Code, Codex, Cursor, Cline, your own scripts
- **Skill ergonomics** — Claude Code and Codex skills (`~/.claude/skills/agent-browser-gateway/` and `~/.codex/skills/agent-browser-gateway/`, installed by `abg install-skill`) teach the agent the CLI in context

A thin MCP wrapper around the same CLI is on the future roadmap for ecosystem coverage. The CLI remains the source of truth.

---

## Plugin architecture

ABG ships with an **Obsidian-style plugin system**: JavaScript modules loaded into the Gateway at startup that hook into the data flow between your browser and your AI agent. The core stays minimal (raw browser access via CDP); data transformation — Markdown conversion, redaction, command abstraction — lives in plugins.

Plugins live under `Agent Browser Gateway.app/Contents/Resources/plugins/` (bundled defaults). Each plugin is a directory with `index.js` and optional `plugin.json`; `index.js` registers transformers via a small `abg` host API:

```js
// plugins/markdown-plugin/index.js (excerpt)
abg.registerTransform("html-to-markdown", function (html) {
  // ...returns Markdown
});
```

Currently bundled:

- **`markdown-plugin`** — Converts page DOM to Markdown for `abg read --as-markdown`. Replaces what used to be a hardcoded converter inside the extension.
- **`notion-plugin`** — Per-domain Markdown diet for `notion.so` / `notion.site`: strips app chrome, scripts, styles, popovers, and bookkeeping before the agent sees the page.
- **`info-plugin`** — Smoke test: prints a startup line.

User plugins can be managed from the CLI:

```bash
abg plugin list
abg plugin install user/repo --yes
abg plugin update
abg plugin uninstall my-plugin
```

See [docs/PLUGINS.md](docs/PLUGINS.md) for the manifest format and authoring guide.

Planned (community / future): more per-domain plugins (`gmail-plugin`, `slack-plugin`, `linear-plugin`), masking plugins (mask credit cards / personal info before the agent sees data), command-abstraction plugins (turn 50 DOM operations into `abg call cart-plugin --add "item-id"`).

### Why this matters: token economy

Most browser-AI bridges hand the LLM raw HTML — sometimes the entire `page.content()` including scripts and styles. The result is huge token bills and degraded reasoning over noisy input.

ABG's `markdown-plugin` strips the page to its semantic essence. Measured on a typical Japanese WordPress blog post (`https://sitest.jp/blog/?p=35065`):

| Method | chars | tokens (approx) | structure |
|---|---:|---:|:---:|
| Playwright `page.content()` (full HTML) | 124,476 | ~50,000 | preserved (massive overhead) |
| Playwright `locator('article').innerHTML()` | 42,070 | ~17,000 | preserved (with overhead) |
| **`abg read N --selector article --as-markdown`** | **11,780** | **~5,900** | **preserved (clean)** |
| Playwright `locator('article').innerText()` | 6,543 | ~3,800 | lost (no headings / links / lists) |

For 1,000 page reads with Claude Opus ($15/M input tokens):

- Playwright `page.content()` → **$750**
- Playwright `locator('article').innerHTML()` → **$255**
- **ABG `read --as-markdown`** → **$88**

A reduction of **~88%** vs the naive Playwright approach, while preserving heading / list / link structure. Per-domain plugins such as the bundled `notion-plugin` push this further by extracting only the semantically meaningful content for each app.

(Token estimates assume mixed Japanese content at ~2 chars/token; relative ratios hold for English at ~4 chars/token.)

The bundled `notion-plugin` is a concrete per-domain example. It is measured with the reproducible
fixture in `examples/fixtures/notion-page.html`:

```bash
node examples/benchmark-notion-plugin.mjs
```

| Method | chars | tokens (approx) | reduction vs raw |
|---|---:|---:|---:|
| Raw Notion-like page HTML | 2,209 | ~553 | - |
| Generic markdown-plugin | 1,242 | ~311 | 44% |
| **notion-plugin domain transform** | **709** | **~178** | **68%** |

For Notion-like pages, ABG now selects the domain transform automatically when `abg read --format markdown` is used on a shared `notion.so` or `notion.site` tab.

---

## Open source verifiability

Closed-source extensions are not auditable. Open-source extensions distributed only as binaries are barely better. ABG aims for **end-to-end verifiability**:

- **Every byte of code that touches your browser is in this repo.** No proprietary blobs.
- **Reproducible builds** (target for v1.0): the binary you download from Releases will hash-match a Docker-built artifact from this repo.
- **No analytics, no crash reporter, no auto-update phone-home.** The Gateway's only outbound connection is the loopback WebSocket to its own extension. Inspect with `lsof -i -p <gateway-pid>` at any time.
- **Audit log is itself open**: see [`Sources/Gateway/AuditLog.swift`](Sources/Gateway/AuditLog.swift). There is no "secret bypass" to log everywhere except where I'd prefer not to.
- **Dependency minimalism.** PRs that add dependencies require a stated reason. Binary dependencies (`.dylib`, `.so`, `.dll`) are avoided.

If you find ABG transmitting anything outside `127.0.0.1`, that is a bug. Open an issue or, even better, a PR.

---

## Comparison

ABG is not trying to replace Playwright or browser test runners. Use it when the browser session
already exists: you are logged in, looking at the real page, and want to hand only that explicitly
shared tab to an AI agent or CLI workflow.

Use **ABG** for:

- inspecting or operating a tab you are already using in your normal Chrome profile
- AI-assisted support/debugging where per-tab consent and audit logs matter
- quick shell-driven reads, screenshots, table extraction, network inspection, and small operations
- workflows where the agent should not receive a global browser context or a remote-debugging port

Use **Playwright / browser test tooling** for:

- deterministic E2E tests, CI, screenshots, and cross-browser regression coverage
- scripted flows that should start from a clean profile and be reproducible for everyone
- test assertions over app code where repeatability matters more than using the user's live session
- browser automation that intentionally controls the whole browser lifecycle

| Project | Approach | What ABG offers that this doesn't |
|---|---|---|
| `Claude in Chrome` (Anthropic) | First-party extension, transmits to Anthropic | Zero telemetry, multi-agent, OSS, per-tab consent |
| `hangwin/mcp-chrome` | Extension bridge, **all tabs always exposed** | Per-tab consent (you choose which tabs) |
| `BrowserMCP` | Extension bridge, Playwright API | Per-tab consent |
| `chrome-devtools-mcp` (Google) | CDP, requires `--remote-debugging-port` | Works with your everyday Chrome profile (Chrome 136+ blocks the CDP path) |
| `vercel-labs/agent-browser` | Spawns Chrome for Testing | Uses the tab you're already looking at, with your logins, in your context |
| `Playwright MCP` (Microsoft) | Dedicated browser, structured snapshots | Per-tab consent on your everyday browser |

The distinction is practical: Playwright is excellent when you want a repeatable browser that the
automation owns; ABG is for safely exposing one human-owned tab to an agent, with JSON output,
local-only transport, and a visible audit trail.

---

## MVP scope (v0.1)

Currently shipped:

- ✅ macOS 14+ menubar app (Swift + SwiftUI `MenuBarExtra`)
- ✅ Chrome extension (Manifest V3, no `<all_urls>`, `activeTab` only)
- ✅ Per-tab consent with auto-revoke on origin change / tab close
- ✅ Read tools: `read` / `screenshot` / `console` / `table` / `describe` / `network` (with selectors, compact formats, and latest screenshot references)
- ✅ Annotation mode: popup or `abg annotate --start` overlay for numbered DOM/screenshot annotations and comments
- ✅ Operation tools: `click` / `fill` / `paste` / `clear` / `replace` / `upload` / `type` / `key` / `navigate` / `scroll` / `drag` (CDP wheel — works on inner-scroll containers)
- ✅ Wait tool: `wait --selector` / `--ms`
- ✅ Operation approval mode (default ON, popup-gated)
- ✅ Multi-Chrome-profile labelling
- ✅ Local audit log (JSONL)
- ✅ `abg` CLI with Claude Code and Codex Skills bundled
- ✅ JS plugin system (Obsidian-style; bundled generic Markdown and Notion per-domain plugins)

In progress / planned (see [ROADMAP.md](ROADMAP.md)):

- 📋 Reproducible builds (v1.0 target)
- 📋 MCP wrapper (future)
- 📋 Firefox / Safari / Edge / iOS / Android (Phase 3+)
- 📋 Remote/multi-machine pairing (Phase 4)

---

## Getting started

### Prerequisites

- macOS 14+
- Xcode 16+ (Swift 6.1+) or Swift toolchain
- [mise](https://mise.jdx.dev/) (manages Node.js + pnpm versions)
- Google Chrome 116+

### Install tools

```bash
mise trust
mise install
```

### Build the Gateway and CLI

```bash
./build-app.sh                          # produces Agent Browser Gateway.app and .build/release/abg
open "Agent Browser Gateway.app"        # menubar shield icon appears
ln -sf $(pwd)/.build/release/abg /usr/local/bin/abg
```

### Install the Chrome extension

Install Agent Browser Gateway from the Chrome Web Store:

https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi

For local development, build and load the unpacked extension:

```bash
cd extension
pnpm install
pnpm run build                          # outputs to extension/dist/
```

In Chrome: open `chrome://extensions` → enable Developer mode → **Load unpacked** → pick `extension/dist/`.

### Share a tab

1. Open the tab you want to share
2. Click the ABG extension icon → **Share this tab with agent**
3. A green `ON` badge appears on the icon; the menubar shield icon fills in
4. Verify with `abg tabs`

### Hand it to Claude Code or Codex

```bash
abg install-skill                       # places/updates ~/.claude/skills/ and ~/.codex/skills/
```

Claude Code or Codex will now invoke `abg` automatically when the conversation references tabs you have shared.

---

## Development

```bash
swift build                             # debug build
swift test                              # Swift unit tests
swift run Gateway                       # menubar app without bundling (dev)

cd extension
pnpm run watch                          # rebuild on save
pnpm run lint                           # Biome (lint + format check)
pnpm run format                         # Biome auto-format
pnpm run typecheck                      # tsc --noEmit
make verify                             # CI-style local verification
```

---

## Security

Threat model and the explicit non-goals are in [SECURITY.md](SECURITY.md). To report a vulnerability privately, see the same file.

In short:
- We **defend against** prompt injection that tries to leak un-shared tabs, accidental over-sharing, and silent audit-log tampering.
- We **do not defend against** other malicious extensions in the same Chrome profile (Chrome's responsibility), root attackers on your machine, or operations the user explicitly authorizes.
- We **never expose** an "execute arbitrary JavaScript" tool to agents. The CLI surface is curated.

---

## Status

🚧 **v0.3.6 / pre-alpha.** Functional for the author's daily use. APIs may change without notice until v1.0.

---

## License

License is not yet decided. The repository is published as source for the author's own use; usage by others is not yet authorised.

---

## 日本語サマリ

**「いま開いてるタブだけ、AI に渡す。」**

普段使いの Chrome に入れる軽量拡張と、Mac メニューバーに常駐する小さな .app + `abg` CLI。ユーザーが明示的に「このタブを共有」とした **そのタブだけ** が、Claude Code などの AI コーディングエージェントから見える。

### コア思想

1. **per-tab 明示許可** — タブ単位の許可。`<all_urls>` なし。`activeTab` のみ
2. **OSS / テレメトリゼロ / 検証可能** — Anthropic / Google / Microsoft が**構造的に**提供できない価値。閉じたソースの拡張は買収やポリシー変更でマルウェア化する歴史がある (The Great Suspender, Stylish, Hover Zoom, etc.)。ABG はあなたの AI が**コードレベルで何をするか**を完全に検証可能にする
3. **CLI + Skill が primary** — MCP より先に CLI。シェルがあれば任意のエージェントから使える
4. **失効は明示的** — オリジン遷移 / タブクローズ / 明示解除。タイムアウトはオプション
5. **すべて監査ログに記録** — JSONL ファイル、自分でも `abg audit` で読める

詳しい設計議論は [`docs/`](docs/) を参照 (Claude.ai 上の設計セッションからの引き継ぎドキュメント)。
