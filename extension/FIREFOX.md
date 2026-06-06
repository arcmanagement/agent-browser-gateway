# Firefox extension MVP

ABG has an initial Firefox WebExtensions target that keeps the same explicit tab-sharing model as
Chrome.

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

## MVP coverage

Firefox uses the `browser` WebExtensions namespace and a Manifest V3 background script. Firefox does
not implement Chrome's `debugger` API, so this target uses fallback paths for the initial command
surface:

- Share/revoke: same popup and tab lifecycle model as Chrome.
- Read: `scripting.executeScript` fallback for same-origin document extraction.
- Screenshot: `tabs.captureVisibleTab` fallback for full visible-tab captures.
- Origin changes and tab close: same revoke behavior as Chrome.

Commands that depend on Chrome DevTools Protocol domains remain Chrome-only until Firefox-specific
fallbacks are added.
