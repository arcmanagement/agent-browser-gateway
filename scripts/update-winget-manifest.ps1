param(
    [Parameter(Mandatory = $true)]
    [string]$Version,
    [string]$OutputDir = "dist\winget",
    [string]$PackageIdentifier = "ArcManagement.AgentBrowserGateway",
    [string]$Repository = "arcmanagement/agent-browser-gateway",
    [string]$PublicDownloadBaseUrl = "https://agent-browser-gateway.com/downloads",
    [string]$InstallerUrl = "",
    [string]$InstallerSha256 = "",
    [string]$ManifestVersion = "1.12.0"
)

$ErrorActionPreference = "Stop"

$Version = $Version.TrimStart("v")
if ([string]::IsNullOrWhiteSpace($InstallerUrl)) {
    $InstallerUrl = "$PublicDownloadBaseUrl/agent-browser-gateway-$Version-windows-x64-setup.zip"
}

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
if (-not [System.IO.Path]::IsPathRooted($OutputDir)) {
    $OutputDir = Join-Path $Root $OutputDir
}

$ManifestDir = Join-Path $OutputDir "manifests\a\ArcManagement\AgentBrowserGateway\$Version"
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) "abg-winget-$Version"
$SetupZipName = "agent-browser-gateway-$Version-windows-x64-setup.zip"
$LocalSetupZip = Join-Path $Root "dist\$SetupZipName"

function Get-InstallerHash {
    if (-not [string]::IsNullOrWhiteSpace($InstallerSha256)) {
        return $InstallerSha256.ToUpperInvariant()
    }

    if (Test-Path $LocalSetupZip) {
        return (Get-FileHash -Algorithm SHA256 $LocalSetupZip).Hash.ToUpperInvariant()
    }

    New-Item -ItemType Directory -Force $TempDir | Out-Null
    $DownloadedZip = Join-Path $TempDir $SetupZipName
    Invoke-WebRequest -Uri $InstallerUrl -OutFile $DownloadedZip
    return (Get-FileHash -Algorithm SHA256 $DownloadedZip).Hash.ToUpperInvariant()
}

$Hash = Get-InstallerHash
New-Item -ItemType Directory -Force $ManifestDir | Out-Null

$VersionManifest = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.version.$ManifestVersion.schema.json
PackageIdentifier: $PackageIdentifier
PackageVersion: $Version
DefaultLocale: en-US
ManifestType: version
ManifestVersion: $ManifestVersion
"@

$InstallerManifest = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.installer.$ManifestVersion.schema.json
PackageIdentifier: $PackageIdentifier
PackageVersion: $Version
MinimumOSVersion: 10.0.19041.0
InstallerType: zip
NestedInstallerType: exe
NestedInstallerFiles:
- RelativeFilePath: AgentBrowserGatewaySetup.exe
Scope: user
InstallModes:
- silent
- silentWithProgress
- interactive
InstallerSwitches:
  Silent: --silent
  SilentWithProgress: --silent
  Interactive: --interactive
  InstallLocation: --install-dir "<INSTALLPATH>"
UpgradeBehavior: install
Commands:
- abg
Installers:
- Architecture: x64
  InstallerUrl: $InstallerUrl
  InstallerSha256: $Hash
  AppsAndFeaturesEntries:
  - DisplayName: Agent Browser Gateway
    DisplayVersion: $Version
    Publisher: ArcManagement
    InstallerType: zip
ManifestType: installer
ManifestVersion: $ManifestVersion
"@

$DefaultLocaleManifest = @"
# yaml-language-server: `$schema=https://aka.ms/winget-manifest.defaultLocale.$ManifestVersion.schema.json
PackageIdentifier: $PackageIdentifier
PackageVersion: $Version
PackageLocale: en-US
Publisher: ArcManagement
PublisherUrl: https://arcm.co.jp/
PublisherSupportUrl: https://agent-browser-gateway.com/docs/
PrivacyUrl: https://agent-browser-gateway.com/privacy/
Author: ArcManagement
PackageName: Agent Browser Gateway
PackageUrl: https://agent-browser-gateway.com/
License: ArcManagement Source License
LicenseUrl: https://agent-browser-gateway.com/LICENSE.txt
Copyright: Copyright (c) ArcManagement Inc.
ShortDescription: Local Chrome tab gateway and CLI for coding agents.
Description: Agent Browser Gateway lets coding agents inspect and operate only the Chrome tabs you explicitly share through the local Gateway and browser extension.
Moniker: abg
Tags:
- chrome
- browser
- cli
- local
- agent
- codex
- claude
Documentations:
- DocumentLabel: Documentation
  DocumentUrl: https://agent-browser-gateway.com/docs/
ReleaseNotesUrl: https://agent-browser-gateway.com/docs/distribution/
InstallationNotes: Install the Agent Browser Gateway Chrome extension from the Chrome Web Store, then share a tab from the extension popup and run abg status.
ManifestType: defaultLocale
ManifestVersion: $ManifestVersion
"@

Set-Content -Path (Join-Path $ManifestDir "$PackageIdentifier.yaml") -Value $VersionManifest -Encoding utf8
Set-Content -Path (Join-Path $ManifestDir "$PackageIdentifier.installer.yaml") -Value $InstallerManifest -Encoding utf8
Set-Content -Path (Join-Path $ManifestDir "$PackageIdentifier.locale.en-US.yaml") -Value $DefaultLocaleManifest -Encoding utf8

Write-Host "updated: $ManifestDir"
Write-Host "version: $Version"
Write-Host "sha256: $Hash"
Write-Host "asset:   $InstallerUrl"
