#!/usr/bin/env bash
set -euo pipefail

# Rewrites a GitHub Release's checksum files and Homebrew cask from the assets
# the release actually serves. CI builds adhoc-signed macOS archives, but a
# maintainer-signed upload is kept when it exists (see
# upload-github-release-assets.sh), so checksums computed from CI's own build
# would not match what users download.
#
# Usage: VERSION=0.5.0 [TAG=v0.5.0] [DRY_RUN=true] reconcile-release-checksums.sh

VERSION="${VERSION:-}"
TAG="${TAG:-}"
DRY_RUN="${DRY_RUN:-false}"
# Resolve the repository before leaving the checkout: gh cannot infer it from
# the temporary download directory.
REPO="${GITHUB_REPOSITORY:-$(gh repo view --json nameWithOwner --jq .nameWithOwner)}"
REPO_ARGS=(-R "$REPO")

if [ -z "$VERSION" ]; then
  echo "VERSION is required." >&2
  exit 1
fi
if [ -z "$TAG" ]; then
  TAG="v$VERSION"
fi

app_zip="agent-browser-gateway-$VERSION-macos-arm64.zip"
dmg="agent-browser-gateway-$VERSION-macos-arm64.dmg"
extension_zip="agent-browser-gateway-extension-$VERSION.zip"
cask="agent-browser-gateway.rb"
sums="SHA256SUMS.txt"
# Order matches the checksum file CI has always written; the DMG is appended
# because only maintainer uploads carry it.
summed=(
  "$app_zip"
  "$extension_zip"
  "$cask"
  "agent-browser-gateway-$VERSION.spdx.json"
  "agent-browser-gateway-$VERSION.cyclonedx.json"
  "$dmg"
)
per_file=("$app_zip" "$dmg" "$extension_zip")

work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

published="$(gh release view "$TAG" "${REPO_ARGS[@]}" --json assets --jq '.assets[].name')"
has_asset() { printf '%s\n' "$published" | grep -Fxq "$1"; }

if ! has_asset "$app_zip"; then
  echo "Release $TAG has no $app_zip; nothing to reconcile." >&2
  exit 1
fi

download=()
for name in "${summed[@]}"; do
  if has_asset "$name"; then
    download+=(--pattern "$name")
  fi
done
gh release download "$TAG" "${REPO_ARGS[@]}" --dir "$work" "${download[@]}"

cd "$work"
zip_sha="$(shasum -a 256 "$app_zip" | awk '{print $1}')"

to_upload=()

if [ -f "$cask" ]; then
  if ! grep -Eq '^  sha256 "[0-9a-f]{64}"$' "$cask"; then
    echo "$cask has no single sha256 line to rewrite." >&2
    exit 1
  fi
  sed -E -i.bak "s/^  sha256 \"[0-9a-f]{64}\"$/  sha256 \"$zip_sha\"/" "$cask"
  rm -f "$cask.bak"
  to_upload+=("$cask")
fi

: > "$sums"
for name in "${summed[@]}"; do
  if [ -f "$name" ]; then
    shasum -a 256 "$name" >> "$sums"
  fi
done
to_upload+=("$sums")

for name in "${per_file[@]}"; do
  if [ -f "$name" ]; then
    shasum -a 256 "$name" > "$name.sha256.txt"
    to_upload+=("$name.sha256.txt")
  fi
done

shasum -a 256 -c "$sums"
echo "Cask sha256 for $app_zip: $zip_sha"

if [ "$DRY_RUN" = "true" ]; then
  echo "DRY_RUN: would replace on $TAG: ${to_upload[*]}"
  cat "$sums"
  exit 0
fi

gh release upload "$TAG" "${REPO_ARGS[@]}" "${to_upload[@]}" --clobber
echo "Reconciled checksum files on $TAG: ${to_upload[*]}"
