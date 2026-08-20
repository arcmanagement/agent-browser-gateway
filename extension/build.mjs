import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as esbuild from "esbuild";
import { resolveGatewayWebSocketUrl } from "./src/gatewayEndpoint.js";

const watch = process.argv.includes("--watch");
const target = parseTarget(
  process.env.ABG_EXTENSION_TARGET ?? readArgValue("--target") ?? "chrome",
);
const DEFAULT_ABG_PORT = 8765;
const rawPort = process.env.ABG_EXTENSION_PORT || process.env.ABG_PORT;
const abgPort = parsePort(rawPort, DEFAULT_ABG_PORT);
const defaultAbgWsUrl = `ws://127.0.0.1:${abgPort}/ws`;
const abgWsUrl = resolveGatewayWebSocketUrl(process.env.ABG_EXTENSION_WS_URL, defaultAbgWsUrl);

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });
await patchManifest(target);

const common = {
  bundle: true,
  target: "es2022",
  platform: "browser",
  logLevel: "info",
  define: {
    __ABG_WS_URL__: JSON.stringify(abgWsUrl),
    __ABG_BROWSER_TARGET__: JSON.stringify(target),
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

// Recording: offscreen document that runs getUserMedia + MediaRecorder.
// Chrome-only; the firefox target strips the offscreen assets and permissions.
const offscreenCfg = {
  ...common,
  entryPoints: ["src/offscreen.ts"],
  outfile: "dist/offscreen.js",
  format: "iife",
};

const chromeOnlyBuilds = target === "chrome" ? [offscreenCfg] : [];

if (watch) {
  const contexts = await Promise.all(
    [bgCfg, popupCfg, approvalCfg, ...chromeOnlyBuilds].map((cfg) => esbuild.context(cfg)),
  );
  await Promise.all(contexts.map((ctx) => ctx.watch()));
  console.log(`watching ${target} extension... (gateway ${abgWsUrl})`);
} else {
  await Promise.all(
    [bgCfg, popupCfg, approvalCfg, ...chromeOnlyBuilds].map((cfg) => esbuild.build(cfg)),
  );
  console.log(`built ${target} extension to dist/ (gateway ${abgWsUrl})`);
}

function readArgValue(name) {
  const prefix = `${name}=`;
  const inline = process.argv.find((arg) => arg.startsWith(prefix));
  if (inline) return inline.slice(prefix.length);
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

function parseTarget(raw) {
  if (raw === "chrome" || raw === "firefox") return raw;
  throw new Error(`Invalid extension target: ${raw}`);
}

function parsePort(raw, fallback) {
  if (!raw) return fallback;
  const port = Number(raw);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`Invalid ABG port: ${raw}`);
  }
  return port;
}

async function patchManifest(target) {
  const configuredName = process.env.ABG_EXTENSION_NAME?.trim();
  const devBuild = abgPort !== DEFAULT_ABG_PORT || abgWsUrl !== defaultAbgWsUrl;
  const manifestPath = "dist/manifest.json";
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (target === "firefox") {
    delete manifest.key;
    delete manifest.minimum_chrome_version;
    // Recording relies on the Chrome-only offscreen + tabCapture APIs.
    manifest.permissions = (manifest.permissions ?? []).filter(
      (perm) => perm !== "offscreen" && perm !== "tabCapture",
    );
    // Reading List is Chrome-only in ABG's current extension target set.
    await rm("dist/offscreen.html", { force: true });
    manifest.optional_permissions = (manifest.optional_permissions ?? []).filter(
      (permission) => permission !== "readingList",
    );
    manifest.description =
      "Share Firefox tabs with AI coding agents via explicit local permission.";
    manifest.background = {
      scripts: ["background.js"],
      type: "module",
    };
    manifest.browser_specific_settings = {
      gecko: {
        id: "agent-browser-gateway@arcm.co.jp",
        strict_min_version: "128.0",
        data_collection_permissions: {
          required: ["none"],
        },
      },
    };
  }
  if (!configuredName && !devBuild && target === "chrome") {
    await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    return;
  }
  const name =
    configuredName ||
    (target === "firefox" ? "Agent Browser Gateway for Firefox" : "Agent Browser Gateway Dev");
  manifest.name = name;
  if (manifest.action) {
    manifest.action.default_title = name;
  }
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
}
