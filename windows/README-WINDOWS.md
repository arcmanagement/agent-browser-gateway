# Agent Browser Gateway for Windows

This is the native Windows implementation of ABG. It is separate from the Swift/macOS implementation but keeps the same Chrome extension protocol.

Current `v0.4.4` release status: WinGet install and Windows release ZIPs are pending while the
signed Windows release workflow and WinGet submission setup are completed.

## Normal GUI install

After the package is accepted by the Windows Package Manager Community Repository:

```powershell
winget install --id ArcManagement.AgentBrowserGateway --source winget
```

When a Windows setup ZIP is published, extract
`agent-browser-gateway-<version>-windows-x64-setup.zip` and double-click:

```text
AgentBrowserGatewaySetup.exe
```

The setup app stops the old Gateway, replaces files in `C:\Tools\AgentBrowserGateway`, updates the user `PATH`, refreshes Claude/Codex skills, and starts the tray Gateway.
`AgentBrowserGatewaySetup.exe` launches the WinUI 3 setup surface from the bundled payload; the setup behavior is the same install/update flow as the script path.
When selected, setup also writes a per-user startup entry so the tray Gateway launches when the user signs in.

Silent setup is available for WinGet and scripted installs:

```powershell
.\AgentBrowserGatewaySetup.exe --silent
.\AgentBrowserGatewaySetup.exe --silent --install-dir "C:\Tools\AgentBrowserGateway"
```

## Developer build and install

After cloning the repository or extracting the Windows source zip, run this from the repository root:

```powershell
.\windows-build-install.cmd
```

This restores packages, runs tests, builds `dist\agent-browser-gateway-<version>-windows-x64.zip`,
builds `dist\agent-browser-gateway-<version>-windows-x64-setup.zip`, extracts the non-GUI payload,
installs to `C:\Tools\AgentBrowserGateway`, runs `abg install-skill --target both`, updates
the user `PATH`, and starts the tray Gateway.

WinUI 3 publish must run on Windows or GitHub Actions `windows-latest`. macOS can prepare source
changes and non-WinUI artifacts, but it cannot publish the WinUI app because `XamlCompiler.exe` is
provided by the Windows toolchain.

## Microsoft Store MSIX

Microsoft Store packages are built on Windows from the repository root:

```powershell
.\packaging\msix\build-msix.ps1 `
  -IdentityName "ArcManagementInc.AgentBrowserGateway" `
  -Publisher "CN=ACF7FCEE-0034-48CB-9C9C-D4EBFBE473EB" `
  -Version "<store-version>" `
  -SignForStore
```

Tagged release builds also create this MSIX in GitHub Actions. The Store package version is derived
from the ABG release version as `<ABG major + 1>.<ABG minor>.<ABG patch>.0`; for example, ABG
`0.4.3` becomes Store package version `1.4.3.0`.

The Store package launches the tray Gateway process. The MSIX builder also copies the WinUI 3
generated `.pri` and `.xbf` files into the packaged WinUI app directory so the bundled status/setup
surfaces have their generated resources available.

To skip tests during an emergency handoff:

```powershell
.\windows-build-install.cmd -SkipTests
```

## Manual install

1. Extract `agent-browser-gateway-<version>-windows-x64.zip`.
2. Open PowerShell in the extracted top-level directory:

   ```powershell
   cd .\agent-browser-gateway-<version>-windows-x64
   ```

   If you extracted into a same-named folder, there may be one extra nested
   `agent-browser-gateway-<version>-windows-x64` directory. Run `dir` and change into the folder that
   directly contains `Install-AgentBrowserGateway.ps1`.
3. Run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\Install-AgentBrowserGateway.ps1
   ```

4. Open a new PowerShell window if the installer updated `PATH`.
5. Start `agent-browser-gateway.exe` if it is not already running.
6. Install the ABG Chrome extension from the Web Store or load the existing unpacked extension.
7. Share a tab from the extension popup.
8. Verify:

   ```powershell
   abg status
   abg tabs --compact
   ```

The installer copies files to `C:\Tools\AgentBrowserGateway` by default, updates the user `PATH`, runs `abg install-skill --target both`, and starts the tray Gateway.
Both the GUI setup and installer script register a user-scoped Add/Remove Programs entry at
`HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentBrowserGateway`. The uninstall entry
points to `Uninstall-AgentBrowserGateway.ps1`, so WinGet can uninstall and upgrade through the
standard Windows package-manager path.

## Tray menu

`agent-browser-gateway.exe` runs in the Windows notification area. If the icon is hidden, open the tray overflow arrow.

Right-click the tray icon for:

- `Status` (opens the WinUI 3 status window)
- `Open audit log`
- `Open logs folder`
- `Launch at sign in` (toggles the current install in the user startup list)
- `Restart Gateway`
- `Quit`

## Startup and quit behavior

Windows startup is user-scoped. ABG writes `HKCU\Software\Microsoft\Windows\CurrentVersion\Run`
with the installed `agent-browser-gateway.exe` path when launch-at-sign-in is enabled. It does not
install a Windows service or machine-wide scheduled task.

`Quit` exits only the current tray Gateway process. If launch-at-sign-in remains enabled, ABG starts
again the next time the user signs in. Disable `Launch at sign in` from the tray menu or the WinUI
status window before quitting if the Gateway should stay off after reboot.

## Signing, SmartScreen, and release artifacts

Windows release artifacts are produced on GitHub Actions `windows-latest` by the `Windows CI`
workflow. The workflow uploads both:

- `agent-browser-gateway-<version>-windows-x64.zip`
- `agent-browser-gateway-<version>-windows-x64-setup.zip`
- `AgentBrowserGateway_<store-version>_win-x64.msix`

Each zip is accompanied by a `.sha256.txt` file. The setup zip is the normal user-facing GitHub
Release and WinGet artifact. The MSIX is the Microsoft Store submission package.

For signed release publication and WinGet submission, configure these repository secrets before
dispatching the workflow:

- `WINDOWS_CODESIGN_PFX_BASE64`: base64-encoded Authenticode signing certificate in PFX format
- `WINDOWS_CODESIGN_PFX_PASSWORD`: PFX password
- `WINGET_CREATE_GITHUB_TOKEN`: GitHub token that can submit PRs to `microsoft/winget-pkgs`

Then run `Windows CI` with `require_code_sign=true` when the goal is to prove signing is configured.
The packaging script signs the staged `.exe` and `.dll` files before zipping, including
`AgentBrowserGatewaySetup.exe`, `abg.exe`, and `agent-browser-gateway.exe`. If signing is explicitly
required but the certificate or `signtool.exe` is unavailable, the workflow fails instead of
publishing an unsigned final artifact.

When a release is published, `Windows CI` always runs build/test/package and uploads both Windows
ZIPs and their SHA-256 files as workflow artifacts. GitHub Release asset upload is gated on the
Windows signing secrets being configured, so an unsigned package is not published as an official
release asset. WinGet manifest generation and submission run only when both signing secrets and
`WINGET_CREATE_GITHUB_TOKEN` are configured.

SmartScreen reputation is attached to the signing certificate and observed download history, not to
this repository alone. Early signed releases can still show SmartScreen warnings until reputation is
established. Keep timestamp signing enabled so existing artifacts remain verifiable after certificate
expiration.

## Paths

- Tray Gateway: `agent-browser-gateway.exe`
- WinUI app: `AgentBrowserGateway.Windows.exe`
- CLI: `abg.exe`
- Audit log: `%LOCALAPPDATA%\AgentBrowserGateway\Logs\audit.jsonl`
- Screenshots: `%TEMP%\abg\screenshots\`
- User plugins/config: `%USERPROFILE%\.abg\` by default (`%USERPROFILE%\.abg-dev\` for `ABG_PORT=8766` dev runs)
- Approved eval: `abg eval t1 --script "document.title" --approve`, disabled by default in extension settings. `--approve` and the approval window are required unless Trusted automation / AutoMode is enabled in the extension popup.

## MVP limitations

The Windows MVP supports the main observation and operation commands. `record`, `replay`, and dynamic plugin commands return `not_supported_on_windows_mvp`.
