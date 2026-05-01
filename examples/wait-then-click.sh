#!/usr/bin/env bash
# Wait for an element to appear, then click it. Reliable replacement for naive sleep+click.
# Usage: ./wait-then-click.sh <tabId> "<css-selector>"

set -euo pipefail

TAB_ID="${1:?tabId required}"
SEL="${2:?selector required}"

echo "Waiting for $SEL on tab $TAB_ID..." >&2
abg wait "$TAB_ID" --selector "$SEL" --timeout 15000

echo "Clicking $SEL..." >&2
abg click "$TAB_ID" --selector "$SEL"
