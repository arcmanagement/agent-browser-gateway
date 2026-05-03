#!/bin/bash
# Build Agent Browser Gateway.app (.app bundle) from the swift build output.
# Also leaves the abg CLI binary at .build/<config>/abg.
set -euo pipefail

CONFIG="${CONFIG:-release}"
VERSION="${VERSION:-0.3.4}"
APP_NAME="Agent Browser Gateway"
APP="$APP_NAME.app"
LEGACY_APP="Gateway.app"
BIN_DIR=".build/$CONFIG"

echo "==> swift build -c $CONFIG"
swift build -c "$CONFIG"

echo "==> assembling $APP"
rm -rf "$APP"
if [ "$LEGACY_APP" != "$APP" ]; then
    rm -rf "$LEGACY_APP"
fi
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/Gateway" "$APP/Contents/MacOS/Gateway"

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
