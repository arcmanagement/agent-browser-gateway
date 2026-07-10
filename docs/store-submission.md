# Microsoft Store Submission

ABG's near-term Windows distribution path is Microsoft Store MSIX submission. Signed GitHub Release
assets and WinGet distribution remain deferred in #291 because ArcManagement-owned OV code signing
with cloud signing has recurring cost.

## Product Type

Use Partner Center:

- `New product` -> `MSIX or PWA app`
- Public product name: `Agent Browser Gateway`
- Category: `Developer tools`
- Package type: MSIX package

Do not use the `EXE or MSI app` product type for the current Store path. The EXE/MSI path requires
publisher-owned Authenticode signing before submission, while the MSIX Store path is re-signed by
Microsoft after certification.

## Marketplace Ingestion MCP

Do not use the Marketplace Ingestion MCP server for the current ABG Windows Store submission. The
MCP server is for Microsoft commercial marketplace Product Ingestion API workflows, and Microsoft
documents its launch support as SaaS and Microsoft 365 / Copilot offers. It does not currently cover
Partner Center `Apps and games` MSIX app name reservation or MSIX package upload.

## Partner Center Identity

After the product is reserved, record the values from Partner Center product identity:

- Store ID: `TODO`
- Package/Identity/Name: `TODO`
- Package/Identity/Publisher: `TODO`
- Package/Properties/PublisherDisplayName: `ArcManagement, Inc.`
- Package Family Name: `TODO`

Use those identity values when building the Store package. The values are case-sensitive.

## Package Build

Run on a Windows build machine with the Windows SDK installed:

```powershell
cd <checkout>
.\packaging\msix\build-msix.ps1 `
  -IdentityName "<Package/Identity/Name from Partner Center>" `
  -Publisher "<Package/Identity/Publisher from Partner Center>" `
  -PublisherDisplayName "ArcManagement, Inc." `
  -Version "1.0.0.0" `
  -SignForStore
```

The package is written to:

```text
artifacts\msix\AgentBrowserGateway_<version>_win-x64.msix
```

The Store package version must use four numeric parts, and the fourth revision part must be `0`.
For the initial Store submission, use `1.0.0.0` unless Partner Center requires a different higher
version.

## Listing Copy

Short description:

> Share selected browser tabs with AI coding agents through a local gateway, explicit per-tab
> consent, and zero product telemetry.

Description:

> Agent Browser Gateway is a local Windows desktop app and browser companion for developers who use
> AI coding agents. It lets the user explicitly share selected browser tabs with local command-line
> agents through the `abg` CLI while keeping the gateway local to the machine.
>
> ABG is designed around visible consent and local control. By default, no browser tabs are shared.
> The user chooses a tab in the browser extension, grants access for that tab, and can revoke access
> at any time. The local gateway listens on loopback and records operations in a local audit log.
>
> ABG does not operate a cloud browser service, does not require an ABG account, does not collect
> product analytics or telemetry, and does not sell user data. If the user connects ABG output to an
> AI service, that service's own terms and privacy policy apply to the content the user sends to it.
>
> Typical uses include reading a shared web page from a coding agent, taking local screenshots,
> inspecting page structure, and running approved browser actions during development and debugging
> workflows.

Feature bullets:

- Explicit per-tab browser sharing
- Local gateway for command-line AI agent workflows
- `abg` CLI for observation and approved browser operations
- Local audit log for browser operations
- No ABG-operated cloud relay, account system, analytics, or telemetry
- Works with the existing Agent Browser Gateway browser extension

## Privacy Policy

Use:

```text
https://agent-browser-gateway.com/privacy/
```

Privacy summary:

> ABG handles browser data locally for tabs the user explicitly shares or commands the user chooses
> to run. ABG does not collect analytics, telemetry, advertising identifiers, or crash reports, and
> does not sell user data. Browser content is not sent to ArcManagement-operated servers by ABG.

## Additional License Terms

Use the license terms from `LICENSE`. Keep the Store additional license terms aligned with the
public website license text.

## Notes for Certification

Use this text in Partner Center `Notes for certification`:

> Agent Browser Gateway is a local-first developer utility. It does not create or manage an online
> account, and there are no publisher-issued test credentials. The app can be launched and evaluated
> without signing in.
>
> Primary certification steps:
> 1. Install and launch Agent Browser Gateway from the submitted MSIX.
> 2. Confirm the app opens and shows the local gateway status.
> 3. Install the Agent Browser Gateway browser extension from the Chrome Web Store:
>    https://chromewebstore.google.com/detail/agent-browser-gateway/ojgedfcgebjchckaagjkmlpgonpjggpi
> 4. Open a normal web page in Chrome, click the extension icon, and share the current tab.
> 5. From PowerShell, run `abg status` and `abg tabs --compact`.
> 6. Confirm the shared tab appears in the CLI output.
>
> The app listens only on loopback for the local browser extension and local CLI. It does not operate
> a cloud relay, analytics endpoint, crash reporter, or hosted account service. If the reviewer does
> not install the browser extension, the app should still launch and report that no extension is
> connected.
>
> The package declares `runFullTrust` because ABG is a packaged desktop app that runs a local gateway
> process and exposes the `abg.exe` command-line alias.

## Assets

Required before final submission:

- At least one Store screenshot
- Store logo
- Privacy policy URL
- Additional license terms
- Notes for certification

Use screenshot size `1366 x 768` PNG for consistency with the previous Store submission workflow.

## Final Submission Checklist

- [ ] Product name is reserved in Partner Center.
- [ ] Partner Center identity values are recorded in this file.
- [ ] The MSIX is built from the current release source on Windows.
- [ ] The generated `AppxManifest.xml` has the Partner Center identity values.
- [ ] The package version uses four numeric parts and revision `0`.
- [ ] The package is uploaded to Partner Center.
- [ ] Listing copy, privacy policy URL, license terms, and certification notes are saved.
- [ ] Screenshots and Store logo are uploaded.
- [ ] Owner reviews the final submission page.
- [ ] Owner clicks `Submit for certification`.

## References

- https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/app-package-requirements
- https://learn.microsoft.com/en-us/windows/apps/publish/publish-your-app/msix/create-app-submission
- https://learn.microsoft.com/en-us/windows/apps/desktop/modernize/package-identity-overview
- https://learn.microsoft.com/en-us/partner-center/marketplace-offers/ingestion-mcp
