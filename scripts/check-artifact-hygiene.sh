#!/bin/bash
# Scan staged release artifacts for developer-local build paths before publication.
# Usage: scripts/check-artifact-hygiene.sh <artifact-or-directory> [...]
# Accepts .zip and .dmg artifacts and already-staged directories. Exits non-zero
# when any scanned file contains a denylisted pattern, printing every finding.
set -euo pipefail

if [ "$#" -eq 0 ]; then
    echo "Usage: $0 <artifact-or-directory> [...]" >&2
    exit 2
fi

# Developer-local traces that must never ship:
# - absolute home paths (a concrete /Users/<account>/ prefix)
# - SwiftPM build-directory strings under any absolute root
# - SwiftPM-generated resource-bundle accessor paths
# Relative `.build/checkouts/...` strings are accepted: they are what the
# release prefix-map flags (PR #307) turn dependency source paths into.
DENY_PATTERN='/Users/[A-Za-z0-9_.-]+/|/(home|var|private|tmp|opt|Volumes)/[A-Za-z0-9_./-]*\.build/|Bundle\.module'

# Generic account-lookup expressions used by the installer UI are allowed: they
# compute the current user's home at runtime instead of naming a maintainer.
ALLOW_PATTERN='/Users/\$|/Users/" ?[&+]|/Users/Shared/'

WORK_DIR="$(mktemp -d /tmp/abg-hygiene.XXXXXX)"
MOUNTS=()
cleanup() {
    for m in ${MOUNTS+"${MOUNTS[@]}"}; do
        hdiutil detach "$m" -quiet || true
    done
    rm -rf "$WORK_DIR"
}
trap cleanup EXIT

scan_root() {
    local label="$1" root="$2" findings
    findings="$(grep -a -r -o -E "$DENY_PATTERN" "$root" 2>/dev/null | grep -v -E "$ALLOW_PATTERN" | sort -u | head -50 || true)"
    if [ -n "$findings" ]; then
        echo "HYGIENE FAIL: $label contains developer-local traces:" >&2
        printf '%s\n' "$findings" | sed "s|$root|.|" >&2
        return 1
    fi
    echo "ok: $label"
}

status=0
index=0
for artifact in "$@"; do
    index=$((index + 1))
    if [ -d "$artifact" ]; then
        scan_root "$artifact" "$artifact" || status=1
    elif [[ "$artifact" == *.zip ]]; then
        extract="$WORK_DIR/zip-$index"
        mkdir -p "$extract"
        /usr/bin/ditto -x -k "$artifact" "$extract"
        scan_root "$artifact" "$extract" || status=1
    elif [[ "$artifact" == *.dmg ]]; then
        mount="$WORK_DIR/dmg-$index"
        mkdir -p "$mount"
        hdiutil attach "$artifact" -nobrowse -readonly -mountpoint "$mount" -quiet
        MOUNTS+=("$mount")
        scan_root "$artifact" "$mount" || status=1
    else
        echo "HYGIENE FAIL: unsupported artifact type: $artifact" >&2
        status=1
    fi
done

if [ "$status" -ne 0 ]; then
    echo "Artifact hygiene check failed. Rebuild with prefix-map flags (see PR #307) before publishing." >&2
fi
exit "$status"
