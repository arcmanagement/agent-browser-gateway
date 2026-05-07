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
dist/agent-browser-gateway-extension-0.3.6.zip
```

The ZIP contents must have `manifest.json` at the archive root. Do not zip the
`extension/dist/` folder itself as a top-level directory.

Chrome Web Store item ID:

```text
ojgedfcgebjchckaagjkmlpgonpjggpi
```

## Store listing fields

- Name: `Agent Browser Gateway`
- Short description: `Share specific Chrome tabs with AI coding agents via per-tab explicit permission.`
- Category: `Developer Tools`
- Language: `English`
- Homepage URL: `https://agent-browser-gateway.com/`
- Privacy policy URL: `https://agent-browser-gateway.com/privacy/`
- Support contact: `contact@arcm.co.jp`

Suggested detailed description:

```text
Agent Browser Gateway lets you share the Chrome tab you choose with a local AI coding agent.

It is built for browser-assisted development and support workflows where the human should keep control of the browser session. No tab is visible by default. You explicitly share one tab from the extension popup, and the local abg CLI can then read, screenshot, inspect console or network context, or perform approved operations in that shared tab.

Core principles:
- Per-tab consent instead of broad browser access
- No host permissions in the extension manifest
- Local gateway over loopback transport
- Agent-agnostic CLI for Codex, Claude Code, Cursor, Cline, and scripts
- Token-efficient Markdown reads that reduce noisy HTML before it reaches an agent
- Local audit log for inspectable operations
- No analytics, advertising identifiers, or product telemetry

ABG is not an end-to-end test runner and does not try to replace Playwright. Playwright is the right tool when automation owns the browser lifecycle. ABG is for the tab you are already using, with your current login and context, when you want to hand only that tab to an AI agent workflow.
```

Suggested single purpose:

```text
Provide user-authorized, local, per-tab browser access so AI coding agents can inspect or operate only the Chrome tab the user explicitly shares.
```

Suggested permission justifications:

- `activeTab`: Access the active tab only after the user explicitly shares it from the extension popup.
- `scripting`: Read selected page content and perform structured operations in the shared tab.
- `tabs`: Read tab title, URL, and lifecycle events so shared tabs can be listed and revoked.
- `storage`: Store local settings and session-scoped tab sharing state.
- `debugger`: Capture screenshots, console messages, network information, file uploads, and input operations for a user-shared tab.
- `alarms`: Keep the extension service worker connected to the local gateway while Chrome is running.

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
No account is required. To test: download the signed macOS gateway DMG from https://agent-browser-gateway.com/downloads/agent-browser-gateway-0.3.6-macos-arm64.dmg, open "Install Agent Browser Gateway.command", install the extension, open a normal web page, click the ABG toolbar icon, share the current tab, then run `abg tabs --compact` and `abg read t1 --format markdown` locally. For help, contact contact@arcm.co.jp.
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
