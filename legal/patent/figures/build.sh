#!/usr/bin/env bash
set -euo pipefail

if ! command -v mmdc >/dev/null 2>&1; then
  echo "mmdc not found. Install Mermaid CLI, for example: npm install -g @mermaid-js/mermaid-cli" >&2
  exit 127
fi

for src in fig-*.mmd; do
  out="${src%.mmd}.svg"
  echo "render $src -> $out" >&2
  mmdc -i "$src" -o "$out" --backgroundColor white
done
