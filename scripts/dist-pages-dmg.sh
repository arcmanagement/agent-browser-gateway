#!/bin/bash
# Build a signed/notarized DMG for temporary GitHub Pages distribution.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-}"
if [ -z "$VERSION" ]; then
    echo "VERSION is required, e.g. VERSION=0.3.4 $0" >&2
    exit 1
fi

APP_NAME="Agent Browser Gateway"
APP_BUNDLE="$APP_NAME.app"
DIST_DIR="$ROOT/dist"
STAGING_DIR="$DIST_DIR/agent-browser-gateway-$VERSION-macos-arm64"
DMG_ROOT="$DIST_DIR/agent-browser-gateway-$VERSION-dmg-root"
INSTALLER_APP="Install Agent Browser Gateway.app"
INSTALLER_SCRIPT="$DIST_DIR/install-agent-browser-gateway.applescript"
INSTALLER_RESOURCES="$DMG_ROOT/$INSTALLER_APP/Contents/Resources"
DMG_NAME="agent-browser-gateway-$VERSION-macos-arm64.dmg"
DMG_PATH="$DIST_DIR/$DMG_NAME"
VOLUME_NAME="Agent Browser Gateway $VERSION"
PAGES_OUTPUT_DIR="${PAGES_OUTPUT_DIR:-}"
SIGN_IDENTITY="${SIGN_IDENTITY:-}"
NOTARY_PROFILE="${NOTARY_PROFILE:-}"

if [ ! -d "$STAGING_DIR" ]; then
    echo "Missing staged release payload: $STAGING_DIR" >&2
    echo "Run make dist VERSION=$VERSION first." >&2
    exit 1
fi

if [ ! -d "$STAGING_DIR/$APP_BUNDLE" ]; then
    echo "Missing app bundle: $STAGING_DIR/$APP_BUNDLE" >&2
    exit 1
fi

if [ ! -x "$STAGING_DIR/abg" ]; then
    echo "Missing CLI binary: $STAGING_DIR/abg" >&2
    exit 1
fi

if [ ! -d "$STAGING_DIR/AgentBrowserGateway_abg.bundle" ]; then
    echo "Missing CLI resource bundle: $STAGING_DIR/AgentBrowserGateway_abg.bundle" >&2
    exit 1
fi

echo "==> stage DMG root"
rm -rf "$DMG_ROOT"
mkdir -p "$DMG_ROOT"

cat > "$INSTALLER_SCRIPT" <<'APPLESCRIPT'
set installerApp to POSIX path of (path to me)
set resourcesPath to installerApp & "Contents/Resources/"
set scriptPath to resourcesPath & "install-agent-browser-gateway.sh"

try
    set installResult to do shell script quoted form of scriptPath with administrator privileges
    display dialog installResult buttons {"OK"} default button "OK" with title "Agent Browser Gateway"
on error errorMessage number errorNumber
    display dialog errorMessage buttons {"OK"} default button "OK" with title "Agent Browser Gateway" with icon stop
end try
APPLESCRIPT

/usr/bin/osacompile -o "$DMG_ROOT/$INSTALLER_APP" "$INSTALLER_SCRIPT"

mkdir -p "$INSTALLER_RESOURCES/payload/Command Line Tools"
/usr/bin/ditto "$STAGING_DIR/$APP_BUNDLE" "$INSTALLER_RESOURCES/payload/$APP_BUNDLE"
/usr/bin/install -m 755 "$STAGING_DIR/abg" "$INSTALLER_RESOURCES/payload/Command Line Tools/abg"
/usr/bin/ditto "$STAGING_DIR/AgentBrowserGateway_abg.bundle" \
    "$INSTALLER_RESOURCES/payload/Command Line Tools/AgentBrowserGateway_abg.bundle"

if [ -f "$STAGING_DIR/$APP_BUNDLE/Contents/Resources/AppIcon.icns" ]; then
    cp "$STAGING_DIR/$APP_BUNDLE/Contents/Resources/AppIcon.icns" \
        "$INSTALLER_RESOURCES/applet.icns"
fi

cat > "$INSTALLER_RESOURCES/install-agent-browser-gateway.sh" <<'INSTALL_COMMAND'
#!/bin/bash
set -euo pipefail

APP_NAME="Agent Browser Gateway.app"
APP_ID="jp.co.arcm.AgentBrowserGateway"
SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PAYLOAD_DIR="$SCRIPT_DIR/payload"
TOOLS_DIR="$PAYLOAD_DIR/Command Line Tools"
APP_SRC="$PAYLOAD_DIR/$APP_NAME"
CLI_SRC="$TOOLS_DIR/abg"
BUNDLE_SRC="$TOOLS_DIR/AgentBrowserGateway_abg.bundle"
APP_DST="/Applications/$APP_NAME"
BIN_DIR="/usr/local/bin"
BUNDLE_DST="$BIN_DIR/AgentBrowserGateway_abg.bundle"

if [ ! -d "$APP_SRC" ]; then
    echo "App bundle not found: $APP_SRC" >&2
    exit 1
fi

if [ ! -x "$CLI_SRC" ]; then
    echo "CLI binary not found: $CLI_SRC" >&2
    exit 1
fi

if [ ! -d "$BUNDLE_SRC" ]; then
    echo "CLI resource bundle not found: $BUNDLE_SRC" >&2
    exit 1
fi

echo "Installing Agent Browser Gateway..."
/usr/bin/osascript -e "quit app id \"$APP_ID\"" >/dev/null 2>&1 || true
/usr/bin/pkill -x Gateway >/dev/null 2>&1 || true
/bin/rm -rf "$APP_DST"
/usr/bin/ditto "$APP_SRC" "$APP_DST"

/bin/mkdir -p "$BIN_DIR"
/usr/bin/install -m 755 "$CLI_SRC" "$BIN_DIR/abg"

/bin/rm -rf "$BUNDLE_DST"
/usr/bin/ditto "$BUNDLE_SRC" "$BUNDLE_DST"

CONSOLE_USER="$(/usr/bin/stat -f %Su /dev/console || true)"
if [ -n "$CONSOLE_USER" ] && [ "$CONSOLE_USER" != "root" ] && /usr/bin/id "$CONSOLE_USER" >/dev/null 2>&1; then
    CONSOLE_UID="$(/usr/bin/id -u "$CONSOLE_USER")"
    CONSOLE_HOME="$(/usr/bin/dscl . -read "/Users/$CONSOLE_USER" NFSHomeDirectory 2>/dev/null | /usr/bin/awk '{print $2}')"
    if [ -n "$CONSOLE_HOME" ]; then
        /usr/bin/sudo -u "$CONSOLE_USER" /usr/bin/env HOME="$CONSOLE_HOME" "$BIN_DIR/abg" install-skill
    else
        "$BIN_DIR/abg" install-skill
    fi
    /bin/launchctl asuser "$CONSOLE_UID" /usr/bin/open "$APP_DST" >/dev/null 2>&1 || /usr/bin/open "$APP_DST"
else
    "$BIN_DIR/abg" install-skill
    /usr/bin/open "$APP_DST"
fi

echo "Installed successfully."
echo "App: $APP_DST"
echo "CLI: $BIN_DIR/abg"
INSTALL_COMMAND
/bin/chmod 755 "$INSTALLER_RESOURCES/install-agent-browser-gateway.sh"

if [ -n "$SIGN_IDENTITY" ]; then
    echo "==> sign installer app"
    /usr/bin/codesign --force --deep --options runtime --timestamp \
        --sign "$SIGN_IDENTITY" \
        "$DMG_ROOT/$INSTALLER_APP"
    /usr/bin/codesign --verify --strict --verbose=2 "$DMG_ROOT/$INSTALLER_APP"
else
    echo "==> skip installer app signing (set SIGN_IDENTITY to enable Developer ID signing)"
fi

cat > "$DMG_ROOT/README.txt" <<EOF
Agent Browser Gateway $VERSION

Double-click "Install Agent Browser Gateway.app" to install:

- /Applications/Agent Browser Gateway.app
- /usr/local/bin/abg
- /usr/local/bin/AgentBrowserGateway_abg.bundle
- Claude Code and Codex skills via "abg install-skill"

The installer starts the menu bar app after installation.
EOF

echo "==> create DMG"
rm -f "$DMG_PATH"
/usr/bin/hdiutil create \
    -volname "$VOLUME_NAME" \
    -srcfolder "$DMG_ROOT" \
    -ov \
    -format UDZO \
    "$DMG_PATH"

if [ -n "$SIGN_IDENTITY" ]; then
    echo "==> sign DMG"
    /usr/bin/codesign --force --timestamp --sign "$SIGN_IDENTITY" "$DMG_PATH"
    /usr/bin/codesign --verify --verbose=2 "$DMG_PATH"
else
    echo "==> skip DMG signing (set SIGN_IDENTITY to enable Developer ID signing)"
fi

if [ -n "$NOTARY_PROFILE" ]; then
    if [ -z "$SIGN_IDENTITY" ]; then
        echo "NOTARY_PROFILE requires SIGN_IDENTITY so the DMG is Developer ID signed." >&2
        exit 1
    fi

    echo "==> submit DMG notarization"
    /usr/bin/xcrun notarytool submit "$DMG_PATH" \
        --keychain-profile "$NOTARY_PROFILE" \
        --wait

    echo "==> staple DMG notarization ticket"
    /usr/bin/xcrun stapler staple "$DMG_PATH"
    /usr/sbin/spctl --assess --type open --context context:primary-signature --verbose "$DMG_PATH"
else
    echo "==> skip DMG notarization (set NOTARY_PROFILE to enable notarytool submit)"
fi

SHA256="$(/usr/bin/shasum -a 256 "$DMG_PATH" | /usr/bin/awk '{print $1}')"

if [ -n "$PAGES_OUTPUT_DIR" ]; then
    echo "==> copy DMG to Pages output"
    mkdir -p "$PAGES_OUTPUT_DIR"
    cp "$DMG_PATH" "$PAGES_OUTPUT_DIR/$DMG_NAME"
    printf "%s  %s\n" "$SHA256" "$DMG_NAME" > "$PAGES_OUTPUT_DIR/$DMG_NAME.sha256.txt"
fi

echo "==> done"
echo "dmg:    $DMG_PATH"
echo "sha256: $SHA256"
