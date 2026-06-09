param(
    [string]$Version = "0.4.1",
    [string]$Configuration = "Release",
    [switch]$SkipWinUiApp,
    [string]$PagesOutputDir = "",
    [string]$CodeSignPfxPath = "",
    [string]$CodeSignPfxPassword = "",
    [string]$TimestampUrl = "http://timestamp.digicert.com",
    [switch]$RequireCodeSign
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

function Resolve-SignTool {
    $Command = Get-Command signtool.exe -ErrorAction SilentlyContinue
    if ($Command) {
        return $Command.Source
    }

    $KitRoot = "${env:ProgramFiles(x86)}\Windows Kits\10\bin"
    if (Test-Path $KitRoot) {
        $Candidate = Get-ChildItem -Path $KitRoot -Recurse -Filter signtool.exe -ErrorAction SilentlyContinue |
            Where-Object { $_.FullName -match '\\x64\\signtool\.exe$' } |
            Sort-Object FullName -Descending |
            Select-Object -First 1
        if ($Candidate) {
            return $Candidate.FullName
        }
    }

    return $null
}

function Invoke-CodeSign {
    param([string[]]$Paths)

    if ([string]::IsNullOrWhiteSpace($CodeSignPfxPath)) {
        if ($RequireCodeSign) {
            throw "Code signing is required, but CodeSignPfxPath was not provided."
        }
        Write-Host "==> skip code signing (no certificate configured)"
        return
    }

    $ResolvedPfx = Resolve-Path $CodeSignPfxPath -ErrorAction SilentlyContinue
    if (-not $ResolvedPfx) {
        throw "Code signing certificate was not found: $CodeSignPfxPath"
    }

    $SignTool = Resolve-SignTool
    if (-not $SignTool) {
        throw "signtool.exe was not found. Install the Windows SDK on the build machine."
    }

    $Files = $Paths |
        Where-Object { Test-Path $_ } |
        ForEach-Object { Get-ChildItem -Path $_ -Recurse -File } |
        Where-Object {
            $_.Name -in @("abg.exe", "agent-browser-gateway.exe", "AgentBrowserGatewaySetup.exe", "AgentBrowserGateway.Windows.exe") -or
            $_.Name -like "AgentBrowserGateway.*.dll"
        } |
        Sort-Object FullName -Unique

    if (-not $Files) {
        throw "No Windows binaries were found to sign."
    }

    foreach ($File in $Files) {
        Write-Host "sign: $($File.FullName)"
        & $SignTool sign /fd SHA256 /td SHA256 /tr $TimestampUrl /f $ResolvedPfx.Path /p $CodeSignPfxPassword $File.FullName
        Assert-LastExitCode "signtool sign $($File.Name)"
    }
}

function Test-ZipTopLevelLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string]$TopLevelDirectory,
        [Parameter(Mandatory = $true)]
        [string[]]$RequiredEntries
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $Archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $Entries = @($Archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        if (-not ($Entries | Where-Object { $_.StartsWith("$TopLevelDirectory/") } | Select-Object -First 1)) {
            throw "Expected entries under top-level directory $TopLevelDirectory/ in $Path"
        }

        foreach ($Entry in $RequiredEntries) {
            if ($Entries -notcontains $Entry) {
                throw "Expected $Entry in $Path"
            }
        }

        $RootNames = @(
            $Entries |
                Where-Object { $_ -ne "" } |
                ForEach-Object {
                    if ($_.Contains("/")) { $_.Split("/")[0] } else { $_ }
                } |
                Sort-Object -Unique
        )
        if ($RootNames.Count -ne 1 -or $RootNames[0] -ne $TopLevelDirectory) {
            throw "ZIP must contain exactly one top-level directory '$TopLevelDirectory'. Found: $($RootNames -join ', ')"
        }
    } finally {
        $Archive.Dispose()
    }
}

function Test-ZipRootLayout {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path,
        [Parameter(Mandatory = $true)]
        [string[]]$RequiredRootEntries
    )

    Add-Type -AssemblyName System.IO.Compression.FileSystem

    $Archive = [System.IO.Compression.ZipFile]::OpenRead($Path)
    try {
        $Entries = @($Archive.Entries | ForEach-Object { $_.FullName.Replace("\", "/") })
        foreach ($Entry in $RequiredRootEntries) {
            if ($Entries -notcontains $Entry) {
                throw "Expected $Entry at the ZIP root in $Path"
            }
        }
    } finally {
        $Archive.Dispose()
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
Copy-Item -Force (Join-Path $Root "windows\Uninstall-AgentBrowserGateway.ps1") (Join-Path $Stage "Uninstall-AgentBrowserGateway.ps1")
Set-Content -Path (Join-Path $Stage "VERSION") -Value $Version -NoNewline

Write-Host "==> stage GUI setup"
Get-ChildItem -Path (Join-Path $PublishRoot "installer") -File |
    Where-Object { $_.Extension -ne ".pdb" } |
    Copy-Item -Destination $SetupStage -Force
New-Item -ItemType Directory -Force (Join-Path $SetupStage "payload") | Out-Null
Copy-Item -Recurse -Force (Join-Path $Stage "*") (Join-Path $SetupStage "payload")

Write-Host "==> sign"
Invoke-CodeSign -Paths @($Stage, $SetupStage)

Write-Host "==> zip"
Compress-Archive -Path $Stage -DestinationPath $ZipPath -Force
Compress-Archive -Path (Join-Path $SetupStage "*") -DestinationPath $SetupZipPath -Force
Test-ZipTopLevelLayout -Path $ZipPath -TopLevelDirectory (Split-Path -Leaf $Stage) -RequiredEntries @(
    "$(Split-Path -Leaf $Stage)/Install-AgentBrowserGateway.ps1",
    "$(Split-Path -Leaf $Stage)/Uninstall-AgentBrowserGateway.ps1",
    "$(Split-Path -Leaf $Stage)/README-WINDOWS.md",
    "$(Split-Path -Leaf $Stage)/VERSION",
    "$(Split-Path -Leaf $Stage)/abg.exe",
    "$(Split-Path -Leaf $Stage)/agent-browser-gateway.exe"
)
Test-ZipRootLayout -Path $SetupZipPath -RequiredRootEntries @(
    "AgentBrowserGatewaySetup.exe",
    "payload/Install-AgentBrowserGateway.ps1",
    "payload/Uninstall-AgentBrowserGateway.ps1",
    "payload/abg.exe",
    "payload/agent-browser-gateway.exe"
)

$Hash = Get-FileHash -Algorithm SHA256 $ZipPath
$SetupHash = Get-FileHash -Algorithm SHA256 $SetupZipPath
Set-Content -Path "$ZipPath.sha256.txt" -Value "$($Hash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $ZipPath)"
Set-Content -Path "$SetupZipPath.sha256.txt" -Value "$($SetupHash.Hash.ToLowerInvariant())  $(Split-Path -Leaf $SetupZipPath)"
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
