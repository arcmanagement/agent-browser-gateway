# Release Signing Policy

ABG release trust is layered by release surface. Git tags and checksum manifests
provide source and artifact integrity. Platform-native signatures provide the
operating-system trust signal for executable payloads.

## Signing Targets

Required for every public release:

- Git release tag: an annotated GPG-signed tag named `v<version>`.
- Checksum manifest: `SHA256SUMS.txt` covering every release asset attached to
  the GitHub Release or published under `/downloads/`.
- Checksum manifest signature: detached GPG signature
  `SHA256SUMS.txt.asc`.
- macOS app, CLI, and DMG or ZIP payload: Apple Developer ID signature, with
  notarization when the artifact is intended for normal user installation.
- Windows `.exe` and `.dll` payloads, including the setup launcher:
  Authenticode signature with timestamping.

Covered by `SHA256SUMS.txt` and `SHA256SUMS.txt.asc`, but not separately signed
with a detached GPG signature in the initial policy:

- Chrome extension ZIP.
- Homebrew Cask file.
- SBOM files.
- Release notes.
- Windows ZIP containers and per-ZIP `.sha256.txt` files.

The signed checksum manifest is the cross-platform artifact integrity root. Do
not add per-binary detached GPG signatures unless a package manager or release
channel requires them.

## Key Ownership

The release GPG key is owned by the ABG maintainer account holder and represents
the ABG release owner. The public key must be published in the GitHub account
used to create release tags and in the release documentation before it is used
for an announced release.

Private release keys must stay outside GitHub Actions:

- Keep the GPG private key on a maintainer-controlled machine or hardware token.
- Keep Apple Developer ID private keys and notary credentials on a trusted
  maintainer Mac.
- Do not store GPG private keys, Apple Developer ID private keys, certificate
  passwords, App Store Connect credentials, or notary credentials in GitHub
  Actions secrets.

Windows Authenticode signing is the only current exception. The existing
`Windows CI` workflow can sign with a PFX supplied through repository secrets.
This risk is explicitly accepted only for Windows release signing until the
project moves to a hardware-backed or cloud KMS-backed signing provider. The PFX
must be an organization-owned code-signing certificate, protected by a strong
password, rotated on normal certificate renewal, and scoped to the Windows
release workflow. GitHub Actions must never receive the release GPG key.

## Maintainer Release Procedure

Create a signed release tag from the reviewed commit:

```bash
export VERSION=0.4.1
git tag -s "v$VERSION" -m "Agent Browser Gateway v$VERSION"
git tag -v "v$VERSION"
git push origin "v$VERSION"
```

Build the signed macOS artifacts on the trusted maintainer Mac:

```bash
make dist VERSION="$VERSION" \
  SIGN_IDENTITY="Developer ID Application: ArcManagement Inc (M46W5MVAQP)" \
  NOTARY_PROFILE="abg-notary"
```

Generate and sign the release checksum manifest from the exact files that will
be published:

```bash
cd dist
shasum -a 256 \
  "agent-browser-gateway-$VERSION-macos-arm64.zip" \
  "agent-browser-gateway-extension-$VERSION.zip" \
  "agent-browser-gateway.rb" \
  "agent-browser-gateway-$VERSION.spdx.json" \
  "agent-browser-gateway-$VERSION.cyclonedx.json" \
  > SHA256SUMS.txt
gpg --armor --detach-sign --output SHA256SUMS.txt.asc SHA256SUMS.txt
```

Windows release signing remains in the Windows release workflow while the PFX
exception above is active. If `require_code_sign=true` or the workflow is
triggered by GitHub Release publication, unsigned Windows release artifacts must
fail packaging instead of being published.

## User Verification

Verify the source tag:

```bash
git fetch --tags https://github.com/arcmanagement/agent-browser-gateway.git
git tag -v "v$VERSION"
```

Verify the signed checksum manifest:

```bash
gpg --verify SHA256SUMS.txt.asc SHA256SUMS.txt
shasum -a 256 -c SHA256SUMS.txt
```

Verify macOS executable signatures after unpacking the macOS artifact:

```bash
codesign --verify --strict --verbose=2 \
  "Agent Browser Gateway.app"
codesign --verify --strict --verbose=2 abg
spctl --assess --type execute --verbose \
  "Agent Browser Gateway.app"
```

Verify Windows executable signatures after unpacking the Windows setup artifact:

```powershell
Get-AuthenticodeSignature .\AgentBrowserGatewaySetup.exe |
  Format-List Status,SignerCertificate,TimeStamperCertificate
Get-AuthenticodeSignature .\payload\abg.exe |
  Format-List Status,SignerCertificate,TimeStamperCertificate
```

Expected results:

- `git tag -v` reports a good GPG signature from the ABG release key.
- `gpg --verify` reports a good signature on `SHA256SUMS.txt`.
- `shasum -a 256 -c SHA256SUMS.txt` reports `OK` for every downloaded asset.
- `codesign` and `spctl` accept the macOS executables.
- `Get-AuthenticodeSignature` reports `Status : Valid` for Windows executables.
