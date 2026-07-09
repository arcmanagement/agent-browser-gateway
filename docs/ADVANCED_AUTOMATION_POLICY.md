# Advanced Automation Policy

This document records the ABG policy decision for Playwright / agent-browser parity features.
The rule is simple: convenience must not collapse the per-tab consent boundary of a normal
personal browser profile.

## Modes

| Mode | Meaning |
|---|---|
| `per-tab` | Allowed for an explicitly shared tab in a normal browser profile. Read-only tools should stay here when possible. |
| `sandbox/all-tabs only` | Allowed only in an intentionally isolated browser profile where the user enabled all-tabs access. |
| `user-controlled deployment only` | Allowed only when the user explicitly controls the browser permission, local profile, organization deployment, or extension fork that exposes the capability. It is not part of normal per-tab or all-tabs sharing. |
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
| Bookmark / Reading List inspection | `user-controlled deployment only` | Separate explicit browser permission required; no write approval for read-only list/search/get | Log operation class, browser/profile identity, result counts, and redacted URL metadata by default | Browser-owned personal data. Not part of normal per-tab sharing or all-tabs permission. Reading List remains descoped if the browser API is unavailable or unstable. |
| Bookmark / Reading List mutation | `user-controlled deployment only` | Separate explicit browser permission and per-operation approval required; delete needs stronger confirmation copy | Log mutation type, browser/profile identity, folder/list scope, redacted URL metadata, and value byte counts, never raw sensitive values | Disabled by default and not unlocked by all-tabs mode alone. Reading List mutation remains descoped if the browser API is unavailable or unstable. |
| Shared-tab video recording | `per-tab` for tab capture; microphone capture requires separate explicit approval | Required before recording starts; microphone inclusion must be optional and clearly identified | Log tab, start/stop time, output path, byte count, whether tab audio and microphone were requested, and approval result | Must show a visible recording indicator. Generated artifacts stay local; no ABG cloud storage or upload. |
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

## Related Roadmap Issues

- #183 HAR export uses the `per-tab` artifact rule with safe redaction defaults.
- #184 cookie/storage inspection uses the `per-tab` read-only rule.
- #185 framework inspection uses the `per-tab` read-only observation rule.
- #187 sandbox browser-owned automation is limited to the `sandbox/all-tabs only` rows above;
  the first supported controls are viewport emulation, Web Storage set/delete, and sandbox tab
  create/close.
- #188 documents the official non-goals versus user-controlled/self-hosted extensions.
- #199 remains an explicit-permission browser-owned personal data track for read-only bookmark and
  Reading List inspection; Reading List is descoped unless browser API support is verified.
- #200 remains an optional browser-owned personal data mutation track; it is disabled by default,
  requires per-operation approval, and is not enabled by all-tabs mode alone.
- #304 remains a consent-gated shared-tab recording track; tab capture can fit `per-tab`, while
  microphone audio adds a separate sensitive approval boundary and visible recording requirement.

## Implementation Checklist

Any PR that implements an advanced automation feature must state:

- the selected mode from this policy,
- whether the feature is read-only or mutating,
- the approval prompt behavior,
- the audit fields recorded,
- the failure behavior when the mode or permission is unavailable.

If a feature does not fit one of the allowed rows, file a new decision issue before implementing it.
