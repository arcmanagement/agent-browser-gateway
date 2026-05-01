#!/usr/bin/env bash
# Capture only a region of a tab. Saves a lot of agent context vs full-page screenshots.
# Usage: ./screenshot-region.sh <tabId> <x> <y> <width> <height>

set -euo pipefail

TAB_ID="${1:?tabId required}"
X="${2:?x required}"
Y="${3:?y required}"
W="${4:?width required}"
H="${5:?height required}"

OUT="/tmp/abg-region-$TAB_ID-$(date +%s).png"
abg screenshot "$TAB_ID" --x "$X" --y "$Y" --width "$W" --height "$H" --out "$OUT"
echo "saved: $OUT"
