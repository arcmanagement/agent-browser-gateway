# ABG Plugins

ABG plugins are local JavaScript modules loaded by the Gateway at startup. They run inside the
Gateway process through JavaScriptCore, so install only plugins you trust.

Plugins are searched in this order:

1. Bundled plugins under `Gateway.app/Contents/Resources/plugins/`
2. User-installed plugins under `~/.abg/plugins/`

During repo development, `abg plugin list` also shows the local `plugins/` directory when run from
the checkout.

## Install And Manage

```bash
abg plugin list
abg plugin list --loaded                  # requires a running Gateway

abg plugin install user/repo --yes
abg plugin install https://github.com/user/repo.git --yes
abg plugin install ./my-plugin --name my-plugin --yes

abg plugin update                         # git pull all user plugins
abg plugin update my-plugin
abg plugin uninstall my-plugin
```

`install` requires `--yes` because plugin code is arbitrary JavaScript loaded by the local Gateway.

## Directory Layout

```text
my-plugin/
  index.js
  plugin.json
```

`index.js` is required. `plugin.json` is optional but recommended.

```json
{
  "name": "my-plugin",
  "version": "0.1.0",
  "author": "your-name",
  "description": "Short human-readable summary.",
  "domains": ["https://mail.google.com/*"],
  "transforms": ["gmail-clean-markdown"],
  "commands": []
}
```

## Host API

The host API is intentionally small:

```js
abg.log("loaded " + abg.plugin.name);

abg.registerTransform("my-transform", function (input) {
  return String(input).trim();
});
```

Transforms are synchronous string-to-string functions. The Gateway currently calls the bundled
`html-to-markdown` transform for `abg read --format markdown`; future domain-specific plugins can
register narrower transforms and commands without expanding the browser extension's permissions.

## Safety Rules

- Do not add telemetry or network calls.
- Do not bypass per-tab consent.
- Do not expose arbitrary JavaScript execution to agents.
- Prefer deterministic transforms that are easy to audit.
