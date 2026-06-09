---
name: bump-abg
description: Agent Browser Gateway リポジトリの ABG アプリをバージョン bump し、拡張・Swift app・CLI resource・docs・Homebrew Cask・WinGet・一時配布 zip 手順を揃えて、必要に応じて signed/notarized build、commit、push、GitHub Release まで行うための専用 workflow。
---

# Bump ABG

Use this skill only in the Agent Browser Gateway repository when the user asks to bump, release, rebuild, package, sign, notarize, commit, push, tag, or publish Agent Browser Gateway.

## Rules

- Treat Developer ID signing and notarization as local-only. Never move Developer ID keys, certificate passwords, App Store Connect credentials, or notary credentials into GitHub Actions.
- Do not commit, push, tag, upload a GitHub Release, or edit a tap unless the user explicitly asks for that side effect.
- If the worktree is dirty before starting, inspect the diff and avoid overwriting unrelated user edits.
- Keep `dist/`, `extension/dist/`, `.build/`, generated apps, and local signing material out of git.
- Use `apply_patch` for manual file edits.
- Every release bump must verify documentation, GitHub Pages content, and bundled agent skill guidance before packaging. If any of those surfaces are stale, update them in the same release bump before building artifacts.

## Version Files

For each bump, update all version-bearing files that currently reference the previous version:

```text
Sources/Gateway/Coordinator.swift
Sources/abg/Resources/agent-browser-gateway.md
build-app.sh
extension/package.json
extension/public/manifest.json
extension/src/background.ts
README.md
ROADMAP.md
docs/HOMEBREW.md
docs/WINGET.md
docs/TEMPORARY_ZIP_INSTALL.md
Casks/agent-browser-gateway.rb
```

`Casks/agent-browser-gateway.rb` and the temporary zip checksums must be updated from the actual generated artifacts, not guessed.

## Freshness Surfaces

Before packaging, explicitly check and update these user-facing guidance surfaces:

```text
README.md
ROADMAP.md
SECURITY.md
docs/
site/
Sources/abg/Resources/agent-browser-gateway.md
windows/AgentBrowserGateway.Cli/Resources/agent-browser-gateway.windows.md
.agents/skills/
```

`Sources/abg/Resources/agent-browser-gateway.md` is the bundled Claude/Codex skill resource shipped with the CLI. `.claude/skills` is a symlink to `.agents/skills`, so update `.agents/skills` as the source of truth.

Do not continue to signing, notarization, tags, or GitHub Release publication while these surfaces still describe the previous version, omit the release's user-visible behavior, or contradict the current security/consent boundary.

## Standard Workflow

1. Establish the current state:

   ```bash
   git status --short --branch
   rg -n "0\\.3\\.[0-9]+|v0\\.3\\.[0-9]+" \
     README.md ROADMAP.md Sources/Gateway/Coordinator.swift \
     Sources/abg/Resources/agent-browser-gateway.md build-app.sh \
    docs/HOMEBREW.md docs/TEMPORARY_ZIP_INSTALL.md \
    docs/WINGET.md \
    extension/package.json extension/public/manifest.json \
    extension/src/background.ts Casks/agent-browser-gateway.rb \
     SECURITY.md docs site .agents/skills \
     windows/AgentBrowserGateway.Cli/Resources
   ```

2. Patch the version files. Add a concise `ROADMAP.md` shipped entry for the new version and the actual change being released.

3. Check documentation, Pages, and skill freshness before packaging:

   ```bash
   git diff -- README.md ROADMAP.md SECURITY.md docs site \
     Sources/abg/Resources/agent-browser-gateway.md \
     windows/AgentBrowserGateway.Cli/Resources \
     .agents/skills
   rg -n "<old-version>|v<old-version>" \
     README.md ROADMAP.md SECURITY.md docs site \
     Sources/abg/Resources/agent-browser-gateway.md \
     windows/AgentBrowserGateway.Cli/Resources \
     .agents/skills
   ```

   If the release changes a user-visible command, consent boundary, install step, artifact path, or security policy, update the relevant docs/Pages/skills in the release branch. This is mandatory, not a post-release follow-up.

4. Run validation before packaging:

   ```bash
   make verify
   cd extension && pnpm audit --audit-level moderate
   ```

5. Build signed and notarized artifacts on the local Mac:

   ```bash
   export VERSION=<new-version>
   make dist VERSION="$VERSION" \
     SIGN_IDENTITY="Developer ID Application: ArcManagement Inc (M46W5MVAQP)" \
     NOTARY_PROFILE="abg-notary" \
     CASK_OUTPUT=Casks/agent-browser-gateway.rb
   ```

   If signing credentials are unavailable, stop after an unsigned build only when the user agrees. For releases, signed and notarized artifacts are required.

6. Verify the generated app, CLI, extension version, and hashes:

   ```bash
   export VERSION=<new-version>
   codesign --verify --strict --verbose=2 \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/Agent Browser Gateway.app"
   codesign --verify --strict --verbose=2 \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/abg"
   spctl --assess --type execute --verbose \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/Agent Browser Gateway.app"
   plutil -p \
     "dist/agent-browser-gateway-$VERSION-macos-arm64/Agent Browser Gateway.app/Contents/Info.plist" \
     | rg "CFBundleShortVersionString|CFBundleVersion|$VERSION"
   node -e 'const m=require("./extension/dist/manifest.json"); if (m.version !== process.env.VERSION) throw new Error(m.version)'
   shasum -a 256 \
     "dist/agent-browser-gateway-$VERSION-macos-arm64.zip" \
     "dist/agent-browser-gateway-extension-$VERSION.zip"
   ```

7. Copy the artifact hashes into `docs/TEMPORARY_ZIP_INSTALL.md`. Confirm `Casks/agent-browser-gateway.rb` has the app zip hash generated by `make dist`.
   Confirm `docs/WINGET.md`, `.github/workflows/windows-ci.yml`, and `.github/workflows/winget-submit.yml`
   still describe the current Windows setup ZIP and WinGet submission path.

8. Run final checks:

   ```bash
   git diff --check
   rg -n "<old-version>|v<old-version>" \
     README.md ROADMAP.md SECURITY.md Sources docs site extension Casks \
     build-app.sh .agents/skills windows/AgentBrowserGateway.Cli/Resources
   git diff --stat
   ```

## Commit, Push, Tag, Release

Only do these when the user asks.

Commit and push:

```bash
git add -A
git diff --cached --stat
git diff --cached --check
git commit -m "Release v<new-version>"
git push origin main
```

Create a GitHub Release only when requested:

```bash
VERSION=<new-version>
git tag "v$VERSION"
git push origin "v$VERSION"
gh release create "v$VERSION" \
  "dist/agent-browser-gateway-$VERSION-macos-arm64.zip" \
  "dist/agent-browser-gateway-extension-$VERSION.zip" \
  --title "v$VERSION" \
  --notes-file release-notes.md
```

If the release asset already exists, inspect with `gh release view "v$VERSION"` and use the least destructive upload/update path.

## Local Install Refresh

When the user asks to update the local running app after a bump:

```bash
VERSION=<new-version>
osascript -e 'quit app id "co.arcm.AgentBrowserGateway"' || true
pkill -f Gateway || true
sudo rm -rf "/Applications/Agent Browser Gateway.app"
sudo ditto \
  "dist/agent-browser-gateway-$VERSION-macos-arm64/Agent Browser Gateway.app" \
  "/Applications/Agent Browser Gateway.app"
sudo install -m 755 \
  "dist/agent-browser-gateway-$VERSION-macos-arm64/abg" \
  /usr/local/bin/abg
sudo rm -rf /usr/local/bin/AgentBrowserGateway_abg.bundle
sudo ditto \
  "dist/agent-browser-gateway-$VERSION-macos-arm64/AgentBrowserGateway_abg.bundle" \
  /usr/local/bin/AgentBrowserGateway_abg.bundle
open "/Applications/Agent Browser Gateway.app"
```

Chrome unpacked extensions may continue running an old service worker until `chrome://extensions` reload is clicked or Chrome is fully restarted.
