---
name: abg-plugin-creator
version: 0.1.0
description: Scaffold and validate local Agent Browser Gateway plugins under ~/.abg/plugins or a repo plugins/ directory.
---

# ABG Plugin Creator

Use this skill when the user asks to create, scaffold, edit, or validate an Agent Browser Gateway plugin.

## Workflow

1. Decide whether the plugin is a user plugin under `~/.abg/plugins/<name>/` or a bundled repo plugin under `plugins/<name>-plugin/`.
2. Create the standard layout:

```text
<name>-plugin/
  index.js
  plugin.json
  README.md
```

3. Keep `index.js` deterministic and local-only. Do not shell out, call network APIs, or log raw prompt/content values.
4. Register commands in JavaScript with `abg.registerCommand`. Treat `plugin.json` command metadata as discovery/help text, not the source of truth.
5. Register transforms with `abg.registerTransform`. Domain Markdown transforms should include `markdown` in the transform name and list matching URL globs in `plugin.json`.
6. If commands need a browser tab, use `context.tab.<action>(options)`. Prefer domain auto-bind through `plugin.json` `domains`; otherwise document `--tab`, `--tab-id`, or `--match-url`.
7. Validate with focused tests or, for a quick local smoke test, run:

```bash
swift test --filter PluginHostTests
abg plugin list --local-only
abg plugin reload <name>
abg <name> --help
```

## Minimal Manifest

```json
{
  "name": "hello",
  "version": "0.1.0",
  "author": "your-name",
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

## Minimal Command

```js
abg.registerCommand("greet", async function (args, context) {
  return {
    ok: true,
    message: "Hello, " + (args.name || "ABG"),
    plugin: context.plugin.name
  };
});
```

## Minimal Tab Command

```js
abg.registerCommand("clear-and-paste", async function (args, context) {
  if (context.tabId == null) {
    return { ok: false, error: "no_tab_context" };
  }
  await context.tab.clear({ selector: args.selector });
  await context.tab.paste({ selector: args.selector, value: args.value || "" });
  return { ok: true };
});
```

## Notes

- Plugin install/update code is scoped to ABG-owned plugin directories. Do not overwrite unrelated user skills or plugins.
- `abg plugin install <source> --yes` is required because plugins run JavaScript inside the local Gateway process.
- `abg plugin reload [name]` reloads plugin code without requiring the user to quit ABG.app or re-share tabs.
- Audit logs for plugin commands must record argument keys and byte counts only, never raw values.
