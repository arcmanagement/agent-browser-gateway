param(
    [Parameter(Mandatory = $true)]
    [string]$IdentityName,

    [Parameter(Mandatory = $true)]
    [string]$Publisher,

    [string]$PublisherDisplayName = "ArcManagement, Inc.",
    [string]$Version = "1.0.0.0",
    [string]$Configuration = "Release",
    [string]$RuntimeIdentifier = "win-x64",
    [string]$OutputRoot = "",
    [switch]$SignForStore
)

$ErrorActionPreference = "Stop"

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE."
    }
}

function Assert-StoreVersion {
    param([string]$Value)

    $parts = $Value.Split(".")
    if ($parts.Count -ne 4) {
        throw "MSIX Store version must have four numeric parts, for example 1.0.0.0."
    }

    for ($index = 0; $index -lt $parts.Count; $index++) {
        $part = $parts[$index]
        $number = 0
        if (-not [int]::TryParse($part, [ref]$number)) {
            throw "MSIX Store version part '$part' is not numeric."
        }
        if ($number -lt 0 -or $number -gt 65535) {
            throw "MSIX Store version part '$part' is outside 0-65535."
        }
        if ($index -eq 0 -and $number -eq 0) {
            throw "MSIX Store version major part must not be 0."
        }
    }

    if ([int]$parts[3] -ne 0) {
        throw "MSIX Store version revision must be 0 because the Store reserves the fourth version part."
    }
}

function Resolve-WindowsSdkTool {
    param([string]$FileName)

    $command = Get-Command $FileName -ErrorAction SilentlyContinue
    if ($command) {
        return $command.Source
    }

    $kitsRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $kitsRoot) {
        $candidate = Get-ChildItem $kitsRoot -Recurse -Filter $FileName -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match "\\x64\\$([regex]::Escape($FileName))$" } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($candidate) {
            return $candidate.FullName
        }
    }

    return $null
}

function Copy-PublishedFiles {
    param(
        [string]$SourceDir,
        [string]$DestinationDir,
        [string[]]$ExcludeExtensions = @(".pdb")
    )

    $sourceRoot = (Resolve-Path $SourceDir).Path.TrimEnd("\")

    Get-ChildItem -Path $sourceRoot -Recurse -File |
        Where-Object { $ExcludeExtensions -notcontains $_.Extension.ToLowerInvariant() } |
        ForEach-Object {
            $relativePath = $_.FullName.Substring($sourceRoot.Length + 1)
            $destination = Join-Path $DestinationDir $relativePath
            $destinationParent = Split-Path $destination -Parent
            New-Item $destinationParent -ItemType Directory -Force | Out-Null
            Copy-Item $_.FullName $destination -Force
        }
}

Assert-StoreVersion $Version

$repoRoot = Resolve-Path (Join-Path $PSScriptRoot "..\..")
$template = Join-Path $PSScriptRoot "AppxManifest.xml.template"
$assetSource = Join-Path $PSScriptRoot "Assets"

if (-not $OutputRoot) {
    $OutputRoot = Join-Path $repoRoot "artifacts\msix"
}

$publishRoot = Join-Path $OutputRoot "publish"
$packageRoot = Join-Path $OutputRoot "package-root"
$appDir = Join-Path $packageRoot "AgentBrowserGateway.Windows"
$cliDir = Join-Path $packageRoot "AgentBrowserGateway.Cli"
$gatewayDir = Join-Path $packageRoot "AgentBrowserGateway.Gateway"
$docsDir = Join-Path $packageRoot "docs"
$packagePath = Join-Path $OutputRoot ("AgentBrowserGateway_{0}_{1}.msix" -f $Version, $RuntimeIdentifier)

Write-Host "==> clean"
Remove-Item $publishRoot, $packageRoot, $packagePath -Recurse -Force -ErrorAction SilentlyContinue
New-Item $publishRoot, $appDir, $cliDir, $gatewayDir, $docsDir -ItemType Directory -Force | Out-Null

Write-Host "==> publish WinUI app"
dotnet publish (Join-Path $repoRoot "windows\AgentBrowserGateway.Windows\AgentBrowserGateway.Windows.csproj") `
    -c $Configuration `
    -r $RuntimeIdentifier `
    --self-contained true `
    -p:Platform=x64 `
    -p:WindowsAppSDKSelfContained=true `
    -o (Join-Path $publishRoot "app")
Assert-LastExitCode "dotnet publish WinUI app"

Write-Host "==> publish CLI"
dotnet publish (Join-Path $repoRoot "windows\AgentBrowserGateway.Cli\AgentBrowserGateway.Cli.csproj") `
    -c $Configuration `
    -r $RuntimeIdentifier `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -o (Join-Path $publishRoot "cli")
Assert-LastExitCode "dotnet publish CLI"

Write-Host "==> publish tray Gateway"
dotnet publish (Join-Path $repoRoot "windows\AgentBrowserGateway.Gateway\AgentBrowserGateway.Gateway.csproj") `
    -c $Configuration `
    -r $RuntimeIdentifier `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -o (Join-Path $publishRoot "gateway")
Assert-LastExitCode "dotnet publish tray Gateway"

Write-Host "==> stage package root"
Copy-PublishedFiles -SourceDir (Join-Path $publishRoot "app") -DestinationDir $appDir
Copy-PublishedFiles -SourceDir (Join-Path $publishRoot "cli") -DestinationDir $cliDir
Copy-PublishedFiles -SourceDir (Join-Path $publishRoot "gateway") -DestinationDir $gatewayDir

Copy-Item -Force (Join-Path $repoRoot "README.md") (Join-Path $docsDir "README.md")
Copy-Item -Force (Join-Path $repoRoot "LICENSE") (Join-Path $docsDir "LICENSE.txt")
Copy-Item -Force (Join-Path $repoRoot "COMMERCIAL.md") (Join-Path $docsDir "COMMERCIAL.md")
Copy-Item -Force (Join-Path $repoRoot "windows\README-WINDOWS.md") (Join-Path $docsDir "README-WINDOWS.md")
Set-Content -Path (Join-Path $docsDir "VERSION") -Value $Version -NoNewline

New-Item (Join-Path $packageRoot "Assets") -ItemType Directory -Force | Out-Null
Copy-Item (Join-Path $assetSource "*") (Join-Path $packageRoot "Assets") -Recurse -Force

$manifest = Get-Content $template -Raw -Encoding UTF8
$manifest = $manifest.Replace("__IDENTITY_NAME__", $IdentityName)
$manifest = $manifest.Replace("__PUBLISHER__", $Publisher)
$manifest = $manifest.Replace("__PUBLISHER_DISPLAY_NAME__", $PublisherDisplayName)
$manifest = $manifest.Replace("__VERSION__", $Version)
Set-Content -Path (Join-Path $packageRoot "AppxManifest.xml") -Value $manifest -Encoding UTF8

Write-Host "==> makeappx"
$makeAppx = Resolve-WindowsSdkTool "makeappx.exe"
if (-not $makeAppx) {
    throw "makeappx.exe was not found. Install the Windows 10/11 SDK."
}

New-Item $OutputRoot -ItemType Directory -Force | Out-Null
& $makeAppx pack /d $packageRoot /p $packagePath /o
Assert-LastExitCode "makeappx pack"

if ($SignForStore) {
    Write-Host "==> sign with local Store upload certificate"
    $signTool = Resolve-WindowsSdkTool "signtool.exe"
    if (-not $signTool) {
        throw "signtool.exe was not found. Install the Windows 10/11 SDK."
    }

    $codeSigningOid = "1.3.6.1.5.5.7.3.3"
    $cert = Get-ChildItem Cert:\CurrentUser\My |
        Where-Object {
            $_.Subject -eq $Publisher -and
            $_.HasPrivateKey -and
            ($_.EnhancedKeyUsageList | Where-Object { $_.ObjectId.Value -eq $codeSigningOid })
        } |
        Sort-Object NotAfter -Descending |
        Select-Object -First 1

    if (-not $cert) {
        $cert = New-SelfSignedCertificate `
            -Type Custom `
            -Subject $Publisher `
            -FriendlyName "Agent Browser Gateway MSIX Store Upload Signing" `
            -CertStoreLocation "Cert:\CurrentUser\My" `
            -KeyUsage DigitalSignature `
            -TextExtension @("2.5.29.37={text}1.3.6.1.5.5.7.3.3")
    }

    & $signTool sign /fd SHA256 /sha1 $cert.Thumbprint $packagePath
    Assert-LastExitCode "signtool sign"
}

Write-Host "MSIX created: $packagePath"
Write-Host "Use Partner Center package identity values for -IdentityName and -Publisher before final upload."
