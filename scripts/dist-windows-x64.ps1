param(
    [string]$Version = "0.3.12",
    [string]$Configuration = "Release",
    [switch]$SkipWinUiApp,
    [string]$PagesOutputDir = ""
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$Dist = Join-Path $Root "dist"
$PublishRoot = Join-Path $Dist "windows-publish"
$Stage = Join-Path $Dist "agent-browser-gateway-$Version-windows-x64"
$ZipPath = Join-Path $Dist "agent-browser-gateway-$Version-windows-x64.zip"
$SetupStage = Join-Path $Dist "agent-browser-gateway-$Version-windows-x64-setup"
$SetupZipPath = Join-Path $Dist "agent-browser-gateway-$Version-windows-x64-setup.zip"

function Assert-LastExitCode {
    param([string]$Step)
    if ($LASTEXITCODE -ne 0) {
        throw "$Step failed with exit code $LASTEXITCODE"
    }
}

Write-Host "==> clean"
Remove-Item -Recurse -Force $PublishRoot, $Stage, $ZipPath, $SetupStage, $SetupZipPath -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force $PublishRoot, $Stage, $SetupStage | Out-Null

if (-not $SkipWinUiApp) {
    Write-Host "==> publish WinUI app"
    dotnet publish (Join-Path $Root "windows\AgentBrowserGateway.Windows\AgentBrowserGateway.Windows.csproj") `
        -c $Configuration `
        -r win-x64 `
        --self-contained true `
        -p:Platform=x64 `
        -p:WindowsAppSDKSelfContained=true `
        -o (Join-Path $PublishRoot "app")
    Assert-LastExitCode "dotnet publish WinUI app"
} else {
    Write-Host "==> skip WinUI app"
}

Write-Host "==> publish CLI"
dotnet publish (Join-Path $Root "windows\AgentBrowserGateway.Cli\AgentBrowserGateway.Cli.csproj") `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -o (Join-Path $PublishRoot "cli")
Assert-LastExitCode "dotnet publish CLI"

Write-Host "==> publish headless Gateway"
dotnet publish (Join-Path $Root "windows\AgentBrowserGateway.Gateway\AgentBrowserGateway.Gateway.csproj") `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -p:PublishSingleFile=true `
    -p:EnableCompressionInSingleFile=true `
    -o (Join-Path $PublishRoot "gateway")
Assert-LastExitCode "dotnet publish headless Gateway"

Write-Host "==> publish GUI installer"
dotnet publish (Join-Path $Root "windows\AgentBrowserGateway.Installer\AgentBrowserGateway.Installer.csproj") `
    -c $Configuration `
    -r win-x64 `
    --self-contained true `
    -p:Platform=x64 `
    -p:WindowsAppSDKSelfContained=true `
    -o (Join-Path $PublishRoot "installer")
Assert-LastExitCode "dotnet publish GUI installer"

Write-Host "==> stage"
if (Test-Path (Join-Path $PublishRoot "app")) {
    Copy-Item -Recurse -Force (Join-Path $PublishRoot "app\*") $Stage
}
Copy-Item -Force (Join-Path $PublishRoot "cli\abg.exe") (Join-Path $Stage "abg.exe")
Get-ChildItem -Path (Join-Path $PublishRoot "gateway") -File |
    Where-Object { $_.Extension -ne ".pdb" } |
    Copy-Item -Destination $Stage -Force
Copy-Item -Force (Join-Path $Root "windows\README-WINDOWS.md") (Join-Path $Stage "README-WINDOWS.md")
Copy-Item -Force (Join-Path $Root "windows\Install-AgentBrowserGateway.ps1") (Join-Path $Stage "Install-AgentBrowserGateway.ps1")
Set-Content -Path (Join-Path $Stage "VERSION") -Value $Version -NoNewline

Write-Host "==> stage GUI setup"
Get-ChildItem -Path (Join-Path $PublishRoot "installer") -File |
    Where-Object { $_.Extension -ne ".pdb" } |
    Copy-Item -Destination $SetupStage -Force
New-Item -ItemType Directory -Force (Join-Path $SetupStage "payload") | Out-Null
Copy-Item -Recurse -Force (Join-Path $Stage "*") (Join-Path $SetupStage "payload")

Write-Host "==> zip"
Compress-Archive -Path (Join-Path $Stage "*") -DestinationPath $ZipPath -Force
Compress-Archive -Path (Join-Path $SetupStage "*") -DestinationPath $SetupZipPath -Force

$Hash = Get-FileHash -Algorithm SHA256 $ZipPath
$SetupHash = Get-FileHash -Algorithm SHA256 $SetupZipPath
if (-not [string]::IsNullOrWhiteSpace($PagesOutputDir)) {
    $ResolvedPagesOutputDir = $PagesOutputDir
    if (-not [System.IO.Path]::IsPathRooted($ResolvedPagesOutputDir)) {
        $ResolvedPagesOutputDir = Join-Path $Root $ResolvedPagesOutputDir
    }

    $ZipName = Split-Path -Leaf $ZipPath
    New-Item -ItemType Directory -Force $ResolvedPagesOutputDir | Out-Null
    Copy-Item -Force $ZipPath (Join-Path $ResolvedPagesOutputDir $ZipName)
    Set-Content -Path (Join-Path $ResolvedPagesOutputDir "$ZipName.sha256.txt") `
        -Value "$($Hash.Hash.ToLowerInvariant())  $ZipName"
}
Write-Host "==> done"
Write-Host "zip:    $ZipPath"
Write-Host "sha256: $($Hash.Hash.ToLowerInvariant())"
Write-Host "setup:  $SetupZipPath"
Write-Host "sha256: $($SetupHash.Hash.ToLowerInvariant())"
