# Agent Browser Gateway (ABG)

> **Bridge your browser to AI agents — without giving up control.**

[![CI](https://github.com/arcmanagement/agent-browser-gateway/actions/workflows/ci.yml/badge.svg)](https://github.com/arcmanagement/agent-browser-gateway/actions/workflows/ci.yml)

Patent allowed; registration fee paid: JP 2026-080620

- 🔓 **Per-tab consent** — You decide which tabs your agent sees, and for how long
- 🌐 **Any agent** — Works with Claude Code, Codex, Cursor, Cline, or any tool that can run a shell command
- 📖 **Public source** — Every line of code that touches your browser is auditable
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
         │ local IPC
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

Nothing leaves your machine. The Gateway listens **only on `127.0.0.1`**. The extension declares **zero default `host_permissions`**; the optional all-tabs mode requests `<all_urls>` only after you enable it in the extension popup.

---

## Install

ABG has three local pieces: the Chrome extension, the Gateway app, and the `abg`
CLI. Install the browser extension first, then install the local Gateway.

1. Install Agent Browser Gateway from the Chrome Web Store:

   https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi

   The public listing currently serves extension `v0.4.4`. The Chrome extension and macOS app can
   advance independently while store review and signed app publication complete.

2. Install the local Gateway.

   macOS:

   ```bash
   brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
   brew trust --cask arcmanagement/agent-browser-gateway/agent-browser-gateway
   brew install --cask agent-browser-gateway
   ```

   If Homebrew says the latest version is already installed, the cask is present. Verify with
   `brew info --cask agent-browser-gateway` or `abg --help`; use
   `brew reinstall --cask agent-browser-gateway` only when you want to force a fresh install.
   Homebrew may also print trust warnings for unrelated taps; check the final install line and
   `brew info --cask agent-browser-gateway` to confirm the ABG cask state.
   If you previously tapped the temporary public Homebrew repository or the private source
   repository, run `brew untap arcmanagement/agent-browser-gateway` once and tap again with the
   explicit GitHub URL above.

   Windows:

   ```powershell
   winget install --id ArcManagement.AgentBrowserGateway --source winget
   ```

   WinGet is not live for `v0.4.5` yet. If this command reports no matching package, that is the
   current expected result until the signed Windows release and Microsoft indexing are complete.

3. For manual macOS install, download the current DMG from
   [GitHub Releases](https://github.com/arcmanagement/agent-browser-gateway/releases), verify the
   SHA-256 checksum published next to it, open it, and double-click
   **Install Agent Browser Gateway.app**.

The DMG installer copies `Agent Browser Gateway.app` to `/Applications`, installs
`abg` under `/usr/local/bin`, installs the bundled Claude Code and Codex skills,
and starts the menubar app.

Windows package-manager install and release ZIPs are pending for `v0.4.5` while the signed Windows
release workflow is completed. For current Windows testing, clone the repository on Windows and run
`.\windows-build-install.cmd` from the repository root.

After installation, open the tab you want to share, click the ABG extension icon,
choose **Share this tab with agent**, and verify from a terminal:

```bash
abg tabs
```

Source builds, unpacked extension loading, and the separate dev app are covered
in [Developer setup](#developer-setup).

Release archive generation, Chrome extension packaging, and Homebrew Cask update
steps are documented in [Homebrew Cask Distribution](docs/HOMEBREW.md). Pull
requests run the `CI` workflow, which smoke-tests unsigned macOS archives and
records the resolved Swift dependency inventory. Chrome extension packaging and
dependency security run as their own workflows. Tags matching `v*.*.*` run the
`Release` workflow to build release archives, create the draft GitHub Release,
and generate release notes.

---

## Tab access modes

The core security model:

1. By default, the agent sees **nothing**. No tabs are shared.
2. To share a tab, **you click the extension icon → Share this tab with agent**.
3. The agent can now read / screenshot / operate **only that tab**, via `abg`.
4. The share is automatically revoked when:
   - The tab navigates to a different origin
   - You close the tab
   - You explicitly revoke (via the popup or `abg revoke`)

For isolated Chrome profiles, test machines, or sandbox browsers, the popup also has **Share all tabs in this profile**. That mode is off by default. Turning it on asks Chrome for optional `<all_urls>` access, then lists every shareable `http`, `https`, and `file` tab in `abg tabs` with `accessMode: "all_tabs"`. Turning it off revokes all all-tabs entries and removes the optional host permission. Manual per-tab sharing remains the default for personal or mixed-use profiles.

Short refs from `abg tabs --compact` are the pin-equivalent for a running Gateway session. A ref is
bound to the pair of browser profile and Chrome tab ID, so adding/removing other tabs does not
renumber it, and the same ref can be reused across a multi-step flow. Prefer refs over raw positive
`tabId` values when multiple profiles are connected; Chrome can assign the same tab ID in different
profiles, and ABG returns `ambiguous_tab_id` rather than routing to the wrong profile. Re-resolve the
ref after the Gateway restarts, the tab closes, or sharing is revoked by a cross-origin navigation.

Operation approval mode adds a second local checkpoint for write operations. By default, `click`, `fill`, `paste`, `paste-rich`, `clear`, `replace`, `upload`, `type`, `key`, `exec-command`, `navigate`, `scroll`, `drag`, and dialog handling actions open a Chrome approval window before they run. Read-only tools, `raise`, and `revoke` never prompt. `raise` is an explicit presentation command that can only activate an already-shared tab and its existing window; it cannot discover or operate unshared tabs. The toggle lives in the extension popup and is stored locally per extension install.

Trusted automation / AutoMode is a separate explicit popup setting for eval-heavy trusted sessions. Eval remains disabled unless **Enable approved JavaScript eval** is on. With AutoMode off, `abg eval` requires `--approve` and a local approval popup for each call. With AutoMode on, eval on already-shared tabs can skip that popup, while script source and result summaries are still audited.

Tab recording is stricter than normal operations: `abg record start` always opens a local approval window, even when operation approvals or Trusted automation would skip other prompts. The **Allow** click supplies Chrome's `tabCapture` gesture, recording only the already-shared tab to a local WebM file.

Every operation an agent performs is recorded to a local audit log (`~/Library/Logs/AgentBrowserGateway/audit.jsonl`).
The Gateway window includes an Audit view for recent local entries with time, command, tab, and search filters.
The Gateway window also has Settings for profile-local timeout defaults, approval defaults, and
per-domain policy drafts stored in `gateway-settings.json` under `~/.abg/` or `~/.abg-dev/`.
The file is local JSON with owner-only permissions and no app database. Persistent defaults live at
the top level, while per-domain overrides live in `domainPolicies`:

```json
{
  "approvalModeDefault": "extension_popup",
  "defaultTimeoutMs": 30000,
  "networkBodyPolicyDefault": "explicit_request_only",
  "domainPolicies": [
    {
      "domain": "example.com",
      "approvalMode": "require_approval",
      "timeoutMs": 45000,
      "networkBodyPolicy": "require_approval",
      "appliesToSubdomains": true
    }
  ]
}
```

Policy precedence is intentionally narrow: one-time approval or denial for the current operation
wins, then any current session policy, then the most specific matching domain policy, then the
profile default. One-time and session decisions are runtime state and are not written to
`gateway-settings.json`. Domain matching normalizes URL hosts, strips ports, and prefers the longest
matching domain when subdomain matching is enabled.

The selected editing surface is the existing Gateway window Settings section. It will extend the
current timeout and approval controls with network body preview policy for defaults and domain
policies, without adding a separate broad settings panel. Network body preview remains bounded and explicit: `explicit_request_only`
allows previews only for commands that ask for `--body`, `require_approval` adds a local approval
checkpoint, and `metadata_only` keeps network inspection to metadata.

---

## CLI

The machine-readable CLI output contract is documented in
[`docs/CLI_JSON_CONTRACT.md`](docs/CLI_JSON_CONTRACT.md). Keep scripts and agent integrations on the
documented JSON keys rather than parsing human-oriented help text.

```bash
# Observation (read-only)
abg status                                       # Gateway state, connected extensions, shared tab count
abg tabs [--compact] [--format text]             # List shared tabs with short refs (t1, t2, ...)
abg inspect                                      # status + shared tabs in one JSON response
abg raise <tab|ref>                              # Activate a shared tab and bring its existing window forward
abg bookmarks list                              # Browser-owned personal data; requires separate Bookmarks access
abg bookmarks search "reference"                # Search bookmark titles/URLs after explicit permission
abg bookmarks get <bookmark-id>
abg bookmarks open <bookmark-id>                # Open an existing bookmark URL through an explicit command
abg reading-list list                           # Chrome 120+ chrome.readingList, separate permission
abg reading-list search "saved page"
abg frames <tab|ref>                             # List iframe/frame refs (@f1, @f2, ...)
abg read <tab|ref> [--selector "<css>"] [--format markdown|text|html|json]
abg read <tab|ref> --frame @f1 --selector "<css>"
abg read <tab|ref> --selector "<css>" --editable-value
abg get text <tab|ref> "<css>"                   # Fine-grained getters: text/html/value/attr/title/url/count/box/styles
abg get editable-value <tab|ref> "<css>"         # Rich-editor visible text + serialized HTML
abg get attr <tab|ref> "<css>" --name href
abg get styles <tab|ref> "<css>" --props display,color
abg find role <tab|ref> button click --name "Submit"
abg find text <tab|ref> "Welcome" text
abg find label <tab|ref> "Email" fill --value "me@example.com"
abg find first <tab|ref> "button" click
abg find nth <tab|ref> 2 ".result" text          # zero-based index
abg find text <tab|ref> "Pay now" click --frame @f1
abg snapshot <tab|ref> --interactive-only --compact
abg snapshot --tabs "post:t1:.editor,preview:t2:main,template:t3:.template"
abg click <tab|ref> --ref @e1                    # ref from the most recent snapshot for that tab
abg is-visible <tab|ref> --selector "<css>"      # Boolean predicates for shell flows
abg is-enabled <tab|ref> --selector "<css>"
abg is-checked <tab|ref> --selector "<css>"
abg screenshot <tab|ref> [--out <path>]          # defaults to $TMPDIR/abg/screenshots/
abg pdf <tab|ref> --out page.pdf                 # Page.printToPDF capture
abg screenshot --latest                          # latest screenshot path
abg record start <tab|ref> [--mic] [--out x.webm] # record tab to webm (tab audio; --mic adds room audio)
abg record stop                                  # stop and write the webm, returns its path
abg record status                                # show the active recording (if any)
abg annotate <tab|ref> [--start|--stop|--clear]  # area/text annotations auto-classified as DOM or screenshot
abg annotate <tab|ref> [--format json|text]      # list current annotations
abg annotate <tab|ref> --selector "<css>" --comment "..."  # explicit DOM annotation
abg annotate <tab|ref> --x N --y N --width N --height N --comment "..." [--out shot.png]
abg console <tab|ref>                            # console messages
abg table <tab|ref> [--selector "table"] [--format json|markdown]
abg describe <tab|ref> [--grid 10x10]            # clickable elements with viewport bboxes
abg network <tab|ref> [--url "*api*"] [--status-min 400]
abg wait-response <tab|ref> --url "*api/save*" --method POST --status-min 200 --status-max 299
abg wait-response <tab|ref> --url-regex "/api/items/\\d+$" --body --max-bytes 8192
abg network <tab|ref> --wait-response --url "*api/save*" --method POST --status-min 200 --status-max 299
abg network <tab|ref> --wait-response --url-regex "/api/items/\\d+$" --body --max-bytes 8192
abg har <tab|ref> --out /tmp/session.har              # Redacted one-shot HAR export
abg state <tab|ref> --kind cookies --name "sid*"      # Cookie/storage keys, values redacted
abg state <tab|ref> --kind local-storage --key "user*" --values
abg framework <tab|ref> --kind react                  # React tree when hooks are available
abg framework <tab|ref> --kind web-vitals             # Performance/Web Vitals snapshot
abg sandbox <tab|ref> viewport --width 390 --height 844 --mobile
abg sandbox <tab|ref> storage-set --storage local-storage --key feature --value on
abg sandbox <tab|ref> tab-create --url https://example.test
abg download <tab|ref>                           # Latest downloads associated with this tab
abg download <tab|ref> --wait --timeout 30000    # Wait for complete/interrupted state
abg dialog <tab|ref>                             # Inspect pending alert/confirm/prompt
abg dialog <tab|ref> --accept                    # Approve and accept a pending dialog
abg dialog <tab|ref> --dismiss                   # Approve and dismiss a pending dialog
abg dialog <tab|ref> --prompt-value "ok"         # Approve and submit prompt text

# Tab targeting shortcuts
abg read --match-url "*kintone*" --format markdown
abg click --match-title "アプリ管理" --selector "button.save"
abg raise --match-title "Review"

# Operation
abg click <tab|ref> --selector "<css>"            # CSS selector click (a selector matching multiple elements returns ambiguous_selector without clicking; use `abg find first|last|nth` or a snapshot ref for repeated controls)
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
abg fill <tab|ref> --selector "<css>" --value "<text>" --diff
abg replace-editable <tab|ref> --selector "<css>" --text-file payload.txt
abg replace-editable <tab|ref> --selector "<css>" --text-file payload.txt --diff
abg paste <tab|ref> --selector "<css>" --value "<text>"  # Clipboard + native paste for rich editors
echo "long text" | abg paste <tab|ref> --selector "<css>" --stdin
abg clipboard-write --mime "text/html" --value "<b>Hello</b>"
abg paste-rich <tab|ref> --selector "<css>"      # Native paste with the current rich clipboard
abg paste-rich <tab|ref> --mime "application/x-vnd.google-docs-sheets-clip+wrapped" --file sheets.clip
abg clear <tab|ref> --selector "<css>"           # Select all content in an editable target and delete it
abg replace <tab|ref> --selector "<css>" --html "<span>...</span>"  # Temporary DOM replacement
abg upload <tab|ref> --selector "input[type=file]" --file "/path/to/file.zip"
abg upload <tab|ref> --selector "input[type=file]" --file a.png --file b.png  # multiple files (input needs `multiple`)
abg type <tab|ref> "<text>"                       # Send text to current focus
abg key <tab|ref> <key> [--modifiers ctrl,shift]  # Enter / Space / ArrowDown / etc.
abg keydown <tab|ref> Shift
abg keyup <tab|ref> Shift
abg keyboard inserttext <tab|ref> "<text>"        # CDP Input.insertText without key events
abg exec-command <tab|ref> --command insertText --value $'line1\nline2'  # focused edit-mode target
printf 'line1\nline2\n' | abg exec-command <tab|ref> --command insertText --stdin
abg exec-command <tab|ref> --command selectAll
abg navigate <tab|ref> "<url>"                    # cross-origin auto-revokes
abg scroll <tab|ref> [--dy 800] [--dx 0]          # Wheel scroll (delta px)
abg scroll <tab|ref> --selector ".scroll-pane" --dy -5000  # Element scrollBy for virtual lists; falls back to the scrollable descendant/ancestor and reports moved/movedX/movedY (moved: false + warning when nothing scrolled)
abg scroll-into-view <tab|ref> --selector "<css>" # Center a known element in the viewport
abg drag <tab|ref> --from-selector ".a" --to-selector ".b"

# Wait
abg wait <tab|ref> --selector "<css>"
abg wait <tab|ref> --selector "<css>" --hidden
abg wait <tab|ref> --ms 1500
abg wait <tab|ref> --text "Welcome"
abg wait <tab|ref> --url "**/dashboard"
abg wait <tab|ref> --load networkidle            # networkidle / load / domcontentloaded
abg wait <tab|ref> --load networkidle --selector ".ready"  # network idle, then selector visible
abg wait <tab|ref> --fn "window.ready === true"

# Escape hatch
abg eval <tab|ref> --script "document.title" --approve  # --approve required unless AutoMode is enabled
abg eval <tab|ref> --script-file task.js --timeout 120000 --approve

# Runtime stream
abg stream enable <tab|ref>                       # local ws://127.0.0.1:8765/stream (send the x-abg-token header from cli-endpoint.json; see `abg stream status` tokenFile)
abg stream status
abg stream disable

# Validation
abg validate editable <tab|ref> --selector "<css>" --rules html-attrs,shortcodes
abg validate editable <tab|ref> --selection

# Repeatable flows
abg record flow <tab|ref> --out flow.json         # record CLI-originated ABG steps until Ctrl+C
abg record <tab|ref> --out flow.json              # same (flow is the default subcommand)
abg replay flow.json --dry-run
abg replay flow.json --match-url "*kintone*"

# Management
abg revoke <tab|ref>                    # Stop sharing
abg audit [--lines 50]                  # Local audit log
abg activity --period day|week          # Local daily/weekly activity digest
abg mcp-server                          # Stdio MCP wrapper over the same abg CLI
```

### Bringing a shared tab to the front

`abg raise <tab|ref>` activates the selected shared tab, then focuses the browser window that
already contains it. The command accepts the same short refs and `--match-url` / `--match-title`
selectors as other tab commands. It does not create a tab or window, navigate, or search outside the
Gateway's shared-tab list. If sharing was revoked, expired, or invalidated by a cross-origin
navigation, the command fails with the normal `tab_not_permitted` guidance before Chrome is asked to
focus anything. The explicit CLI invocation is the presentation consent, so it does not open a
second approval window; the Gateway records `raise_tab`, extension ID, tab ID, and the shared URL in
the local audit log.

ABG intentionally does not provide `abg open <url> --new-window --activate` for normal personal
profiles. Creating browser tabs or windows remains limited to isolated `sandbox/all-tabs` mode.
On macOS, users can keep a separate AppleScript helper when they intentionally need to open an
arbitrary URL in a new Chrome window or search all Chrome tabs by URL. That helper uses macOS
Automation permission and operates outside ABG, so it bypasses ABG's explicit-sharing boundary,
permission expiry, and audit log. [Issue #309](https://github.com/arcmanagement/agent-browser-gateway/issues/309)
contains the existing `open-front-window.sh` and `focus-chrome-tab.sh` examples and their macOS
limitations.

### Stable multi-step tab targeting

Run `abg tabs --compact` once, select the target by `profile`, `url`, and `title`, then keep using its
`ref` for the flow:

```bash
abg read t12 --selector "main" --format text
abg fill t12 --selector "textarea" --value "Hello"
abg read t12 --selector "textarea" --editable-value
```

The `targetId` in compact JSON is the Gateway's profile-qualified routing handle. It is intended for
machine consumers; scripts should normally retain the human-readable `ref`. Raw `tabId` remains
accepted when it is unique across connected profiles.

### File attachment

`abg upload` is the canonical route in ABG v0.4.3 and later. It works when Chrome's **Allow access to
file URLs** setting is enabled for the Agent Browser Gateway extension, the selector resolves to a
top-document `<input type="file">`, and the supplied paths are absolute and readable. Chrome applies
that explicit local-file access grant to debugger file attachment even when the target page uses
HTTP or HTTPS. Repeat `--file` only when the input has the `multiple` attribute. ABG resolves the
input to a stable CDP backend node before calling `DOM.setFileInputFiles`.

If the site exposes a custom upload button, inspect the page for its underlying file input and target
that input. Cross-origin iframe inputs and widgets that do not expose a top-document file input are
not supported; use the site's manual attachment UI instead. Do not synthesize `DataTransfer` or
`DragEvent` through `eval`.

When local-file access is off, ABG returns `file_access_required` with the exact recovery step instead
of exposing Chrome's raw `{"code":-32000,"message":"Not allowed"}` debugger error. Current versions
also use the stable CDP backend node ID so DOM lookup and attachment do not depend on a transient
frontend node ID. Other Chrome rejections return `file_attach_failed` with selector, frame, and path
guidance. If local-file access cannot be enabled, use the site's manual attachment UI.

### Eval script size and timeout

`eval` defaults to 75 seconds, or a higher profile default, so the local approval window can finish.
`--timeout` is clamped to 1–300 seconds. Keep script source at or below 64 KiB. The hard limit is
256 KiB; larger `--script-file` input fails locally with `script_too_large` before it reaches the
browser. A timed-out accepted script returns `command_timeout` with the effective timeout and script
size in the message. Split large work or replace it with named primitives, `upload`, `wait --fn`, or
a local plugin command.

Use `fill` for native `input`, `textarea`, and plain `contenteditable` targets when one explicit
replacement command is enough. It dispatches `beforeinput`, `input`, and `change` metadata, avoids
clipboard dependence, and returns the detected editable kind plus replacement lengths. Use
`replace-editable` when the stronger command name makes a CMS/rich-editor workflow clearer; it uses
the same replacement path and can read from `--text-file` or `--stdin`. Add `--diff` when a high-risk
editor change needs compact before/after evidence. ABG captures selector-scoped text and HTML
hashes, lengths, and redacted bounded excerpts in the command result and local audit log, but does
not write full before/after content or replacement values by default. Use `type` when the target
already has focus and needs per-character keyboard events. Use `paste` for rich editors that ignore
synthetic value updates or character events, including Lexical, ProseMirror, Slate, Quill, and many
native editable surfaces. `paste` writes the text to the clipboard, focuses the selected editable
element, and sends Cmd+V on macOS or Ctrl+V elsewhere; the audit log records the action, tab id,
selector, and byte length only, never the pasted text.

Use `activity --period day` or `activity --period week` when you want an opt-in local digest of
recent agent activity instead of raw JSONL events. The digest is generated from the on-device audit
log only and summarizes action counts, tab IDs, origins, timestamps, and approval outcomes. It does
not include raw pasted values, clipboard payloads, plugin arguments, or raw audit `details`. Use
`audit` when you need exact event records for debugging or review.

Replay flows are governed by the [Replay Policy](docs/REPLAY_POLICY.md). Flow files should keep
repeatable operation shape and non-secret defaults, while caller-provided values stay in explicit
runtime input or a separate local values file. Secret placeholders use `{{secret.name}}` and must
not be written to flow files, audit logs, dry-run output, screenshots, HAR files, or exported replay
artifacts. `abg replay --dry-run` is a preflight preview: it may show target metadata, step order,
required variable names, secret/non-secret classification, and value byte lengths, but not raw
values or browser artifacts.

Use `clipboard-write` and `paste-rich` for app-specific clipboard formats. `clipboard-write` writes
one MIME payload to the local OS clipboard without a tab operation. `paste-rich` sends the native
paste shortcut to the currently focused target, or focuses `--selector` first. The combined form
`abg paste-rich t1 --mime "<type>" --value "<payload>"` writes the clipboard and pastes in one
audited tab operation; the audit log records the tab, MIME type, and payload byte length, not the
payload.

For a Google Sheets edit-mode cell, prepare a Sheets wrapped clipboard payload whose cell value
contains the newline, focus the target cell in edit mode, then paste through the native path:

```bash
abg paste-rich t1 \
  --mime "application/x-vnd.google-docs-sheets-clip+wrapped" \
  --file sheets-multiline-cell.clip
```

For a rich editor that accepts HTML clipboard data, paste `text/html` while targeting the editable
surface:

```bash
abg paste-rich t1 \
  --selector '[contenteditable="true"]' \
  --mime "text/html" \
  --value '<p>First line</p><p><strong>Second line</strong></p>'
```

For Figma layer paste, write the Figma-specific MIME payload first, focus the canvas, then run
`abg paste-rich t1`.

Use `exec-command` when the target already has focus in an edit-mode proxy and browser-native
`document.execCommand` is the right input path. For example, double-click a Google Sheets cell or
focus a contenteditable rich editor, then run
`abg exec-command t1 --command insertText --value $'first line\nsecond line'`. The initial
allowlist is `insertText`, `delete`, `selectAll`, `undo`, and `redo`; unsupported names fail before
the browser sees the command. Audit logs record the tab, command name, and value byte length, not
the inserted text.

Use `clear` as the single-purpose primitive for emptying rich editors. It focuses the editable
target, selects its content, and deletes it. The result includes `clearStrategy`, one of
`execCommand`, `selectionRange`, `syntheticInput`, `keyboardShortcut`, or `null`.

Use `get` when a script needs one compact value instead of a larger `read` payload. `get text/html`
returns one selector-scoped value, `get count` returns a match count, `get box` returns a viewport
rect, and `get styles --props display,color` keeps computed-style reads small.
Use `get editable-value` or `read --editable-value` for rich editors when the visible editable text
and serialized contenteditable DOM may diverge.
Use `is-visible`, `is-enabled`, and `is-checked` for conditionals; a false predicate still exits
successfully and returns `{ "value": false }`.
Use `find` when CSS selectors would be brittle. `find role t1 button click --name "Save"` resolves
by role and accessible name, while `text`, `label`, `placeholder`, `alt`, `title`, and `testid`
cover common Playwright-style locators. Use `inspect` or `text` actions to inspect matches before
mutating actions such as `click`, `fill`, `hover`, `focus`, `check`, or `uncheck`.
`find first`, `find last`, and `find nth` apply explicit index modifiers to a CSS selector; `nth`
uses zero-based indexes so scripts can align with array-style JSON output.
Use `frames` before targeting iframe content. `frames` returns stable refs such as `@f1`, frame
URLs, names, titles, nesting, and accessibility flags. Pass `--frame @f1` to `read`, `get`,
`find`, `snapshot`, predicates, waits, and selector actions so frame targeting is explicit in CLI
params, approvals, and recorded flows. ABG currently targets same-origin accessible frames only;
cross-origin frames are listed but selector access returns `frame_not_accessible` instead of
silently falling back to the top document.
Use `eval` only as the long-tail escape hatch when named primitives are not enough. It is disabled
by default in the extension popup. When Trusted automation / AutoMode is off, every call must pass
`--approve` and Chrome opens a local approval window containing the exact script. When AutoMode is on,
eval on already-shared tabs skips that popup. The audit log records the script source, approval mode,
and result type/size summary; sanitized return values are capped by `--max-bytes`.
Use `snapshot` when an agent needs an inspectable list of visible accessible elements. Each snapshot
assigns refs such as `@e1`; refs are scoped to the latest snapshot for that tab and can be used with
`abg click <tab> --ref @e1`.
Use `snapshot --tabs "name:tab:selector,..."` for before/after evidence across multiple already
shared tabs. Each target reports partial failure independently, so one missing selector does not
drop successful captures.
Use `download --wait` after a click or form action that is expected to download a file. ABG reports
Chrome download metadata such as URL, suggested filename, MIME type, status, final path when
available, byte counts, and failed/canceled states. It does not open or read downloaded file
contents; if Chrome cannot expose a final path, the result includes `unavailableReason`.
Use `wait-response` when a workflow needs a specific response before continuing. Match by URL glob
or regex, method, status range, and resource type. Timeout returns stable JSON with `ok: false` and
`error: "timeout"`. Response body preview is opt-in with `--body` and capped by `--max-bytes`; ABG
does not store headers or response bodies in audit logs. The older `network --wait-response` spelling
uses the same protocol path and remains available for compatibility.
Use `har` when support/debugging needs a browser-standard network artifact. HAR export is one-shot,
local-only, and redacted by default: cookies, authorization headers, request headers, request
bodies, and response bodies are omitted. Only bounded buffered metadata is exported, with `--limit`
capped at 1000 entries; the Gateway writes the file to `--out` or an ABG temp directory and records
the tab, filters, byte size, redaction mode, and output path in the local audit log.
Use `state` to inspect whether cookies, `localStorage`, or `sessionStorage` contain expected keys
for the shared tab origin. Values are redacted by default; `--values` must be explicit and the
Gateway audit log records that full values were requested. `state` is read-only and does not expose
write/delete operations.
Use `bookmarks` and `reading-list` only after enabling their separate popup toggles. These are
browser-owned personal data commands, not shared-tab page state. Bookmark support uses Chrome's
`chrome.bookmarks` API and the optional `bookmarks` permission. Reading List support uses
`chrome.readingList`, which Chrome documents for Chrome 120+ with the `readingList` permission;
Chromium browsers that do not expose the API return an explicit unsupported error. Audit logs record
the command boundary, counts, ids, and byte lengths, but do not record full bookmark or Reading List
URLs.
Use `framework` for read-only React, Web Vitals, and SPA navigation signals from the current shared
tab. React inspection depends on a compatible page-exposed React DevTools hook; without one, ABG
returns an explicit unavailable result and a bounded DOM marker summary. Web Vitals are snapshots
from the browser Performance API, and SPA navigation is reported only when the browser Navigation
API exposes entries. ABG does not install test-runner instrumentation, pre-page-load scripts,
component patches, or telemetry collectors for this command.
Use `sandbox` only in isolated all-tabs profile mode. The Gateway rejects sandbox browser-owned
automation for normal per-tab shares. Supported mutating controls are viewport emulation,
localStorage/sessionStorage set/delete, and sandbox tab create/close; each action uses the local
operation approval flow and records audit metadata. Do not enable all-tabs mode in mixed personal
profiles.
Use `stream enable` only for long-running local agent sessions that need live DOM mutation,
network, and console events. The stream endpoint is loopback-only and scoped to the currently
enabled shared tab; unsharing the tab stops further events.
Use `validate editable` before saving CMS/editor content when broken HTML-like or shortcode
attributes would be hard to spot visually. It reports compact machine-readable issue locations and
does not mutate the page.

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

## CLI, Skill, and MCP

The agent can talk to ABG by running `abg` from the shell. This remains the source of truth because
it has unique advantages:

- **No HTTP/MCP client required** — any agent that can run a shell command works
- **Trivially debuggable** — run `abg screenshot 445` yourself and see exactly what the agent sees
- **Agent-agnostic** — Claude Code, Codex, Cursor, Cline, your own scripts
- **Skill ergonomics** — Claude Code and Codex skills installed by `npx skills add arcmanagement/agent-browser-gateway -g` teach the agent the CLI in context, including the `agent-browser-gateway` and `abg-plugin-creator` skills

For MCP clients, ABG also ships `abg mcp-server`, a stdio MCP wrapper that exposes a single
`abg_cli` tool. The tool accepts argv tokens after `abg` and launches the local CLI as a child
process. It does not duplicate the Gateway protocol or bypass permissions: per-tab sharing,
operation approval, audit logging, and plugin execution stay on the existing CLI/Gateway path.

Codex config (`~/.codex/config.toml`):

```toml
[mcp_servers.abg]
command = "abg"
args = ["mcp-server"]
```

Claude Code:

```bash
claude mcp add abg -- abg mcp-server
```

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
- **`gmail-plugin` / `slack-plugin` / `linear-plugin`** — First-party per-domain Markdown examples for authenticated app pages.
- **`slack-plugin` commands** — `abg slack catch-up`, `abg slack pending`, and `abg slack open-channel` wrap repeated Slack browser workflows.
- **`redaction-plugin`** — Opt-in local Markdown masking via `abg read --format markdown --redact`.
- **`workflow-plugin`** — Command-abstraction examples using `context.tab.*`.
- **`info-plugin`** — Smoke test: prints a startup line.

User plugins can be installed from the macOS plugin browser or managed from the CLI:

```bash
abg plugin list
abg plugin install user/repo --yes
abg plugin install https://github.com/user/repo.git --yes
abg plugin install git@github.com:user/private-plugin.git --yes
abg plugin update                         # git pull user plugins
abg plugin disable my-plugin              # keep files, stop loading commands/transforms
abg plugin enable my-plugin               # re-enable and reload when the Gateway is running
abg plugin reload my-plugin
abg plugin uninstall my-plugin
```

Repository installs use the local `git` command. Private repositories rely on the user's existing
SSH keys, git credential helper, or GitHub CLI-backed git authentication; ABG does not ask for or
store GitHub tokens.

By default user plugins live under `~/.abg/plugins/`; `ABG_PORT=8766` dev runs use
`~/.abg-dev/plugins/` so local experiments do not mutate production plugin state.
The macOS plugin browser can update or uninstall only these user plugins. Built-in plugins are
bundled with the app, and Local Dev plugins are external working copies, so the browser never
removes them.
User plugins can also be disabled without deleting their directory. ABG persists that toggle in
the active profile's filesystem state (`plugin-state.json` under `~/.abg/` or `~/.abg-dev/`);
there is no app database for plugin enablement.
Gateway Settings use the same profile-local filesystem model and store timeout, approval, and
domain-policy defaults in `gateway-settings.json`; ABG does not run an app database for these
preferences.

See [docs/PLUGINS.md](docs/PLUGINS.md) for the manifest format and authoring guide.

Planned (community / future): more workflow-specific plugins built from these local examples.

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

## Source-available verifiability

Closed-source extensions are not auditable. Source-published extensions distributed only as
binaries are barely better. ABG aims for **end-to-end verifiability**:

- **Every byte of code that touches your browser is in this repo.** No proprietary blobs.
- **Reproducible builds** (target for v1.0): release dry runs use `make reproducible-build` to create unsigned Gateway and extension comparison artifacts, checksums, and an SBOM. The Linux CLI can also be rebuilt through the pinned Docker path in [`docs/REPRODUCIBLE_DOCKER_BUILD.md`](docs/REPRODUCIBLE_DOCKER_BUILD.md). The v1.0 checksum, signing, SBOM, provenance, and user verification plan is in [`docs/RELEASE_ARTIFACT_TRUST.md`](docs/RELEASE_ARTIFACT_TRUST.md).
- **No analytics, no crash reporter, no auto-update phone-home.** The Gateway's only outbound connection is the loopback WebSocket to its own extension. Inspect with `lsof -i -p <gateway-pid>` at any time.
- **Audit log is itself open**: see [`Sources/Gateway/AuditLog.swift`](Sources/Gateway/AuditLog.swift). There is no "secret bypass" to log everywhere except where I'd prefer not to.
- **Dependency minimalism.** PRs that add dependencies require a stated reason. Binary dependencies (`.dylib`, `.so`, `.dll`) are avoided.

If you find ABG transmitting anything outside `127.0.0.1`, that is a bug. Open an issue or, even better, a PR.

---

## Official non-goals and user-controlled deployments

Official ABG will not operate a cloud relay, collect telemetry, or provide silent general JavaScript
execution. Those are product boundaries, not missing roadmap items.

User-controlled deployments are different. Private remote pairing over a user's Tailnet or LAN is
tracked in [#71](https://github.com/arcmanagement/agent-browser-gateway/issues/71) and must remain
a user-operated connection path, not an ABG-operated relay. Likewise, local or organization-owned
metrics can exist in self-hosted deployments only when the user/team controls the endpoint and the
configuration. They are not telemetry sent to ABG operators.

The initial iOS companion pairing design is documented in
[docs/IOS_GATEWAY_PAIRING.md](docs/IOS_GATEWAY_PAIRING.md). It defines QR/manual-code pairing,
the desktop Gateway receiving surface, revocation behavior, and the audit events that must be
written before an implementation is considered complete.

The approved eval boundary remains explicit: eval is disabled by default, must be enabled in the
extension, and is limited to already-shared tabs. With Trusted automation / AutoMode off, `--approve`
and a local approval window are required on every call. With AutoMode on, the user has opted into
skipping that popup for trusted sessions, and audit logging still records script source and approval
mode. Hidden eval without either per-call approval or explicit AutoMode is an official non-goal.

---

## Comparison

ABG is not trying to replace Playwright or browser test runners. Use it when the browser session
already exists: you are logged in, looking at the real page, and want to hand a selected tab, or an
explicitly isolated all-tabs profile, to an AI agent or CLI workflow.

Use **ABG** for:

- inspecting or operating a tab you are already using in your normal Chrome profile
- sandbox Chrome profiles where exposing every tab is intentional but Playwright-owned sessions are inconvenient
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
| `Claude in Chrome` (Anthropic) | First-party extension, transmits to Anthropic | Zero telemetry, multi-agent, public source, per-tab consent |
| `hangwin/mcp-chrome` | Extension bridge, **all tabs always exposed** | Per-tab by default; optional all-tabs only after local opt-in |
| `BrowserMCP` | Extension bridge, Playwright API | Existing Chrome sessions with per-tab default and optional all-tabs profile mode |
| `chrome-devtools-mcp` (Google) | CDP, requires `--remote-debugging-port` | Works with your everyday Chrome profile (Chrome 136+ blocks the CDP path) |
| `vercel-labs/agent-browser` | Spawns Chrome for Testing | Uses the tab you're already looking at, with your logins, in your context |
| `Playwright MCP` (Microsoft) | Dedicated browser, structured snapshots | Per-tab consent on your everyday browser |

The distinction is practical: Playwright is excellent when you want a repeatable browser that the
automation owns; ABG is for safely exposing human-owned browser state to an agent, with per-tab
sharing by default, an explicit all-tabs profile mode for sandboxes, JSON output, local-only
transport, and a visible audit trail.

Advanced parity features are governed by the
[Advanced Automation Policy](docs/ADVANCED_AUTOMATION_POLICY.md). The policy classifies each
capability as normal `per-tab`, `sandbox/all-tabs only`, `user-controlled deployment only`,
`self-hosted only`, or an official `non-goal`, with the required approval and audit behavior for
each mode.

### Feature parity for autonomous agents

| Capability | ABG | Vercel agent-browser / Playwright | ABG boundary |
|---|---|---|---|
| Existing logged-in browser session | Implemented via explicit shared tabs or opt-in all-tabs profile mode | Usually launched or framework-owned browser contexts | ABG exposes tabs only through the selected local access mode |
| Read DOM / text / HTML | `read`, `get text/html/value/attr/title/url/count/box/styles` | Locator/page getters | Selector-scoped JSON by default |
| Frame targeting | `frames`, plus `--frame @fN` on read/get/find/snapshot/predicates/waits/actions | Playwright `frameLocator` / frame targets | Same-origin frames only; cross-origin returns explicit errors |
| Rich editor input | `fill`, `replace-editable`, `paste`, `paste-rich`, `keyboard inserttext`, `exec-command insertText` | `fill`, `keyboard.insertText`, paste-like flows | Clipboard only when explicitly using `paste` / `paste-rich`; exec-command is allowlisted |
| Native actions | `click`, `dblclick`, `focus`, `hover`, `select`, `check`, `uncheck`, `scroll`, `scroll-into-view`, `drag`, `upload`, `pdf` | Locator actions, page PDF, file upload | Write-like actions go through local approval mode |
| Keyboard primitives | `type`, `key`, `keydown`, `keyup`, `keyboard inserttext` | Keyboard type/down/up/insertText | Current focused target only |
| Predicates and waits | `is-visible`, `is-enabled`, `is-checked`, `wait --selector/--text/--url/--load/--fn/--ms` | Locator predicates and wait APIs | `wait --fn` is predicate-only, not data extraction |
| Response waits | `wait-response` or `network --wait-response`, optional `--body --max-bytes` | `waitForResponse`, response body APIs | Body preview is opt-in, size-capped, and headers are not stored |
| HAR export | `har --out file.har`, with URL/method/status/type filters | HAR recording/export | One-shot, local-only, metadata-only redaction by default |
| Cookie/storage inspection | `state --kind cookies/local-storage/session-storage`, optional `--values` | Browser context storage APIs | Read-only, shared-tab origin scoped, values redacted by default and audited when requested |
| Bookmark / Reading List inspection | `bookmarks list/search/get/open`, `reading-list list/search` | Browser bookmark/context APIs | Separate explicit browser permission; not unlocked by per-tab or all-tabs sharing; redacted audit metadata |
| Bookmark / Reading List mutation | Not provided by official ABG | Browser bookmark/context APIs | Official non-goal because profile-wide writes and deletes exceed tab consent; a user-controlled plugin or fork requires a new policy decision |
| Framework/vitals inspection | `framework --kind react/web-vitals/spa` | Framework-aware inspection / performance APIs | Read-only snapshots only; missing hooks fail gracefully |
| Sandbox browser-owned controls | `sandbox viewport/storage-set/storage-delete/tab-create/tab-close` | Browser context emulation and lifecycle controls | Sandbox/all-tabs profile only; approval and audit required |
| Semantic locators | `find role/text/label/placeholder/alt/title/testid`, `first/last/nth` | Playwright locators / agent-browser find | Structured matches before actions |
| AI snapshots | `snapshot` refs such as `@e1`, plus multi-tab selector snapshots | Accessibility snapshots / locator snapshots | Refs are per-tab and per-latest-snapshot |
| Downloads | `download`, `download --wait` | Download lifecycle events | Metadata/path only; file contents are not read |
| Shared-tab video recording | `record start/stop` webm artifact | Browser video/screencast APIs | Explicit start approval, visible recording state, local output, and separate microphone disclosure |
| JavaScript dialogs | `dialog`, `dialog --accept/--dismiss/--prompt-value` | Dialog event/handler APIs | Inspect is read-only; handling uses operation approval and audit |
| Runtime event stream | `stream enable/status/disable` over local `/stream` | Page events / runtime streams | Loopback-only, token-authenticated, and scoped to one shared tab |
| General JavaScript eval | `eval` escape hatch, disabled by default | Playwright `evaluate`, agent-browser eval-like tools | Per-call approval unless Trusted automation / AutoMode is enabled, exact script audit, result size cap |
| Global browser visibility | Optional all-tabs profile mode | Common in automation frameworks | Off by default, local opt-in, removable optional permission, audit log |

ABG treats general-purpose JavaScript eval as an explicit escape hatch, not the default automation
surface. Prefer named, auditable primitives (`get`, `find`, `wait --fn`, `snapshot`, or
manifest-backed plugin commands) whenever they cover the workflow. `wait --fn` remains limited to
readiness predicates and returns only success or timeout state, not arbitrary extracted data.

---

## MVP scope (v0.1)

Currently shipped:

- ✅ macOS 14+ menubar app (Swift + SwiftUI `MenuBarExtra`)
- ✅ Chrome extension (Manifest V3, `activeTab` by default, optional `<all_urls>` only for all-tabs profile mode)
- ✅ Firefox extension MVP target (WebExtensions MV3; see [extension/FIREFOX.md](extension/FIREFOX.md))
- ✅ Per-tab consent with auto-revoke on origin change / tab close
- ✅ Optional all-tabs access for isolated Chrome profiles / sandbox machines
- ✅ Read and inspection tools: `frames`, `read`, `get`, `find`, `snapshot`, `screenshot`, `pdf`, `console`, `table`, `describe`, `network`, and boolean predicates
- ✅ Annotation mode: popup or `abg annotate --start` overlay for numbered DOM/screenshot annotations and comments
- ✅ Operation tools: `click`, `dblclick`, `focus`, `hover`, `select`, `check`, `uncheck`, `fill`, `replace-editable`, `paste`, `clipboard-write`, `paste-rich`, `clear`, `replace`, `upload`, `type`, `key`, `keydown`, `keyup`, `keyboard inserttext`, `exec-command`, `navigate`, `scroll`, `scroll-into-view`, and `drag`
- ✅ JavaScript dialog inspection and approved handling: `dialog`, `dialog --accept`, `dialog --dismiss`, and `dialog --prompt-value`
- ✅ Wait, stream, and validation tools: `wait --selector/--text/--url/--load/--fn/--ms`, `stream enable/status/disable`, and `validate editable`
- ✅ Download lifecycle observation: `download` and `download --wait` return metadata and paths without reading file contents
- ✅ Network response wait and bounded body preview: `wait-response`, `network --wait-response`, `--body`, and `--max-bytes`
- ✅ Redacted local HAR export: `har --out file.har` writes bounded metadata-only HAR artifacts without cloud services
- ✅ Read-only cookie and Web Storage inspection: `state`, with values redacted by default and audited `--values`
- ✅ Explicit-permission browser-owned personal data inspection: `bookmarks` and Chrome `reading-list`, with URL redaction in audit logs
- ✅ Read-only framework and Web Vitals snapshots: `framework --kind react/web-vitals/spa`, bounded and hook-dependent
- ✅ Sandbox-only browser-owned automation controls: `sandbox`, rejected outside all-tabs profile mode
- ✅ Operation approval mode (default ON, popup-gated)
- ✅ Multi-Chrome-profile labelling
- ✅ Local audit log (JSONL)
- ✅ `abg` CLI with Claude Code and Codex Skills bundled
- ✅ Stdio MCP wrapper over the same CLI (`abg mcp-server`)
- ✅ JS plugin system (Obsidian-style; bundled generic Markdown and Notion per-domain plugins)
- ✅ Gateway runtime/macOS shell boundary for future desktop OS ports (see [docs/GATEWAY_CORE_BOUNDARY.md](docs/GATEWAY_CORE_BOUNDARY.md))
- ✅ Extension browser-adapter boundary for future desktop browser ports (see [docs/BROWSER_ADAPTER.md](docs/BROWSER_ADAPTER.md))
- 📋 Windows and Linux desktop OS expansion models are documented separately in
  [docs/DESKTOP_OS_EXPANSION.md](docs/DESKTOP_OS_EXPANSION.md).

In progress / planned (see [ROADMAP.md](ROADMAP.md)):

- 📋 Reproducible builds (v1.0 target)
- 📋 Safari / Edge / iOS / Android (Phase 3+)
- 📋 iOS Safari is blocked research, not MVP scope, until a native iOS companion and reduced
  Safari-compatible command surface are designed.
- 📋 Remote/multi-machine pairing (Phase 4)

---

## Developer setup

### Prerequisites

- macOS 14+
- Xcode 16+ (Swift 6.1+) or Swift toolchain
- [mise](https://mise.jdx.dev/) (manages Node.js + pnpm versions)
- Google Chrome 120+

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

CONFIG=debug APP_VARIANT=dev ./build-app.sh  # produces Agent Browser Gateway Dev.app on port 8766
open "Agent Browser Gateway Dev.app"         # separate menubar app/profile from production
ABG_PORT=8766 .build/debug/abg status        # point CLI at the dev app
```

### Build and load the development extension

```bash
cd extension
pnpm install
pnpm run build                          # outputs to extension/dist/
```

In Chrome: open `chrome://extensions` → enable Developer mode → **Load unpacked** → pick `extension/dist/`.
Use the Chrome Web Store extension for normal installs; use this unpacked build only when developing or testing extension changes.

For incognito / Secret Window workflows, open
`chrome://extensions/?id=ojgedfcgebjchckaagjkmlpgonpjggpi` and enable **Allow in incognito**.
Chrome disables extension access to incognito windows by default; normal tabs do not require this.

### Share a tab

1. Open the tab you want to share
2. Click the ABG extension icon → **Share this tab with agent**
3. A green `ON` badge appears on the icon; the menubar shield icon fills in
4. Verify with `abg tabs`

### Hand it to Claude Code or Codex

```bash
npx skills add arcmanagement/agent-browser-gateway -g   # installs the ABG skills into ~/.claude/skills/ etc.
npx skills list -g                                       # show installed skills
npx skills update -g                                     # refresh them after a release
npx skills remove -g agent-browser-gateway abg-plugin-creator  # uninstall
```

Claude Code or Codex will now invoke `abg` automatically when the conversation references tabs you have shared.

---

## Development

```bash
swift build                             # debug build
swift test                              # Swift unit tests
swift run Gateway                       # single debug process without app-bundle separation
CONFIG=debug APP_VARIANT=dev ./build-app.sh  # separate dev menubar app: 8766 + AgentBrowserGateway-dev/.abg-dev
open "Agent Browser Gateway Dev.app"
ABG_PORT=8766 .build/debug/abg status   # point CLI at the dev app

cd extension
pnpm run watch                          # rebuild on save
ABG_PORT=8766 pnpm run build             # local unpacked extension named Agent Browser Gateway Dev
pnpm run lint                           # Biome (lint + format check)
pnpm run format                         # Biome auto-format
pnpm run typecheck                      # tsc --noEmit
pnpm run test                           # Vitest unit tests
pnpm run test:coverage                  # Vitest coverage for unit-testable extension logic
make verify                             # CI-style local verification
make reproducible-build                 # unsigned release dry run with SBOM and checksums
make docker-repro                       # pinned Docker rebuild of the Linux abg CLI artifact
```

Pull requests run the `CI` workflow's `Swift tests` job on macOS and `Extension tests` job on
Linux. The GitHub check names used by branch protection are `CI / Swift tests` and
`CI / Extension tests`. Those jobs run the following test gates:

```bash
swift test --enable-code-coverage
scripts/swift-coverage-check.sh
cd extension && pnpm run test:coverage
```

**Updates** — Homebrew installs update with `brew upgrade --cask agent-browser-gateway`, Mac App Store installs through App Store automatic updates, and DMG installs by downloading the newer DMG and running the bundled installer again ([details](docs/MACOS_INSTALL_UPDATE_UNINSTALL.md)). There is no in-app updater by design.

Branch-protection verification and emergency bypass rules are documented in [docs/REQUIRED_CHECKS_AND_BYPASS.md](docs/REQUIRED_CHECKS_AND_BYPASS.md).
Current Swift and extension test coverage is inventoried in [docs/TESTING_INVENTORY.md](docs/TESTING_INVENTORY.md).

---

## Security

Threat model and the explicit non-goals are in [SECURITY.md](SECURITY.md). To report a vulnerability privately, see the same file.

In short:
- We **defend against** prompt injection that tries to leak un-shared tabs, accidental over-sharing, and silent audit-log tampering.
- We **do not defend against** other malicious extensions in the same Chrome profile (Chrome's responsibility), root attackers on your machine, or operations the user explicitly authorizes.
- We expose JavaScript eval only as a disabled-by-default escape hatch for already-shared tabs. Per-call approval is the default; explicit Trusted automation / AutoMode can skip the popup while preserving audit logs. The normal CLI surface is curated and named.

---

## Status

🚧 **v0.4.5 / pre-alpha.** Functional for the author's daily use. APIs may change without notice until v1.0.

---

## License

Agent Browser Gateway is published with source code available under the license terms in
[LICENSE](LICENSE). This is a public-source, non-OSI license. [COMMERCIAL.md](COMMERCIAL.md)
summarizes who can use ABG for free and when to contact ArcManagement for a commercial license.

```
Copyright (c) 2026 ArcManagement, Inc. and affiliates.

Licensed under the ArcManagement Source License.
```

### Transparency commitment

ArcManagement publishes the full source code of every release of ABG publicly on GitHub for **transparency and security verification**. Users and security researchers can always inspect what ABG does on their machines.

### Free use — who qualifies

ABG is **free** for the following uses. Within those permitted purposes, the license covers use,
copying, modification, and distribution:

- **Personal, hobby, learning, non-profit, educational, and public research** — individuals, students, charitable organizations, schools, public research institutions, government bodies
- **Small companies** for any use including commercial — companies with **fewer than 50 employees & contractors** AND **less than JPY 500,000,000 annual revenue**

No registration required for free use.

### Larger organizations — let's talk

If your company exceeds the free-use threshold (50 employees / JPY 500M revenue), a commercial license is the right path. Email [`license@arcm.co.jp`](mailto:license@arcm.co.jp) — pricing is case-by-case.

See [COMMERCIAL.md](COMMERCIAL.md) for more.

### Contributing — let's build together

Contributions are welcome. By submitting a contribution, you agree it is licensed under the same terms as the project (inbound = outbound). You also grant ArcManagement, Inc. the right to relicense your contribution as part of the project — including under a commercial license for paying users — should the need arise. Sign off each commit with `git commit -s` per the [Developer Certificate of Origin](https://developercertificate.org/); see [CONTRIBUTING.md](CONTRIBUTING.md).

### Patents

ArcManagement has received a decision to grant Japanese patent application JP 2026-080620 covering aspects of ABG, and the registration fee has been paid. The patent right takes effect once it is entered in the Patent Register. The license grants a patent license for permitted uses; commercial license agreements include explicit patent terms.

### Trademarks

"ABG™" and "Agent Browser Gateway™" are unregistered trademarks of ArcManagement, Inc. See [TRADEMARK.md](TRADEMARK.md).

---

## 日本語サマリ

**「いま開いてるタブを、明示的に AI に渡す。」**

普段使いの Chrome に入れる軽量拡張と、Mac メニューバーに常駐する小さな .app + `abg` CLI。デフォルトでは、ユーザーが明示的に「このタブを共有」とした **そのタブだけ** が、Claude Code などの AI コーディングエージェントから見える。隔離プロファイルや sandbox マシンでは、popup から all-tabs mode を明示的に ON にできる。

### コア思想

1. **per-tab 明示許可がデフォルト** — 通常はタブ単位の許可。`host_permissions` は空。隔離プロファイル用 all-tabs mode のみ optional `<all_urls>` を要求
2. **ソース公開 / テレメトリゼロ / 検証可能** — Anthropic / Google / Microsoft が**構造的に**提供できない価値。閉じたソースの拡張は買収やポリシー変更でマルウェア化する歴史がある (The Great Suspender, Stylish, Hover Zoom, etc.)。ABG はあなたの AI が**コードレベルで何をするか**を完全に検証可能にする
3. **CLI + Skill が primary** — MCP より先に CLI。シェルがあれば任意のエージェントから使える
4. **失効は明示的** — オリジン遷移 / タブクローズ / 明示解除。タイムアウトはオプション
5. **すべて監査ログに記録** — JSONL ファイル、自分でも `abg audit` で読める

詳しい設計議論は [`docs/`](docs/) を参照 (Claude.ai 上の設計セッションからの引き継ぎドキュメント)。
