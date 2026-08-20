#!/usr/bin/env node
import { lstatSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export function resolveReproducibleOutput(repoRootInput, requestedOutput) {
  const repoRoot = path.resolve(repoRootInput);
  const allowedRoot = path.join(repoRoot, "dist");
  const output = path.resolve(repoRoot, requestedOutput);

  if (path.dirname(output) !== allowedRoot) {
    throw new Error(
      `ABG_REPRO_OUT must be a direct child of ${allowedRoot}; received ${output}`,
    );
  }

  const allowedRootInfo = lstatSync(allowedRoot, { throwIfNoEntry: false });
  if (allowedRootInfo?.isSymbolicLink()) {
    throw new Error(`Refusing reproducible output because ${allowedRoot} is a symbolic link`);
  }

  return output;
}

function main() {
  const [repoRoot, requestedOutput] = process.argv.slice(2);
  if (!repoRoot || !requestedOutput) {
    console.error("usage: resolve-reproducible-output.mjs <repo-root> <requested-output>");
    process.exit(2);
  }

  try {
    console.log(resolveReproducibleOutput(repoRoot, requestedOutput));
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(2);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
