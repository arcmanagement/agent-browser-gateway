# Android WebView DevTools Bridge Design

Issue: [#70](https://github.com/arcmanagement/agent-browser-gateway/issues/70)

This document records the Phase 4 design position for connecting Android WebView debugging to ABG
through the Chrome DevTools Protocol.

## Official references

- [Chrome DevTools: Remote debugging WebViews](https://developer.chrome.com/docs/devtools/remote-debugging/webviews/)
- [Chrome DevTools: Remote debug Android devices](https://developer.chrome.com/docs/devtools/remote-debugging/)
- [Android Developers: `WebView.setWebContentsDebuggingEnabled`](https://developer.android.com/reference/android/webkit/WebView#setWebContentsDebuggingEnabled(boolean))
- [Android Developers: Android Debug Bridge](https://developer.android.com/tools/adb)
- [Chrome DevTools Protocol](https://chromedevtools.github.io/devtools-protocol/)

## WebView debugging prerequisites

Android WebView debugging is not a browser-wide capability. The host Android application must enable
it from application code by calling `WebView.setWebContentsDebuggingEnabled(true)`. Chrome's
documentation states that WebView debugging is available on Android 4.4 and later, and that the
setting applies to all WebViews in the application. It also notes that the WebView debugging setting
is not controlled by the manifest `debuggable` flag, so applications that want debug-build-only
exposure must check `ApplicationInfo.FLAG_DEBUGGABLE` before enabling it.

ABG therefore cannot make an arbitrary production WebView inspectable. The Android app owner must
ship or run a build that enables WebView debugging, and the target WebView must be alive on the
device before it can appear as a DevTools target.

After WebView debugging is enabled, the normal Chrome DevTools flow discovers debug-enabled WebViews
through `chrome://inspect`, and DevTools attaches to a target as it would for a remote browser tab.
For ABG, that means the future bridge should discover target metadata, then connect to the target's
DevTools Protocol websocket endpoint. ABG should not require users to launch Chrome with a global
`--remote-debugging-port` for their everyday desktop profile.

## Transport options

| Option | Device requirements | Host requirements | Consent surface | ABG position |
|---|---|---|---|---|
| USB ADB | Android developer options, USB debugging enabled, RSA debugging prompt accepted on the device | Android SDK Platform Tools, local `adb` server on port 5037 | Physical cable plus device unlock and RSA prompt | Adopt as the minimum supported path |
| Android 11+ wireless debugging | Same Wi-Fi network, Android 11 or later for phone, wireless debugging enabled, pairing code or QR pairing | Latest Platform Tools, mDNS-capable network for automatic discovery | Device-side wireless debugging prompts, pairing code, optional trusted network | Defer until USB bridge is stable |
| Android 10 and lower ADB over Wi-Fi | Initial USB connection, shared Wi-Fi network, `adb tcpip 5555`, then `adb connect` | Platform Tools and network path to device TCP port | Starts with USB consent, then leaves an ADB daemon reachable on the local network until reset | Hold as an advanced/manual path, not a default ABG feature |
| Direct network CDP endpoint | App or device exposes a DevTools Protocol endpoint over the network | Reachable host/port and target discovery URL | App-specific; not covered by Android WebView docs | Non-default, self-hosted only after a separate threat-model review |

## Minimum ABG design

The first implementable design should be USB-only and local-first:

1. User enables Android developer options and USB debugging on the device.
2. User connects the device over USB and accepts Android's RSA debugging prompt.
3. User runs or opens an Android app build that has `WebView.setWebContentsDebuggingEnabled(true)`.
4. ABG uses `adb` locally to discover attached devices and only offers devices whose state is
   `device`.
5. ABG maps the selected WebView target to a local DevTools Protocol websocket by using ADB-backed
   local forwarding. The exact socket discovery and forwarding implementation is an implementation
   task, not a product permission decision.
6. The target appears in ABG as a mobile WebView target with an explicit access mode, separate from
   desktop extension-provided tabs.
7. Read and operation commands reuse the existing named command model and approval policy. WebView
   targets do not get a hidden eval exception.

The minimum target identity should include:

- device serial or a locally stable alias,
- application package name,
- WebView title or URL when available,
- DevTools target id,
- transport type, starting with `android-usb-adb`,
- access mode, for example `android_webview_manual`.

ABG should avoid storing raw device serials in long-lived public artifacts. Local audit entries may
record enough target identity for the user to review what happened on their machine, but public docs,
examples, and tests should use neutral placeholders.

## Consent model

Android WebView consent has two layers:

1. Android platform consent: developer options, USB debugging or wireless debugging, and device-side
   authorization. ABG must treat this as necessary but not sufficient.
2. ABG target consent: the user must explicitly select a discovered device and WebView target before
   an agent can see it.

ABG should not auto-share every WebView target from an attached device. The default should mirror
desktop per-tab sharing: no target is visible to agents until the user shares a specific WebView
target from a local ABG surface or an equivalent CLI command designed for local human use.

Origin-change auto-revoke does not map cleanly to WebView targets because a single native app may
change URLs frequently or load app-provided HTML with opaque origins. For the first version, target
consent should revoke on:

- explicit user revoke,
- device disconnect,
- ADB authorization loss,
- WebView target disappearance,
- Gateway shutdown.

URL or origin changes should be audited and surfaced, but not used as the first auto-revoke rule
until WebView navigation behavior is tested across real apps.

Mutating commands should keep the existing operation approval model. Remote screencast input,
keyboard input, JavaScript eval, storage mutation, and target navigation are sensitive enough to
require explicit local approval unless a later Android-specific trusted policy is designed.

## Audit handling

Every Android WebView command must write the same local audit log class as desktop tab commands.
The audit entry should include:

- action name and approval mode,
- target kind, for example `android_webview`,
- transport, for example `usb_adb`,
- redacted device identity or local alias,
- package name when available,
- target id and current URL or title when available,
- command result summary, byte lengths, and redaction mode where relevant.

Audit entries must not include:

- wireless pairing codes,
- ADB private keys,
- raw pasted text or clipboard payloads,
- raw network response bodies,
- full storage values unless the command already has an explicit value-disclosure mode.

If wireless debugging is later supported, audit entries should record whether the network was a
device-trusted wireless debugging network, but not record pairing secrets.

## Deferred designs

Wireless debugging should wait for the USB path because it adds network discovery, pairing expiry,
trusted-network behavior, and local-network exposure. Android 11+ pairing is a reasonable future
path, especially with newer ADB Wi-Fi behavior, but it needs a dedicated consent screen and clear
revocation.

Android 10 and lower Wi-Fi debugging through `adb tcpip 5555` should not be a default guided flow.
It requires an initial USB step and then asks the device-side ADB daemon to listen on the network.
ABG may document it later as an expert-only path, but the product should not normalize leaving ADB
reachable on a LAN.

Direct network DevTools Protocol endpoints are not covered by the Android WebView debugging docs and
should be treated as self-hosted or app-owner infrastructure. Supporting them would require a
separate pairing and trust model so ABG does not become a generic unauthenticated CDP client.

## Implementation blockers

- Confirm the reliable ADB socket discovery path for WebView DevTools targets across current
  Android System WebView versions and Android Chrome-backed WebView providers.
- Decide whether Android target sharing lives in the existing Gateway window, a new mobile target
  picker, or a CLI-first local flow.
- Add a protocol representation for non-extension targets without weakening the existing extension
  origin allowlist or desktop tab permission manager.
- Define test fixtures for target discovery and audit redaction without requiring a physical Android
  device in normal CI.
- Validate how URL changes, app-provided HTML, iframes, and multiprocess WebView renderer changes
  surface through DevTools Protocol before adopting any origin-based auto-revoke rule.
