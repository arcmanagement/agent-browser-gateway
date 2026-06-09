param(
    [string]$InstallDir = "C:\Tools\AgentBrowserGateway",
    [switch]$NoPathUpdate,
    [switch]$Silent
)

$ErrorActionPreference = "Stop"

$InstallDir = [Environment]::ExpandEnvironmentVariables($InstallDir)
$UninstallKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentBrowserGateway"
$StartupKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run"
$StartupValueName = "Agent Browser Gateway"

function Get-GatewayProcesses {
    $Names = @("agent-browser-gateway", "AgentBrowserGateway.Windows")
    $Processes = @()
    foreach ($Name in $Names) {
        $Processes += @(Get-Process -Name $Name -ErrorAction SilentlyContinue)
    }
    return @($Processes | Where-Object { $_.Id -ne $PID } | Sort-Object Id -Unique)
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

function Remove-UserPath {
    $CurrentPath = [Environment]::GetEnvironmentVariable("Path", "User")
    if ([string]::IsNullOrWhiteSpace($CurrentPath)) {
        return
    }

    $NormalizedInstallDir = [IO.Path]::GetFullPath($InstallDir).TrimEnd('\')
    $Parts = @(
        $CurrentPath -split ';' |
            Where-Object { -not [string]::IsNullOrWhiteSpace($_) } |
            Where-Object {
                try {
                    [IO.Path]::GetFullPath([Environment]::ExpandEnvironmentVariables($_)).TrimEnd('\') -ne $NormalizedInstallDir
                } catch {
                    $true
                }
            }
    )
    [Environment]::SetEnvironmentVariable("Path", ($Parts -join ';'), "User")
}

function Remove-RegistryEntries {
    Remove-Item -Path $UninstallKeyPath -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $StartupKeyPath) {
        Remove-ItemProperty -Path $StartupKeyPath -Name $StartupValueName -ErrorAction SilentlyContinue
    }
}

if (-not $Silent) {
    Write-Host "Uninstalling Agent Browser Gateway..."
    Write-Host "Target: $InstallDir"
}

Stop-ExistingGateway
Remove-RegistryEntries
if (-not $NoPathUpdate) {
    Remove-UserPath
}

if (Test-Path $InstallDir) {
    Remove-Item -Recurse -Force $InstallDir
}

if (-not $Silent) {
    Write-Host "Uninstalled successfully."
}
