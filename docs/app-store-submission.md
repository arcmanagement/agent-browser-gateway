# Mac App Store Submission

ABG's Mac App Store path is separate from the Developer ID, Homebrew, and website download paths.
The Store build must be sandboxed and uploaded to App Store Connect as a signed package.

## Current Decision

Use a Store-specific bundle identifier for the initial App Store record:

```text
jp.co.arcm.AgentBrowserGateway
```

This matches the identifier style used by other ArcManagement App Store apps. The existing
Developer ID, Homebrew, and website builds keep using `co.arcm.AgentBrowserGateway`. Do not upload
the first App Store Connect build until this decision is intentionally changed or confirmed, because
App Store Connect does not allow changing the Bundle ID after the first build upload.

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
   SKU: agent-browser-gateway-macos
   User Access: No access restriction
   ```

4. Create or refresh Mac App Store distribution credentials on a trusted maintainer Mac:
   - Mac App Distribution signing certificate
   - Mac Installer Distribution signing certificate
   - Mac App Store Connect provisioning profile for `jp.co.arcm.AgentBrowserGateway`

Do not store Apple private keys, certificates, App Store Connect API keys, or passwords in GitHub
Actions secrets.

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

Local sandbox smoke build:

```bash
VERSION=0.4.2 make appstore-pkg
```

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

The Mac App Store app is sandboxed. Before submitting for review, validate these surfaces under the
Store build, not only under the Developer ID build:

- The Gateway launches and shows local status.
- The local WebSocket server can listen on `127.0.0.1`.
- The Chrome extension can connect to the sandboxed Gateway.
- `abg status` and `abg tabs --compact` have a supported user path.
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

Use this draft in App Store Connect:

> Agent Browser Gateway is a local-first developer utility. It does not create or manage an online
> account, and there are no publisher-issued test credentials. The app can be launched and evaluated
> without signing in.
>
> Primary review steps:
> 1. Install and launch Agent Browser Gateway.
> 2. Confirm the app opens and shows the local gateway status.
> 3. Install the Agent Browser Gateway browser extension from the Chrome Web Store:
>    https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi
> 4. Open a normal web page in Chrome, click the extension icon, and share the current tab.
> 5. From Terminal, run `abg status` and `abg tabs --compact`.
> 6. Confirm the shared tab appears in the CLI output.
>
> The app listens only on loopback for the local browser extension and local CLI. It does not operate
> a cloud relay, analytics endpoint, crash reporter, or hosted account service. If the reviewer does
> not install the browser extension, the app should still launch and report that no extension is
> connected.

## Final Checklist

- [x] App Store bundle ID decision is recorded.
- [x] Bundle ID is registered in Apple Developer.
- [ ] App Store Connect app record is created.
- [x] App Sandbox entitlements are defined.
- [x] Local Store build/package script exists.
- [ ] Sandboxed Store build is smoke-tested locally.
- [ ] App Store signed package is uploaded.
- [ ] Listing metadata, screenshots, privacy information, and review notes are saved.
- [ ] Owner reviews the final submission page and submits for App Review.
- [ ] Review result, Store URL, and release state are recorded.

## References

- https://developer.apple.com/macos/distribution/
- https://developer.apple.com/help/app-store-connect/manage-builds/upload-builds/
- https://help.apple.com/xcode/mac/current/en.lproj/dev91fe7130a.html
