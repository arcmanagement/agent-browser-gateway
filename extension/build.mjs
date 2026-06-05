import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");
const DEFAULT_ABG_PORT = 8765;
const rawPort = process.env.ABG_EXTENSION_PORT || process.env.ABG_PORT;
const abgPort = parsePort(rawPort, DEFAULT_ABG_PORT);
const abgWsUrl = `ws://127.0.0.1:${abgPort}/ws`;

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await patchManifest();

const common = {
  bundle: true,
  target: "es2022",
  platform: "browser",
  logLevel: "info",
  define: {
    __ABG_WS_URL__: JSON.stringify(abgWsUrl),
  },
};

const bgCfg = {
  ...common,
  entryPoints: ["src/background.ts"],
  outfile: "dist/background.js",
  format: "esm",
};

const popupCfg = {
  ...common,
  entryPoints: ["src/popup.ts"],
  outfile: "dist/popup.js",
  format: "iife",
};

const approvalCfg = {
  ...common,
  entryPoints: ["src/approval.ts"],
  outfile: "dist/approval.js",
  format: "iife",
};

if (watch) {
  const bg = await esbuild.context(bgCfg);
  const pop = await esbuild.context(popupCfg);
  const approval = await esbuild.context(approvalCfg);
  await Promise.all([bg.watch(), pop.watch(), approval.watch()]);
  console.log(`watching... (gateway ${abgWsUrl})`);
} else {
  await Promise.all([esbuild.build(bgCfg), esbuild.build(popupCfg), esbuild.build(approvalCfg)]);
  console.log(`built to dist/ (gateway ${abgWsUrl})`);
}

function parsePort(raw, fallback) {
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ABG port: ${raw}`);
  }
  return port;
}

async function patchManifest() {
  const configuredName = process.env.ABG_EXTENSION_NAME?.trim();
  const devBuild = abgPort !== DEFAULT_ABG_PORT;
  if (!configuredName && !devBuild) return;

  const manifestPath = "dist/manifest.json";
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  const name = configuredName || "Agent Browser Gateway Dev";
  manifest.name = name;
  if (manifest.action) {
    manifest.action.default_title = name;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
