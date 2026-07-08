# Roadmap

Living document. Reflects current intent, not commitment. Last updated 2026-06-10.

Current repo version: **v0.4.1**.

## Shipped

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
- `install-skill` installs the bundled guidance into both Claude Code and Codex skill directories
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
- Browser-owned personal data access for bookmarks and Reading List (#199/#200) remains a later
  explicit-permission track, separate from normal per-tab sharing.

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

- iOS Safari Web Extension
- Android Chrome
- Remote pairing: connect to a Gateway running on another machine on the same Tailnet / LAN, with QR-code pairing (#71). This is a user-controlled private path, not an ABG-operated relay.
- Approval forwarding from a phone (review what the agent wants to do on your laptop, from your phone)

### WKWebView debugging support design note

WKWebView support is a separate target-app integration track, not a direct result of the iOS Safari
Web Extension port.

Current platform constraints:

- Safari Web Inspector is the official Apple debugging surface for Safari pages and inspectable web
  content. It covers DOM, console, JavaScript sources, network activity, storage, graphics, layers,
  and audits.
- App-embedded `WKWebView` content is not automatically exposed to external tooling in release
  builds. Starting with macOS 13.3 and iOS/iPadOS/tvOS 16.4, each app must opt in per web view by
  setting `WKWebView.isInspectable = true`. The same opt-in model exists for `JSContext`.
- On iOS and iPadOS devices, the user must also enable Safari Web Inspector in Settings under
  Safari > Advanced > Web Inspector. Simulators have Web Inspector enabled by default.
- Safari Web Extensions customize Safari browsing on iPhone, iPad, and Mac. They can read and
  modify Safari web page content after the user enables the extension and grants permissions, but
  that extension model does not install into arbitrary third-party app `WKWebView` instances.

ABG implication:

The current ABG extension model cannot attach to app-embedded `WKWebView` content by itself. ABG's
shipped architecture depends on a browser extension running in the user's browser profile and a
local Gateway receiving messages from that extension. A third-party native app's `WKWebView` does
not load the ABG Chrome or Safari extension, and the app decides whether its web view is
inspectable.

Target-app integration requirements:

1. The app owner opts in each supported `WKWebView` by setting `isInspectable` where the OS supports
   it, or provides an app-specific debug bridge when Web Inspector is unavailable.
2. The app exposes a user-visible local debugging or support mode so inspection is intentional and
   reversible.
3. The app provides stable web-view identity, page metadata, and lifecycle events to ABG, because
   browser tab IDs and extension-origin messages are not available inside the app.
4. Operations go through an app-owned consent path. A read-only DOM/screenshot bridge should come
   before any write operation.
5. Transport remains local or user-paired, matching ABG's no-cloud-relay and zero-telemetry
   boundary.

Implementation options:

| Option | Shape | Strengths | Limits | Decision |
|---|---|---|---|---|
| Target-app SDK or adapter | A native app embeds a small ABG bridge around selected `WKWebView` instances and forwards approved observations/actions to the local Gateway. | Preserves explicit app-owner consent, works without private APIs, can provide stable app-specific metadata, and can start with read-only support. | Requires each target app to integrate code and ship an update. ABG cannot make arbitrary apps visible. | Recommended first implementation path after Safari/iOS extension feasibility work. |
| Platform debugging bridge | ABG discovers inspectable WebKit targets through Safari Web Inspector or related WebKit debugging interfaces, then maps them into the Gateway protocol. | Could cover any app that opts into `isInspectable` without app-specific SDK code beyond Apple's property. Useful for diagnostics and support workflows. | Automation APIs are not equivalent to Chrome DevTools Protocol, may depend on undocumented or unstable interfaces, and still requires user/device Web Inspector enablement. | Research-only until a public, stable automation contract is confirmed. |
| Unsupported/deferred | Treat third-party app `WKWebView` automation as outside official ABG scope, while documenting manual Safari Web Inspector workflows. | Honest product boundary, avoids fragile private tooling, and keeps roadmap focused on browser extension ports and private pairing. | Does not solve support workflows for embedded WebViews. | Keep as fallback if no target app partner or stable bridge is available. |

Recommended next step:

Defer general third-party `WKWebView` attachment and proceed only with an explicit target-app
integration track. The first milestone should be a read-only proof of concept for an app owned by
the integrator:

1. App marks selected `WKWebView` instances inspectable in debug/support mode.
2. App bridge reports web-view list, current URL/title, DOM text or HTML snapshot, console messages,
   and screenshots to the local Gateway.
3. ABG CLI exposes those entries separately from browser tabs, for example as `webview:` refs, so
   users can distinguish app-owned WebViews from Safari/Chrome tabs.
4. Write operations remain deferred until consent, audit, and App Review implications are designed.

The platform debugging bridge remains a spike after the target-app proof of concept. It should only
graduate if ABG can rely on public Apple/WebKit contracts rather than private Safari internals.

References:

- Apple Safari developer tools: <https://developer.apple.com/safari/tools/>
- Apple Safari extensions overview: <https://developer.apple.com/safari/extensions/>
- WebKit, "Enabling the Inspection of Web Content in Apps":
  <https://webkit.org/blog/13936/enabling-the-inspection-of-web-content-in-apps/>

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
