param(
    [string]$InstallDir = "C:\Tools\AgentBrowserGateway",
    [switch]$NoPathUpdate,
    [switch]$NoStart,
    [switch]$StartUi
)

$ErrorActionPreference = "Stop"

$SourceDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$InstallDir = [Environment]::ExpandEnvironmentVariables($InstallDir)
$GatewayPort = 8765
$ProductName = "Agent Browser Gateway"
$Publisher = "ArcManagement"
$UninstallKeyPath = "HKCU:\Software\Microsoft\Windows\CurrentVersion\Uninstall\AgentBrowserGateway"
if (-not [string]::IsNullOrWhiteSpace($env:ABG_PORT)) {
    $ParsedPort = 0
    if ([int]::TryParse($env:ABG_PORT, [ref]$ParsedPort) -and $ParsedPort -ge 1 -and $ParsedPort -le 65535) {
        $GatewayPort = $ParsedPort
    }
}

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
        $Connect = $Client.BeginConnect("127.0.0.1", $GatewayPort, $null, $null)
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
    throw "Port 127.0.0.1:$GatewayPort is still in use. Stop the existing Gateway from the tray menu or Task Manager, then run the installer again."
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

function Send-EnvironmentChangeNotification {
    Add-Type -Namespace Win32 -Name NativeMethods -MemberDefinition @"
[System.Runtime.InteropServices.DllImport("user32.dll", SetLastError=true, CharSet=System.Runtime.InteropServices.CharSet.Auto)]
public static extern System.IntPtr SendMessageTimeout(
    System.IntPtr hWnd,
    uint Msg,
    System.IntPtr wParam,
    string lParam,
    uint fuFlags,
    uint uTimeout,
    out System.IntPtr lpdwResult);
"@ -ErrorAction SilentlyContinue

    $HwndBroadcast = [System.IntPtr]0xffff
    $WmSettingChange = 0x001a
    $SmtoAbortIfHung = 0x0002
    $Result = [System.IntPtr]::Zero
    [void][Win32.NativeMethods]::SendMessageTimeout($HwndBroadcast, $WmSettingChange, [System.IntPtr]::Zero, "Environment", $SmtoAbortIfHung, 5000, [ref]$Result)
}

function Quote-CommandArgument {
    param([Parameter(Mandatory = $true)][string]$Value)
    return '"' + ($Value -replace '"', '\"') + '"'
}

function Register-UninstallEntry {
    $UninstallScript = Join-Path $InstallDir "Uninstall-AgentBrowserGateway.ps1"
    $PowerShell = Join-Path $PSHOME "powershell.exe"
    if (-not (Test-Path $PowerShell)) {
        $PowerShell = "powershell.exe"
    }

    $QuotedPowerShell = Quote-CommandArgument $PowerShell
    $QuotedScript = Quote-CommandArgument $UninstallScript
    $QuotedInstallDir = Quote-CommandArgument $InstallDir
    $UninstallCommand = "$QuotedPowerShell -NoProfile -ExecutionPolicy Bypass -File $QuotedScript -InstallDir $QuotedInstallDir"
    $QuietUninstallCommand = "$UninstallCommand -Silent"
    $VersionPath = Join-Path $InstallDir "VERSION"
    $DisplayVersion = "0.4.5"
    if (Test-Path $VersionPath) {
        $DisplayVersion = (Get-Content -Path $VersionPath -Raw).Trim()
    }

    New-Item -Path $UninstallKeyPath -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "DisplayName" -Value $ProductName -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "DisplayVersion" -Value $DisplayVersion -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "Publisher" -Value $Publisher -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "InstallLocation" -Value $InstallDir -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "DisplayIcon" -Value (Join-Path $InstallDir "AgentBrowserGateway.Windows.exe") -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "URLInfoAbout" -Value "https://github.com/arcmanagement/agent-browser-gateway" -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "UninstallString" -Value $UninstallCommand -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "QuietUninstallString" -Value $QuietUninstallCommand -PropertyType String -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "NoModify" -Value 1 -PropertyType DWord -Force | Out-Null
    New-ItemProperty -Path $UninstallKeyPath -Name "NoRepair" -Value 1 -PropertyType DWord -Force | Out-Null
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
        Send-EnvironmentChangeNotification
        Write-Host "Added to user PATH: $InstallDir"
        Write-Host "Open a new PowerShell window for PATH changes to take effect."
    } else {
        Write-Host "PATH already contains: $InstallDir"
    }
}

Register-UninstallEntry

Write-Host "Install agent skills with: npx skills add arcmanagement/agent-browser-gateway -g"

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
