#!/usr/bin/env bash
set -euo pipefail

VERSION="${VERSION:-}"
TAG="${TAG:-}"
NOTES_PATH="${NOTES_PATH:-dist/RELEASE_NOTES.md}"
GITHUB_RELEASE_DRAFT="${GITHUB_RELEASE_DRAFT:-true}"

if [ -z "$VERSION" ]; then
  echo "VERSION is required." >&2
  exit 1
fi

if [ -z "$TAG" ]; then
  TAG="v$VERSION"
fi

if [ ! -f "$NOTES_PATH" ]; then
  echo "Release notes not found: $NOTES_PATH" >&2
  exit 1
fi

assets=(
  "dist/agent-browser-gateway-$VERSION-macos-arm64.zip"
  "dist/agent-browser-gateway-extension-$VERSION.zip"
  "dist/agent-browser-gateway.rb"
  "dist/agent-browser-gateway-$VERSION.spdx.json"
  "dist/agent-browser-gateway-$VERSION.cyclonedx.json"
  "dist/SHA256SUMS.txt"
)

for asset in "${assets[@]}"; do
  if [ ! -f "$asset" ]; then
    echo "Release asset not found: $asset" >&2
    exit 1
  fi
done

if gh release view "$TAG" >/dev/null 2>&1; then
  gh release edit "$TAG" \
    --title "$TAG" \
    --notes-file "$NOTES_PATH"
else
  create_args=()
  if [ "$GITHUB_RELEASE_DRAFT" = "true" ]; then
    create_args+=(--draft)
  fi
  gh release create "$TAG" \
    "${create_args[@]}" \
    --title "$TAG" \
    --notes-file "$NOTES_PATH"
fi

gh release upload "$TAG" "${assets[@]}" --clobber

echo "GitHub Release assets uploaded: $TAG"
