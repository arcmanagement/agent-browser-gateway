#!/bin/bash
# Update Casks/agent-browser-gateway.rb from a released macOS zip.
set -euo pipefail

VERSION="${1:-}"
if [ -z "$VERSION" ]; then
    echo "usage: $0 <version-without-v>" >&2
    exit 2
fi

VERSION="${VERSION#v}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CASK_PATH="${CASK_PATH:-$ROOT/Casks/agent-browser-gateway.rb}"
GITHUB_RELEASE_BASE_URL="${GITHUB_RELEASE_BASE_URL:-https://github.com/arcmanagement/agent-browser-gateway/releases/download}"
ASSET_NAME="agent-browser-gateway-$VERSION-macos-arm64.zip"
ASSET_URL="$GITHUB_RELEASE_BASE_URL/v$VERSION/$ASSET_NAME"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT

if [ ! -f "$CASK_PATH" ]; then
    echo "missing cask: $CASK_PATH" >&2
    exit 1
fi

if [ -n "${ABG_CASK_ASSET_PATH:-}" ]; then
    ASSET_PATH="$ABG_CASK_ASSET_PATH"
    if [ ! -f "$ASSET_PATH" ]; then
        echo "ABG_CASK_ASSET_PATH does not exist: $ASSET_PATH" >&2
        exit 1
    fi
else
    ASSET_PATH="$TMP_DIR/$ASSET_NAME"
    curl -fsSL "$ASSET_URL" -o "$ASSET_PATH"
fi

SHA256="$(shasum -a 256 "$ASSET_PATH" | awk '{print $1}')"

ruby - "$CASK_PATH" "$VERSION" "$SHA256" <<'RUBY'
path, version, sha256 = ARGV
text = File.read(path)
text = text.sub(/version "[^"]+"/, %(version "#{version}"))
text = text.sub(/sha256 "[0-9a-f]{64}"/, %(sha256 "#{sha256}"))
File.write(path, text)
RUBY

echo "updated: $CASK_PATH"
echo "version: $VERSION"
echo "sha256: $SHA256"
echo "asset:   ${ABG_CASK_ASSET_PATH:-$ASSET_URL}"
