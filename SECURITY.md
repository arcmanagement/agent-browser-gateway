# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

A private contact channel will be published before the project is opened up for general use. Until then, the project is at pre-alpha and security reports outside the maintainer's circle are not yet being processed.

## Supported versions

ABG is pre-1.0. Only the latest released tag receives security fixes. Unreleased commits on `main` may contain known issues.

| Version | Supported |
|---|---|
| `main` (latest commit) | yes (best effort) |
| latest tagged release | yes |
| older tagged releases | no |

## Threat model

### What ABG defends against

- **Prompt injection that tries to leak un-shared tabs.** The Gateway rejects any operation on a `tabId` that is not in the live permission list. The list is updated only by the extension on real `chrome.tabs.*` events or by explicit user action.
- **Accidental over-sharing through navigation.** A permitted tab is automatically revoked when its origin changes.
- **Silent surveillance by an agent.** Every operation is appended to `~/Library/Logs/AgentBrowserGateway/audit.jsonl`. There is no code path that performs an extension command without an audit-log entry.
- **Network exfiltration by ABG itself.** Gateway binds only `127.0.0.1`. The extension declares no `host_permissions`. There is no analytics / crash reporter / auto-update phone-home.
- **Malicious websites trying to connect to the local Gateway.** The Gateway WebSocket rejects connections unless the handshake `Origin` is a browser-extension origin (`chrome-extension://`, `moz-extension://`, or `safari-web-extension://`). Normal websites cannot use ABG by opening `ws://127.0.0.1:8765/ws` from page JavaScript.

### What ABG does not defend against

These are explicit non-goals; we will not accept "fixes" that pretend otherwise without a serious threat-model discussion first.

- **Other Chrome extensions in the same profile.** Chrome's extension model itself is not a sandbox boundary against same-profile peers. If you load malicious extensions, they can read everything you can read.
- **Root or same-user attackers on the host machine.** If something on your Mac can read `~/Library/Application Support/AgentBrowserGateway/gateway.sock`, it can talk to the Gateway. Same for the audit log.
- **User-installed plugins.** Plugins under `~/.abg/plugins` are local code loaded by the Gateway. ABG does not auto-download plugins; install only plugins you trust.
- **Operations the user explicitly authorizes.** If you share a tab and approve a write operation such as `click`, `fill`, `replace`, `upload`, or `navigate`, that is by design. Operation approval mode is enabled by default, but the per-tab consent gate remains the primary boundary.
- **Bugs in Chrome, Vapor, SwiftNIO, or other dependencies.** We monitor for advisories and update.

## Design invariants

If a future PR violates any of these, it should be rejected:

1. The Chrome extension's manifest never includes `<all_urls>` in `host_permissions`. `activeTab` is the only host-access path.
2. The Gateway WebSocket / HTTP listener binds only `127.0.0.1`.
3. The Gateway WebSocket accepts browser-extension origins only. Do not weaken the `Origin` allowlist to accept arbitrary `http://`, `https://`, `file://`, `null`, or missing origins.
4. The CLI Unix socket is created with `chmod 0700`.
5. Runtime support/log directories are owner-only (`0700`), and the audit log file is owner-only (`0600`).
6. There is no MCP/CLI tool that executes arbitrary user-supplied JavaScript in a permitted tab. Tools are curated, structured, and named.
7. Any outbound network connection from the Gateway or extension is explicitly disclosed in the README, with the exact endpoint and purpose.
8. The audit log records every read and every operation, with the originating agent identifier where available.
