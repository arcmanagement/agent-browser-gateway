# WinGet Distribution

ABG for Windows is submitted to the Microsoft Windows Package Manager Community Repository as:

```text
ArcManagement.AgentBrowserGateway
```

Current `v0.4.6` status: ABG is not indexed by WinGet yet, and no Windows release ZIP has been
published. The release is waiting on the signed Windows release and WinGet submission workflow.

Once the WinGet PR for a release is merged into `microsoft/winget-pkgs`, users can install ABG with:

```powershell
winget install --id ArcManagement.AgentBrowserGateway --source winget
```

The package uses the public download setup ZIP:

```text
agent-browser-gateway-<version>-windows-x64-setup.zip
```

The setup ZIP contains `AgentBrowserGatewaySetup.exe` at the archive root and the release payload in
`payload/`. The WinGet manifest treats it as a ZIP installer with a nested EXE installer.

## Release Workflow

The unified `Release` workflow runs on `v*.*.*` tag pushes, creates a draft
GitHub Release, and calls `Windows CI` with the same tag version. The Windows job:

1. Builds and tests the Windows app, gateway, CLI, and setup launcher.
2. Publishes signed Windows release ZIPs and SHA-256 files to the GitHub Release
   when Windows signing secrets are configured.
3. Generates WinGet manifests with `scripts/update-winget-manifest.ps1`.
4. Submits the manifests to `microsoft/winget-pkgs` with `wingetcreate` after
   the draft GitHub Release is published and the setup ZIP URL is public.

Set these repository secrets before expecting signed Windows release assets or
WinGet submission:

```text
WINDOWS_CODESIGN_PFX_BASE64
WINDOWS_CODESIGN_PFX_PASSWORD
WINGET_CREATE_GITHUB_TOKEN
```

Use a GitHub personal access token that can create a fork and PR against the public
`microsoft/winget-pkgs` repository. The default `GITHUB_TOKEN` cannot do that because it is scoped to
this repository.

If Windows signing secrets are not configured, the workflow still builds and
uploads CI artifacts, but it skips GitHub Release upload and WinGet submission.
If the GitHub Release is still a draft, WinGet submission is deferred until the
release is published.

## Manual Dry Run

Generate manifests without submitting:

```powershell
.\scripts\update-winget-manifest.ps1 -Version 0.4.6
```

The output path is:

```text
dist\winget\manifests\a\ArcManagement\AgentBrowserGateway\0.4.6
```

Validate on Windows when `winget` is available:

```powershell
winget validate dist\winget\manifests\a\ArcManagement\AgentBrowserGateway\0.4.6
```

Submit or resubmit manually from GitHub Actions with the `WinGet Submission` workflow. Set
`submit=true` only after the public setup ZIP exists in the GitHub Release or under the configured
public download URL.

## Installer Requirements

The setup launcher supports:

```text
AgentBrowserGatewaySetup.exe --silent
AgentBrowserGatewaySetup.exe --interactive
AgentBrowserGatewaySetup.exe --silent --install-dir "C:\Tools\AgentBrowserGateway"
```

Silent setup delegates to `Install-AgentBrowserGateway.ps1`, registers an Add/Remove Programs entry
under `HKCU`, refreshes the user `PATH`, installs the Claude/Codex skills, and starts the local
Gateway. The uninstall entry points to `Uninstall-AgentBrowserGateway.ps1`, so WinGet can uninstall
or upgrade the package through the standard package-manager path.
