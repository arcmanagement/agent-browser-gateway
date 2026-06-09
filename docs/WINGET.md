# WinGet Distribution

ABG for Windows is submitted to the Microsoft Windows Package Manager Community Repository as:

```text
ArcManagement.AgentBrowserGateway
```

Current `v0.4.1` status: ABG is not indexed by WinGet yet, and no Windows release ZIP has been
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

The `Windows CI` workflow runs on GitHub Release publication and:

1. Builds and tests the Windows app, gateway, CLI, and setup launcher.
2. Requires Windows code signing for release-triggered runs.
3. Publishes the Windows release ZIPs and SHA-256 files to the public download site.
4. Generates WinGet manifests with `scripts/update-winget-manifest.ps1`.
5. Submits the manifests to `microsoft/winget-pkgs` with `wingetcreate`.

Set this repository secret before publishing a release:

```text
WINGET_CREATE_GITHUB_TOKEN
```

Use a GitHub personal access token that can create a fork and PR against the public
`microsoft/winget-pkgs` repository. The default `GITHUB_TOKEN` cannot do that because it is scoped to
this repository.

## Manual Dry Run

Generate manifests without submitting:

```powershell
.\scripts\update-winget-manifest.ps1 -Version 0.4.1
```

The output path is:

```text
dist\winget\manifests\a\ArcManagement\AgentBrowserGateway\0.4.1
```

Validate on Windows when `winget` is available:

```powershell
winget validate dist\winget\manifests\a\ArcManagement\AgentBrowserGateway\0.4.1
```

Submit or resubmit manually from GitHub Actions with the `WinGet Submission` workflow. Set
`submit=true` only after the public setup ZIP exists under `https://agent-browser-gateway.com/downloads/`.

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
