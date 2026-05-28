---
name: agent-browser-gateway
version: 0.3.10
description: Windows Native ABG skill. Use the local abg.exe CLI to inspect or operate Chrome tabs shared through the Agent Browser Gateway extension, either per-tab or via opt-in all-tabs mode on isolated profiles.
---

# Agent Browser Gateway for Windows

ABG exposes only Chrome tabs the user explicitly shared from the extension popup.
Do not assume unshared tabs are visible.

Exception: on isolated Chrome profiles or sandbox machines, the user can enable `Share all tabs in this profile` in the extension popup. Then `abg tabs --compact` lists shareable tabs with `accessMode` set to `all_tabs`.

## Basic Flow

1. Run `abg status` to confirm the Windows Gateway is running.
2. Run `abg tabs --compact` to list shared tabs, refs such as `t1`, and access mode.
3. Use `abg read <ref>`, `abg screenshot <ref>`, `abg describe <ref>`, or operation commands only against those refs.
4. If no tab is shared, ask the user to click the ABG Chrome extension icon on the target tab and share it.

## Commands

```powershell
abg status
abg tabs --compact
abg inspect
abg read t1 --format markdown
abg screenshot t1 --out "$env:TEMP\abg-shot.png"
abg console t1
abg table t1 --selector "table"
abg describe t1
abg network t1 --url "*api*" --status-min 400

abg click t1 --selector "button.save"
abg fill t1 --selector "input[name=q]" --value "hello"
abg paste t1 --selector "[contenteditable=true]" --value "long text"
abg clear t1 --selector "[contenteditable=true]"
abg upload t1 --selector "input[type=file]" --file "C:\path\file.zip"
abg key t1 Enter
abg navigate t1 "https://example.com"
abg scroll t1 --dy 800
abg eval t1 --script "document.title" --approve
abg revoke t1
abg audit --lines 50
```

## Windows Notes

- Tray Gateway: `agent-browser-gateway.exe`
- WinUI app: `AgentBrowserGateway.Windows.exe`
- CLI: `abg.exe`
- Extension WebSocket: `127.0.0.1:8765/ws`
- CLI transport: Windows named pipe `AgentBrowserGateway.Cli`
- Audit log: `%LOCALAPPDATA%\AgentBrowserGateway\Logs\audit.jsonl`
- Screenshots: `%TEMP%\abg\screenshots\`
- `abg eval` is disabled by default in the shared extension settings and still requires `--approve` plus the local approval window for every call.

`record`, `replay`, and dynamic plugin commands are not supported by the Windows MVP yet.
