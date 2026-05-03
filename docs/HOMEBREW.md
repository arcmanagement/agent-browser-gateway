# Homebrew Cask Distribution

ABG is distributed as an Apple Silicon-only Homebrew Cask. The cask installs:

- `Agent Browser Gateway.app` into `/Applications`
- `abg` into Homebrew's `bin`

The Chrome extension is shipped as a separate release asset and must be loaded separately.

## Build Release Artifacts

Unsigned local smoke build:

```bash
make dist VERSION=0.3.1
```

Developer ID signed and notarized build:

```bash
make dist VERSION=0.3.1 \
  SIGN_IDENTITY="Developer ID Application: ArcManagement Inc (M46W5MVAQP)" \
  NOTARY_PROFILE="abg-notary"
```

Outputs:

```text
dist/agent-browser-gateway-0.3.1-macos-arm64.zip
dist/agent-browser-gateway-extension-0.3.1.zip
dist/agent-browser-gateway.rb
```

`dist/agent-browser-gateway.rb` contains the calculated `sha256` for the Homebrew cask.

## Publish

1. Create and push the release tag.
2. Upload both zip files to the GitHub Release.
3. Copy `dist/agent-browser-gateway.rb` into the tap repository as `Casks/agent-browser-gateway.rb`.
4. Commit and push the tap update.

For a same-repository tap, generate directly into `Casks/` after the GitHub Release asset exists:

```bash
make dist VERSION=0.3.1 CASK_OUTPUT=Casks/agent-browser-gateway.rb
git add Casks/agent-browser-gateway.rb
git commit -m "Update Homebrew cask for v0.3.1"
git push
```

## Install Test

```bash
brew tap arcmanagement/agent-browser-gateway https://github.com/arcmanagement/agent-browser-gateway
brew install --cask agent-browser-gateway
```
