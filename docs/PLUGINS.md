# ABG Plugin Tutorial

ABG plugins are local JavaScript modules loaded by the Gateway at startup. They run inside the
Gateway process through JavaScriptCore, so install only plugins you trust.

Plugins are searched in this order:

1. Bundled plugins under `Agent Browser Gateway.app/Contents/Resources/plugins/`
2. User-installed plugins under `~/.abg/plugins/` by default (`~/.abg-dev/plugins/` for `ABG_PORT=8766` dev runs)

During repo development, `abg plugin list` also shows the local `plugins/` directory when run from
the checkout.

## Install And Manage

```bash
abg plugin list
abg plugin list --loaded                  # requires a running Gateway

abg plugin install user/repo --yes
abg plugin install https://github.com/user/repo.git --yes
abg plugin install git@github.com:user/private-plugin.git --yes
abg plugin install ./my-plugin --name my-plugin --yes

abg plugin update                         # git pull all user plugins
abg plugin update my-plugin
abg plugin reload my-plugin               # reload in the running Gateway without re-sharing tabs
abg plugin reload                         # reload all plugins on the Gateway search paths
abg plugin uninstall my-plugin
```

The macOS plugin browser exposes the same install path through the `+` button. Paste `user/repo`,
an HTTPS GitHub URL, an SSH Git URL, or another `git clone` URL. User-installed plugins also show
Update and Uninstall actions in the detail view.

`install` requires `--yes` in the CLI because plugin code is arbitrary JavaScript loaded by the
local Gateway. Repository installs use the local `git` command, so private repositories use the
user's existing SSH keys, git credential helper, or GitHub CLI-backed git authentication. ABG does
not ask for or store GitHub tokens, and HTTPS URLs with embedded credentials are rejected.

Update runs `git pull --ff-only` for git-backed user plugins. Uninstall only removes directories
under the active user plugin root. Built-in plugins come from the app bundle, and Local Dev plugins
are external working copies, so the browser does not uninstall them.

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

## Host API

The host API is intentionally small:

```js
abg.log("loaded " + abg.plugin.name);

abg.registerTransform("my-transform", function (input) {
  return String(input).trim();
});
```

Transforms are synchronous string-to-string functions. The Gateway calls `html-to-markdown` for
generic `abg read --format markdown` output. If a plugin manifest declares `domains` and a transform
name containing `markdown`, the Gateway tries that transform first when the shared tab URL matches
one of the domain globs.

## Commands API

Plugins can also expose first-class CLI commands:

```js
abg.registerCommand("greet", async function (args, context) {
  return {
    message: "Hello, " + (args.name || "ABG"),
    plugin: context.plugin.name,
    version: context.plugin.version
  };
});
```

The handler signature is:

```js
(args, context) => result | Promise<result>
```

`args` is a JSON object built by the CLI. `context` contains the current plugin metadata as
`context.plugin.name` and `context.plugin.version`, plus `context.tabId` when the caller passes
`--tab-id`.

Registering the command in JavaScript is the source of truth. `plugin.json` command metadata is for
documentation and CLI help. If the manifest declares a command that `index.js` does not register,
the Gateway logs a startup warning and keeps loading the plugin.

Command metadata supports `string`, `boolean`, `number`, and `object` argument types:

```json
{
  "name": "hello-plugin",
  "version": "0.1.0",
  "commands": [
    {
      "name": "greet",
      "description": "Return a greeting.",
      "args": [
        { "name": "name", "type": "string", "required": false, "default": "ABG" },
        { "name": "loud", "type": "boolean", "required": false, "default": false }
      ]
    }
  ]
}
```

Invoke plugin commands as dynamic ABG subcommands:

```bash
abg hello-plugin greet --name "Ada" --loud
abg hello-plugin greet --tab t1
abg hello-plugin greet --match-url "*example.com*"
abg hello-plugin greet --json '{"name":"Ada","loud":true}'
printf '{"name":"Ada"}' | abg hello-plugin greet --stdin
```

`--key value` becomes `{ "key": value }`; `--flag` becomes `{ "flag": true }`. Scalar values are
parsed as booleans or numbers when possible, otherwise they remain strings. `--json` and JSON
`--stdin` merge object values into `args`; non-JSON stdin is passed as `args.stdin`.
`--tab`, `--tab-id`, `--match-url`, `--match-title`, and `--first` are reserved by the dynamic
command runner for tab binding and are not passed through as plugin args.

The command result is serialized as JSON to stdout. Handler failures are returned as structured JSON
errors containing `error`, `message`, `plugin`, and `command`.

If the command is invoked without an explicit tab and the plugin manifest declares `domains`, the
Gateway tries to bind the command to a shared tab whose URL matches those domain globs. Exactly one
match becomes `context.tabId`; zero matches returns `no_matching_tab` with `expectedDomains`; multiple
matches returns `ambiguous_tab` with compact `candidates`. `--tab-id`, `--tab`, or `--match-url`
remain explicit overrides.

Audit logs record command invocations with `action: "plugin_command_run"`, the plugin name, command
name, argument key list, and serialized argument byte length. Argument values are never written to
the audit log because prompts and payloads may contain sensitive data.

Prefer command handlers that return structured JSON with a stable `{ ok, ... }` shape. Keep command
argument metadata in `plugin.json` so `abg <plugin> <command> --help` can display required inputs and
defaults. Command plugins should compose `context.tab.*` primitives instead of shelling out or
inventing a separate browser access path.

The bundled agent skill in `Sources/abg/Resources/agent-browser-gateway.md` contains the concise
agent-facing authoring guide. Keep this tutorial as the deeper human-facing reference.

### Tab API

Command handlers can drive the shared tab with `context.tab.<action>(options)`. Each method returns a
Promise resolving to the same JSON shape as the corresponding CLI primitive, and rejects with
`{ error: "no_tab_context", message: "..." }` when the command was invoked without `--tab-id`.

Available methods:

- `context.tab.paste({ selector, value })` mirrors `abg paste`.
- `context.tab.clear({ selector })` mirrors `abg clear`.
- `context.tab.fill({ selector, value })` mirrors `abg fill`.
- `context.tab.click({ selector })`, `context.tab.click({ x, y })`, or `context.tab.click({ id })`
  mirrors `abg click`.
- `context.tab.key({ key, modifiers })` mirrors `abg key`.
- `context.tab.read({ selector, format })` mirrors `abg read`; `format: "markdown"` enables Markdown
  conversion.
- `context.tab.describe({ filter, depth })` mirrors `abg describe`.
- `context.tab.wait({ selector, hidden, ms })` mirrors `abg wait`.
- `context.tab.screenshot({ selector, x, y, width, height })` mirrors `abg screenshot`; clipping uses
  `x`, `y`, `width`, and `height`.
- `context.tab.navigate({ url })` mirrors `abg navigate`.

Plugin-issued tab actions route through the same Gateway dispatch path as CLI calls, so per-tab
consent, operation approval, debug bar behavior, and audit logging apply uniformly. Do not shell out
from JavaScript or log raw argument values.

```js
abg.registerCommand("clear-and-paste", async function (args, context) {
  if (context.tabId == null) {
    return { ok: false, error: "no_tab_context" };
  }
  await context.tab.clear({ selector: args.selector });
  await context.tab.paste({ selector: args.selector, value: args.value });
  return { ok: true };
});
```

### Hello Command Example

```text
hello-plugin/
  index.js
  plugin.json
```

```js
abg.registerCommand("greet", async function (args) {
  const name = args.name || "ABG";
  return { ok: true, message: "Hello, " + name };
});
```

```json
{
  "name": "hello-plugin",
  "version": "0.1.0",
  "description": "Minimal ABG command plugin.",
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

After installing or bundling the plugin and restarting the Gateway:

```bash
abg hello-plugin greet --name "Ada"
```

During plugin development, use `abg plugin reload hello-plugin` to reload `index.js` and
`plugin.json` without quitting ABG.app. Existing tab shares are preserved. If a reload fails, the
previous loaded version remains active.

Expected output:

```json
{
  "message": "Hello, Ada",
  "ok": true
}
```

### Local Redaction

The bundled `redaction` plugin provides an opt-in Markdown masking transform:

```bash
abg read t1 --format markdown --redact
abg read t1 --format markdown --redact --redact-regex 'ACME-[0-9]+'
printf 'ada@example.com' | abg redaction redact --stdin
abg redaction redact --json '{"text":"ticket ACME-123","customRegexes":["ACME-[0-9]+"]}'
```

The baseline masks email addresses, phone-like strings, credit-card-like strings, and optional custom
regexes supplied by the caller. It is a local content-minimization helper, not a security guarantee.
When `--redact` runs, the audit log records transform names and custom regex count, not raw matched
values.

## Per-Domain Markdown Plugin

This is the smallest useful per-domain plugin:

```js
function cleanGmail(html) {
  return String(html)
    .replace(/<style[\s\S]*?<\/style>/gi, "")
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

abg.registerTransform("gmail-clean-markdown", cleanGmail);
```

Declare the target domain in `plugin.json`:

```json
{
  "name": "gmail-plugin",
  "domains": ["https://mail.google.com/*"],
  "transforms": ["gmail-clean-markdown"]
}
```

Then read a shared matching tab:

```bash
abg read --match-url "https://mail.google.com/*" --format markdown --first
```

ABG will call `gmail-clean-markdown` before falling back to the generic `html-to-markdown`
transform.

## Bundled Examples

- `plugins/markdown-plugin` provides generic HTML to Markdown conversion.
- `plugins/notion-plugin` is a per-domain plugin for `notion.so` and `notion.site` pages. It strips
  Notion app chrome, scripts, styles, sidebars, popovers, and bookkeeping attributes before
  returning compact Markdown.
- `plugins/gmail-plugin`, `plugins/slack-plugin`, and `plugins/linear-plugin` are first-party
  per-domain Markdown examples for authenticated app pages. They run locally in the Gateway plugin
  host, use deterministic transforms, and do not make network calls.
- `plugins/slack-plugin` also provides `catch-up`, `pending`, and `open-channel` workflow commands
  for reading settled channel messages and jumping to a channel by name or id.
- `plugins/redaction-plugin` provides opt-in local Markdown redaction.
- `plugins/workflow-plugin` demonstrates command abstraction with `context.tab.clear`,
  `context.tab.paste`, `context.tab.wait`, `context.tab.read`, and `context.tab.click`.
- `plugins/info-plugin` is a loader smoke test.

Run the Notion benchmark:

```bash
node examples/benchmark-notion-plugin.mjs
```

## Safety Rules

- Do not add telemetry or network calls.
- Do not bypass the configured tab access mode. Plugins must use the Gateway tab APIs and must not invent a separate browser access path.
- Do not bypass the approved-eval / Trusted automation boundary or expose unapproved arbitrary JavaScript execution to agents.
- Prefer deterministic transforms that are easy to audit.
