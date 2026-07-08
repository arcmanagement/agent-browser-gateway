# Browser adapter and desktop browser support

ABG's extension code is currently centered on the Chrome-compatible WebExtensions path. The
`extension/src/browserAdapter.ts` boundary keeps browser-specific behavior explicit, but a browser is
not production-supported until install, per-tab sharing, Gateway connection, and revoke flows are
validated on that browser.

## Support matrix

| Browser | Status | Extension APIs | Permission prompts and consent | Gateway connection | Native messaging constraints | Blockers | Next owner |
|---|---|---|---|---|---|---|---|
| Chrome | Supported baseline | Manifest V3, `activeTab`, `scripting`, `tabs`, `storage`, `debugger`, `downloads`, `alarms`, `clipboardWrite`, and optional `<all_urls>` for isolated all-tabs profiles. The `debugger` API exposes the Chrome DevTools Protocol domains ABG uses for DOM, input, network, PDF, and state commands. | Per-tab consent comes from the popup sharing the active tab. All-tabs mode requests optional host access at runtime, is off by default, and can be revoked from the popup. Chrome shows the debugger infobar when ABG attaches to a tab. | Extension background service worker connects directly to `ws://127.0.0.1:<port>/ws`. | ABG does not currently use extension native messaging on Chrome. If added later, the native host manifest must be installed per browser profile and allow the extension origin. | None for the current shipped path. | Core maintainers |
| Edge | Chromium-compatible, not locally validated in this session | Microsoft documents Chrome extension API and manifest key compatibility with Edge, subject to Edge's supported API list. ABG should use the Chrome build first. | Expected to match Chrome for popup-driven per-tab sharing and optional `<all_urls>`, but the install and runtime prompts must be checked in Edge. Rebranding is required before Edge Add-ons submission if a package is distributed there. | Expected to use the existing local WebSocket path. | If native messaging is introduced, Edge requires the native host manifest `allowed_origins` entry to use the Edge extension ID. | `Microsoft Edge.app` is not installed in the validation machine, so install, tab-share, Gateway connection, and revoke flows are blocked. | Follow-up validator with Edge installed |
| Brave | Chromium-compatible, not locally validated in this session | Brave uses Chromium extension APIs and can load Chrome Web Store extensions, so ABG should use the Chrome build first. API parity must still be validated because Brave privacy protections can affect page behavior and extension prompts. | Expected to match Chrome for popup-driven per-tab sharing and optional `<all_urls>`. Validate that Brave shields do not interfere with popup sharing, WebSocket connection, debugger attachment, or all-tabs revocation. | Expected to use the existing local WebSocket path. | If native messaging is introduced, validate host manifest installation and extension ID handling for Brave separately. | `Brave Browser.app` is not installed in the validation machine, so install, tab-share, Gateway connection, and revoke flows are blocked. | Follow-up validator with Brave installed |
| Firefox | Feasibility target, implementation split to [#324](https://github.com/arcmanagement/agent-browser-gateway/issues/324) | The repo has a Firefox build target and a `browser` namespace adapter. Firefox WebExtensions support `activeTab`, `scripting`, `tabs`, `storage`, `downloads`, optional host permissions, and native messaging, but the Chrome `debugger`/CDP command surface is not available as ABG uses it. | Per-tab consent can stay popup-driven. Firefox Manifest V3 optional host permissions should use `optional_host_permissions`, with Firefox 128+ as the current target. All-tabs mode needs a Firefox-specific prompt and revoke validation. | The current build still points to the local WebSocket Gateway. Validate background lifetime and connection behavior in Firefox before claiming support. | Firefox native messaging uses browser-specific host manifest locations and extension IDs. It is optional for ABG today, but would be a fallback if the WebSocket path is blocked by review or platform behavior. | CDP-backed commands need Firefox fallbacks or explicit unsupported errors. Install/share/read/screenshot/revoke still need full local validation. | [#324](https://github.com/arcmanagement/agent-browser-gateway/issues/324) |
| Safari | Feasibility target, implementation split to [#323](https://github.com/arcmanagement/agent-browser-gateway/issues/323) | Safari Web Extensions reuse many WebExtensions concepts but ship through an app extension container. ABG needs a Safari manifest/build target and a Safari adapter before install testing. | Safari has its own extension enablement and website permission prompts. Per-tab consent must be mapped to Safari's active tab and website-access model without implying Chrome-style optional all-tabs behavior. | The current WebSocket service-worker path is unvalidated in Safari. A Safari-specific bridge or native app messaging may be required. | Safari Web Extensions can message the containing native app. Packaging, signing, and review constraints must be handled before distribution. | No Safari build target exists. Apple Developer Program, signing, packaging, website permission behavior, transport, and revoke semantics all require a dedicated implementation path. | [#323](https://github.com/arcmanagement/agent-browser-gateway/issues/323) |

## Chrome-compatible smoke test

Run this test before marking Edge or Brave supported. Use a temporary browser profile so all-tabs
mode, debugger attachment, and revoke behavior do not touch a daily-use profile.

1. Build the Chrome-compatible extension:

   ```bash
   cd extension
   pnpm run build
   ```

2. Install `extension/dist/` as an unpacked extension in the target browser's extension management
   page.

3. Start the local Gateway app or CLI path that provides `ws://127.0.0.1:8765/ws`.

4. Open an `https://example.com/` tab and share only that tab from the extension popup.

5. Confirm Gateway visibility:

   ```bash
   abg tabs --compact
   abg inspect
   ```

6. Run at least one read-only command against the shared tab, then revoke it from the popup or CLI:

   ```bash
   abg read --tab t1 --selector body
   abg revoke --tab t1
   abg tabs --compact
   ```

7. Enable all-tabs mode only in the temporary profile, confirm more than one shareable tab appears
   with `accessMode: "all_tabs"`, then turn all-tabs mode off and confirm the all-tabs entries are
   revoked.

Record the browser version, extension build command, Gateway version, install result, share result,
Gateway connection result, revoke result, and any browser prompt differences in the PR or Issue.

## Session validation notes

- `extension/package.json` exposes `pnpm run build` for the Chrome-compatible build and
  `pnpm run build:firefox` for the Firefox target.
- This session found `/Applications/Google Chrome.app`, `/Applications/Firefox.app`, and
  `/Applications/Safari.app`.
- This session did not find `/Applications/Microsoft Edge.app` or `/Applications/Brave Browser.app`,
  so Edge and Brave runtime validation is blocked by missing local browser installations.
- README and ROADMAP must link to this matrix instead of implying Firefox, Safari, Edge, or Brave are
  production-ready.

## Reference sources

- Chrome `debugger` API: <https://developer.chrome.com/docs/extensions/reference/api/debugger>
- Chrome native messaging: <https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging>
- Microsoft Edge Chrome extension porting: <https://learn.microsoft.com/en-us/microsoft-edge/extensions/developer-guide/port-chrome-extension>
- Firefox optional permissions: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/manifest.json/optional_permissions>
- Firefox Chrome incompatibilities: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Chrome_incompatibilities>
- Firefox native messaging: <https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Native_messaging>
- Safari Web Extensions: <https://developer.apple.com/documentation/safariservices/safari-web-extensions>
- Safari native app messaging: <https://developer.apple.com/documentation/safariservices/messaging-a-web-extension-s-native-app>
