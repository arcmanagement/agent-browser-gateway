# Agent Browser Gateway (ABG)

> **Bridge your browser to AI agents — without giving up control.**

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
│ Gateway.app (menubar)        │
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

Operation approval mode adds a second local checkpoint for write operations. By default, `click`, `fill`, `type`, `key`, `navigate`, and `scroll` open a Chrome approval window before they run. Read-only tools and `revoke` never prompt. The toggle lives in the extension popup and is stored locally per extension install.

Every operation an agent performs is recorded to a local audit log (`~/Library/Logs/AgentBrowserGateway/audit.jsonl`).

---

## CLI

```bash
# Observation (read-only)
abg status                                       # Gateway state, connected extensions, shared tab count
abg tabs                                         # List shared tabs (JSON: tabId, url, title, ...)
abg read <tabId> [--selector "<css>"] [--as-markdown]  # DOM (text+HTML, or Markdown via bundled plugin)
abg screenshot <tabId> [--out <path>]            # PNG path
abg console <tabId>                              # console messages

# Operation (v0.1.1)
abg click <tabId> --selector "<css>"             # CSS selector click
abg click <tabId> --x <px> --y <px>              # Coordinate click (works on canvas apps)
abg fill <tabId> --selector "<css>" --value "<text>"
abg type <tabId> "<text>"                        # Send text to current focus
abg key <tabId> <key> [--modifiers ctrl,shift]   # Enter / Space / ArrowDown / etc.
abg navigate <tabId> "<url>"                     # cross-origin auto-revokes
abg scroll <tabId> [--dy 800] [--dx 0]           # Wheel scroll (delta px); works on inner-scroll containers

# Management
abg revoke <tabId>                      # Stop sharing
abg audit [--lines 50]                  # Local audit log
abg install-skill                       # Install Claude Code Skill into ~/.claude/skills/
```

---

## Why CLI + Skill instead of MCP?

The agent talks to ABG by running `abg` from the shell. This is not the only design — MCP wrappers can come later — but as the primary interface it has unique advantages:

- **No HTTP/MCP client required** — any agent that can run a shell command works
- **Trivially debuggable** — run `abg screenshot 445` yourself and see exactly what the agent sees
- **Agent-agnostic** — Claude Code, Codex, Cursor, Cline, your own scripts
- **Skill ergonomics** — Claude Code's Skill system (`~/.claude/skills/agent-browser-gateway.md`, installed by `abg install-skill`) teaches the agent the CLI in context

A thin MCP wrapper around the same CLI is on the v0.2 roadmap for ecosystem coverage. The CLI remains the source of truth.

---

## Plugin architecture

ABG ships with an **Obsidian-style plugin system**: JavaScript modules loaded into the Gateway at startup that hook into the data flow between your browser and your AI agent. The core stays minimal (raw browser access via CDP); data transformation — Markdown conversion, redaction, command abstraction — lives in plugins.

Plugins live under `Gateway.app/Contents/Resources/plugins/` (bundled defaults). Each plugin is a `.js` file that registers transformers via a small `abg` host API:

```js
// plugins/markdown-plugin/index.js (excerpt)
abg.registerTransform("html-to-markdown", function (html) {
  // ...returns Markdown
});
```

Currently bundled:

- **`markdown-plugin`** — Converts page DOM to Markdown for `abg read --as-markdown`. Replaces what used to be a hardcoded converter inside the extension.
- **`info-plugin`** — Smoke test: prints a startup line.

Planned (community / future): per-domain plugins (`gmail-plugin`, `notion-plugin`, `slack-plugin`), masking plugins (mask credit cards / personal info before the agent sees data), command-abstraction plugins (turn 50 DOM operations into `abg call cart-plugin --add "item-id"`).

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

A reduction of **~88%** vs the naive Playwright approach, while preserving heading / list / link structure. Per-domain plugins (e.g. a future `gmail-plugin`, `notion-plugin`, `slack-plugin`) push this further by extracting only the semantically meaningful content for each app.

(Token estimates assume mixed Japanese content at ~2 chars/token; relative ratios hold for English at ~4 chars/token.)

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

| Project | Approach | What ABG offers that this doesn't |
|---|---|---|
| `Claude in Chrome` (Anthropic) | First-party extension, transmits to Anthropic | Zero telemetry, multi-agent, OSS, per-tab consent |
| `hangwin/mcp-chrome` | Extension bridge, **all tabs always exposed** | Per-tab consent (you choose which tabs) |
| `BrowserMCP` | Extension bridge, Playwright API | Per-tab consent |
| `chrome-devtools-mcp` (Google) | CDP, requires `--remote-debugging-port` | Works with your everyday Chrome profile (Chrome 136+ blocks the CDP path) |
| `vercel-labs/agent-browser` | Spawns Chrome for Testing | Uses the tab you're already looking at, with your logins, in your context |
| `Playwright MCP` (Microsoft) | Dedicated browser, structured snapshots | Per-tab consent on your everyday browser |

The right-upper quadrant — *per-tab consent × everyday browser × verifiable OSS* — is, as of mid-2026, mostly empty.

---

## MVP scope (v0.1)

Currently shipped:

- ✅ macOS 14+ menubar app (Swift + SwiftUI `MenuBarExtra`)
- ✅ Chrome extension (Manifest V3, no `<all_urls>`, `activeTab` only)
- ✅ Per-tab consent with auto-revoke on origin change / tab close
- ✅ Read tools: `read` / `screenshot` / `console` (with `--selector`, `--clip`, `--as-markdown`)
- ✅ Operation tools: `click` / `fill` / `type` / `key` / `navigate` / `scroll` (CDP wheel — works on inner-scroll containers)
- ✅ Wait tool: `wait --selector` / `--ms`
- ✅ Operation approval mode (default ON, popup-gated)
- ✅ Multi-Chrome-profile labelling
- ✅ Local audit log (JSONL)
- ✅ `abg` CLI with Claude Code Skill bundled
- ✅ JS plugin system (Obsidian-style; bundled `markdown-plugin` for `--as-markdown`)

In progress / planned (see [ROADMAP.md](ROADMAP.md)):

- 📋 Reproducible builds (v1.0 target)
- 📋 MCP wrapper (v0.2)
- 📋 Firefox / Safari / Edge / iOS / Android (Phase 3+)
- 📋 Remote/multi-machine pairing (Phase 4)

---

## Getting started

### Prerequisites

- macOS 14+
- Xcode 16+ (Swift 6.3+) or Swift toolchain
- [mise](https://mise.jdx.dev/) (manages Node.js + pnpm versions)
- Google Chrome 116+

### Install tools

```bash
mise trust
mise install
```

### Build the Gateway and CLI

```bash
./build-app.sh                          # produces Gateway.app and .build/release/abg
open Gateway.app                        # menubar shield icon appears
ln -sf $(pwd)/.build/release/abg /usr/local/bin/abg
```

### Build and load the extension

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

### Hand it to Claude Code

```bash
abg install-skill                       # places ~/.claude/skills/agent-browser-gateway.md
```

Claude Code will now invoke `abg` automatically when the conversation references tabs you have shared.

---

## Development

```bash
swift build                             # debug build
swift run Gateway                       # menubar app without bundling (dev)

cd extension
pnpm run watch                          # rebuild on save
pnpm run lint                           # Biome (lint + format check)
pnpm run format                         # Biome auto-format
pnpm run typecheck                      # tsc --noEmit
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

🚧 **v0.1.2 / pre-alpha.** Functional for the author's daily use. Not yet hardened for general distribution. APIs may change without notice until v1.0.

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
