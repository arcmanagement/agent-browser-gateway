// workflow-plugin: command-abstraction examples for plugin authors.

function requireTab(context, command) {
  if (context.tabId == null) {
    return {
      ok: false,
      error: "no_tab_context",
      message: "abg workflow " + command + " requires --tab, --tab-id, --match-url, or a domain auto-bound plugin.",
    };
  }
  return null;
}

abg.registerCommand("clear-and-paste", async function (args, context) {
  var missing = requireTab(context, "clear-and-paste");
  if (missing) return missing;
  await context.tab.clear({ selector: args.selector });
  var paste = await context.tab.paste({ selector: args.selector, value: args.value || "" });
  return { ok: true, plugin: context.plugin.name, paste: paste };
});

abg.registerCommand("read-wait-click", async function (args, context) {
  var missing = requireTab(context, "read-wait-click");
  if (missing) return missing;
  var selector = args.selector;
  await context.tab.wait({ selector: selector, timeoutMs: args.timeoutMs || 3000 });
  var before = await context.tab.read({ selector: selector, format: "text" });
  var click = await context.tab.click({ selector: selector });
  return { ok: true, plugin: context.plugin.name, before: before, click: click };
});

abg.log("registered workflow command examples");
