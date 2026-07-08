# Update Delivery Decision

This note records the initial ABG update-delivery path and the alternatives considered.

## Selected initial path

ABG will start with manual, user-initiated updates through the public download site and package
manager metadata:

- macOS users install or update with the Homebrew cask, or download the current signed DMG from
  `https://agent-browser-gateway.com/`.
- Windows users will update through WinGet after the signed Windows package and WinGet submission
  are live.
- The Chrome extension updates through the Chrome Web Store.
- Git tags and release notes remain the source trace for published versions, but GitHub Releases are
  not the first user-facing binary update channel.

This path is intentionally simple for the first public releases. It preserves ABG's local-first and
zero-telemetry promise because the Gateway app does not need an update checker, background network
request, or automatic binary replacement path. It also keeps Developer ID signing and notarization on
the trusted maintainer machine instead of moving sensitive signing material into hosted automation.

## Candidate comparison

| Mechanism | User experience | Security and operations | Initial decision |
| --- | --- | --- | --- |
| GitHub Releases | Familiar release history, tag notes, and downloadable assets for technical users. | Good for source traceability and release notes, but not ideal as the primary end-user update surface because users still need to find, verify, and install the right artifact. Public assets also need the same signing and checksum process as the website. | Use for tags and release traceability. Do not make it the initial primary binary update path. |
| Sparkle | Native macOS update checks and guided in-app updates. | Strong macOS updater ecosystem, but it adds an appcast, update-signing keys, updater UI, failure handling, and network behavior that must be explained under ABG's zero-telemetry model. It also covers macOS only, so Windows still needs a separate path. | Defer until release volume and user support needs justify the added moving parts. |
| No automatic app updater | Users check the website, Homebrew cask, WinGet, or extension store and choose when to update. | Lowest implementation and trust surface. No background update checks, no appcast, no additional signing key path, and no automatic replacement of local binaries. Requires clear user-facing documentation. | Selected for the initial release path. |

## Current user-facing update flow

1. Check the current version in the ABG app, `abg --version`, the Homebrew cask, or the website.
2. For macOS Homebrew installs, run `brew update` and `brew upgrade --cask agent-browser-gateway`.
3. For manual macOS installs, download the current DMG from the website, verify the SHA-256 checksum,
   and run the installer again. The installer overwrites the managed app and CLI without deleting
   local runtime state.
4. For Windows, use WinGet after the package is indexed. Until then, follow the repository-based
   testing instructions.
5. The browser extension updates through Chrome Web Store update handling.

## Revisit triggers

Reconsider Sparkle or another automatic updater when any of these become true:

- Users need a lower-friction macOS update path after multiple public releases.
- Release cadence makes manual website and Homebrew checks too costly.
- ABG can document and test update-check network behavior without weakening the zero-telemetry
  promise.
- Windows and macOS update flows can stay coherent enough that user support remains simple.
