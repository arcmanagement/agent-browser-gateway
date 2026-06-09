# Homebrew Cask Distribution

ABG is distributed as an Apple Silicon-only Homebrew Cask. The cask installs:

- `Agent Browser Gateway.app` into `/Applications`
- `abg` into Homebrew's `bin`

The Chrome extension is shipped as a separate release asset and must be loaded separately.

Users install from the same-repository tap:

```bash
brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
brew install --cask agent-browser-gateway
```

This works after the versioned macOS ZIP exists on the GitHub Release and
`Casks/agent-browser-gateway.rb` on the default branch points at that version and SHA-256.

## Build Release Artifacts

Unsigned local smoke build:

```bash
export VERSION=0.4.1
make dist VERSION="$VERSION"
```

Developer ID signed and notarized build:

```bash
export VERSION=0.4.1
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
dist/agent-browser-gateway-0.4.1-macos-arm64.zip
dist/agent-browser-gateway-extension-0.4.1.zip
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
4. Upload both zip files to the GitHub Release. Publishing the release also starts
   the Windows release workflow, which uploads Windows assets and submits WinGet
   manifests when its secrets are configured:

   ```bash
   gh release create "v$VERSION" \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.zip" \
     "dist/agent-browser-gateway-extension-$VERSION.zip" \
     --title "v$VERSION" \
     --notes-file release-notes.md
   ```

5. Update `Casks/agent-browser-gateway.rb` from the uploaded release asset:

   ```bash
   bash scripts/update-homebrew-cask.sh "$VERSION"
   ```

6. Verify the Cask:

   ```bash
   ruby -c Casks/agent-browser-gateway.rb
   tap_name="arcmanagement/agent-browser-gateway"
   brew tap-new --no-git "$tap_name"
   tap_dir="$(brew --repository "$tap_name")"
   mkdir -p "$tap_dir/Casks"
   cp Casks/agent-browser-gateway.rb "$tap_dir/Casks/agent-browser-gateway.rb"
   brew audit --cask --strict --tap="$tap_name" agent-browser-gateway
   git diff -- Casks/agent-browser-gateway.rb
   ```

   After the GitHub Release asset is reachable from the network, run the online
   check as well:

   ```bash
   brew audit --cask --strict --online --tap="$tap_name" agent-browser-gateway
   ```

7. Commit and push the tap update before announcing the release as Homebrew-ready.

For a same-repository tap, generate directly into `Casks/` after the GitHub Release asset exists:

```bash
export VERSION=0.4.1
bash scripts/update-homebrew-cask.sh "$VERSION"
git add Casks/agent-browser-gateway.rb
git commit -m "Update Homebrew cask for v$VERSION"
git push
```

The `Homebrew Cask Update` GitHub Actions workflow runs the same update command
for a manually supplied version, audits the Cask, and uploads the updated Cask as
an artifact. It does not push commits automatically.

WinGet release flow is covered separately in [WINGET.md](WINGET.md).

## Install Test

```bash
brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
brew install --cask agent-browser-gateway
```
