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
dist/agent-browser-gateway-extension-1.3.3.zip
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

## 1.3.3 review notes

- Read and replace complete CodeMirror 5 documents through the editor API instead of its hidden input buffer. Read-only editors and mismatched replacement preconditions fail without editing.
- Send virtual key codes for legacy keyboard handlers, and avoid inserting text for modifier shortcuts such as Command+A and Control+A.
- No new Chrome permissions or host access. Desktop versions are unchanged.

## 1.3.2 review notes

- Restore the shared-tab badge after reload and same-origin navigation, and restore the current badge when the extension worker resumes. Cross-origin navigation still revokes sharing.
- Native input fill avoids focus changes that can open password-manager suggestions. An approved, unmodified Escape can dismiss a blocking page-mounted inline menu and reconnect the debugger without replaying the failed action or changing password-manager settings.
- Recovery remains bound to the original tab-sharing grant. Unclipped screenshot fallback verifies the active shared tab and its origin before and after capture, discarding results if access changes.
- No new Chrome permissions or host access. Desktop versions are unchanged.

## 1.3.1 review notes

- No new Chrome permissions or host access. Re-login from a saved Cloud connection also sends a value derived from the saved credential, so the service keeps the same browser identity for that browser. The saved credential itself is not included in the login request.
- Sharing consent and data transmission are otherwise unchanged. Desktop versions are unchanged.

## 1.3.0 review notes

- Adds current-tab annotation toggle, Area/Text switching, confirmed Clear all, and toolbar visibility commands. Only the annotation toggle may share an unshared tab, using the existing sharing checks.
- Shortcut labels reflect browser settings. Toolbar position and collapsed state are stored in extension-local storage. Notices have close buttons and consume Escape through key release.
- No new Chrome permissions or host access. Desktop versions are unchanged.

## 1.2.2 review notes

- No new Chrome permissions. The popup refreshes connection status while open and shows connection/authentication progress instead of a false Disconnected warning. Edited settings are preserved.
- Includes the 1.2.1 connection-history improvements below. Sharing consent and data transmission are unchanged.

## 1.2.1 review notes

- No new Chrome permissions. Connection history recognizes exact Cloudflare proxy-restart messages for WebSocket close code 1001 and stores the fixed label `cloudflare_proxy_restarting`. Other arbitrary close text remains excluded from browser-local history and JSON exports.
- No change to sharing consent, data transmission, or desktop versions.

## 1.1.3 review notes

- No new Chrome permissions. Native file attachments follow the operation approval toggle on manual shares and Sandbox. When it is off, all file paths skip the attachment approval window without requiring Trusted automation or automatic resume. Cloud account-forced approval, Chrome file-URL permission, and separate recording approvals still apply. Desktop versions are unchanged.

## 1.1.1 review notes

- No new Chrome permissions. Cloud reads that may contain sensitive values now follow the operation approval toggle. With it off, snapshots, descriptions, find results, editable validation, input values, state values, and network response bodies skip approval on shared tabs, including manual shares.
- Cloud account-forced approval and password/sign-in-code protections remain in effect. File attachments, recording, browser-owned personal-data writes, and eval retain their existing approval rules.

## 1.1.0 review notes

- No new Chrome permissions. In a saved Cloud Sandbox with automatic resume and Trusted automation enabled, and write approval off, input-value reads and ordinary native file attachments skip repeated approval. No extra switch or upload-folder setup is required. Manual shares, Cloud account-forced approval, and protected paths still prompt. Password and sign-in-code reads remain blocked. Use an isolated host containing only files intended for trusted automation; path checks do not resolve symlinks.
- File paths are on the connected browser host; no client-to-browser byte transfer is added. Recording remains approval-gated.
- Update the data-use disclosure for this automation behavior before submitting. Review and final staged publication remain separate.

## 1.0.0 review notes

- Optional direct Cloud connection, Web email/password login, registered-browser authorization, saved destinations, and isolated-profile Sandbox auto-resume. Local mode remains available without an account.
- Cloud mode sends explicitly shared content and requested operation results to the selected service and authorized AI clients. Account UI: `https://app.agent-browser-gateway.com`; browser service: `https://connect.agent-browser-gateway.com` and `wss://connect.agent-browser-gateway.com`.
- `downloads`: Observe download events and query status, filenames, and browser-host paths for downloads associated with shared tabs. The extension does not use this API to initiate downloads or transfer downloaded files to clients.
- `clipboardWrite`: Write explicitly requested plain/rich text through the extension's offscreen document. It does not read clipboard contents.
- Before Store submission, update these justifications and the data-use disclosure in the Developer Dashboard. If a previous package is pending review, wait for it or have the owner withdraw it. The direct GitHub ZIP release does not mean Store approval or publication.
- Test Cloud by selecting **Connect to → Cloud**, registering with Web login, applying the saved destination, sharing a tab, and authorizing an AI client. Recording still needs approval; Sandbox auto-resume is off until explicitly enabled.
- File attachment uses absolute browser-host paths through the debugger API, requires the file-URL grant, and always prompts with those paths. Approving it exposes the chosen files to the target website. It is not client-to-browser byte transfer.

## 0.5.2 review notes

- No new permissions. Fixes the local approval window cutting off its footer: it now sizes to its
  content after the bundled fonts load.
- This package replaces the withdrawn 0.5.1 submission and includes all 0.5.1 and 0.5.0 changes
  listed below.

## 0.5.1 review notes

- New extension icon (the gate mark used across ABG); no functional change from the icon.
- This package replaces the withdrawn 0.5.0 submission and includes all 0.5.0 changes listed below.
- New `favicon` permission, used only to show each shared tab's site icon next to it in the
  local Gateway menu. The extension reads the icon from Chrome's own favicon cache through
  `chrome-extension://<id>/_favicon/` (no network request), re-encodes it to a 32×32 PNG of at
  most 8 KB, and sends it over the existing loopback WebSocket with the tab it already shares.
  Icons are read only for tabs the user has shared and are kept in memory only.
- No change to the install prompt: with `tabs` already declared, Chrome folds the `favicon`
  warning ("Read the icons of the websites you visit") into the existing warnings, so
  `chrome.management.getPermissionWarningsByManifest` returns the same list for 0.5.0 and this
  manifest, and updating does not disable the extension.

## 0.5.0 review notes

- No new permissions and no new host access. The release adds two keyboard shortcuts (`commands`):
  share or revoke the current tab, and copy the current tab's numeric ID. Both act only on the
  active tab after the user presses the key; copying the ID never grants access.
- The existing offscreen document now also declares the `CLIPBOARD` reason, used only to write the
  tab ID for the copy shortcut from the extension context instead of the page.
- Annotations on a shared tab are kept in `chrome.storage.session` so the user can restore them
  after a reload. They are never written to page-visible storage and are deleted when the tab
  closes or the user clears them.
- The popup, approval window, and annotation overlay are redesigned and localized (English and
  Japanese); the consent and approval boundary is unchanged.

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
- Short description: `Share the Chrome tabs you choose with AI coding agents. Nothing is shared until you allow it.`
- Category: `Developer Tools`
- Language: `English`
- Homepage URL: `https://agent-browser-gateway.com/`
- Privacy policy URL: `https://agent-browser-gateway.com/privacy/`
- Support contact: `contact@arcm.co.jp`

Suggested detailed description:

```text
Agent Browser Gateway lets you share the Chrome tab you choose with an AI client through a local Gateway or an optional Cloud connection. Cloud mode uses Web login and registered-browser authorization and does not require a desktop app. See the Cloud extension guide for installation and data handling.

It is built for browser-assisted development and support workflows where the human should keep control of the browser session. No tab is visible by default. You explicitly share one tab from the extension popup, and the local abg CLI can then read, screenshot, inspect console or network context, or perform approved operations in that shared tab. For isolated Chrome profiles or sandbox machines, the user can also enable an optional all-tabs mode from the popup; Chrome then prompts for optional access to all sites in that profile.

Core principles:
- Per-tab consent instead of broad browser access
- No default host permissions in the extension manifest
- Optional all-tabs access only after local user opt-in and Chrome's permission prompt
- Local gateway over loopback transport, or an explicitly selected authenticated Cloud gateway
- Agent-agnostic CLI for Codex, Claude Code, Cursor, Cline, and scripts
- Token-efficient Markdown reads that reduce noisy HTML before it reaches an agent
- Local audit log for inspectable operations
- No analytics, advertising identifiers, or product telemetry

ABG is not an end-to-end test runner and does not try to replace Playwright. Playwright is the right tool when automation owns the browser lifecycle. ABG is for browser state you are already using, with your current login and context, when you want to hand selected tabs or an isolated all-tabs profile to an AI agent workflow.
```

Suggested single purpose:

```text
Provide user-authorized browser access through a local or selected Cloud gateway so AI clients can inspect or operate only shared tabs, or shareable tabs in an isolated profile after explicit all-tabs opt-in.
```

Suggested permission justifications:

- `activeTab`: Access the active tab only after the user explicitly shares it from the extension popup or its keyboard shortcut.
- `scripting`: Read selected page content and perform structured operations in the shared tab.
- `tabs`: Read tab title, URL, and lifecycle events so shared tabs can be listed and revoked.
- `storage`: Store local settings and session-scoped tab sharing state.
- `downloads`: Observe shared-tab download events and inspect their status, filenames, and browser-host paths. Does not initiate downloads or read arbitrary files.
- `clipboardWrite`: Write requested text or rich text; never read the clipboard.
- `debugger`: Capture screenshots, console messages, network information, file uploads, and input operations for a user-shared tab.
- `alarms`: Keep the extension service worker connected to the local gateway while Chrome is running.
- `tabCapture`: Record an already-shared tab to a local WebM file only after the local approval window's Allow click.
- `desktopCapture`: Fallback for recording tabs shared through the opt-in all-tabs sandbox mode, where no per-tab toolbar click exists for `tabCapture`: the Allow click opens Chrome's own tab picker and the user selects the tab to record. Never invoked outside the recording approval flow.
- `offscreen`: Run Chrome's MediaRecorder capture pipeline in a hidden extension document while recording chunks stream to the local gateway, and copy the current tab ID to the clipboard when the user presses the copy-tab-ID keyboard shortcut.
- `favicon`: Show a shared tab's site icon in the local Gateway menu. The icon is read from Chrome's own favicon cache (never fetched from the network), only for tabs the user has shared, and re-encoded to a small PNG before it is sent to the local gateway.
- Optional permission `bookmarks`: Requested only when the user enables "Bookmarks access"; allows read-only bookmark inspection and opening an existing bookmark URL through an explicit local command.
- Optional permission `readingList`: Requested only when the user enables "Reading List access"; allows read-only Reading List inspection on Chrome versions that expose `chrome.readingList`.
- Optional host permission `<all_urls>`: Requested only when the user enables "Share all tabs (sandbox profiles only)"; allows structured page operations across tabs in an isolated/sandbox profile. It is removed when the mode is disabled.

Remote code declaration:

```text
Extension implementation code is bundled in the submitted package. Cloud tools include an explicitly enabled JavaScript-evaluation surface and user-selected plugins that can request page actions. These capabilities require an accurate Chrome Web Store policy review; do not submit an unconditional remote-code denial for this version without resolving the applicable policy classification.
```

Privacy disclosure:

ABG handles website content, browsing activity, and user activity only when needed
for its user-facing feature: user-authorized access to the tab the user
shares. It does not sell data, transfer data for advertising, or use data for
credit eligibility or unrelated profiling.

Dashboard data-use checkboxes:

- `Web history`
- `User activity`
- `Website content`

These categories are disclosed because the extension can handle the URL/title,
network context, page content, screenshots, and operations for a user-shared tab.
ArcManagement does not collect analytics, telemetry, or advertising identifiers. In optional Cloud mode, the selected service processes shared browser data to provide the requested connection; it is not a local-only data path. The privacy policy and Developer Dashboard must disclose this before Store submission.

Suggested reviewer test instructions:

```text
Local mode requires no account. To test it, install the signed macOS Gateway from https://github.com/arcmanagement/agent-browser-gateway/releases/latest and the extension, open a normal web page, share it from the ABG toolbar popup, then run `abg tabs --compact` and `abg read t1 --format markdown` locally. Optional Cloud mode requires an account: choose Cloud in the popup, register a destination through Web login, approve the browser, apply the destination, and share a tab. Authorize the AI client through the Web account flow. For optional all-tabs mode, use an isolated Chrome profile, enable "Share all tabs (sandbox profiles only)", and accept Chrome's permission prompt. Auto-resume requires its separate checkbox. For help, contact contact@arcm.co.jp.
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
workflow or dispatched with the GitHub CLI. Use this procedure for CRX / Chrome
extension review submissions, including extension-only releases.

- `extension/public/manifest.json` contains the public manifest `"key"` value so
  CI, local builds, and unpacked builds keep the stable extension ID.
- `extension/store-assets/` contains the listing screenshots
  (`screenshot-01-1280x800.png` to `screenshot-05-1280x800.png`), the small and marquee
  promotional tiles, and their HTML sources; its README has the regenerate command.
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

### Submit and verify through the CLI

1. Confirm the release change is merged into `main`, and that the package,
   manifest, and runtime versions agree. Build and verify the ZIP with
   `scripts/chrome-web-store/build-extension-package.sh`. The ZIP must contain
   `manifest.json` at its root and have the intended version.
2. For an extension-only release, publish the verified ZIP and checksum under
   `extension-v<version>` with `--latest=false`. This component tag does **not**
   trigger the unified `Release` workflow or submit to the Store. A unified
   `v<version>` release calls the submit workflow automatically; check that run
   before dispatching a duplicate.
3. Submit the merged extension version with the existing workflow:

   ```bash
   gh workflow run chrome-web-store-submit.yml --ref main \
     -f extension_version=<version>
   gh run list --workflow chrome-web-store-submit.yml --limit 5
   gh run view <run-id>
   ```

   Identify the run for this dispatch and its commit. Supplying the version is
   required for a release submission so the build rejects an unexpected version.
   The workflow refreshes OAuth credentials and fetches Store status before
   building, uploading, and submitting with `STAGED_PUBLISH`. Keep credentials in
   GitHub Actions secrets; do not retrieve them into local commands.
4. Wait for the run to finish, inspect failures with `gh run view <run-id>
   --log-failed`, and download its evidence:

   ```bash
   gh run download <run-id> --name chrome-web-store-oauth-health --dir <health-dir>
   gh run download <run-id> --name chrome-web-store-submission --dir <submission-dir>
   ```

   Inspect the saved JSON responses for the intended version and Store state.
   Workflow dispatch, successful ZIP upload, and a GitHub Release alone are not
   evidence of review acceptance. Report review submission as complete only when
   the Store response confirms that version is `PENDING_REVIEW` (or a later review
   state). If it was already pending, report the existing submission accurately.
5. Report the GitHub release, review submission, Store publication, and installed
   browser version separately. Review submission stops at staged publishing;
   final Store publication requires its own authorization after approval.

### When browser interaction is needed

Routine status checks, OAuth health checks, uploads, review submissions, retries,
and result verification use the CLI and the existing workflow. Do not open the
Developer Dashboard as a submission preflight or fallback without a concrete
blocker. Inspect workflow logs and API responses first.

Use the Dashboard only when the returned error or requested listing change
requires an interactive action, such as editing permission justifications,
uploading listing assets, or renewing authorization that the workflow cannot
refresh. Explain the specific blocker before requesting owner action. A different
version pending review is a stop condition: do not withdraw it or publish it
without explicit authorization. After a metadata fix, rerun the CLI workflow to
submit and verify the result.
