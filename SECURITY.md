# Security Policy

## Reporting a vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report vulnerabilities privately to `contact@arcm.co.jp`. Do not include account passwords, browser credentials, or private page content in public reports.

## Supported versions

The Chrome extension is 1.0.0; desktop packages retain separate versions. Only the latest released version of each component receives security fixes. Unreleased commits on `main` may contain known issues.

| Version | Supported |
|---|---|
| `main` (latest commit) | yes (best effort) |
| latest tagged release | yes |
| older tagged releases | no |

## Threat model

### Optional Cloud mode

Extension 1.0.0 can connect to the service selected in the popup without a desktop Gateway. The official account UI is `https://app.agent-browser-gateway.com`; browser login, route discovery, and shared-tab traffic use `https://connect.agent-browser-gateway.com` and `wss://connect.agent-browser-gateway.com`. Account login authorizes browser registration and client access. The service handles shared-tab metadata, requested content, screenshots, operation inputs/results, and transferred artifacts. This mode is not local-only, and local audit-file guarantees below apply to the desktop path. See [Cloud usage](docs/CLOUD_EXTENSION.md).

The extension stores a browser credential in trusted extension storage, never the account password. Only registered browsers and authorized clients may participate. Per-tab consent remains the default. Sandbox and auto-resume require separate explicit opt-in in an isolated profile; resume is scoped to the saved destination and credential and authenticates before tabs are announced. Revocation and invalid credentials stop access. Cloud policy can require approval even when the browser's local write-approval toggle is off. Recording and Cloud file attachment retain browser approval gates.

Switching local/Cloud mode, changing a Cloud endpoint, or replacing its credential resets personal-data access, mutation, eval, and Trusted automation settings and restores operation approval. Reapplying the same endpoint and credential preserves these settings. Bookmark and Reading List opt-ins cover data outside the shared tab and send requested list data through the selected service. Trusted automation can waive ordinary operation/eval prompts only after the owner enables it for that destination. File attachment uses absolute paths on the browser host and requires both Chrome's file-URL grant and approval displaying the paths; an approved file is exposed to the target website. There is no client-to-browser file-byte transfer in the extension. Download inspection returns metadata and browser-host paths.

The following desktop transport and filesystem properties describe local mode, not Cloud service storage or transport.

### What ABG defends against

- **Prompt injection that tries to leak un-shared tabs.** The Gateway rejects any operation on a `tabId` that is not in the live permission list. The list is updated only by the extension on real `chrome.tabs.*` events or by explicit user action. In all-tabs profile mode, the explicit user action is the local popup toggle plus Chrome's optional permission prompt.
- **Accidental over-sharing through navigation.** A manually permitted tab is automatically revoked when its origin changes. In all-tabs profile mode, navigation is intentionally tracked because the whole isolated profile is the selected boundary.
- **Silent surveillance by an agent.** Every operation is appended to `~/Library/Logs/AgentBrowserGateway/audit.jsonl`. There is no code path that performs an extension command without an audit-log entry.
- **Silent audio/video capture.** `abg record start` always opens a local approval window, even when normal operation approvals are disabled or Trusted automation is enabled. The user's Allow click is also the Chrome `tabCapture` gesture; recording cannot start silently from the CLI alone.
- **Network exfiltration by ABG itself.** Gateway binds only `127.0.0.1`. The extension declares no default `host_permissions`; optional `<all_urls>` is requested only for all-tabs profile mode. There is no analytics / crash reporter / auto-update phone-home.
- **Browser-owned personal data leakage.** Bookmarks and Reading List entries are not part of normal per-tab sharing. They require separate optional API permissions from the extension popup, use dedicated CLI commands, and audit entries record operation metadata without full saved URLs.
- **Malicious websites trying to connect to the local Gateway.** The Gateway WebSocket rejects connections unless the handshake `Origin` is a browser-extension origin (`chrome-extension://`, `moz-extension://`, or `safari-web-extension://`). Normal websites cannot use ABG by opening the local endpoint, such as the default `ws://127.0.0.1:8765/ws`, from page JavaScript.

### What ABG does not defend against

These are explicit non-goals; we will not accept "fixes" that pretend otherwise without a serious threat-model discussion first.

- **Other Chrome extensions in the same profile.** Chrome's extension model itself is not a sandbox boundary against same-profile peers. If you load malicious extensions, they can read everything you can read.
- **Root or same-user attackers on the host machine.** If something on your Mac can read `~/Library/Application Support/AgentBrowserGateway/gateway.sock`, it can talk to the Gateway. Same for the audit log.
- **User-installed plugins.** Plugins under the ABG user plugin directory (`~/.abg/plugins` by default, profile-specific for dev runs) are local code loaded by the Gateway. ABG does not auto-download plugins; install only plugins you trust.
- **Operations the user explicitly authorizes.** If you share a tab and approve a write operation such as `click`, `fill`, `replace`, `upload`, `navigate`, or `record start`, that is by design. Operation approval mode is enabled by default, but the per-tab consent gate remains the primary boundary. Recording has its own approval gate and captures only an already-shared tab.
- **Approved JavaScript eval.** `abg eval` is an explicit escape hatch, disabled by default in extension settings. When Trusted automation / AutoMode is off, every call requires `--approve` plus a local approval window showing the exact script. When AutoMode is on, the local user has explicitly opted into skipping that popup for already-shared tabs; the audit log still records the script source, approval mode, and result summary.
- **Bugs in Chrome, Vapor, SwiftNIO, or other dependencies.** We monitor for advisories and update.

### User-controlled remote and self-hosted deployments

Local mode does not require a Cloud account or relay. Optional Cloud mode is explicitly selected by the user and disclosed above; it does not add analytics or advertising telemetry. A user or organization may also operate a private gateway with an explicit trust boundary.

- Private remote pairing over Tailnet/LAN with QR code is tracked by #71. It must use user-controlled
  connectivity, pairing expiry, revocation, and audit entries, not an ABG-operated cloud relay.
- User/team-owned local metrics in a self-hosted deployment are allowed only when the endpoint and
  data retention are controlled by that user/team. Sending telemetry to ABG operators remains a
  non-goal.
- General JavaScript execution remains disabled by default. Per-call approval is the default even in
  remote or self-hosted deployments unless a separate, explicit local policy such as Trusted
  automation / AutoMode changes that behavior for that user-controlled environment.

## Design invariants

If a future PR violates any of these, it should be rejected:

1. The Chrome extension's manifest keeps `host_permissions` empty. `<all_urls>` may appear only in `optional_host_permissions`, and it must be requested from the popup only when the user enables all-tabs profile mode.
2. Browser-owned personal data APIs such as `chrome.bookmarks` and `chrome.readingList` may appear only in `optional_permissions`, and each must have a separate popup toggle before the Gateway can dispatch its command surface. Reading List is supported only when the target browser exposes `chrome.readingList`; unsupported browsers must return an explicit unsupported error.
3. The Gateway WebSocket / HTTP listener binds only `127.0.0.1`.
4. The Gateway WebSocket accepts browser-extension origins only. Do not weaken the `Origin` allowlist to accept arbitrary `http://`, `https://`, `file://`, `null`, or missing origins.
5. The CLI reaches the Gateway only through owner-protected rendezvous points: the Unix socket (standard state dir, or the app-group container for the sandboxed Store build) is created with `chmod 0700`, and the loopback WebSocket `/cli` fallback and the `/stream` runtime-event route both require the per-launch token from the owner-only (`0600`) `cli-endpoint.json` in the `x-abg-token` header and reject any upgrade that carries an `Origin` header. Loopback TCP is reachable by other local accounts and WebSocket upgrades from web pages are exempt from same-origin policy, so the token requirement must never be dropped from any non-extension local route.
6. Runtime support/log directories are owner-only (`0700`), and the audit log file is owner-only (`0600`).
7. General JavaScript eval is never hidden: it must be disabled by default, require either explicit per-call approval or explicit Trusted automation / AutoMode, and write an audit entry with script source, approval mode, and result type/size summary. Prefer curated, structured, named tools whenever possible.
8. Tab recording is never hidden: it must require a browser approval window, target only a live shared tab, and visibly mark the tab with `REC`. Local mode streams chunks to a local file and audits start/stop metadata. Cloud mode retains chunks in extension IndexedDB for retrieval by the authorized client through the selected service.
9. Any outbound network connection from the Gateway or extension is explicitly disclosed in the README, with the exact endpoint and purpose.
10. The audit log records every read and every operation, with the originating agent identifier where available.
11. Advanced automation features must follow `docs/ADVANCED_AUTOMATION_POLICY.md`: normal per-tab, sandbox/all-tabs only, self-hosted only, or official non-goal. Mutating browser-owned state must not appear in normal personal-profile per-tab mode.

## Dependency security gates

Dependency changes are checked by `.github/workflows/dependency-security.yml`.

Failure conditions:

1. The extension dependency audit runs `pnpm audit --audit-level high` and fails on high or critical npm advisories.
2. Swift dependencies are resolved from `Package.swift` and `Package.resolved`. CI fails if `swift package resolve` changes `Package.resolved`, then uploads `swift package show-dependencies --format json` as the Swift dependency inventory for review.
3. Dependency Review runs with a `high` severity threshold and vulnerability checks enabled, but is advisory until the repository supports Dependency Review Action. Treat high or critical findings from that advisory output as release blockers; license checks are intentionally off until ABG has a separate license-allowlist policy.

Swift strategy:

- `Package.resolved` is the reviewed lockfile for SwiftPM dependencies.
- GitHub Dependency Review is the first review surface for changed manifests and lockfiles where GitHub can identify advisories. It becomes a blocking gate once repository security settings support the action.
- Until there is a stable first-party SwiftPM vulnerability audit command in the toolchain, Swift dependency security review is based on the lockfile diff, GitHub advisories, Dependabot/security alerts, and the uploaded dependency inventory.

Exception policy:

- Do not bypass the workflow with `warn-only` or by lowering the severity threshold in a feature PR.
- A temporary exception must be documented in the PR with the package, version, advisory ID when available, why ABG is not affected or how the risk is mitigated, a follow-up issue, and an expiry condition.
- Security exceptions for runtime dependencies require maintainer approval before merge.
