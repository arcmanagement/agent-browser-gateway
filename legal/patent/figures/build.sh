#!/usr/bin/env bash
set -euo pipefail

if command -v mmdc >/dev/null 2>&1; then
  renderer=(mmdc)
elif command -v npx >/dev/null 2>&1; then
  renderer=(npx --yes -p @mermaid-js/mermaid-cli mmdc)
else
  echo "Mermaid CLI not found. Install it with: npm install -g @mermaid-js/mermaid-cli" >&2
  exit 127
fi

for src in fig-*.mmd; do
  out="${src%.mmd}.svg"
  echo "render $src -> $out" >&2
  "${renderer[@]}" -i "$src" -o "$out" --backgroundColor white
done
