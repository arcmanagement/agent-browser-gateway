#!/usr/bin/env bash
set -euo pipefail

# Publishes CI-built release assets, without ever replacing assets a maintainer
# already uploaded. CI has no signing keys by design, so its macOS artifacts are
# adhoc-signed; clobbering a Developer ID signed, notarized upload would leave an
# unsigned app on the release (see issue #412). Existing assets are therefore
# kept and reported, not overwritten.

VERSION="${VERSION:-}"
TAG="${TAG:-}"
NOTES_PATH="${NOTES_PATH:-dist/RELEASE_NOTES.md}"
GITHUB_RELEASE_DRAFT="${GITHUB_RELEASE_DRAFT:-true}"
# Escape hatch for a deliberate re-upload of the same names. Never set this in
# the tag-triggered workflow.
ALLOW_ASSET_OVERWRITE="${ALLOW_ASSET_OVERWRITE:-false}"

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

release_exists=false
if gh release view "$TAG" >/dev/null 2>&1; then
  release_exists=true
fi

if [ "$release_exists" = true ]; then
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

existing=""
if [ "$release_exists" = true ]; then
  existing="$(gh release view "$TAG" --json assets --jq '.assets[].name' 2>/dev/null || true)"
fi

to_upload=()
skipped=()
for asset in "${assets[@]}"; do
  name="$(basename "$asset")"
  if [ "$ALLOW_ASSET_OVERWRITE" != "true" ] && printf '%s\n' "$existing" | grep -Fxq "$name"; then
    skipped+=("$name")
    continue
  fi
  to_upload+=("$asset")
done

if [ "${#skipped[@]:-0}" -gt 0 ] && [ -n "${skipped+set}" ]; then
  echo "Keeping ${#skipped[@]} existing release asset(s); CI will not replace them:" >&2
  printf '  %s\n' "${skipped[@]}" >&2
  echo "A maintainer-signed upload stays authoritative. Set ALLOW_ASSET_OVERWRITE=true only for a deliberate re-upload." >&2
fi

if [ "${#to_upload[@]}" -eq 0 ]; then
  echo "GitHub Release already carries every asset: $TAG"
  exit 0
fi

if [ "$ALLOW_ASSET_OVERWRITE" = "true" ]; then
  gh release upload "$TAG" "${to_upload[@]}" --clobber
else
  gh release upload "$TAG" "${to_upload[@]}"
fi

echo "GitHub Release assets uploaded (${#to_upload[@]} new): $TAG"
