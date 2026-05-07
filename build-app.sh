#!/bin/bash
# Build Agent Browser Gateway.app (.app bundle) from the swift build output.
# Also leaves the abg CLI binary at .build/<config>/abg.
set -euo pipefail

CONFIG="${CONFIG:-release}"
VERSION="${VERSION:-0.3.5}"
APP_NAME="Agent Browser Gateway"
APP="$APP_NAME.app"
LEGACY_APP="Gateway.app"
BIN_DIR=".build/$CONFIG"
APP_ICON_NAME="AppIcon"
APP_ICON_FILE="$APP_ICON_NAME.icns"
ICON_SOURCE_SVG="extension/store-assets/icon-source.svg"
ICON_SOURCE_PNG="extension/public/icons/128.png"
ICONSET_DIR="$BIN_DIR/$APP_ICON_NAME.iconset"

render_icon_png() {
    local size="$1"
    local output="$2"

    if [ -f "$ICON_SOURCE_SVG" ] && command -v rsvg-convert >/dev/null 2>&1; then
        rsvg-convert -w "$size" -h "$size" "$ICON_SOURCE_SVG" -o "$output"
    elif [ -f "$ICON_SOURCE_PNG" ]; then
        sips -z "$size" "$size" "$ICON_SOURCE_PNG" --out "$output" >/dev/null
    else
        return 1
    fi
}

echo "==> swift build -c $CONFIG"
swift build -c "$CONFIG"

echo "==> assembling $APP"
rm -rf "$APP"
if [ "$LEGACY_APP" != "$APP" ]; then
    rm -rf "$LEGACY_APP"
fi
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/Gateway" "$APP/Contents/MacOS/Gateway"

echo "==> bundling app icon"
if [ -f "$ICON_SOURCE_SVG" ] || [ -f "$ICON_SOURCE_PNG" ]; then
    rm -rf "$ICONSET_DIR"
    mkdir -p "$ICONSET_DIR" "$APP/Contents/Resources"
    render_icon_png 16 "$ICONSET_DIR/icon_16x16.png"
    render_icon_png 32 "$ICONSET_DIR/icon_16x16@2x.png"
    render_icon_png 32 "$ICONSET_DIR/icon_32x32.png"
    render_icon_png 64 "$ICONSET_DIR/icon_32x32@2x.png"
    render_icon_png 128 "$ICONSET_DIR/icon_128x128.png"
    render_icon_png 256 "$ICONSET_DIR/icon_128x128@2x.png"
    render_icon_png 256 "$ICONSET_DIR/icon_256x256.png"
    render_icon_png 512 "$ICONSET_DIR/icon_256x256@2x.png"
    render_icon_png 512 "$ICONSET_DIR/icon_512x512.png"
    render_icon_png 1024 "$ICONSET_DIR/icon_512x512@2x.png"
    iconutil -c icns "$ICONSET_DIR" -o "$APP/Contents/Resources/$APP_ICON_FILE"
else
    echo "warning: app icon source not found; expected $ICON_SOURCE_SVG or $ICON_SOURCE_PNG" >&2
fi

if [ -d "plugins" ]; then
    mkdir -p "$APP/Contents/Resources"
    cp -R plugins "$APP/Contents/Resources/plugins"
fi

cat > "$APP/Contents/Info.plist" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>$APP_NAME</string>
    <key>CFBundleDisplayName</key><string>$APP_NAME</string>
    <key>CFBundleIdentifier</key><string>co.arcm.AgentBrowserGateway</string>
    <key>CFBundleExecutable</key><string>Gateway</string>
    <key>CFBundleIconFile</key><string>$APP_ICON_NAME</string>
    <key>CFBundleVersion</key><string>$VERSION</string>
    <key>CFBundleShortVersionString</key><string>$VERSION</string>
    <key>CFBundlePackageType</key><string>APPL</string>
    <key>LSUIElement</key><true/>
    <key>LSMinimumSystemVersion</key><string>14.0</string>
    <key>NSPrincipalClass</key><string>NSApplication</string>
    <key>NSHighResolutionCapable</key><true/>
</dict>
</plist>
EOF

echo "==> done"
echo "    app:  $(pwd)/$APP"
echo "    cli:  $(pwd)/$BIN_DIR/abg"
echo ""
echo "next:"
printf '  open "%s"                           # launch menubar app\n' "$APP"
echo "  ln -sf $(pwd)/$BIN_DIR/abg /usr/local/bin/abg # symlink CLI to PATH"
