# Homebrew Cask Distribution

ABG is distributed as an Apple Silicon-only Homebrew Cask. The cask installs:

- `Agent Browser Gateway.app` into `/Applications`
- `abg` into Homebrew's `bin`

The Chrome extension is shipped as a separate release asset and must be loaded separately.

Users install from the same-repository tap:

```bash
brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
brew trust --cask arcmanagement/agent-browser-gateway/agent-browser-gateway
brew install --cask agent-browser-gateway
```

This works after the versioned macOS ZIP exists in the matching GitHub Release and this repository's
`Casks/agent-browser-gateway.rb` points at that version and SHA-256.

The temporary public tap repository `arcmanagement/homebrew-agent-browser-gateway` is archived. Use
the explicit GitHub URL above so Homebrew taps this source repository instead of applying its
`homebrew-` repository-name shortcut.

## Build Release Artifacts

Unsigned local smoke build:

```bash
export VERSION=0.4.6
make dist VERSION="$VERSION"
```

Developer ID signed and notarized build:

```bash
export VERSION=0.4.6
make release-dmg VERSION="$VERSION" \
  SIGN_IDENTITY="Developer ID Application: ArcManagement Inc (M46W5MVAQP)" \
  NOTARY_PROFILE="abg-notary"
```

Keep Developer ID signing local. Do not put the Developer ID private key, certificate
password, App Store Connect credentials, or `notarytool` credentials into GitHub Actions
secrets. CI may build and test unsigned artifacts, but signed release assets should be
created on a trusted maintainer Mac and uploaded to the draft GitHub Release before publication.

Outputs:

```text
dist/agent-browser-gateway-0.4.6-macos-arm64.zip
dist/agent-browser-gateway-0.4.6-macos-arm64.dmg
dist/agent-browser-gateway-extension-0.4.6.zip
dist/agent-browser-gateway.rb
```

`dist/agent-browser-gateway.rb` contains the calculated `sha256` for the Homebrew cask.

## Tag-triggered release workflow

The unified `Release` workflow runs on tags matching `v*.*.*` and can also be
started manually with a version input. It builds the macOS ZIP, Chrome extension
ZIP, generated Cask, SBOMs, `SHA256SUMS.txt`, and `RELEASE_NOTES.md`, then
creates or updates the GitHub Release and uploads those assets.

The same workflow also calls the Chrome Web Store review-submission workflow and
the Windows release workflow. The GitHub Release is created as a draft so the
owner can review release assets before publication. Final store publishing also
remains owner-controlled: Chrome Web Store uses `STAGED_PUBLISH`, Microsoft
Store submission remains a Partner Center action, and Mac App Store upload stays
on the trusted maintainer Mac. WinGet submission is deferred until the draft
GitHub Release is published and the setup ZIP URL is public.

For branch validation before tagging, run the `CI` workflow. Its release artifact
smoke-test job builds unsigned archives with the workflow dispatch
`release_version` input, verifies the generated Cask, and uploads the archive
set as a workflow artifact. The same CI run also uploads a Chrome Web Store ZIP
and runs dependency security checks, so release, packaging, and dependency
failures are visible before a tag is created.

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

3. Create and push the release tag. Wait for the tag workflow to create the draft GitHub Release.
4. Replace the CI-built unsigned macOS ZIP with the signed local ZIP, then upload the signed DMG,
   extension ZIP, and checksum sidecars to the same draft GitHub Release.

   ```bash
   (
     cd dist
     shasum -a 256 "agent-browser-gateway-$VERSION-macos-arm64.zip" \
       > "agent-browser-gateway-$VERSION-macos-arm64.zip.sha256.txt"
     shasum -a 256 "agent-browser-gateway-$VERSION-macos-arm64.dmg" \
       > "agent-browser-gateway-$VERSION-macos-arm64.dmg.sha256.txt"
     shasum -a 256 "agent-browser-gateway-extension-$VERSION.zip" \
       > "agent-browser-gateway-extension-$VERSION.zip.sha256.txt"
   )

   gh release upload "v$VERSION" \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.zip" \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.zip.sha256.txt" \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.dmg" \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.dmg.sha256.txt" \
     "dist/agent-browser-gateway-extension-$VERSION.zip" \
     "dist/agent-browser-gateway-extension-$VERSION.zip.sha256.txt" \
     --clobber
   ```

5. Update `Casks/agent-browser-gateway.rb` from the public release asset:

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

   After the public download asset is reachable from the network, run the online check as well:

   ```bash
   brew audit --cask --strict --online --tap="$tap_name" agent-browser-gateway
   ```

7. Commit and push `Casks/agent-browser-gateway.rb` before announcing the release as Homebrew-ready.
   Do not commit release binaries to the source repository.

Generate the same-repository tap cask directly into `Casks/` after the public download asset exists:

```bash
export VERSION=0.4.6
bash scripts/update-homebrew-cask.sh "$VERSION"
git add Casks/agent-browser-gateway.rb
git commit -m "Update Homebrew cask for v$VERSION"
git push
```

The `Homebrew Cask Update` GitHub Actions workflow runs the same update command
for a manually supplied version, audits the Cask, and uploads the updated Cask as
an artifact. It does not push commits automatically.

WinGet release flow is covered separately in [WINGET.md](WINGET.md).
Mac App Store submission is covered separately in
[app-store-submission.md](app-store-submission.md). Keep that path distinct from
the Developer ID signed Homebrew/DMG release flow because the Store build must be
sandboxed and uploaded through App Store Connect.

## Install Test

```bash
brew untap arcmanagement/agent-browser-gateway || true
brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
brew trust --cask arcmanagement/agent-browser-gateway/agent-browser-gateway
brew install --cask agent-browser-gateway
```
