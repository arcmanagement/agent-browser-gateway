#!/bin/bash
# Read-only preflight for the Mac App Store package build. Inspects local signing
# identities, the provisioning profile, and the build environment without copying,
# printing, or exporting any secret material.
set -euo pipefail

status=0

check() {
    local label="$1" ok="$2" detail="$3"
    if [ "$ok" = "yes" ]; then
        printf 'ok    %-34s %s\n' "$label" "$detail"
    else
        printf 'MISS  %-34s %s\n' "$label" "$detail"
        status=1
    fi
}

echo "Mac App Store preflight (read-only)"
echo

if [ -n "${VERSION:-}" ]; then
    check "VERSION" yes "$VERSION"
else
    check "VERSION" no "set VERSION=<tag version without v>"
fi

if [ -n "${BUILD_NUMBER:-}" ]; then
    check "BUILD_NUMBER" yes "$BUILD_NUMBER"
else
    check "BUILD_NUMBER" no "set BUILD_NUMBER=<next App Store build number>"
fi

app_identity="${APPSTORE_APP_SIGN_IDENTITY:-}"
installer_identity="${APPSTORE_INSTALLER_SIGN_IDENTITY:-}"
identities="$(security find-identity -v -p codesigning 2>/dev/null || true)"

if [ -n "$app_identity" ]; then
    if printf '%s' "$identities" | grep -Fq "$app_identity"; then
        check "app signing identity" yes "present in keychain"
    else
        check "app signing identity" no "APPSTORE_APP_SIGN_IDENTITY not found by security find-identity"
    fi
else
    apple_dist_count="$(printf '%s' "$identities" | grep -c "Apple Distribution\|3rd Party Mac Developer Application" || true)"
    check "app signing identity" no "set APPSTORE_APP_SIGN_IDENTITY (keychain has $apple_dist_count candidate identities)"
fi

if [ -n "$installer_identity" ]; then
    if security find-identity -v 2>/dev/null | grep -Fq "$installer_identity"; then
        check "installer signing identity" yes "present in keychain"
    else
        check "installer signing identity" no "APPSTORE_INSTALLER_SIGN_IDENTITY not found by security find-identity"
    fi
else
    check "installer signing identity" no "set APPSTORE_INSTALLER_SIGN_IDENTITY"
fi

profile="${APPSTORE_PROVISIONING_PROFILE:-}"
if [ -n "$profile" ] && [ -f "$profile" ]; then
    plist="$(security cms -D -i "$profile" 2>/dev/null || true)"
    if [ -n "$plist" ]; then
        expiry="$(printf '%s' "$plist" | plutil -extract ExpirationDate raw -o - - 2>/dev/null || true)"
        name="$(printf '%s' "$plist" | plutil -extract Name raw -o - - 2>/dev/null || true)"
        check "provisioning profile" yes "${name:-unnamed} (expires ${expiry:-unknown})"
        if [ -n "$expiry" ]; then
            expiry_epoch="$(date -j -f '%Y-%m-%dT%H:%M:%SZ' "$expiry" '+%s' 2>/dev/null || true)"
            if [ -n "$expiry_epoch" ] && [ "$expiry_epoch" -lt "$(date '+%s')" ]; then
                check "provisioning profile expiry" no "profile expired $expiry; download a fresh profile"
            fi
        fi
    else
        check "provisioning profile" no "unreadable profile at APPSTORE_PROVISIONING_PROFILE"
    fi
else
    check "provisioning profile" no "set APPSTORE_PROVISIONING_PROFILE to the .provisionprofile path"
fi

for f in packaging/appstore/AgentBrowserGateway.appstore.entitlements packaging/appstore/abg.appstore.entitlements; do
    if [ -f "$f" ]; then
        check "entitlements $(basename "$f")" yes "present"
    else
        check "entitlements $(basename "$f")" no "missing $f"
    fi
done

if security find-generic-password -s ABG_APP_STORE_CONNECT >/dev/null 2>&1; then
    check "App Store Connect keychain item" yes "ABG_APP_STORE_CONNECT present (value not read)"
else
    check "App Store Connect keychain item" no "ABG_APP_STORE_CONNECT not found; needed for altool upload"
fi

echo
if [ "$status" -eq 0 ]; then
    echo "Preflight passed. Run: VERSION=$VERSION BUILD_NUMBER=${BUILD_NUMBER:-<n>} make appstore-pkg"
else
    echo "Preflight found missing inputs. Fix the MISS lines above, then re-run."
fi
exit "$status"
