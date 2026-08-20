import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { resolveReproducibleOutput } from "./resolve-reproducible-output.mjs";

const repoRoot = path.resolve("/example/agent-browser-gateway");

test("accepts only direct children of the repository dist directory", () => {
  assert.equal(
    resolveReproducibleOutput(repoRoot, "dist/reproducible-build"),
    path.join(repoRoot, "dist/reproducible-build"),
  );
  assert.equal(
    resolveReproducibleOutput(repoRoot, path.join(repoRoot, "dist", "comparison-run")),
    path.join(repoRoot, "dist/comparison-run"),
  );
});

test("rejects paths that could delete unrelated data", () => {
  for (const candidate of [
    repoRoot,
    path.dirname(repoRoot),
    path.join(repoRoot, ".tmp", "comparison-run"),
    path.join(repoRoot, "dist"),
    path.join(repoRoot, "dist", "nested", "comparison-run"),
  ]) {
    assert.throws(
      () => resolveReproducibleOutput(repoRoot, candidate),
      /ABG_REPRO_OUT must be a direct child/,
    );
  }
});
