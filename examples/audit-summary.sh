#!/usr/bin/env bash
# Summarise recent agent activity. Useful for "did anything weird happen?" checks.
# Reads the local audit log (no network).

set -euo pipefail

LINES="${1:-100}"
abg audit --lines "$LINES" \
  | jq -r '
      group_by(.action) | map({action: .[0].action, count: length, last_ts: ([.[].ts] | max)}) |
      sort_by(-.count) |
      .[] | "\(.count)\t\(.action)\t(last \(.last_ts))"
    ' \
  | column -t -s $'\t'
