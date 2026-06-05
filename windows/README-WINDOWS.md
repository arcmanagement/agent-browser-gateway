# Agent Browser Gateway for Windows

This is the native Windows implementation of ABG. It is separate from the Swift/macOS implementation but keeps the same Chrome extension protocol.

## Normal GUI install

For regular Windows use, extract `agent-browser-gateway-0.3.12-windows-x64-setup.zip` and double-click:

```text
AgentBrowserGatewaySetup.exe
```

The setup app stops the old Gateway, replaces files in `C:\Tools\AgentBrowserGateway`, updates the user `PATH`, refreshes Claude/Codex skills, and starts the tray Gateway.

## Developer build and install

After extracting the Windows source zip, run this from the extracted repository root:

```powershell
.\windows-build-install.cmd
```

This restores packages, runs tests, builds `dist\agent-browser-gateway-0.3.12-windows-x64.zip`,
builds `dist\agent-browser-gateway-0.3.12-windows-x64-setup.zip`, extracts the non-GUI payload,
installs to `C:\Tools\AgentBrowserGateway`, runs `abg install-skill --target both`, updates
the user `PATH`, and starts the tray Gateway.

To skip tests during an emergency handoff:

```powershell
.\windows-build-install.cmd -SkipTests
```

## Manual install

1. Extract `agent-browser-gateway-0.3.12-windows-x64.zip`.
2. In PowerShell, run:

   ```powershell
   Set-ExecutionPolicy -Scope Process Bypass
   .\Install-AgentBrowserGateway.ps1
   ```

3. Open a new PowerShell window if the installer updated `PATH`.
4. Start `agent-browser-gateway.exe` if it is not already running.
5. Install the ABG Chrome extension from the Web Store or load the existing unpacked extension.
6. Share a tab from the extension popup.
7. Verify:

   ```powershell
   abg status
   abg tabs --compact
   ```

The installer copies files to `C:\Tools\AgentBrowserGateway` by default, updates the user `PATH`, runs `abg install-skill --target both`, and starts the tray Gateway.

## Tray menu

`agent-browser-gateway.exe` runs in the Windows notification area. If the icon is hidden, open the tray overflow arrow.

Right-click the tray icon for:

- `Status`
- `Open audit log`
- `Open logs folder`
- `Restart Gateway`
- `Quit`

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
