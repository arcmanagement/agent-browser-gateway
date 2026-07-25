# macOS Install, Update, and Uninstall

This page documents the public macOS DMG installer payload and the Mac App Store
build's CLI setup. The DMG replaces the older temporary ZIP flow for normal users.

## Installed Paths

The DMG contains `Install Agent Browser Gateway.app`. Double-clicking it runs the
embedded installer with administrator privileges and overwrites the installer-managed
payload:

```text
/Applications/Agent Browser Gateway.app
/usr/local/bin/abg
```

The app bundle also carries the CLI at
`/Applications/Agent Browser Gateway.app/Contents/MacOS/abg`; the `/usr/local/bin`
copy is what puts it on `PATH`.

Agent skills for Claude Code and Codex are installed with the skills CLI, not by the
installer:

```bash
npx skills add arcmanagement/agent-browser-gateway -g
```

This installs and updates:

```text
~/.claude/skills/agent-browser-gateway/SKILL.md
~/.claude/skills/abg-plugin-creator/SKILL.md
~/.codex/skills/agent-browser-gateway/SKILL.md
~/.codex/skills/abg-plugin-creator/SKILL.md
```

After installation, the Gateway may create local runtime data:

```text
~/Library/Application Support/AgentBrowserGateway/
~/Library/Logs/AgentBrowserGateway/
~/.abg/
$TMPDIR/abg/screenshots/
~/Library/Group Containers/group.jp.co.arcm.abg/
```

Development profiles use profile-specific variants such as
`~/Library/Application Support/AgentBrowserGateway-dev/`,
`~/Library/Logs/AgentBrowserGateway-dev/`, and `~/.abg-dev/`.

## Mac App Store Build

The Mac App Store version installs only `/Applications/Agent Browser Gateway.app`; a
Store package cannot write to `/usr/local/bin`. The CLI is bundled inside the app.
Put it on `PATH` yourself:

```bash
sudo ln -sf "/Applications/Agent Browser Gateway.app/Contents/MacOS/abg" /usr/local/bin/abg
```

or call it by full path:

```bash
"/Applications/Agent Browser Gateway.app/Contents/MacOS/abg" status
```

The Store gateway and CLI rendezvous through the shared app-group container
(`~/Library/Group Containers/group.jp.co.arcm.abg/`) — a Unix socket when the
path fits the macOS socket-path limit, otherwise a token-authenticated loopback
WebSocket. This is automatic; `abg status` reports the active transports.

The bundled Store CLI is sandboxed. Commands that read arbitrary host files
(`upload --file`, `eval --script-file`, `fill --text-file`) report
`sandbox_unsupported`; use `--stdin` variants or the Homebrew/DMG CLI when you need
them.

## Update Behavior

To update ABG, download the newer DMG and run **Install Agent Browser Gateway.app**
again. The installer:

1. Asks the running Gateway to quit and falls back to killing the `Gateway` process.
2. Removes `/Applications/Agent Browser Gateway.app`.
3. Copies the new app bundle to `/Applications`.
4. Replaces `/usr/local/bin/abg` (and removes the legacy
   `/usr/local/bin/AgentBrowserGateway_abg.bundle` shipped until 0.4.3).
5. Starts the menubar app after installation.

Keep the agent skills current with `npx skills update -g` (or re-run the
`npx skills add` command above).

The update does not delete local runtime state, audit logs, user plugins, or Chrome
extension settings.

## Uninstall

Quit Agent Browser Gateway from the menubar, then remove the installer-managed
payload:

```bash
sudo rm -rf "/Applications/Agent Browser Gateway.app"
sudo rm -f /usr/local/bin/abg
sudo rm -rf /usr/local/bin/AgentBrowserGateway_abg.bundle   # legacy, shipped until 0.4.3
```

Remove the Chrome extension from `chrome://extensions`.

To fully remove local ABG data, also delete the runtime paths you no longer need:

```bash
rm -rf "$HOME/Library/Application Support/AgentBrowserGateway"
rm -rf "$HOME/Library/Logs/AgentBrowserGateway"
rm -rf "$HOME/.abg"
rm -rf "${TMPDIR:-/tmp}/abg"
rm -rf "$HOME/Library/Group Containers/group.jp.co.arcm.abg"
```

Remove the installed agent skills only if you no longer want agents to discover ABG:

```bash
npx skills remove -g agent-browser-gateway abg-plugin-creator
```

or delete the directories directly:

```bash
rm -rf "$HOME/.claude/skills/agent-browser-gateway"
rm -rf "$HOME/.claude/skills/abg-plugin-creator"
rm -rf "${CODEX_HOME:-$HOME/.codex}/skills/agent-browser-gateway"
rm -rf "${CODEX_HOME:-$HOME/.codex}/skills/abg-plugin-creator"
```

## Difference from the Older ZIP Flow

The older temporary ZIP flow required users to manually copy the app bundle and
`abg`, then separately load an unpacked extension directory in Chrome.

The DMG flow is different:

- The macOS app and CLI are embedded in a signed installer app.
- Updating is an overwrite install; re-running the DMG installer replaces the managed
  app and CLI payload.
- Agent skills install from the repository via `npx skills add`, so they can be
  updated independently of the CLI binary.
- The browser extension is installed from the Chrome Web Store for normal use; no
  unpacked extension folder needs to be preserved or reloaded.
