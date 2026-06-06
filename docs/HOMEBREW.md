# Homebrew Cask Distribution

ABG is distributed as an Apple Silicon-only Homebrew Cask. The cask installs:

- `Agent Browser Gateway.app` into `/Applications`
- `abg` into Homebrew's `bin`

The Chrome extension is shipped as a separate release asset and must be loaded separately.

## Build Release Artifacts

Unsigned local smoke build:

```bash
export VERSION=0.3.12
make dist VERSION="$VERSION"
```

Developer ID signed and notarized build:

```bash
export VERSION=0.3.12
make dist VERSION="$VERSION" \
  SIGN_IDENTITY="Developer ID Application: ArcManagement Inc (M46W5MVAQP)" \
  NOTARY_PROFILE="abg-notary"
```

Keep Developer ID signing local. Do not put the Developer ID private key, certificate
password, App Store Connect credentials, or `notarytool` credentials into GitHub Actions
secrets. CI may build and test unsigned artifacts, but signed release assets should be
created on a trusted maintainer Mac and uploaded to GitHub Releases afterward.

Outputs:

```text
dist/agent-browser-gateway-0.3.12-macos-arm64.zip
dist/agent-browser-gateway-extension-0.3.12.zip
dist/agent-browser-gateway.rb
```

`dist/agent-browser-gateway.rb` contains the calculated `sha256` for the Homebrew cask.

## Tag-triggered CI artifact build

The `Release Artifacts` workflow runs on tags matching `v*.*.*` and can also be
started manually with a version input. It builds the unsigned macOS ZIP, Chrome
extension ZIP, generated Cask, `SHA256SUMS.txt`, and `RELEASE_NOTES.md`, then
uploads them as a GitHub Actions artifact.

This workflow is for reproducible archive generation and release review. It does
not publish a GitHub Release and does not handle Developer ID signing,
notarization, stapling, or Chrome Web Store submission.

## Publish

1. Run the signed/notarized local build above.
2. Verify the local artifacts:

   ```bash
   codesign --verify --strict --verbose=2 \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/Agent Browser Gateway.app"
   codesign --verify --strict --verbose=2 \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/abg"
   spctl --assess --type execute --verbose \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/Agent Browser Gateway.app"
   shasum -a 256 \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.zip" \
     "dist/agent-browser-gateway-extension-$VERSION.zip"
   ```

3. Create and push the release tag.
4. Upload both zip files to the GitHub Release:

   ```bash
   gh release create "v$VERSION" \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.zip" \
     "dist/agent-browser-gateway-extension-$VERSION.zip" \
     --title "v$VERSION" \
     --notes-file release-notes.md
   ```

5. Copy `dist/agent-browser-gateway.rb` into the tap repository as `Casks/agent-browser-gateway.rb`.
6. Commit and push the tap update.

For a same-repository tap, generate directly into `Casks/` after the GitHub Release asset exists:

```bash
export VERSION=0.3.12
make dist VERSION="$VERSION" CASK_OUTPUT=Casks/agent-browser-gateway.rb
git add Casks/agent-browser-gateway.rb
git commit -m "Update Homebrew cask for v$VERSION"
git push
```

## Install Test

```bash
brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
brew install --cask agent-browser-gateway
```
