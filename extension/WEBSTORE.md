# Chrome Web Store submission notes

This directory contains the Chrome extension package for Agent Browser Gateway.

## Package

Build the ZIP that should be uploaded to the Chrome Web Store:

```bash
cd extension
pnpm run webstore:zip
```

The ZIP is written to:

```text
dist/agent-browser-gateway-extension-0.4.8.zip
```

The ZIP contents must have `manifest.json` at the archive root. Do not zip the
`extension/dist/` folder itself as a top-level directory.

CI also builds and uploads the same package shape from the
`Chrome Extension Package` workflow. The workflow runs `pnpm run webstore:zip`,
checks that `manifest.json` is at the archive root, and uploads
`chrome-extension-webstore-zip` as a GitHub Actions artifact.

Chrome Web Store item ID:

```text
ojgedfcgebjchckaagjkmlpgonpjggpi
```

## 0.4.8 review notes

- No new Chrome permissions. This release adds iPhone Safari tab sharing and Safari-specific
  capability bridges in the containing iOS app. The Chrome extension keeps the same permission and
  consent boundary as 0.4.7.

## 0.4.7 review notes

- No new permissions. The release adds companion pairing on the desktop app and
  forwards operation approval summaries to a paired phone; the extension change
  is limited to emitting those approval events over the existing local
  WebSocket and accepting a decision for an approval already pending in it.

## 0.4.6 review notes

- New `desktopCapture` permission: used only as the recording approval fallback for tabs shared
  through the opt-in all-tabs sandbox mode, where no per-tab toolbar click exists for `tabCapture`.
  The user always sees the local approval window first, and the Chrome tab picker itself is the
  consent surface for the picked tab. Never invoked outside the recording flow.
- Selector commands now traverse open shadow roots; this uses no additional permissions.

## 0.4.5 review notes

This Chrome Web Store package keeps the existing permission boundary and changes the developer
Gateway endpoint setting:

- Applying an empty or whitespace-only endpoint restores `ws://127.0.0.1:8765/ws` and reconnects.
- Applying a non-empty invalid endpoint continues to show a validation error.

No extension permissions or default host permissions are added.

## 0.4.4 review notes

This Chrome Web Store package keeps the existing permission boundary and adds:

- A popup setting for selecting and persisting a developer-controlled Gateway WebSocket endpoint.
- Shared-tab and browser-window foreground activation through an explicit `raise` command.
- Stable all-tabs routing when other tabs open or close, with clearer evaluation size errors.
- Updated package and release guidance for the local Gateway and agent skills.

The default endpoint remains `ws://127.0.0.1:8765/ws`. No new extension permissions or default host
permissions are added.

## 0.4.3 review notes

This Chrome Web Store package bumps the extension version for review after the
multi-file upload hardening change. The user-visible changes are:

- `abg upload` now accepts repeated `--file` arguments for multi-file inputs.
- File input attachment uses a more stable DevTools node reference.
- File attachment errors now explain unsupported inputs and rejected paths more
  clearly.

## Store listing fields

- Name: `Agent Browser Gateway`
- Short description: `Share Chrome tabs with AI coding agents via explicit local permission.`
- Category: `Developer Tools`
- Language: `English`
- Homepage URL: `https://agent-browser-gateway.com/`
- Privacy policy URL: `https://agent-browser-gateway.com/privacy/`
- Support contact: `contact@arcm.co.jp`

Suggested detailed description:

```text
Agent Browser Gateway lets you share the Chrome tab you choose with a local AI coding agent.

It is built for browser-assisted development and support workflows where the human should keep control of the browser session. No tab is visible by default. You explicitly share one tab from the extension popup, and the local abg CLI can then read, screenshot, inspect console or network context, or perform approved operations in that shared tab. For isolated Chrome profiles or sandbox machines, the user can also enable an optional all-tabs mode from the popup; Chrome then prompts for optional access to all sites in that profile.

Core principles:
- Per-tab consent instead of broad browser access
- No default host permissions in the extension manifest
- Optional all-tabs access only after local user opt-in and Chrome's permission prompt
- Local gateway over loopback transport
- Agent-agnostic CLI for Codex, Claude Code, Cursor, Cline, and scripts
- Token-efficient Markdown reads that reduce noisy HTML before it reaches an agent
- Local audit log for inspectable operations
- No analytics, advertising identifiers, or product telemetry

ABG is not an end-to-end test runner and does not try to replace Playwright. Playwright is the right tool when automation owns the browser lifecycle. ABG is for browser state you are already using, with your current login and context, when you want to hand selected tabs or an isolated all-tabs profile to an AI agent workflow.
```

Suggested single purpose:

```text
Provide user-authorized, local browser access so AI coding agents can inspect or operate only the Chrome tab the user explicitly shares, or every shareable tab in an isolated profile after the user enables optional all-tabs mode.
```

Suggested permission justifications:

- `activeTab`: Access the active tab only after the user explicitly shares it from the extension popup.
- `scripting`: Read selected page content and perform structured operations in the shared tab.
- `tabs`: Read tab title, URL, and lifecycle events so shared tabs can be listed and revoked.
- `storage`: Store local settings and session-scoped tab sharing state.
- `debugger`: Capture screenshots, console messages, network information, file uploads, and input operations for a user-shared tab.
- `alarms`: Keep the extension service worker connected to the local gateway while Chrome is running.
- `tabCapture`: Record an already-shared tab to a local WebM file only after the local approval window's Allow click.
- `desktopCapture`: Fallback for recording tabs shared through the opt-in all-tabs sandbox mode, where no per-tab toolbar click exists for `tabCapture`: the Allow click opens Chrome's own tab picker and the user selects the tab to record. Never invoked outside the recording approval flow.
- `offscreen`: Run Chrome's MediaRecorder capture pipeline in a hidden extension document while recording chunks stream to the local gateway.
- Optional permission `bookmarks`: Requested only when the user enables "Bookmarks access"; allows read-only bookmark inspection and opening an existing bookmark URL through an explicit local command.
- Optional permission `readingList`: Requested only when the user enables "Reading List access"; allows read-only Reading List inspection on Chrome versions that expose `chrome.readingList`.
- Optional host permission `<all_urls>`: Requested only when the user enables "Share all tabs in this profile"; allows structured page operations across tabs in an isolated/sandbox profile. It is removed when the mode is disabled.

Remote code declaration:

```text
No. Agent Browser Gateway does not execute remotely hosted code. Extension code is bundled in the submitted package.
```

Privacy disclosure:

ABG handles website content, browsing activity, and user activity only when needed
for its user-facing feature: local, user-authorized access to the tab the user
shares. It does not sell data, transfer data for advertising, or use data for
credit eligibility or unrelated profiling.

Dashboard data-use checkboxes:

- `Web history`
- `User activity`
- `Website content`

These categories are disclosed because the extension can handle the URL/title,
network context, page content, screenshots, and operations for a user-shared tab.
ArcManagement does not collect analytics, telemetry, advertising identifiers, or
browser data on ABG-operated servers.

Suggested reviewer test instructions:

```text
No account is required. To test: download the signed macOS gateway package from the latest GitHub Release at https://github.com/arcmanagement/agent-browser-gateway/releases, open "Install Agent Browser Gateway.command", install the extension, open a normal web page, click the ABG toolbar icon, share the current tab, then run `abg tabs --compact` and `abg read t1 --format markdown` locally. To test optional all-tabs mode, use an isolated Chrome profile, open the ABG popup, enable "Share all tabs in this profile", accept Chrome's permission prompt, then confirm `abg tabs --compact` shows `accessMode` as `all_tabs`. For help, contact contact@arcm.co.jp.
```

## Stable Chrome extension ID

The Chrome Web Store item ID was created when the first ZIP was uploaded to the
Developer Dashboard:

```text
ojgedfcgebjchckaagjkmlpgonpjggpi
```

To make local unpacked builds use that same ID, `extension/public/manifest.json`
contains the top-level `"key"` field copied from the Dashboard public key.

If the item ever needs to be recreated from scratch, repeat this process:

1. Upload the ZIP in the Developer Dashboard, but do not rely on ABG for this page:
   Chrome blocks extension scripting on the Web Store dashboard.
2. Open the uploaded item.
3. Go to the Package tab.
4. Click View public key.
5. Copy only the text between `-----BEGIN PUBLIC KEY-----` and
   `-----END PUBLIC KEY-----`.
6. Remove newlines so the key is one line.
7. Add it to `extension/public/manifest.json` as the top-level `"key"` field.
8. Rebuild and load `extension/dist/` in `chrome://extensions`; the local ID
   should match the Chrome Web Store item ID.

Do not commit a private `.pem` or other signing key. The manifest `"key"` value
is a public key string used for deterministic extension ID generation.

## GitHub Actions review submission boundary

The package workflow produces the submission ZIP for pull requests. The
`Chrome Web Store Submit` workflow uploads the ZIP through the Chrome Web Store
API and submits it for review. It can be called by the unified tag release
workflow or run manually from GitHub Actions.

- `extension/public/manifest.json` contains the public manifest `"key"` value so
  CI, local builds, and unpacked builds keep the stable extension ID.
- `extension/store-assets/` contains listing screenshots and promotional images.
  These assets are not included in the extension ZIP; update them manually in the
  Developer Dashboard when the listing changes.
- The submit workflow always uses `STAGED_PUBLISH`, so final publishing remains
  a manual owner action after Chrome Web Store review approval.
- A scheduled monthly health check refreshes the OAuth token and fetches the
  store item status without uploading a package. This keeps the Google OAuth
  client active and catches token or policy problems before the next release.

Required GitHub Actions variables:

```text
CHROME_EXTENSION_ID
CHROME_PUBLISHER_ID
CHROME_CLIENT_ID
```

Required GitHub Actions secrets:

```text
CHROME_CLIENT_SECRET
CHROME_REFRESH_TOKEN
```

The Google Cloud project is used only to enable the Chrome Web Store API and to
create the OAuth client and refresh token. Build, verification, ZIP upload, and
review submission run in GitHub Actions.

To submit a merged extension version for review, push the release tag and let
the unified `Release` workflow call `Chrome Web Store Submit`. For a manual
resubmission, open GitHub Actions, run `Chrome Web Store Submit`, and optionally
provide the expected extension version. Leaving the input empty uses
`extension/package.json`.
