param(
    [string]$InstallDir = "C:\Tools\AgentBrowserGateway",
    [switch]$NoPathUpdate,
    [switch]$NoStart,
    [switch]$StartUi
)

$ErrorActionPreference = "Stop"

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = [Environment]::ExpandEnvironmentVariables($InstallDir)

Write-Host "Installing Agent Browser Gateway for Windows..."
Write-Host "Source: $SourceDir"
Write-Host "Target: $InstallDir"

function Get-GatewayProcesses {
    $Names = @("agent-browser-gateway", "AgentBrowserGateway.Windows")
    $Processes = @()
    foreach ($Name in $Names) {
        $Processes += @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
    }
    return @($Processes | Sort-Object Id -Unique)
}

function Test-GatewayPortOpen {
    $Client = New-Object System.Net.Sockets.TcpClient
    try {
        $Connect = $Client.BeginConnect("127.0.0.1", 8765, $null, $null)
        if (-not $Connect.AsyncWaitHandle.WaitOne(150)) {
            return $false
        }
        $Client.EndConnect($Connect)
        return $true
    } catch {
        return $false
    } finally {
        $Client.Close()
    }
}

function Stop-ExistingGateway {
    $Processes = @(Get-GatewayProcesses)
    if ($Processes.Count -eq 0) {
        return
    }

    Write-Host "Stopping existing Gateway..."
    foreach ($Process in $Processes) {
        Stop-Process -InputObject $Process -Force -ErrorAction SilentlyContinue
    }

    $Deadline = (Get-Date).AddSeconds(10)
    do {
        Start-Sleep -Milliseconds 250
        $Remaining = @(Get-GatewayProcesses)
    } while ($Remaining.Count -gt 0 -and (Get-Date) -lt $Deadline)

    if ($Remaining.Count -gt 0) {
        $Ids = ($Remaining | ForEach-Object { $_.Id }) -join ", "
        throw "Could not stop the existing Agent Browser Gateway process(es): $Ids"
    }
}

function Wait-GatewayPortFree {
    $Deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $Deadline) {
        if (-not (Test-GatewayPortOpen)) {
            return
        }
        Start-Sleep -Milliseconds 250
    }
    throw "Port 127.0.0.1:8765 is still in use. Stop the existing Gateway from the tray menu or Task Manager, then run the installer again."
}

function Wait-GatewayReady {
    param([string]$AbgPath)

    $Deadline = (Get-Date).AddSeconds(10)
    while ((Get-Date) -lt $Deadline) {
        & $AbgPath status *> $null
        if ($LASTEXITCODE -eq 0) {
            return
        }
        Start-Sleep -Milliseconds 500
    }
    throw "Gateway was installed, but did not become ready within 10 seconds. Try running: agent-browser-gateway.exe"
}

Stop-ExistingGateway
Wait-GatewayPortFree

if ((Test-Path $InstallDir) -and ((Resolve-Path $InstallDir).Path -ne (Resolve-Path $SourceDir).Path)) {
    Write-Host "Replacing installed files..."
    Remove-Item -Recurse -Force $InstallDir
}
New-Item -ItemType Directory -Force $InstallDir | Out-Null

if ((Resolve-Path $InstallDir).Path -ne (Resolve-Path $SourceDir).Path) {
    Write-Host "Copying new files..."
    Copy-Item -Recurse -Force (Join-Path $SourceDir "*") $InstallDir
}

if (-not $NoPathUpdate) {
    $CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    $Parts = @()
    if (-not [string]::IsNullOrWhiteSpace($CurrentPath)) {
        $Parts = $CurrentPath -split ';' | Where-Object { -not [string]::IsNullOrWhiteSpace($_) }
    }
    if ($Parts -notcontains $InstallDir) {
        $NewPath = (($Parts + $InstallDir) -join ';')
        [Environment]::SetEnvironmentVariable("Path", $NewPath, "User")
        Write-Host "Added to user PATH: $InstallDir"
        Write-Host "Open a new PowerShell window for PATH changes to take effect."
    } else {
        Write-Host "PATH already contains: $InstallDir"
    }
}

$Abg = Join-Path $InstallDir "abg.exe"
if (Test-Path $Abg) {
    Write-Host "Updating Claude/Codex skills..."
    & $Abg install-skill --target both
} else {
    Write-Warning "abg.exe was not found at $Abg; skipped skill update."
}

if (-not $NoStart) {
    $Gateway = Join-Path $InstallDir "agent-browser-gateway.exe"
    if (Test-Path $Gateway) {
        Start-Process -FilePath $Gateway
        if (Test-Path $Abg) {
            Wait-GatewayReady -AbgPath $Abg
        }
        Write-Host "Started Gateway: $Gateway"
    } else {
        Write-Warning "Gateway executable was not found at $Gateway"
    }

    if ($StartUi) {
        $App = Join-Path $InstallDir "AgentBrowserGateway.Windows.exe"
        if (Test-Path $App) {
            Start-Process $App
        } else {
            Write-Warning "Gateway UI was not found at $App"
        }
    }
}

Write-Host "Installed successfully."
Write-Host "Run: abg status"
