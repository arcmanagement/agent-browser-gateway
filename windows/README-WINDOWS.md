# Agent Browser Gateway for Windows

This is the native Windows implementation of ABG. It is separate from the Swift/macOS implementation but keeps the same Chrome extension protocol.

## Normal GUI install

For regular Windows use, extract `agent-browser-gateway-0.3.12-windows-x64-setup.zip` and double-click:

```text
AgentBrowserGatewaySetup.exe
```

The setup app stops the old Gateway, replaces files in `C:\Tools\AgentBrowserGateway`, updates the user `PATH`, refreshes Claude/Codex skills, and starts the tray Gateway.
`AgentBrowserGatewaySetup.exe` launches the WinUI 3 setup surface from the bundled payload; the setup behavior is the same install/update flow as the script path.
When selected, setup also writes a per-user startup entry so the tray Gateway launches when the user signs in.

## Developer build and install

After extracting the Windows source zip, run this from the extracted repository root:

```powershell
.\windows-build-install.cmd
```

This restores packages, runs tests, builds `dist\agent-browser-gateway-0.3.12-windows-x64.zip`,
builds `dist\agent-browser-gateway-0.3.12-windows-x64-setup.zip`, extracts the non-GUI payload,
installs to `C:\Tools\AgentBrowserGateway`, runs `abg install-skill --target both`, updates
the user `PATH`, and starts the tray Gateway.

WinUI 3 publish must run on Windows or GitHub Actions `windows-latest`. macOS can prepare source
changes and non-WinUI artifacts, but it cannot publish the WinUI app because `XamlCompiler.exe` is
provided by the Windows toolchain.

To skip tests during an emergency handoff:

```powershell
.\windows-build-install.cmd -SkipTests
```

## Manual install

1. Extract `agent-browser-gateway-0.3.12-windows-x64.zip`.
2. Open PowerShell in the extracted top-level directory:

   ```powershell
   cd .\agent-browser-gateway-0.3.12-windows-x64
   ```

   If you extracted into a same-named folder, there may be one extra nested
   `agent-browser-gateway-0.3.12-windows-x64` directory. Run `dir` and change into the folder that
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
