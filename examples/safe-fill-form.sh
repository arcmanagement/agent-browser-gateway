#!/usr/bin/env bash
# Fill a form field, then verify by re-reading. The "verify" step is what makes this safe.
# Usage: ./safe-fill-form.sh <tabId> "<css-selector>" "<value>"

set -euo pipefail

TAB_ID="${1:?tabId required}"
SEL="${2:?selector required}"
VAL="${3:?value required}"

# 1. Read what's currently in the field (compact)
BEFORE=$(abg read "$TAB_ID" --selector "$SEL" 2>/dev/null | jq -r '.text // .html // empty' | head -c 200)
echo "before: $BEFORE" >&2

# 2. Fill
abg fill "$TAB_ID" --selector "$SEL" --value "$VAL" >/dev/null

# 3. Wait briefly for any reactive UI to settle
abg wait "$TAB_ID" --ms 250 >/dev/null

# 4. Re-read and check the value reflects the change
AFTER=$(abg read "$TAB_ID" --selector "$SEL" 2>/dev/null | jq -r '.text // .html // empty' | head -c 200)
echo "after: $AFTER" >&2

if echo "$AFTER" | grep -qF "$VAL"; then
  echo "ok: $VAL is reflected" >&2
else
  echo "warn: value not reflected; the field may use a richer editor or be controlled externally" >&2
  exit 2
fi
