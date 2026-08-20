# Reproducible Docker Build

ABG provides a Docker build entry point for third-party source rebuilds of the
Linux `abg` CLI and shared `GatewayCore` code.

```bash
make docker-repro
```

For the broader v1.0 release artifact dry run, including the Chrome extension ZIP, unsigned host
Gateway binaries, SBOM, and checksum manifest, use:

```bash
make reproducible-build
```

The release trust plan and user verification path are documented in
[`RELEASE_ARTIFACT_TRUST.md`](RELEASE_ARTIFACT_TRUST.md).

Outputs are written to `dist/reproducible-docker/`:

- `abg-linux-<arch>`
- `SHA256SUMS.txt`
- `SWIFT_VERSION.txt`
- `SOURCE_DATE_EPOCH`

## Pins

The build uses:

- Docker base image `swift:6.1-noble@sha256:4c6af6663ed2316002a3b38ff5505a1fc1f2749ec31e84936c32dd336713c569`
- tracked `Package.resolved` SwiftPM revisions
- repository source at the checked-out commit
- `SOURCE_DATE_EPOCH` from the checked-out commit timestamp by default

Set `ABG_REPRO_PLATFORM=linux/amd64` or `ABG_REPRO_PLATFORM=linux/arm64` to
force a target platform when Docker supports it.

## Difference From macOS Release Artifacts

This Docker build is not a replacement for the notarized macOS app, DMG, or
Homebrew Cask artifacts. Those artifacts require the macOS toolchain, app
bundling, code signing, and optional Apple notarization. The Docker entry point
is a deterministic source rebuild for the Linux CLI surface and shared protocol
code, so reviewers can inspect dependency pins and compare the resulting
checksum for that build target.

## Manual Verification

```bash
make docker-repro
cd dist/reproducible-docker
shasum -a 256 -c SHA256SUMS.txt
./abg-linux-* --version
```
