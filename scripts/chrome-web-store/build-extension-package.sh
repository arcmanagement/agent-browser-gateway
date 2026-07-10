#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
OUTPUT_DIR="${CWS_OUTPUT_DIR:-"$ROOT_DIR/.cws"}"
EXPECTED_VERSION="${EXTENSION_VERSION:-}"

mkdir -p "$OUTPUT_DIR"

cd "$ROOT_DIR/extension"

package_version="$(node -p "require('./package.json').version")"
manifest_version="$(node -p "require('./public/manifest.json').version")"
runtime_version="$(
  node -e "const fs = require('fs'); const m = fs.readFileSync('src/background.ts', 'utf8').match(/const VERSION = \"([^\"]+)\"/); if (!m) process.exit(1); process.stdout.write(m[1]);"
)"

if [[ "$package_version" != "$manifest_version" || "$package_version" != "$runtime_version" ]]; then
  echo "Extension version mismatch: package=$package_version, manifest=$manifest_version, runtime=$runtime_version" >&2
  exit 1
fi

if [[ -n "$EXPECTED_VERSION" && "$EXPECTED_VERSION" != "$package_version" ]]; then
  echo "Expected extension version $EXPECTED_VERSION, but package.json has $package_version" >&2
  exit 1
fi

pnpm test
pnpm typecheck
pnpm lint
pnpm run webstore:zip

cd "$ROOT_DIR"

zip_path="dist/agent-browser-gateway-extension-$package_version.zip"
test -s "$zip_path"

unzip -Z1 "$zip_path" | tee "$OUTPUT_DIR/extension-zip-entries.txt"
grep -qx "manifest.json" "$OUTPUT_DIR/extension-zip-entries.txt"

if grep -q "^dist/" "$OUTPUT_DIR/extension-zip-entries.txt"; then
  echo "Extension ZIP must not contain a top-level dist/ directory." >&2
  exit 1
fi

zipped_version="$(
  unzip -p "$zip_path" manifest.json | node -e "let s=''; process.stdin.on('data', d => s += d); process.stdin.on('end', () => { const m = JSON.parse(s); process.stdout.write(m.version || ''); });"
)"

if [[ "$zipped_version" != "$package_version" ]]; then
  echo "Zipped manifest version mismatch: zip=$zipped_version, package=$package_version" >&2
  exit 1
fi

shasum -a 256 "$zip_path" | tee "$OUTPUT_DIR/agent-browser-gateway-extension-$package_version.zip.sha256"
printf '%s' "$package_version" > "$OUTPUT_DIR/extension-version.txt"

if [[ -n "${GITHUB_OUTPUT:-}" ]]; then
  {
    echo "version=$package_version"
    echo "zip_path=$zip_path"
  } >>"$GITHUB_OUTPUT"
fi
