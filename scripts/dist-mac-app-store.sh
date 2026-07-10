#!/bin/bash
# Build a sandboxed macOS app package candidate for Mac App Store validation.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"

VERSION="${VERSION:-}"
if [ -z "$VERSION" ]; then
    echo "VERSION is required, e.g. VERSION=0.4.2 $0" >&2
    exit 1
fi

APP_NAME="Agent Browser Gateway"
APP_BUNDLE="$APP_NAME.app"
APPSTORE_BUNDLE_ID="${APPSTORE_BUNDLE_ID:-jp.co.arcm.AgentBrowserGateway}"
BUILD_NUMBER="${BUILD_NUMBER:-$VERSION}"
ENTITLEMENTS="${APPSTORE_ENTITLEMENTS:-$ROOT/packaging/appstore/AgentBrowserGateway.appstore.entitlements}"
APP_SIGN_IDENTITY="${APPSTORE_APP_SIGN_IDENTITY:-}"
INSTALLER_SIGN_IDENTITY="${APPSTORE_INSTALLER_SIGN_IDENTITY:-}"
PROVISIONING_PROFILE="${APPSTORE_PROVISIONING_PROFILE:-}"
DIST_DIR="$ROOT/dist"
STAGING_DIR="$DIST_DIR/app-store/agent-browser-gateway-$VERSION"
APP_STAGE="$STAGING_DIR/$APP_BUNDLE"
PKG_PATH="$DIST_DIR/agent-browser-gateway-$VERSION-mac-app-store.pkg"
SIGN_ENTITLEMENTS="$ENTITLEMENTS"

if [ ! -f "$ENTITLEMENTS" ]; then
    echo "Missing entitlements file: $ENTITLEMENTS" >&2
    exit 1
fi

echo "==> build app"
VERSION="$VERSION" \
BUILD_NUMBER="$BUILD_NUMBER" \
APP_VARIANT=prod \
APP_BUNDLE_ID="$APPSTORE_BUNDLE_ID" \
CONFIG=release \
./build-app.sh

echo "==> stage App Store app"
rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
/usr/bin/ditto "$APP_BUNDLE" "$APP_STAGE"

if [ -n "$PROVISIONING_PROFILE" ]; then
    if [ ! -f "$PROVISIONING_PROFILE" ]; then
        echo "Provisioning profile not found: $PROVISIONING_PROFILE" >&2
        exit 1
    fi
    echo "==> embed provisioning profile"
    /usr/bin/install -m 644 "$PROVISIONING_PROFILE" "$APP_STAGE/Contents/embedded.provisionprofile"

    if [ -n "$APP_SIGN_IDENTITY" ]; then
        echo "==> prepare App Store signing entitlements"
        PROFILE_PLIST="$STAGING_DIR/provisioning-profile.plist"
        SIGN_ENTITLEMENTS="$STAGING_DIR/appstore-signing.entitlements"
        /usr/bin/security cms -D -i "$PROVISIONING_PROFILE" > "$PROFILE_PLIST"
        /bin/cp "$ENTITLEMENTS" "$SIGN_ENTITLEMENTS"

        app_identifier="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:com.apple.application-identifier" "$PROFILE_PLIST" 2>/dev/null || true)"
        team_identifier="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:com.apple.developer.team-identifier" "$PROFILE_PLIST" 2>/dev/null || true)"

        if [ -n "$app_identifier" ]; then
            /usr/libexec/PlistBuddy -c "Delete :com.apple.application-identifier" "$SIGN_ENTITLEMENTS" >/dev/null 2>&1 || true
            /usr/libexec/PlistBuddy -c "Add :com.apple.application-identifier string $app_identifier" "$SIGN_ENTITLEMENTS"
        fi
        if [ -n "$team_identifier" ]; then
            /usr/libexec/PlistBuddy -c "Delete :com.apple.developer.team-identifier" "$SIGN_ENTITLEMENTS" >/dev/null 2>&1 || true
            /usr/libexec/PlistBuddy -c "Add :com.apple.developer.team-identifier string $team_identifier" "$SIGN_ENTITLEMENTS"
        fi

        if /usr/libexec/PlistBuddy -c "Print :Entitlements:keychain-access-groups" "$PROFILE_PLIST" >/dev/null 2>&1; then
            /usr/libexec/PlistBuddy -c "Delete :keychain-access-groups" "$SIGN_ENTITLEMENTS" >/dev/null 2>&1 || true
            /usr/libexec/PlistBuddy -c "Add :keychain-access-groups array" "$SIGN_ENTITLEMENTS"
            keychain_group_index=0
            while keychain_group="$(/usr/libexec/PlistBuddy -c "Print :Entitlements:keychain-access-groups:$keychain_group_index" "$PROFILE_PLIST" 2>/dev/null)"; do
                /usr/libexec/PlistBuddy -c "Add :keychain-access-groups:$keychain_group_index string $keychain_group" "$SIGN_ENTITLEMENTS"
                keychain_group_index=$((keychain_group_index + 1))
            done
        fi
    fi
else
    echo "==> skip provisioning profile embed (set APPSTORE_PROVISIONING_PROFILE for upload builds)"
fi

echo "==> clear App Store package extended attributes"
/usr/bin/xattr -cr "$APP_STAGE"

echo "==> strip app executable"
/usr/bin/strip -S "$APP_STAGE/Contents/MacOS/Gateway"

if [ -n "$APP_SIGN_IDENTITY" ]; then
    echo "==> sign app for App Store"
    /usr/bin/codesign --force --options runtime --timestamp \
        --entitlements "$SIGN_ENTITLEMENTS" \
        --sign "$APP_SIGN_IDENTITY" \
        "$APP_STAGE/Contents/MacOS/Gateway"
    /usr/bin/codesign --force --options runtime --timestamp \
        --entitlements "$SIGN_ENTITLEMENTS" \
        --sign "$APP_SIGN_IDENTITY" \
        "$APP_STAGE"
else
    echo "==> ad-hoc sign app for local sandbox smoke validation"
    /usr/bin/codesign --force --deep \
        --entitlements "$ENTITLEMENTS" \
        --sign - \
        "$APP_STAGE"
fi

echo "==> verify app signature"
/usr/bin/codesign --verify --strict --verbose=2 "$APP_STAGE"
/usr/bin/codesign -d --entitlements :- "$APP_STAGE" >/dev/null

if [ -n "$INSTALLER_SIGN_IDENTITY" ]; then
    echo "==> create signed App Store package"
    rm -f "$PKG_PATH"
    /usr/bin/productbuild \
        --component "$APP_STAGE" /Applications \
        --sign "$INSTALLER_SIGN_IDENTITY" \
        "$PKG_PATH"
    /usr/sbin/pkgutil --check-signature "$PKG_PATH"
else
    echo "==> skip package creation (set APPSTORE_INSTALLER_SIGN_IDENTITY for upload package)"
fi

echo "==> done"
echo "app:         $APP_STAGE"
echo "bundle id:   $APPSTORE_BUNDLE_ID"
echo "version:     $VERSION"
echo "build:       $BUILD_NUMBER"
if [ -f "$PKG_PATH" ]; then
    echo "pkg:         $PKG_PATH"
else
    echo "pkg:         not created"
fi
