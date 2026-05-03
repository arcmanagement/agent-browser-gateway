# Roadmap

Living document. Reflects current intent, not commitment. Last updated 2026-05-02.

Current repo version: **v0.2.3**.

## Shipped

### v0.1 — read-only baseline (2026-05-01)
- macOS 14+ menubar app (Swift / SwiftUI `MenuBarExtra`)
- Chrome MV3 extension (`activeTab` + `scripting` + `debugger` + `tabs` + `storage` + `alarms`, **no `host_permissions`**)
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

## In progress (v0.1.2)

- `wait` / `wait_for` (selector / text / timeout) so dynamic pages don't need `sleep` in scripts
- WS bind retry (Gateway currently does not retry if the port is already in use)
- Skill auto-sync: `install-skill` always reflects the current CLI surface, with a version pin
- `screenshot --clip x,y,w,h` for partial captures (saves agent-context dramatically)
- `read --selector` and `read --as-markdown` for compact DOM extraction
- Multi-tab UX polish in popup and menubar

## Next (v0.2)

- Multiple Chrome profiles bound to a single Gateway (profile = extension instance)
- MCP server as a thin wrapper over the same CLI for ecosystem coverage
- `record` / `replay` for repeatable agent flows
- Settings UI (in the Gateway window) for: timeout defaults, approval mode, per-domain policy

## Later (v0.3+)

- Audit log viewer in the Gateway UI
- Daily/weekly digest of agent activity (local only, opt-in)
- `wait_for_response` and other DevTools-Protocol-flavored tools (network idle, page load, etc.)

## Phase 3

- Firefox extension (WebExtensions, MV3 path)
- Safari Web Extension (App Extension, requires Apple Developer Program)
- Edge / Brave (mostly trivial after Chrome)
- Windows port of the Gateway

## Phase 4

- iOS Safari Web Extension
- Android Chrome
- Remote pairing: connect to a Gateway running on another machine on the same Tailnet / LAN, with QR-code pairing
- Approval forwarding from a phone (review what the agent wants to do on your laptop, from your phone)

## Hard non-goals

These will not happen, regardless of demand:

- Cloud relay we operate. ABG must remain runnable with all networking blocked except loopback.
- Any telemetry / analytics. Even opt-in.
- An "execute arbitrary JavaScript" tool exposed to agents.
- Closed-source modules in this repo. Commercial features (if any) live in separate repos.

## Reproducibility milestones (toward v1.0)

- [ ] Docker image that builds the Gateway and CLI byte-for-byte deterministically
- [ ] GitHub Actions release workflow with publicly readable build logs
- [ ] SBOM (CycloneDX) attached to every release
- [ ] GPG-signed release tags and binaries
- [ ] Documented hash-verification procedure: download → verify → install
