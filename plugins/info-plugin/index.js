// info-plugin: smoke test plugin for the ABG plugin loader.
// Runs at Gateway startup, verifies the `abg` host API is wired correctly.

abg.log("hello from " + abg.plugin.name + ", abg=" + abg.version);

abg.registerCommand("ping", async function (args, context) {
  return {
    ok: true,
    echo: args.message || "pong",
    plugin: context.plugin.name,
  };
});
