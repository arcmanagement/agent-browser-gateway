# Roadmap

Living document. Reflects current intent, not commitment. Last updated 2026-07-27.

Current repo version: **v0.4.2**.

## Shipped

### v0.4.2 — Tab recording and explicit personal data inspection (2026-07-09)
- Added `abg record start/stop/status` for approval-gated WebM recording of a shared Chrome tab, including tab audio and optional microphone mixing.
- Kept recording behind an explicit local approval window; the Allow click mints the Chrome `tabCapture` stream ID so CLI-driven recording still satisfies the user-gesture requirement.
- Streamed MediaRecorder chunks through the extension and Gateway to disk, added a red `REC` badge, documented manual verification in `docs/RECORDING.md`, and kept Firefox builds free of Chrome-only recording permissions.
- Added `abg bookmarks list/search/get/open` and `abg reading-list list/search` behind separate popup toggles and Chrome optional permissions, with audit metadata that avoids storing full saved URLs.

### v0.4.1 — Audit log performance patch (2026-06-10)
- Changed `abg audit --lines N` to read JSONL entries from the end of the audit log instead of decoding the entire local log file.
- Limited the Gateway Audit window to the latest 500 entries and moved reload work off the main UI path so large local audit logs no longer make the window sluggish.
- Added regression coverage for large audit-log tail reads and zero-line tail requests.

### v0.4.0 — Public launch release and cross-platform packages (2026-06-09)
- Published ABG as a public-source repository with counsel-reviewed license, commercial-use, contribution, notice, trademark, and patent-status guidance.
- Refreshed the public documentation site and download surface so macOS, Windows, and Chrome extension release artifacts point to the same current version.
- Added Windows release packaging coverage alongside the signed/notarized macOS payload and Chrome Web Store submission ZIP release asset.
- Added release follow-through for package managers: Homebrew Cask stays aligned with the GitHub Release asset, and Windows release publication can generate and submit WinGet manifests for `ArcManagement.AgentBrowserGateway`.

### v0.3.12 — Trusted eval automation and release freshness guardrails (2026-05-31)
- Added Trusted automation / AutoMode for eval-heavy trusted sessions, allowing already-shared tabs to skip the per-call eval approval popup only after the user opts in.
- Kept eval disabled by default, preserved the `--approve` + local approval default path when AutoMode is off, and recorded approval mode plus result summaries in audit entries.
- Required release bumps to verify docs, GitHub Pages content, and bundled Claude/Codex skill guidance before packaging so release artifacts and user guidance stay aligned.

### v0.3.11 — Advanced browser parity under consent boundaries (2026-05-30)
- Added iframe frame targeting, JavaScript dialog handling, download lifecycle inspection, response waits/body previews, and redacted HAR export for shared tabs.
- Added read-only cookie/Web Storage inspection, framework/Web Vitals diagnostics, and sandbox/all-tabs browser-owned controls with approval and audit requirements.
- Documented the advanced automation policy, official non-goals, user-controlled deployment boundary, GitHub Pages docs, and bundled Claude/Codex skill guidance for the updated command surface.

### v0.3.10 — All-tabs profile mode and public docs (2026-05-28)
- Added optional all-tabs profile access for isolated Chrome profiles and sandbox machines, with Chrome's optional `<all_urls>` permission requested only after local user opt-in.
- Plumbed `accessMode` through the extension, Gateway protocol, CLI compact tab lists, audit details, and Windows protocol parity so agents can distinguish `manual` from `all_tabs` context.
- Added the public Docs page and refreshed README, SECURITY, Chrome Web Store notes, plugin docs, and bundled Claude/Codex skill guidance for the updated trust model.

### v0.3.9 — Incognito access guidance (2026-05-27)
- Added Chrome incognito access detection to the extension popup so users can see when Chrome has not allowed ABG in incognito windows.
- Added a popup settings shortcut and blocked incognito tab sharing with an explicit error when access is disabled.
- Updated setup and temporary zip install docs to explain Chrome's `Allow in incognito` switch for Secret Window workflows.

### v0.3.8 — Approved JavaScript eval escape hatch (2026-05-25)
- Added `abg eval` as a disabled-by-default escape hatch for long-tail browser workflows that named primitives do not cover.
- Kept eval behind extension settings, with `--approve` and a local approval window by default; explicit Trusted automation / AutoMode can skip the popup for already-shared tabs while preserving audit.
- Added sanitized return serialization, result size caps, and audit entries with script source plus result type/byte summary.
- Updated README, SECURITY, bundled Claude/Codex skill guidance, Windows docs, and GitHub Pages download metadata for the new boundary.

### v0.3.7 — Agent-browser / Playwright parity CLI expansion (2026-05-25)
- Completed Epic #96 by shipping the autonomous-agent CLI parity layer across focused sub-issues.
- Added compact inspection primitives (`inspect`, `get`, `find`, `snapshot`, predicates, multi-tab snapshots) so agents can avoid brittle CSS and oversized DOM reads.
- Expanded browser actions (`dblclick`, `focus`, `hover`, `select`, `check`, `uncheck`, `scroll-into-view`, key down/up, direct text insertion, PDF, richer waits, stream, and editable validation) while preserving per-tab consent and approval-mode boundaries.
- Refreshed README and the bundled Claude/Codex skill guidance so the documented command surface matches the release.

### v0.3.6 — Plugin commands API and authoring guide (2026-05-07)
- Added first-class plugin commands from PR #118 as the headline public API for this release.
- Documented user plugin authoring in the bundled ABG skill, including `plugin.json` command metadata,
  `abg.registerCommand`, handler context, invocation forms, and audit-log privacy rules.
- Kept `docs/PLUGINS.md` as the deeper human-facing tutorial and cross-linked it from the skill.

### v0.3.5 — Rich editor paste and clear primitives (2026-05-07)
- Added `abg paste` with native paste, `execCommand`, and synthetic `ClipboardEvent` fallback paths for rich text editors.
- Added `abg clear` with independent clearing strategies for editors that ignore synthetic key events.
- Documented `clear` then `paste` as the replacement-content idiom for rich editor workflows.

### v0.1 — read-only baseline (2026-05-01)
- macOS 14+ menubar app (Swift / SwiftUI `MenuBarExtra`)
- Chrome MV3 extension (`activeTab` + `scripting` + `debugger` + `tabs` + `storage` + `alarms`, no default `host_permissions`, optional `<all_urls>` for all-tabs profile mode)
- Per-tab consent with auto-revoke on origin change / tab close / explicit revoke
- Read tools: `read` / `screenshot` / `console`
- `abg` CLI (Swift Argument Parser)
- Local audit log (JSONL)
- Claude Code Skill bundled

### v0.1.1 — operations (2026-05-01)
- `click` (selector + xy coordinates), `fill`, `type`, `key`, `navigate`, `scroll`
- Operation approval mode: read-only is automatic, write operations require popup OK (default ON for new installs)
- WebSocket frame size raised to 256 MB (was Vapor default 16 KB → silently dropped screenshots)
- Extension service-worker heartbeat fixed to Chrome 117+ minimum (0.5 min)

### v0.1.3 — CDP everywhere & plugin architecture (2026-05-02)
- `scroll` rewritten to CDP `Input.dispatchMouseEvent` `mouseWheel` — works on inner-scroll containers (Gemini chat, ChatGPT, Slack threads) and no longer needs `host_permissions`
- `read` rewritten to CDP `Runtime.evaluate` — works on every origin without `host_permissions`
- **JS plugin system** (Obsidian-style): JavaScriptCore in the Gateway, plugins in `Agent Browser Gateway.app/Contents/Resources/plugins/`, minimal `abg` host API (`abg.log`, `abg.registerTransform`)
- Bundled `markdown-plugin`: HTML→Markdown conversion moved out of the extension into a plugin. The extension now returns raw HTML; the Gateway invokes the plugin transformer when `--as-markdown` is requested
- Bundled `info-plugin`: smoke test that exercises the plugin loader at startup
- Token economy benchmark in README: `~88%` reduction vs Playwright `page.content()` while preserving structure

### v0.2.x — workflow tools and distribution polish (2026-05-03)
- `wait` (`--selector`, `--hidden`, `--ms`) for dynamic pages
- `table`, `describe`, and `network` observation tools for compact page inspection
- `upload` via Chrome DevTools Protocol `DOM.setFileInputFiles`
- `record` / `replay` for repeatable CLI-originated agent flows
- `install-skill` installs the bundled guidance into both Claude Code and Codex skill directories (replaced by `npx skills add` in 0.4.4)
- Homebrew-style release artifacts: macOS app/CLI zip, Chrome extension zip, and generated cask

### v0.3.0 — annotation mode (2026-05-03)
- Popup and CLI entrypoints for annotation mode (`Annotate this tab`, `abg annotate --start`)
- Numbered annotations with comments, move, resize, Delete/Backspace removal, Clear, Done, and Escape stop
- Automatic `dom` vs `screenshot` classification for cursor annotations
- DOM annotations track selectors, text/style metadata, scroll, iframe, and responsive layout changes
- Screenshot annotations remain available for arbitrary visual regions, canvas, video, and ambiguous wrappers
- `replace` operation for temporary DOM swaps from annotation-derived selectors

### v0.3.1 — DOM annotation polish (2026-05-03)
- DOM annotations stay locked to their selector and cannot be moved or resized from the overlay
- Screenshot annotations remain manually movable and resizable
- Skill and README guidance now distinguish DOM selector annotations from screenshot-region annotations

### v0.3.2 — TextAnnotation mode (2026-05-03)
- Annotation mode now has separate **Area** and **Text** modes
- Text annotations are first-class `kind: "text"` data with top-level selected text and `textAnchor` metadata
- Text selections render as line-by-line selection highlights instead of screenshot-style rectangles
- Multi-element text selections store DOM Range anchors and follow responsive layout changes
- README, bundled app resources, and Claude/Codex skills document the text annotation workflow

### v0.3.3 — Public-source security hardening (2026-05-03)
- Gateway WebSocket rejects non-extension Origins before accepting messages
- Runtime support/log directories are owner-only, and the audit log is owner-only
- Extension Popup renders page-derived tab titles/URLs with DOM text APIs instead of HTML strings
- CI permissions, local secret ignores, security policy, and signing/notarization docs are tightened
- Extension tooling is updated to clear the current moderate `esbuild` advisory

### v0.3.4 — ChatGPT Atlas annotation support (2026-05-03)
- Annotation mode falls back to Chrome DevTools Protocol `Runtime.evaluate` when `chrome.scripting.executeScript` is blocked by browser host-permission behavior
- Popup and CLI annotation entrypoints ensure the debugger session is attached before starting annotation mode
- Existing Chrome behavior continues to use `chrome.scripting.executeScript` first

## In progress

- WS bind retry (Gateway currently does not retry if the port is already in use)
- MCP stdio wrapper (`abg mcp-server`) over the same CLI for ecosystem coverage
- More domain-specific annotation heuristics without accidentally selecting oversized wrappers
- Gateway Settings UI for profile-local timeout defaults, approval defaults, and per-domain policy storage

## Next

- Audit log viewer in the Gateway UI
- Multiple Chrome profile UX polish
- Browser-owned personal data expansion under #178 continues as an explicit-permission track,
  separate from normal per-tab sharing. #199 adds bookmark inspection and Chrome Reading List
  inspection behind dedicated optional permissions; follow-up work should keep the same audit and
  URL-redaction boundary.

## Later

- Daily/weekly digest of agent activity (local only, opt-in)
- `wait_for_response` and other DevTools-Protocol-flavored tools (network idle, page load, etc.)
- Browser-owned automation controls such as storage mutation, network mocking, init scripts,
  emulation, and tab/window management are sandbox/all-tabs profile work, not normal per-tab work.

## Phase 3

- Gateway runtime/macOS shell boundary for desktop OS ports
- Shared extension browser-adapter boundary for desktop browser ports
- Firefox extension MVP (WebExtensions MV3 manifest, share/revoke/read/screenshot fallback path)
- Safari Web Extension (App Extension, requires Apple Developer Program)
- Edge / Brave (mostly trivial after Chrome)
- Windows port of the Gateway, including tray lifecycle, launch-at-sign-in, and WinUI setup/status surfaces

## Phase 4

- iOS Safari Web Extension: blocked research, not MVP scope until a native iOS companion design
  replaces the current local Gateway/CLI bridge and the extension command surface is reduced to APIs
  that Safari exposes on iOS.
- Android Chrome
- Remote pairing: connect to a Gateway running on another machine on the same Tailnet / LAN, with QR-code pairing (#71). This is a user-controlled private path, not an ABG-operated relay.
- Approval forwarding from a phone (review what the agent wants to do on your laptop, from your phone)

### iOS Safari Web Extension feasibility (#66)

Current decision: iOS Safari support is not an MVP port of the Chrome extension. It is a later
native-companion research track. The existing ABG model assumes a desktop Gateway process, loopback
WebSocket, Unix domain socket, and `abg` CLI. Apple packages Safari web extensions as macOS,
visionOS, or iOS app extensions inside a containing app, and the extension, containing app, and
native app extension run in separate sandboxes. That makes iOS support a product and architecture
project, not a manifest conversion.

Apple references:

- [Safari web extensions](https://developer.apple.com/documentation/safariservices/safari-web-extensions)
- [Creating a Safari web extension](https://developer.apple.com/documentation/safariservices/creating-a-safari-web-extension)
- [Managing Safari web extension permissions](https://developer.apple.com/documentation/safariservices/managing-safari-web-extension-permissions)
- [Assessing your Safari web extension's browser compatibility](https://developer.apple.com/documentation/safariservices/assessing-your-safari-web-extension-s-browser-compatibility)
- [Messaging between the app and JavaScript in a Safari web extension](https://developer.apple.com/documentation/safariservices/messaging-between-the-app-and-javascript-in-a-safari-web-extension)

Capability mapping:

| ABG capability | iOS Safari extension-only status | Native companion requirement | MVP decision |
|---|---|---|---|
| Per-page read state (`read`, `get`, `snapshot`) | Partially feasible after the user grants website access from Safari's More menu or Settings. `tabs` needs host permission, `scripting.executeScript` lacks `injectImmediately`, and dynamic content-script registration requires Safari 16.4 or later. | Required for an external agent command channel, durable audit and policy storage, and cross-session state. Page code must route messages through extension background or UI code. | Not MVP. A limited read-only prototype is feasible but is not ABG parity. |
| Screenshots (`screenshot`, visual annotations) | Partially feasible for visible-tab capture. Apple documents `tabs.captureVisibleTab`, but ABG also needs desktop file output, annotation coordination, and debugger-backed fallbacks. | Required to persist or export captures and connect them to an agent workflow. | Research-only. Prototype visible-tab capture on a real iOS device before committing to this scope. |
| Operation approval (`click`, `fill`, `type`, `navigate`, dialogs, eval) | Simple content-script operations and extension UI may be feasible, but ABG's current command surface relies heavily on Chrome's `debugger` API and DevTools Protocol. Safari provides no equivalent iOS path for those commands. | Required for durable approval state, audit logging, and a native review surface. Native messaging goes through a native app extension; Apple also states that a containing iOS app cannot initiate messages to the extension's JavaScript. | Unsupported for MVP. Any later write primitive must preserve explicit approval and audit semantics, and the extension must initiate native exchanges. |
| Network, cookies, downloads, sandbox/all-tabs, PDF, HAR, emulation, and file operations | Not feasible as extension-only ABG parity. Apple documents `webRequest` as unsupported on iOS, storage and window API limits, and App Store updates instead of `update_url`. ABG also uses Chrome-only permissions including `debugger`, `downloads`, `tabCapture`, and `offscreen`. | A companion can provide app storage, export, and approval UI, but cannot recreate missing Safari extension APIs. | Explicitly unsupported for iOS MVP. |

Browser-extension-only scope that may be worth a later prototype:

- Safari-packaged extension with `activeTab`, narrow host permissions, popup/share UI, and website
  permission guidance.
- Read-only DOM and text extraction from a user-granted page using supported `tabs` and `scripting`
  APIs, with clear errors for unsupported frames or missing website permission.
- Visible-tab capture proof of concept on a real iOS device.
- Local extension storage for transient share state, within Safari's storage limits.

Native-companion scope required before any ABG-branded iOS support:

- iOS containing app and native app extension packaged through Xcode and App Store distribution.
- App group storage shared by the containing app and native app extension.
- Extension-initiated native messaging through the native app extension. The containing iOS app
  cannot send unsolicited messages to extension JavaScript.
- Replacement for desktop Gateway and CLI semantics, since iOS cannot expose the same Unix socket
  and shell-driven `abg` workflow to a coding agent running on a desktop.
- Native approval and audit surfaces that preserve ABG's user-visible control model.

Unsupported behavior for iOS Safari:

- No Chrome DevTools Protocol or `chrome.debugger` automation parity.
- No sandbox/all-tabs profile mode equivalent.
- No browser-owned network interception, HAR export, download lifecycle, PDF generation, cookie
  inspection, emulation, file upload, or dialog handling parity.
- No background desktop agent connection matching the current local Gateway and CLI transport.
- No hidden eval or write operation without explicit user approval.

## Hard non-goals

These will not happen, regardless of demand:

- Cloud relay we operate. ABG must remain runnable with all networking blocked except loopback; #71 is limited to private Tailnet/LAN pairing controlled by the user.
- Any telemetry / analytics sent to ABG operators. User/team-owned local metrics in self-hosted deployments are separate from official ABG telemetry.
- Hidden JavaScript execution without explicit user policy. The only general eval path is disabled by default and requires explicit enablement plus either per-call local approval or explicit Trusted automation / AutoMode, with audit.
- Closed-source modules in this repo. Commercial features (if any) live in separate repos.

## Reproducibility milestones (toward v1.0)

- [ ] Docker image that builds the Gateway and CLI byte-for-byte deterministically
- [ ] GitHub Actions release workflow with publicly readable build logs
- [ ] SBOM (CycloneDX) attached to every release
- [ ] GPG-signed release tags and binaries
- [ ] Documented hash-verification procedure: download → verify → install
