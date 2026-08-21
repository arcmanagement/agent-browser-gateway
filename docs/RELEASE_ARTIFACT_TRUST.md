# Release Artifact Trust

This document defines the v1.0 artifact trust plan for ABG release assets. It covers the build
inputs, artifact names, checksum and SBOM locations, signing responsibilities, and the user
verification path before installation.

## Reproducible build entry point

Run the host reproducible build entry point from a clean checkout:

```bash
git clone https://github.com/arcmanagement/agent-browser-gateway.git
cd agent-browser-gateway
git checkout vX.Y.Z
mise trust
mise install
make reproducible-build
```

Outputs are written to `dist/reproducible-build/`:

- `agent-browser-gateway-extension-X.Y.Z.zip`
- `abg-darwin-arm64` or the host-specific unsigned CLI binary
- `Gateway-darwin-arm64` or the host-specific unsigned Gateway binary
- `agent-browser-gateway-X.Y.Z.spdx.json`
- `BUILD_INPUTS.txt`
- `SHA256SUMS.txt`

Set `ABG_REPRO_SKIP_GATEWAY=1` to rebuild only the extension, checksum manifest, and SBOM. Set
`ABG_REPRO_INCLUDE_DOCKER=1` to also run the pinned Linux CLI Docker rebuild documented in
[`REPRODUCIBLE_DOCKER_BUILD.md`](REPRODUCIBLE_DOCKER_BUILD.md).

## Pinned inputs

The reproducible build entry point records the inputs it used in `BUILD_INPUTS.txt`:

- Repository commit from `git rev-parse HEAD`.
- `SOURCE_DATE_EPOCH`, defaulting to the checked-out commit timestamp.
- Node.js and pnpm versions from `mise.toml`.
- .NET SDK version from `global.json` for Windows release parity.
- Swift toolchain requirement from `Package.swift`.
- Swift dependencies from `Package.resolved`.
- Extension dependencies from `extension/pnpm-lock.yaml`.
- Docker Linux CLI base image digest from `Dockerfile.repro` when `ABG_REPRO_INCLUDE_DOCKER=1`.

The release app ZIP and DMG are not byte-for-byte reproducible in v1.0 because Developer ID signing,
timestamping, and Apple notarization add external state. The reproducible build entry point therefore
produces unsigned comparison artifacts and records the signing boundary explicitly.

## v1.0 artifact responsibilities

| Surface | Artifact | Checksum owner | Signing owner | SBOM owner | Provenance owner |
|---|---|---|---|---|---|
| macOS app and CLI | `agent-browser-gateway-X.Y.Z-macos-arm64.zip` | Release maintainer writes `SHA256SUMS.txt` | Release maintainer signs with Developer ID and notarizes on a trusted Mac | Release workflow writes `agent-browser-gateway-X.Y.Z.spdx.json` and `agent-browser-gateway-X.Y.Z.cyclonedx.json` | Release maintainer publishes tag, commit, and workflow run in release notes |
| Chrome extension | `agent-browser-gateway-extension-X.Y.Z.zip` | Release workflow writes `SHA256SUMS.txt` | Chrome Web Store package signing is handled by Google after upload | Release workflow includes extension dependencies in SBOMs | Release maintainer records source tag and Web Store version |
| Homebrew cask | `agent-browser-gateway.rb` | Release workflow includes the cask file in `SHA256SUMS.txt` | Not signed separately; Homebrew verifies the embedded artifact SHA-256 | Covered by release SBOM metadata | Release maintainer verifies the cask points at the versioned public URL |
| Windows package | `agent-browser-gateway-X.Y.Z-windows-x64.zip` and setup ZIP | Windows release workflow writes SHA-256 | Windows release workflow signs with Authenticode certificate | Windows release workflow should publish a Windows SBOM before v1.0 general availability | Release maintainer records workflow run and WinGet PR |

## Checksum and SBOM locations

For public releases, publish these files next to the release artifacts:

- `SHA256SUMS.txt`
- `agent-browser-gateway-X.Y.Z.spdx.json`
- `agent-browser-gateway-X.Y.Z.cyclonedx.json`
- platform-specific checksum sidecars such as
  `agent-browser-gateway-X.Y.Z-macos-arm64.dmg.sha256.txt` for direct GitHub Release downloads

The local dry run writes the same first two file types under `dist/reproducible-build/`, so reviewers
can inspect file names and checksum format without access to signing keys or release credentials.

## Maintainer release checklist

1. Build from the signed tag, not from a local branch.
2. Run `make reproducible-build` and keep `dist/reproducible-build/SHA256SUMS.txt` for comparison.
3. Run the signed macOS release build on a trusted Mac with `SIGN_IDENTITY` and `NOTARY_PROFILE`.
4. Generate release SBOMs and `SHA256SUMS.txt`.
5. Verify `codesign`, `spctl`, and `shasum -a 256 -c SHA256SUMS.txt`.
6. Publish artifacts, checksum files, SBOMs, and release notes together.
7. Confirm the public download page links to the versioned artifacts and checksum files.

## User verification before installation

Download the artifact and checksum file from the same release:

```bash
curl -LO https://github.com/arcmanagement/agent-browser-gateway/releases/download/vX.Y.Z/agent-browser-gateway-X.Y.Z-macos-arm64.dmg
curl -LO https://github.com/arcmanagement/agent-browser-gateway/releases/download/vX.Y.Z/agent-browser-gateway-X.Y.Z-macos-arm64.dmg.sha256.txt
shasum -a 256 -c agent-browser-gateway-X.Y.Z-macos-arm64.dmg.sha256.txt
```

For a GitHub release bundle with `SHA256SUMS.txt`:

```bash
curl -LO https://github.com/arcmanagement/agent-browser-gateway/releases/download/vX.Y.Z/agent-browser-gateway-X.Y.Z-macos-arm64.zip
curl -LO https://github.com/arcmanagement/agent-browser-gateway/releases/download/vX.Y.Z/SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt --ignore-missing
```

On macOS, verify the app signature before first launch:

```bash
codesign --verify --strict --verbose=2 "/Applications/Agent Browser Gateway.app"
spctl --assess --type execute --verbose "/Applications/Agent Browser Gateway.app"
```

Only install artifacts whose checksum verification succeeds. If the checksum file is missing or the
hash does not match, stop and open a GitHub issue.
