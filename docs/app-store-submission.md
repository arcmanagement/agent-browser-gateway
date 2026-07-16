# Mac App Store Submission

ABG's Mac App Store path is separate from the Developer ID, Homebrew, and website download paths.
The Store build must be sandboxed and uploaded to App Store Connect as a signed package.

## Current Decision

Use the ArcManagement production Bundle ID for the initial App Store record:

```text
jp.co.arcm.AgentBrowserGateway
```

This matches the identifier style used by other ArcManagement apps. Developer ID, Homebrew,
website, and Mac App Store builds use the same production Bundle ID. Do not upload the first App
Store Connect build until this decision is intentionally changed or confirmed, because App Store
Connect does not allow changing the Bundle ID after the first build upload.

Use the platform-neutral SKU `agent-browser-gateway`, without a `-macos` suffix. The product may add
an iOS platform later, so the Store record should not make the initial macOS platform part of the
durable product identifier.

## External Setup

1. In Apple Developer Certificates, Identifiers & Profiles, register an explicit macOS App ID:

   ```text
   Description: Agent Browser Gateway
   Bundle ID: jp.co.arcm.AgentBrowserGateway
   ```

2. Confirm that `jp.co.arcm.AgentBrowserGateway` appears in the App Store Connect `New App` form.
3. Create the App Store Connect app record:

   ```text
   Platform: macOS
   Name: Agent Browser Gateway
   Primary language: English (U.S.)
   Bundle ID: jp.co.arcm.AgentBrowserGateway
   SKU: agent-browser-gateway
   Apple ID: 6789562058
   User Access: No access restriction
   ```

4. Create or refresh Mac App Store distribution credentials on a trusted maintainer Mac:
   - Mac App Distribution signing certificate
   - Mac Installer Distribution signing certificate
   - Mac App Store Connect provisioning profile for `jp.co.arcm.AgentBrowserGateway`

Do not store Apple private keys, certificates, App Store Connect API keys, or passwords in GitHub
Actions secrets.

## Unified Release Boundary

The `Release` workflow runs on `v*.*.*` tag pushes and creates a draft GitHub Release, Windows
release artifacts, WinGet submission, and Chrome Web Store review submission from the same tag
version. Mac App Store upload remains a trusted maintainer Mac step because the required Apple
private keys, App Store provisioning profile, and App Store Connect credentials stay out of GitHub
Actions.

For each tagged release, use the same tag version when building the App Store package locally:

```bash
VERSION=<tag version without v> \
BUILD_NUMBER=<next App Store build number> \
APPSTORE_PROVISIONING_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/<profile>.provisionprofile" \
APPSTORE_APP_SIGN_IDENTITY="<Mac App Store application signing identity>" \
APPSTORE_INSTALLER_SIGN_IDENTITY="<Mac App Store installer signing identity>" \
make appstore-pkg
```

Upload the generated `.pkg` with Transporter or `xcrun altool --upload-package` using the
`ABG_APP_STORE_CONNECT` keychain item on the trusted maintainer Mac.

## App Store Connect Record

The macOS app record is created in App Store Connect:

```text
Apple ID: 6789562058
Version: 0.4.2
SKU: agent-browser-gateway
Price: Free
Availability: 175 countries or regions
Release: Manual release after App Review approval
Privacy: Data Not Collected
```

Saved listing details include one macOS screenshot, the listing copy below, support and marketing
URLs, privacy policy URL, Developer Tools category, 4+ age rating, and App Review notes.

## Store Build

The Store build uses App Sandbox entitlements from:

```text
packaging/appstore/AgentBrowserGateway.appstore.entitlements
```

The current entitlements allow local loopback server/client networking:

```text
com.apple.security.app-sandbox = true
com.apple.security.network.client = true
com.apple.security.network.server = true
```

For signed App Store upload builds, `scripts/dist-mac-app-store.sh` copies the App Store
provisioning profile's team identifier, application identifier, and keychain access groups into the
codesign entitlements so the app signature matches the embedded profile.

The app Info.plist declares the App Store category and that the app does not use non-exempt
encryption:

```text
LSApplicationCategoryType = public.app-category.developer-tools
ITSAppUsesNonExemptEncryption = false
```

Local sandbox smoke build:

```bash
VERSION=0.4.2 make appstore-pkg
```

Current local verification:

```text
VERSION=0.4.2 BUILD_NUMBER=42 ... make appstore-pkg
codesign --verify --strict --verbose=2 dist/app-store/agent-browser-gateway-0.4.2/Agent Browser Gateway.app
pkgutil --check-signature dist/agent-browser-gateway-0.4.2-mac-app-store.pkg
PlistBuddy :LSApplicationCategoryType = public.app-category.developer-tools
PlistBuddy :ITSAppUsesNonExemptEncryption = false
PlistBuddy :CFBundleIdentifier = jp.co.arcm.AgentBrowserGateway
PlistBuddy :CFBundleShortVersionString = 0.4.2
PlistBuddy :CFBundleVersion = 42
codesign entitlements include app-sandbox, network.client, network.server,
com.apple.application-identifier, com.apple.developer.team-identifier, and keychain-access-groups
xattr scan found no com.apple.quarantine attributes in the staged app bundle
```

Apple validation/upload status:

```text
xcrun altool --validate-app dist/agent-browser-gateway-0.4.2-mac-app-store.pkg ... = VERIFY SUCCEEDED
xcrun altool --upload-package dist/agent-browser-gateway-0.4.2-mac-app-store.pkg ... = UPLOAD SUCCEEDED
xcrun altool --build-status ... = VALID_BINARY, IMPORT-STATUS: VALID, APP_STORE_ELIGIBLE
```

App Review submission status:

```text
App Store Connect macOS 0.4.2 = Ready for Distribution (released 2026-07-16)
Store URL = https://apps.apple.com/app/id6789562058
Submission ID = 14025e93-6eb6-40c2-89dc-d7b8f320b4e5
Submitted item = macOS app 0.4.2 with build 0.4.2 (42)
History:
  - 2026-07-10 submitted for review
  - 2026-07-15 rejected:
    - Guideline 2.1.0 Performance: App Completeness (Information Needed, new app)
    - Guideline 2.4.5 Performance: Hardware Compatibility (automated flag on
      com.apple.security.network.server "no matching functionality")
  - 2026-07-16 12:49 JST replied with requested information and screen recording
  - 2026-07-16 approved same day; release is manual per the App Store Connect record
  - 2026-07-16 released by the owner; App Store Connect shows Ready for Distribution
    (storefront page propagation can take up to a few hours after release)
```

Rejection response (sent 2026-07-16): replied in the App Store Connect message thread with
the requested information (physical-device screen recording, tested devices, purpose/audience,
setup steps, external services, regional consistency, regulated-content N/A) and the
justification for `com.apple.security.network.server` (the app is a local gateway server; the
listener binds exclusively to loopback 127.0.0.1:8765 for the browser extension). The same
content was saved to the App Review Information notes field. No new binary was required.

Review findings that shaped the response:

- The Store app is `LSUIElement` (menu bar only): first launch shows no window and no Dock
  icon, so review steps must direct the reviewer to the menu bar shield icon first.
- The Mac App Store app bundle does not contain the `abg` CLI, and the CLI's Unix domain
  socket path (`~/Library/Application Support/AgentBrowserGateway/gateway.sock`) is remapped
  into the app sandbox container for the Store build, so CLI-based review steps are not
  possible against the Store app. Review steps must be app + extension only.

Runtime smoke under the sandboxed Store build remains useful for review follow-up and release
readiness.

Upload package build on a trusted maintainer Mac:

Use `security find-identity -v -p codesigning` to confirm the exact local signing identity names
before running the upload build.

```bash
VERSION=0.4.2 \
BUILD_NUMBER=42 \
APPSTORE_PROVISIONING_PROFILE="$HOME/Library/MobileDevice/Provisioning Profiles/<profile>.provisionprofile" \
APPSTORE_APP_SIGN_IDENTITY="<Mac App Store application signing identity>" \
APPSTORE_INSTALLER_SIGN_IDENTITY="<Mac App Store installer signing identity>" \
make appstore-pkg
```

Expected output:

```text
dist/app-store/agent-browser-gateway-0.4.2/Agent Browser Gateway.app
dist/agent-browser-gateway-0.4.2-mac-app-store.pkg
```

Upload the `.pkg` with Transporter or App Store Connect's supported command-line upload flow.

## Store-Specific Constraints

The Mac App Store app is sandboxed. Validate these surfaces under the Store build, not only under
the Developer ID build, before follow-up review responses or final release:

- The Gateway launches and shows local status.
- The local WebSocket server can listen on `127.0.0.1`.
- The Chrome extension can connect to the sandboxed Gateway.
- `abg status` and `abg tabs --compact` have **no supported user path in the Store build**: the
  CLI is not bundled in the app, and the sandboxed Gateway's Unix domain socket path
  (`~/Library/Containers/jp.co.arcm.AgentBrowserGateway/Data/Library/Application Support/AgentBrowserGateway/gateway.sock`)
  is 125 bytes, which exceeds the macOS `sun_path` limit (104 bytes), so the socket cannot be
  bound at all under the sandbox container — the CLI reports `socket path too long` even with an
  `ABG_STATE_DIR` override. CLI support for the Store build requires moving the socket to a
  shorter path first. Review steps and Store listing copy must not depend on the CLI.
- Features that write to arbitrary filesystem paths are either supported through allowed locations
  or documented as unavailable in the Store build.
- User plugin installation and plugin storage work under the sandbox container model, or are
  disabled/documented for the Store build.

The existing DMG installer writes `/usr/local/bin/abg` and
`/usr/local/bin/AgentBrowserGateway_abg.bundle`. That install flow is not used for the Mac App Store
package.

## Listing Copy

Short description:

> Share selected browser tabs with AI coding agents through a local gateway, explicit per-tab
> consent, and zero product telemetry.

Description:

> Agent Browser Gateway is a local Mac utility and browser companion for developers who use AI
> coding agents. It lets the user explicitly share selected browser tabs with local command-line
> agents through the `abg` CLI while keeping the gateway local to the machine.
>
> ABG is designed around visible consent and local control. By default, no browser tabs are shared.
> The user chooses a tab in the browser extension, grants access for that tab, and can revoke access
> at any time. The local gateway listens on loopback and records operations in a local audit log.
>
> ABG does not operate a cloud browser service, does not require an ABG account, does not collect
> product analytics or telemetry, and does not sell user data. If the user connects ABG output to an
> AI service, that service's own terms and privacy policy apply to the content the user sends to it.

Keywords:

```text
developer tools, browser automation, local gateway, coding agents, debugging
```

Support URL:

```text
https://agent-browser-gateway.com/
```

Privacy Policy URL:

```text
https://agent-browser-gateway.com/privacy/
```

Category:

```text
Developer Tools
```

## App Review Notes

The notes below are saved in the App Store Connect App Review Information notes field
(updated 2026-07-16 after the 0.4.2 rejection). Do not reintroduce CLI steps: the Store build
has no supported `abg` CLI path (see Store-Specific Constraints).

> LAUNCH NOTE: Agent Browser Gateway is a menu bar utility (LSUIElement). On first launch it
> does not open a window or add a Dock icon. A shield icon labeled "ABG" appears at the right
> side of the macOS menu bar. Click it to open the status popover. Launching the app again from
> Applications (or clicking "Plugins" in the popover) opens the full dashboard window.
>
> PURPOSE AND AUDIENCE: A developer utility for software developers who use local AI coding
> agents. It lets the user explicitly share individual browser tabs with their own local tools
> through a gateway that runs entirely on the Mac. Nothing is shared by default; each tab
> requires an explicit user grant that can be revoked at any time; operations are recorded in a
> local audit log.
>
> NO ACCOUNT: The app has no account registration, login, or account deletion, no purchases or
> subscriptions, no user-generated content, and no publisher-issued credentials. It can be fully
> launched and evaluated without signing in. It does not request access to location, contacts,
> camera, microphone, or tracking.
>
> REVIEW STEPS (app only):
> 1. Launch Agent Browser Gateway from Applications.
> 2. Click the shield "ABG" menu bar icon. The popover shows the local gateway status
>    ("Local only - 127.0.0.1:8765"), shared tabs (initially none), and connected extensions
>    ("No extension connected").
> 3. Launch the app again from Applications (or click "Plugins" in the popover) to open the full
>    dashboard window (Plugins, Audit, Settings, Shared Tabs).
>
> REVIEW STEPS (optional full tab-sharing flow):
> 4. In Google Chrome, install the free companion extension "Agent Browser Gateway" from the
>    Chrome Web Store:
>    https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi
> 5. Open any normal web page, click the extension icon, and share the current tab.
> 6. The shared tab appears in the app's popover and dashboard and can be revoked from either
>    side. If the extension is not installed, the app still launches and reports that no
>    extension is connected.
>
> NETWORK SERVER ENTITLEMENT: com.apple.security.network.server is required for core
> functionality. The app is a local gateway server: it listens for incoming WebSocket
> connections from the user's browser extension. The listener binds exclusively to loopback
> (127.0.0.1:8765) and is never reachable from other devices. Without this entitlement the
> extension cannot connect and the app's primary feature is impossible.
> com.apple.security.network.client alone is not sufficient because the app is the listening
> side.
>
> EXTERNAL SERVICES: None required for core functionality. No backend of ours, no data
> providers, no authentication services, no payment processors, no analytics or crash
> reporting, and the app does not call any AI services itself. The optional companion extension
> is distributed through the Chrome Web Store. An optional developer command-line companion is
> distributed separately and is not part of this app.
>
> REGIONS: The app functions identically in all regions.
>
> REGULATED CONTENT: Not applicable. No regulated industry, no protected third-party material;
> original software.
>
> TESTED ON: MacBook Pro (MacBookPro18,2, Apple M1 Max), macOS 26.5.2, sandboxed Mac App Store
> build.

## Final Checklist

- [x] App Store bundle ID decision is recorded.
- [x] Bundle ID is registered in Apple Developer.
- [x] App Store Connect app record is created.
- [x] App Sandbox entitlements are defined.
- [x] Local Store build/package script exists.
- [x] Sandboxed Store build is smoke-tested locally (2026-07-16: sandbox container created,
      loopback WS server bound on 127.0.0.1:8765, Chrome extension reconnected and re-announced
      a shared tab, audit log written in the container; CLI socket bind impossible — see
      Store-Specific Constraints).
- [x] App Store signed package is uploaded.
- [x] Listing metadata, screenshots, privacy information, and review notes are saved.
- [x] Owner reviews the final submission page and submits for App Review.
- [x] Review result is recorded (0.4.2 rejected 2026-07-15: Guideline 2.1.0 + 2.4.5).
- [x] Rejection reply is sent (2026-07-16 12:49 JST, with a 35-second physical-device screen
      recording attached; the disabled "Resubmit to App Review" button is expected because the
      reply, not a resubmission, is the requested action for an information request).
- [x] Release state is recorded (0.4.2 approved and released 2026-07-16, Ready for
      Distribution; the reply alone resolved both rejection reasons the same day).
- [x] Store URL is recorded: https://apps.apple.com/app/id6789562058

## References

- https://developer.apple.com/macos/distribution/
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- https://developer.apple.com/documentation/bundleresources/information-property-list/itsappusesnonexemptencryption
- https://help.apple.com/xcode/mac/current/en.lproj/dev91fe7130a.html
