---
name: abg-plugin-creator
version: 0.1.0
description: Scaffold and validate local Agent Browser Gateway plugins.
---

# ABG Plugin Creator

Use this skill when creating or validating Agent Browser Gateway plugins.

Standard layout:

```text
<name>-plugin/
  index.js
  plugin.json
  README.md
```

Key rules:

- Plugins run as local JavaScript inside the Gateway process. Install only trusted code.
- `index.js` is required. `plugin.json` is recommended for list/help metadata.
- Register transforms with `abg.registerTransform(name, fn)`.
- Register commands with `abg.registerCommand(name, async function (args, context) { ... })`.
- Do not shell out, call network APIs, or log raw prompts, credentials, or page content.
- Commands that operate on a tab should use `context.tab.<action>(options)` and require a shared tab context.

Minimal command:

```js
abg.registerCommand("greet", async function (args, context) {
  return { ok: true, message: "Hello, " + (args.name || "ABG"), plugin: context.plugin.name };
});
```

Minimal manifest:

```json
{
  "name": "hello",
  "version": "0.1.0",
  "description": "Minimal ABG plugin.",
  "domains": ["https://example.com/*"],
  "transforms": [],
  "commands": [
    {
      "name": "greet",
      "description": "Return a greeting.",
      "args": [
        { "name": "name", "type": "string", "required": false, "default": "ABG" }
      ]
    }
  ]
}
```

Useful validation commands:

```bash
abg plugin list --local-only
abg plugin reload <name>
abg <name> --help
```
