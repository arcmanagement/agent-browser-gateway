# Firefox WebExtensions feasibility

ABG can support a Firefox extension MVP, but it cannot reach Chrome feature parity with the current
WebExtensions API surface. The blocker is not Manifest V3 itself. Firefox supports a usable MV3
extension background page path, `activeTab`, `scripting`, tab capture, optional host permissions,
downloads, storage, alarms, tabs, and windows. The blocker is the missing Chrome `debugger` API,
which ABG uses as its CDP bridge for most high-fidelity browser inspection and automation.

Recommendation: ship Firefox as a limited browser-port MVP for explicit share/revoke, basic DOM
read, visible-tab screenshots, tab metadata, downloads, and simple DOM operations. Keep CDP-backed
parity Chrome-only unless Firefox implements a debugger-equivalent extension API or ABG adds a
separate Firefox-native automation bridge with a new consent model.

## Build

```bash
cd extension
pnpm run build:firefox
```

The Firefox build is written to `extension/dist/`. To create a ZIP:

```bash
cd extension
pnpm run firefox:zip
```

## Temporary install

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on**.
3. Select `extension/dist/manifest.json`.
4. Start the Gateway, open a normal `http`, `https`, or `file` page, and share it from the popup.

## Source links

- Firefox MV3 background scripts: MDN documents that Firefox does not support extension background
  service workers, but does support `background.scripts` / event pages for MV3. It recommends
  declaring both `service_worker` and `scripts` for cross-browser manifests:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/background
- Host and optional host permissions: MDN documents that MV3 uses `host_permissions` for install-time
  host access and `optional_host_permissions` for runtime host access:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/permissions
- Programmatic injection: MDN documents `scripting.executeScript` availability in Firefox and its
  requirement for `"scripting"` plus either host permission or `activeTab`:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/scripting/executeScript
- Visible-tab screenshot: MDN documents `tabs.captureVisibleTab()` and its `<all_urls>` or
  `activeTab` permission requirement. Firefox 126 and later support `activeTab` for this API:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/captureVisibleTab
- Missing debugger API: MDN's Chrome incompatibilities page states that Chrome's `debugger` API is
  not implemented in Firefox:
  https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities#debugger_api

## Current Chrome implementation dependencies

The Chrome extension manifest declares:

- API permissions: `activeTab`, `scripting`, `tabs`, `storage`, `debugger`, `downloads`, `alarms`,
  and `clipboardWrite`.
- No default `host_permissions`.
- Runtime all-tabs profile mode through `optional_host_permissions: ["<all_urls>"]`.
- MV3 `background.service_worker` with module output.

The Firefox build path already patches the manifest in `extension/build.mjs`:

- Removes Chrome-only `key` and `minimum_chrome_version`.
- Uses `background.scripts: ["background.js"]` with `type: "module"` instead of a service worker.
- Sets `browser_specific_settings.gecko.id`, strict minimum Firefox version, and no-data-collection
  metadata.
- Builds the same TypeScript entrypoint with `__ABG_BROWSER_TARGET__ = "firefox"` so runtime code can
  gate debugger-dependent behavior through `browserAdapter.supportsDebugger`.

## Permission and API mapping

| ABG capability | Chrome implementation | Firefox WebExtensions mapping | Feasibility |
|---|---|---|---|
| Extension-to-Gateway local link | Background script opens `ws://127.0.0.1:<port>/ws` to the local Gateway. | Use the Firefox background event page created from `background.scripts`. | Feasible for MVP. Needs runtime smoke testing because Firefox uses an event page, not a Chrome service worker. |
| Per-tab manual sharing | Popup uses `activeTab`, `tabs`, `storage`, and tab lifecycle events. | Same permission model is available. Continue storing `manual` entries and revoking on origin change or close. | Feasible. |
| All-tabs sandbox profile mode | Popup requests optional `<all_urls>` through `chrome.permissions.request`, then `tabs.query({})` enumerates shareable tabs. | MV3 runtime host access maps to `optional_host_permissions`. Use the `browser.permissions` namespace and keep no default host permissions. | Feasible. Validate the exact Firefox permission prompt before publication. |
| Basic DOM read | Chrome primary path uses CDP `Runtime.evaluate`; fallback can use `scripting.executeScript`. | Use `scripting.executeScript` with `activeTab` or optional host access. | Feasible for normal pages. Limited on restricted pages and by content-script isolation. |
| Visible screenshot | Chrome primary path can use CDP and fallback to `tabs.captureVisibleTab`. | Use `tabs.captureVisibleTab`; Firefox 126+ supports `activeTab` for this call. | Feasible for visible viewport screenshots. Full-page or PDF-style captures remain blocked. |
| Console stream | Chrome attaches debugger and subscribes to `Runtime.consoleAPICalled`. | No `browser.debugger` equivalent. Devtools APIs are for extension devtools pages, not a background bridge to arbitrary shared tabs. | Blocked for MVP. |
| Network log, HAR, wait-response, response body | Chrome uses debugger `Network.*` domains. | `webRequest` can observe request metadata with host permission but does not provide the same response-body capture or CDP wait semantics. | Partial metadata possible later. Current ABG parity blocked. |
| JavaScript dialog handling | Chrome uses debugger `Page.handleJavaScriptDialog`. | No equivalent background extension API for arbitrary tab dialogs. | Blocked. |
| PDF export | Chrome uses debugger `Page.printToPDF`. | No equivalent WebExtensions API. | Blocked. |
| Cookie and storage inspection | Chrome uses debugger `Network.getCookies` and in-page evaluation for storage. | Cookies require the `cookies` permission plus host access; storage may be inspected only through injected scripts where allowed. | Later support possible with narrower behavior and extra permission review. |
| Viewport emulation and browser-owned sandbox controls | Chrome uses debugger `Emulation.*`, tab APIs, and all-tabs gating. | Tab create/close can use tab APIs, but viewport/device emulation has no WebExtensions equivalent. | Partial sandbox tab lifecycle possible. Emulation blocked. |
| Mouse, wheel, key, and drag fidelity | Chrome uses debugger `Input.*` domains for trusted input dispatch. | Content-script DOM events are not equivalent to browser input and are blocked by many real-world app paths. | Basic DOM operations possible. High-fidelity automation blocked. |
| File upload | Chrome uses debugger `DOM.setFileInputFiles` and fallback scripting. | WebExtensions cannot set arbitrary local files into page file inputs without browser-specific support. | Blocked unless a Firefox-native user-mediated path is designed. |
| Annotation overlay | Chrome uses `scripting.executeScript` first and CDP fallback when host-permission behavior blocks injection. | Use only `scripting.executeScript`; no CDP fallback exists. | Feasible on pages where injection is allowed. Less robust than Chrome. |
| Downloads | Chrome uses `downloads.onCreated`, `downloads.onChanged`, and `downloads.search`. | Firefox supports the downloads API surface used by ABG. | Feasible. |
| Approval popup and settings | Uses extension pages, `windows.create`, `runtime.onMessage`, and `storage`. | Same broad WebExtensions concepts exist. Firefox extension page URLs are random unless a Gecko ID is set, which the build already does. | Feasible. |

## Blockers

1. No Firefox implementation of Chrome's `debugger` API means no extension-accessible CDP bridge.
   This blocks ABG's current implementation for console, network bodies, HAR parity, dialogs, PDF,
   cookies via CDP, emulation, trusted input, file upload, and robust cross-origin read fallbacks.
2. Firefox MV3 background execution uses event pages rather than Chrome service workers. ABG can
   build for that path, but the local WebSocket reconnect and heartbeat behavior needs dedicated
   runtime testing before release.
3. `scripting.executeScript` is a content-script path. It requires `activeTab` or host permission and
   is unavailable on restricted pages. It also does not provide Chrome CDP's page-world execution and
   automation fidelity.
4. Optional `<all_urls>` remains acceptable only for isolated all-tabs profiles. The Firefox prompt
   and Add-ons review explanation must preserve ABG's no-default-host-permission trust model.

## Support decision

Firefox should stay in the roadmap as a Phase 3 limited MVP, not a promise of Chrome parity.

- MVP: share/revoke, list shared tabs, read page DOM/text where injection is allowed, capture visible
  viewport screenshots, basic annotation overlay on injectable pages, downloads metadata, and simple
  DOM-based click/fill/key fallbacks where they work.
- Later support: network request metadata, cookies/storage with explicit extra permissions, and more
  DOM-operation fallbacks after the MVP consent and audit behavior is tested in Firefox.
- Rejected for Firefox until a new architecture exists: claiming CDP/debugger parity, hidden
  high-fidelity input dispatch, PDF capture, response-body HAR parity, dialog control, viewport
  emulation, and arbitrary file upload automation.

The product wording should therefore be "Firefox extension MVP" or "limited Firefox support", never
"full Firefox parity".
