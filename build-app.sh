#!/bin/bash
# Build Gateway.app (.app bundle) from the swift build output.
# Also leaves the abg CLI binary at .build/<config>/abg.
set -euo pipefail

CONFIG="${CONFIG:-release}"
APP="Gateway.app"
BIN_DIR=".build/$CONFIG"

echo "==> swift build -c $CONFIG"
swift build -c "$CONFIG"

echo "==> assembling $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS"
cp "$BIN_DIR/Gateway" "$APP/Contents/MacOS/Gateway"

cat > "$APP/Contents/Info.plist" <<'EOF'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>CFBundleName</key><string>Gateway</string>
    <key>CFBundleDisplayName</key><string>Agent Browser Gateway</string>
    <key>CFBundleIdentifier</key><string>co.arcm.AgentBrowserGateway</string>
    <key>CFBundleExecutable</key><string>Gateway</string>
    <key>CFBundleVersion</key><string>0.1.0</string>
    <key>CFBundleShortVersionString</key><string>0.1.0</string>
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
echo "  open $APP                                    # launch menubar app"
echo "  ln -sf $(pwd)/$BIN_DIR/abg /usr/local/bin/abg # symlink CLI to PATH"
