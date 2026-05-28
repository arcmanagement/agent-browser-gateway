#!/bin/bash
# Build macOS arm64 release artifacts for Homebrew Cask distribution.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-}"
if [ -z "$VERSION" ]; then
    echo "VERSION is required, e.g. VERSION=0.3.1 $0" >&2
    exit 1
fi

if [ "$(uname -m)" != "arm64" ]; then
    echo "This release script only builds the macOS arm64 artifact." >&2
    echo "Run it on Apple Silicon, or set up a dedicated arm64 CI runner." >&2
    exit 1
fi

APP_NAME="Agent Browser Gateway"
APP_BUNDLE="$APP_NAME.app"
CLI_BINARY=".build/release/abg"
CLI_RESOURCE_BUNDLE=".build/release/AgentBrowserGateway_abg.bundle"
DIST_DIR="$ROOT/dist"
STAGING_DIR="$DIST_DIR/agent-browser-gateway-$VERSION-macos-arm64"
ZIP_NAME="agent-browser-gateway-$VERSION-macos-arm64.zip"
ZIP_PATH="$DIST_DIR/$ZIP_NAME"
EXTENSION_ZIP_NAME="agent-browser-gateway-extension-$VERSION.zip"
EXTENSION_ZIP_PATH="$DIST_DIR/$EXTENSION_ZIP_NAME"
CASK_OUTPUT="${CASK_OUTPUT:-$DIST_DIR/agent-browser-gateway.rb}"
GITHUB_REPOSITORY="${GITHUB_REPOSITORY:-arcmanagement/agent-browser-gateway}"
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

create_app_zip() {
    rm -f "$ZIP_PATH"
    (
        cd "$STAGING_DIR"
        /usr/bin/zip -qry "$ZIP_PATH" "$APP_BUNDLE" abg AgentBrowserGateway_abg.bundle
    )
}

echo "==> build app and CLI"
VERSION="$VERSION" CONFIG=release ./build-app.sh

echo "==> build Chrome extension"
(
    cd extension
    pnpm run build
)

echo "==> stage release payload"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
cp -R "$APP_BUNDLE" "$STAGING_DIR/"
cp "$CLI_BINARY" "$STAGING_DIR/abg"
if [ ! -d "$CLI_RESOURCE_BUNDLE" ]; then
    echo "Missing CLI resource bundle: $CLI_RESOURCE_BUNDLE" >&2
    exit 1
fi
cp -R "$CLI_RESOURCE_BUNDLE" "$STAGING_DIR/AgentBrowserGateway_abg.bundle"

if [ -n "$SIGN_IDENTITY" ]; then
    echo "==> sign app and CLI"
    codesign --force --options runtime --timestamp \
        --sign "$SIGN_IDENTITY" \
        "$STAGING_DIR/$APP_BUNDLE/Contents/MacOS/Gateway"
    codesign --force --options runtime --timestamp \
        --sign "$SIGN_IDENTITY" \
        "$STAGING_DIR/$APP_BUNDLE"
    codesign --force --options runtime --timestamp \
        --sign "$SIGN_IDENTITY" \
        "$STAGING_DIR/abg"

    codesign --verify --strict --verbose=2 "$STAGING_DIR/$APP_BUNDLE"
    codesign --verify --strict --verbose=2 "$STAGING_DIR/abg"
else
    echo "==> skip signing (set SIGN_IDENTITY to enable Developer ID signing)"
fi

echo "==> create Homebrew payload zip"
mkdir -p "$DIST_DIR"
create_app_zip

if [ -n "$NOTARY_PROFILE" ]; then
    if [ -z "$SIGN_IDENTITY" ]; then
        echo "NOTARY_PROFILE requires SIGN_IDENTITY so the submitted artifact is Developer ID signed." >&2
        exit 1
    fi

    echo "==> submit notarization"
    xcrun notarytool submit "$ZIP_PATH" \
        --keychain-profile "$NOTARY_PROFILE" \
        --wait

    echo "==> staple app notarization ticket"
    xcrun stapler staple "$STAGING_DIR/$APP_BUNDLE"
    spctl --assess --type execute --verbose "$STAGING_DIR/$APP_BUNDLE"

    echo "==> recreate Homebrew payload zip with stapled app"
    create_app_zip
else
    echo "==> skip notarization (set NOTARY_PROFILE to enable notarytool submit)"
fi

echo "==> create Chrome extension zip"
rm -f "$EXTENSION_ZIP_PATH"
(
    cd extension/dist
    /usr/bin/zip -qry "$EXTENSION_ZIP_PATH" .
)

SHA256="$(shasum -a 256 "$ZIP_PATH" | awk '{print $1}')"

echo "==> write Homebrew cask"
mkdir -p "$(dirname "$CASK_OUTPUT")"
cat > "$CASK_OUTPUT" <<EOF
cask "agent-browser-gateway" do
  version "$VERSION"
  sha256 "$SHA256"

  url "https://github.com/$GITHUB_REPOSITORY/releases/download/v#{version}/agent-browser-gateway-#{version}-macos-arm64.zip"
  name "Agent Browser Gateway"
  desc "Share authorized Chrome tabs with AI coding agents"
  homepage "https://github.com/$GITHUB_REPOSITORY"

  depends_on macos: ">= :sonoma"
  depends_on arch: :arm64

  app "Agent Browser Gateway.app"
  binary "abg"
  artifact "AgentBrowserGateway_abg.bundle", target: "#{HOMEBREW_PREFIX}/bin/AgentBrowserGateway_abg.bundle"

  uninstall quit: "co.arcm.AgentBrowserGateway"

  zap trash: [
    "~/Library/Application Support/AgentBrowserGateway",
    "~/Library/Logs/AgentBrowserGateway",
  ]

  caveats <<~EOS
    Install the Chrome extension separately from the release asset:
      https://github.com/$GITHUB_REPOSITORY/releases/download/v#{version}/agent-browser-gateway-extension-#{version}.zip
  EOS
end
EOF

echo "==> done"
echo "payload:   $ZIP_PATH"
echo "extension: $EXTENSION_ZIP_PATH"
echo "cask:      $CASK_OUTPUT"
echo "sha256:    $SHA256"
