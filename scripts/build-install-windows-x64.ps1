param(
    [string]$Version = "0.3.6",
    [string]$InstallDir = "C:\Tools\AgentBrowserGateway",
    [switch]$SkipTests,
    [switch]$NoPathUpdate,
    [switch]$NoStart
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$FinalZip = Join-Path $Root "dist\agent-browser-gateway-$Version-windows-x64.zip"
$ExtractDir = Join-Path $Root "dist\agent-browser-gateway-$Version-windows-x64-install"

function Resolve-Dotnet {
    $Command = Get-Command dotnet -ErrorAction SilentlyContinue
    if ($Command) {
        return $Command.Source
    }

    $Candidates = @(
        (Join-Path $env:ProgramFiles "dotnet\dotnet.exe"),
        (Join-Path ${env:ProgramFiles(x86)} "dotnet\dotnet.exe")
    )
    foreach ($Candidate in $Candidates) {
        if ($Candidate -and (Test-Path $Candidate)) {
            $DotnetDir = Split-Path -Parent $Candidate
            if (($env:Path -split ';') -notcontains $DotnetDir) {
                $env:Path = "$DotnetDir;$env:Path"
            }
            return $Candidate
        }
    }

    return $null
}

function Ensure-Dotnet8 {
    $Dotnet = Resolve-Dotnet
    if ($Dotnet) {
        return $Dotnet
    }

    $Winget = Get-Command winget -ErrorAction SilentlyContinue
    if (-not $Winget) {
        throw "dotnet was not found and winget is unavailable. Install .NET 8 SDK from https://dotnet.microsoft.com/download/dotnet/8.0 and re-run this script."
    }

    Write-Host "dotnet was not found. Installing .NET 8 SDK with winget..."
    winget install --id Microsoft.DotNet.SDK.8 --source winget --accept-package-agreements --accept-source-agreements --silent

    $Dotnet = Resolve-Dotnet
    if (-not $Dotnet) {
        throw "Installed .NET 8 SDK, but dotnet.exe was still not found. Open a new PowerShell window and re-run .\windows-build-install.cmd -SkipTests."
    }
    return $Dotnet
}

Write-Host "==> check dotnet"
$Dotnet = Ensure-Dotnet8
& $Dotnet --version

Write-Host "==> restore"
& $Dotnet restore (Join-Path $Root "windows\AgentBrowserGateway.Windows.sln")

if (-not $SkipTests) {
    Write-Host "==> test"
    & $Dotnet test (Join-Path $Root "windows\AgentBrowserGateway.Tests\AgentBrowserGateway.Tests.csproj") -c Release
} else {
    Write-Host "==> skip tests"
}

Write-Host "==> package"
& (Join-Path $Root "scripts\dist-windows-x64.ps1") -Version $Version

Write-Host "==> extract install payload"
Remove-Item -Recurse -Force $ExtractDir -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $ExtractDir | Out-Null
Expand-Archive -Path $FinalZip -DestinationPath $ExtractDir -Force

Write-Host "==> install"
$InstallArgs = @{ InstallDir = $InstallDir }
if ($NoPathUpdate) { $InstallArgs["NoPathUpdate"] = $true }
if ($NoStart) { $InstallArgs["NoStart"] = $true }
& (Join-Path $ExtractDir "Install-AgentBrowserGateway.ps1") @InstallArgs

Write-Host "==> done"
Write-Host "Installed to: $InstallDir"
Write-Host "Open a new PowerShell window, then run:"
Write-Host "  abg status"
