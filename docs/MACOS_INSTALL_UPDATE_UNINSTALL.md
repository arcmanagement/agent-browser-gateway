# macOS Install, Update, and Uninstall

This page documents the public macOS DMG installer payload. It replaces the older
temporary ZIP flow for normal users.

## Installed Paths

The DMG contains `Install Agent Browser Gateway.app`. Double-clicking it runs the
embedded installer with administrator privileges and overwrites the installer-managed
payload:

```text
/Applications/Agent Browser Gateway.app
/usr/local/bin/abg
/usr/local/bin/AgentBrowserGateway_abg.bundle
```

The installer also runs `abg install-skill`, which installs or updates both bundled
skills for Claude Code and Codex:

```text
~/.claude/skills/agent-browser-gateway/SKILL.md
~/.claude/skills/abg-plugin-creator/SKILL.md
~/.codex/skills/agent-browser-gateway/SKILL.md
~/.codex/skills/abg-plugin-creator/SKILL.md
```

If `CODEX_HOME` is set, Codex skills are installed under:

```text
$CODEX_HOME/skills/agent-browser-gateway/SKILL.md
$CODEX_HOME/skills/abg-plugin-creator/SKILL.md
```

After installation, the Gateway may create local runtime data:

```text
~/Library/Application Support/AgentBrowserGateway/
~/Library/Logs/AgentBrowserGateway/
~/.abg/
$TMPDIR/abg/screenshots/
```

Development profiles use profile-specific variants such as
`~/Library/Application Support/AgentBrowserGateway-dev/`,
`~/Library/Logs/AgentBrowserGateway-dev/`, and `~/.abg-dev/`.

## Update Behavior

To update ABG, download the newer DMG and run **Install Agent Browser Gateway.app**
again. The installer:

1. Asks the running Gateway to quit and falls back to killing the `Gateway` process.
2. Removes `/Applications/Agent Browser Gateway.app`.
3. Copies the new app bundle to `/Applications`.
4. Replaces `/usr/local/bin/abg`.
5. Replaces `/usr/local/bin/AgentBrowserGateway_abg.bundle`.
6. Runs `abg install-skill` so Claude Code and Codex skills match the installed CLI.
7. Starts the menubar app after installation.

The update does not delete local runtime state, audit logs, user plugins, or Chrome
extension settings.

## Uninstall

Quit Agent Browser Gateway from the menubar, then remove the installer-managed
payload:

```bash
sudo rm -rf "/Applications/Agent Browser Gateway.app"
sudo rm -f /usr/local/bin/abg
sudo rm -rf /usr/local/bin/AgentBrowserGateway_abg.bundle
```

Remove the Chrome extension from `chrome://extensions`.

To fully remove local ABG data, also delete the runtime paths you no longer need:

```bash
rm -rf "$HOME/Library/Application Support/AgentBrowserGateway"
rm -rf "$HOME/Library/Logs/AgentBrowserGateway"
rm -rf "$HOME/.abg"
rm -rf "${TMPDIR:-/tmp}/abg"
```

Remove the installed agent skills only if you no longer want agents to discover ABG:

```bash
rm -rf "$HOME/.claude/skills/agent-browser-gateway"
rm -rf "$HOME/.claude/skills/abg-plugin-creator"
rm -rf "${CODEX_HOME:-$HOME/.codex}/skills/agent-browser-gateway"
rm -rf "${CODEX_HOME:-$HOME/.codex}/skills/abg-plugin-creator"
```

## Difference from the Older ZIP Flow

The older temporary ZIP flow required users to manually copy the app bundle, `abg`,
and `AgentBrowserGateway_abg.bundle`, then separately load an unpacked extension
directory in Chrome.

The DMG flow is different:

- The macOS app, CLI, and CLI resource bundle are embedded in a signed installer app.
- Updating is an overwrite install; re-running the DMG installer replaces the managed
  app and CLI payload.
- `abg install-skill` runs as part of installation, so bundled skills track the
  installed CLI version.
- The browser extension is installed from the Chrome Web Store for normal use; no
  unpacked extension folder needs to be preserved or reloaded.
