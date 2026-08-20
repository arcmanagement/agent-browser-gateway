# Advanced Automation Policy

This document records the ABG policy decision for Playwright / agent-browser parity features.
The rule is simple: convenience must not collapse the per-tab consent boundary of a normal
personal browser profile.

## Modes

| Mode | Meaning |
|---|---|
| `per-tab` | Allowed for an explicitly shared tab in a normal browser profile. Read-only tools should stay here when possible. |
| `sandbox/all-tabs only` | Allowed only in an intentionally isolated browser profile where the user enabled all-tabs access. |
| `user-controlled deployment only` | Allowed only when the user explicitly controls the browser permission, local profile, organization deployment, plugin, or fork that exposes the capability. It is not part of normal per-tab or all-tabs sharing. |
| `self-hosted only` | Allowed only when the user or their organization operates the network/service side. It is not an ABG-operated service. |
| `non-goal` | Not accepted in official ABG, even if convenient. |

## Capability Matrix

| Capability | Mode | Approval requirement | Audit requirement | Notes |
|---|---|---|---|---|
| DOM/text/snapshot reads | `per-tab` | No write approval | Log read command, tab, URL, selector/frame scope | Existing safe default. |
| Frame targeting | `per-tab` | Actions in frames use normal operation approval | Log frame ref/selector in params and action metadata | Cross-origin frames fail explicitly. |
| Response waits and bounded body preview | `per-tab` | No write approval; body preview requires explicit `--body` | Log network command; body previews are size-capped | Headers are not stored. |
| Redacted HAR export | `per-tab` | No write approval; artifact generation must be explicit | Log tab, filters, redaction mode, byte size, and local path | Local filesystem only; no ABG cloud storage. |
| Cookie / Web Storage reads | `per-tab` | No write approval; full values require explicit `--values` | Log kind, filters, counts, and whether values were requested | Values are redacted by default. |
| Framework and Web Vitals reads | `per-tab` | No write approval | Log read command and tab | Hook-dependent, bounded, no component mutation. |
| JavaScript dialog inspection and handling | `per-tab` | No approval to inspect; accept, dismiss, and prompt-value operations require approval | Log dialog type and handling action without storing sensitive prompt values | Dialog handling stays scoped to the shared tab. |
| Download lifecycle and local artifact paths | `per-tab` | Download initiation follows the approval policy of the triggering action | Log tab, suggested filename, state, byte size, and local path | File contents are not read automatically and artifacts remain local. |
| Bookmark / Reading List inspection | `user-controlled deployment only` | Separate explicit browser permission required; no write approval for read-only list, search, get, or open | Log operation class, browser/profile identity, result counts, and redacted URL metadata by default | Browser-owned personal data. It is not unlocked by per-tab or all-tabs sharing. |
| Bookmark / Reading List mutation | `non-goal` in official ABG; a future user-controlled plugin or fork requires a new policy decision | Not applicable in official ABG | Not applicable in official ABG | Profile-wide personal-data writes and deletes are not bounded by tab consent, and the deletion/reorganization risk outweighs the current demonstrated need. |
| Shared-tab video recording | `per-tab` | Explicit start approval required; microphone inclusion is optional and separately identified | Log tab, start/stop time, output path, byte count, requested audio sources, and approval result | Must show a visible recording indicator. Generated artifacts stay local. |
| Cookie / storage write or delete | `sandbox/all-tabs only` | Required per operation | Log key/name, scope, action, and value byte count, never raw secret values | Not allowed for normal personal-profile per-tab sharing. |
| Network route/mock/mutation | `sandbox/all-tabs only` | Required before enabling each rule and before mutation when practical | Log rule id, URL scope, method/status changes, byte counts | No silent request/response rewriting in normal mode. |
| Init scripts / pre-page-load instrumentation | `sandbox/all-tabs only` | Required before installing/enabling script | Log script hash/source summary, URL scope, enable/disable time | Needed before navigation, so it does not fit normal per-tab consent. |
| Viewport/device/geolocation/offline/header/proxy emulation | `sandbox/all-tabs only` | Required for state changes | Log previous/new emulation state and scope | Treat as browser-owned state, not a page read. |
| New tab/window create or close | `sandbox/all-tabs only` | Required per operation | Log target URL/window/tab id and action | Agents must not manage a user's normal browser windows. |
| Private Tailnet/LAN remote pairing | `self-hosted only` | Pairing approval required on the user's device | Log paired device, scope, expiry, and revocation | Related to private remote pairing work such as #71. |
| User/team-owned local metrics | `self-hosted only` | User/org admin opt-in required | Log configuration changes locally | Metrics must remain under the user's control. |
| ABG-operated cloud relay | `non-goal` | Not applicable | Not applicable | Official ABG must remain runnable with networking blocked except loopback. |
| Telemetry sent to ABG operators | `non-goal` | Not applicable | Not applicable | No analytics or crash reporting endpoint. |
| General JavaScript eval escape hatch | `per-tab` only when enabled | Extension eval setting enabled. With Trusted automation / AutoMode off, CLI `--approve` and per-call local approval window. With AutoMode on, popup can be skipped for already-shared tabs. | Log exact script source, approval mode, and result type/size summary | Prefer named structured tools. |
| Hidden general JavaScript execution without explicit user policy | `non-goal` | Not applicable | Not applicable | Eval must require either per-call approval or explicit Trusted automation / AutoMode. |

## Epic #178 closure ledger

| Issue | Capability | Outcome | Boundary |
|---|---|---|---|
| #179 | Frame targeting | Shipped | `per-tab`; same-origin targeting only, with explicit cross-origin errors. |
| #180 | JavaScript dialogs | Shipped | `per-tab`; inspection is read-only and handling requires approval and audit. |
| #181 | Downloads | Shipped | `per-tab`; lifecycle and local artifact paths only. |
| #182 | Response waits and bounded body inspection | Shipped | `per-tab`; body access is explicit and size-capped. |
| #183 | HAR export | Shipped | `per-tab`; explicit local artifact with safe redaction defaults. |
| #184 | Cookie and Web Storage inspection | Shipped | `per-tab`; read-only and redacted by default. |
| #185 | Framework and Web Vitals inspection | Shipped | `per-tab`; read-only, bounded snapshots. |
| #186 | Advanced automation policy | Decision complete | Defines the mode, approval, and audit boundaries in this document. |
| #187 | Browser-owned sandbox controls | Shipped | `sandbox/all-tabs only`; state changes require approval and audit. |
| #188 | Official non-goals and extensions | Shipped | Separates official non-goals from user-controlled and self-hosted deployments. |
| #199 | Bookmark and Reading List inspection | Shipped | `user-controlled deployment only`; separate browser permissions and redacted audit metadata. |
| #200 | Bookmark and Reading List mutation | Descoped from official ABG | Profile-wide personal-data writes and deletes exceed tab consent and carry disproportionate deletion/reorganization risk. A future user-controlled plugin, fork, or new decision issue may revisit the capability. |
| #203 | Trusted eval automation | Shipped | `per-tab`; eval stays disabled by default and requires per-call approval or explicit AutoMode, with audit. |
| #304 | Shared-tab recording | Shipped | `per-tab`; explicit start, visible recording state, local artifact, and separate microphone disclosure. |

## Implementation Checklist

Any PR that implements an advanced automation feature must state:

- the selected mode from this policy,
- whether the feature is read-only or mutating,
- the approval prompt behavior,
- the audit fields recorded,
- the failure behavior when the mode or permission is unavailable.

If a feature does not fit one of the allowed rows, file a new decision issue before implementing it.
