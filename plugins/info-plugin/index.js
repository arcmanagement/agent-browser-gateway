// info-plugin: smoke test plugin for the ABG plugin loader.
// Runs at Gateway startup, verifies the `abg` host API is wired correctly.

abg.log("hello from " + abg.plugin.name + ", abg=" + abg.version);
