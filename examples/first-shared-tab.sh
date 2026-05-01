#!/usr/bin/env bash
# Read the DOM of the first shared tab as Markdown.
# Useful when an agent needs a compact view of the page for summarisation.

set -euo pipefail

if ! command -v jq >/dev/null 2>&1; then
  echo "jq is required" >&2
  exit 1
fi

TAB_ID=$(abg tabs | jq -r '.[0].tabId // empty')
if [ -z "$TAB_ID" ]; then
  echo "no shared tabs. ask the user to click the extension icon and share a tab." >&2
  exit 1
fi

echo "Reading tab $TAB_ID as markdown..." >&2
abg read "$TAB_ID" --as-markdown
