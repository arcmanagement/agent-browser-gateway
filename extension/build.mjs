import { cp, mkdir, rm } from "node:fs/promises";
import * as esbuild from "esbuild";

const watch = process.argv.includes("--watch");

await rm("dist", { recursive: true, force: true });
await mkdir("dist", { recursive: true });
await cp("public", "dist", { recursive: true });

const common = {
  bundle: true,
  target: "es2022",
  platform: "browser",
  logLevel: "info",
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
  console.log("watching...");
} else {
  await Promise.all([esbuild.build(bgCfg), esbuild.build(popupCfg), esbuild.build(approvalCfg)]);
  console.log("built to dist/");
}
