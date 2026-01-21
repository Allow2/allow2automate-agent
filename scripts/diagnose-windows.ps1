#Requires -Version 5.1
<#
.SYNOPSIS
    Allow2 Automate Agent - Windows Diagnostic Script

.DESCRIPTION
    This script checks the status of all Allow2 Automate Agent components on Windows:
    - Windows Service status
    - Running processes
    - Configuration file
    - Log files
    - Network connectivity
    - System requirements

.EXAMPLE
    .\diagnose-windows.ps1

.EXAMPLE
    .\diagnose-windows.ps1 -Verbose

.NOTES
    Run as Administrator for full diagnostics
#>

[CmdletBinding()]
param(
    [switch]$ShowFullLogs,
    [int]$LogLines = 50
)

# Colors and formatting
$ErrorColor = "Red"
$WarningColor = "Yellow"
$SuccessColor = "Green"
$InfoColor = "Cyan"
$HeaderColor = "Magenta"

function Write-Header {
    param([string]$Text)
    Write-Host ""
    Write-Host ("=" * 60) -ForegroundColor $HeaderColor
    Write-Host "  $Text" -ForegroundColor $HeaderColor
    Write-Host ("=" * 60) -ForegroundColor $HeaderColor
}

function Write-Status {
    param(
        [string]$Label,
        [string]$Value,
        [string]$Status = "Info"  # Success, Warning, Error, Info
    )

    $color = switch ($Status) {
        "Success" { $SuccessColor }
        "Warning" { $WarningColor }
        "Error"   { $ErrorColor }
        default   { $InfoColor }
    }

    $icon = switch ($Status) {
        "Success" { "[OK]" }
        "Warning" { "[!]" }
        "Error"   { "[X]" }
        default   { "[i]" }
    }

    Write-Host "  $icon " -ForegroundColor $color -NoNewline
    Write-Host "$Label`: " -NoNewline
    Write-Host $Value -ForegroundColor $color
}

function Write-SubItem {
    param([string]$Text, [string]$Color = "Gray")
    Write-Host "      $Text" -ForegroundColor $Color
}

# Configuration paths
$ServiceName = "Allow2AutomateAgent"
$InstallDir = "C:\Program Files\Allow2"
$DataDir = "C:\ProgramData\Allow2\agent"
$ConfigFile = "$DataDir\config.json"
$LogDir = "$DataDir\logs"
$MainLog = "$LogDir\agent.log"
$ErrorLog = "$LogDir\error.log"
$AgentExe = "$InstallDir\allow2automate-agent.exe"
$HelperExe = "$InstallDir\agent\helper\allow2automate-agent-helper.exe"

# Track issues
$issues = @()

Write-Host ""
Write-Host "Allow2 Automate Agent - Windows Diagnostics" -ForegroundColor $HeaderColor
Write-Host "============================================" -ForegroundColor $HeaderColor
Write-Host "Timestamp: $(Get-Date -Format 'yyyy-MM-dd HH:mm:ss')"
Write-Host "Computer:  $env:COMPUTERNAME"
Write-Host "User:      $env:USERNAME"

# Check if running as admin
$isAdmin = ([Security.Principal.WindowsPrincipal] [Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
if (-not $isAdmin) {
    Write-Host ""
    Write-Host "WARNING: Not running as Administrator. Some checks may be limited." -ForegroundColor $WarningColor
    Write-Host "Run PowerShell as Administrator for full diagnostics." -ForegroundColor $WarningColor
}

# ============================================================================
# 1. SERVICE STATUS
# ============================================================================
Write-Header "1. Windows Service Status"

$service = Get-Service -Name $ServiceName -ErrorAction SilentlyContinue

if ($service) {
    $statusColor = switch ($service.Status) {
        "Running" { "Success" }
        "Stopped" { "Error" }
        default   { "Warning" }
    }
    Write-Status "Service Name" $ServiceName "Info"
    Write-Status "Status" $service.Status $statusColor
    Write-Status "Start Type" $service.StartType "Info"

    if ($service.Status -ne "Running") {
        $issues += "Service is not running"
    }

    # Get service details via WMI
    $wmiService = Get-WmiObject -Class Win32_Service -Filter "Name='$ServiceName'" -ErrorAction SilentlyContinue
    if ($wmiService) {
        Write-Status "Path" $wmiService.PathName "Info"
        Write-Status "Process ID" $(if ($wmiService.ProcessId -gt 0) { $wmiService.ProcessId } else { "N/A" }) "Info"
    }
} else {
    Write-Status "Service" "NOT INSTALLED" "Error"
    $issues += "Service is not installed"
}

# ============================================================================
# 2. PROCESS STATUS
# ============================================================================
Write-Header "2. Running Processes"

$agentProcess = Get-Process -Name "allow2automate-agent" -ErrorAction SilentlyContinue
$helperProcess = Get-Process -Name "allow2automate-agent-helper" -ErrorAction SilentlyContinue

if ($agentProcess) {
    foreach ($proc in $agentProcess) {
        Write-Status "Agent Process" "Running (PID: $($proc.Id))" "Success"
        Write-SubItem "CPU Time: $($proc.CPU)"
        Write-SubItem "Memory: $([math]::Round($proc.WorkingSet64 / 1MB, 2)) MB"
        Write-SubItem "Start Time: $($proc.StartTime)"
    }
} else {
    Write-Status "Agent Process" "Not running" "Error"
    $issues += "Agent process is not running"
}

if ($helperProcess) {
    foreach ($proc in $helperProcess) {
        Write-Status "Helper Process" "Running (PID: $($proc.Id))" "Success"
    }
} else {
    Write-Status "Helper Process" "Not running" "Warning"
}

# ============================================================================
# 3. INSTALLATION CHECK
# ============================================================================
Write-Header "3. Installation"

if (Test-Path $InstallDir) {
    Write-Status "Install Directory" $InstallDir "Success"

    if (Test-Path $AgentExe) {
        $fileInfo = Get-Item $AgentExe
        Write-Status "Agent Binary" "Found" "Success"
        Write-SubItem "Size: $([math]::Round($fileInfo.Length / 1MB, 2)) MB"
        Write-SubItem "Modified: $($fileInfo.LastWriteTime)"

        # Try to get version
        try {
            $version = (Get-Item $AgentExe).VersionInfo.FileVersion
            if ($version) {
                Write-SubItem "Version: $version"
            }
        } catch {}
    } else {
        Write-Status "Agent Binary" "NOT FOUND at $AgentExe" "Error"
        $issues += "Agent binary not found"
    }

    if (Test-Path $HelperExe) {
        Write-Status "Helper Binary" "Found" "Success"
    } else {
        Write-Status "Helper Binary" "Not installed (optional)" "Info"
    }
} else {
    Write-Status "Install Directory" "NOT FOUND" "Error"
    $issues += "Installation directory not found"
}

# ============================================================================
# 4. CONFIGURATION
# ============================================================================
Write-Header "4. Configuration"

if (Test-Path $DataDir) {
    Write-Status "Data Directory" $DataDir "Success"
} else {
    Write-Status "Data Directory" "NOT FOUND" "Error"
    $issues += "Data directory not found"
}

if (Test-Path $ConfigFile) {
    Write-Status "Config File" "Found" "Success"

    try {
        $config = Get-Content $ConfigFile -Raw | ConvertFrom-Json

        # Check required fields
        if ($config.agentId) {
            Write-SubItem "Agent ID: $($config.agentId)" "Green"
        } else {
            Write-SubItem "Agent ID: NOT SET" "Red"
            $issues += "Agent ID not configured"
        }

        if ($config.authToken) {
            Write-SubItem "Auth Token: [CONFIGURED]" "Green"
        } else {
            Write-SubItem "Auth Token: NOT SET" "Red"
            $issues += "Auth token not configured"
        }

        if ($config.parentApiUrl) {
            Write-SubItem "Parent URL: $($config.parentApiUrl)" "Green"
        } else {
            Write-SubItem "Parent URL: NOT SET" "Yellow"
        }

        # Optional fields
        Write-SubItem "Check Interval: $($config.checkInterval)ms"
        Write-SubItem "Log Level: $($config.logLevel)"
        Write-SubItem "mDNS Enabled: $($config.enableMDNS)"
        Write-SubItem "Auto Update: $($config.autoUpdate)"

    } catch {
        Write-Status "Config Parse" "INVALID JSON" "Error"
        $issues += "Configuration file is not valid JSON"
    }
} else {
    Write-Status "Config File" "NOT FOUND at $ConfigFile" "Error"
    $issues += "Configuration file not found"
}

# ============================================================================
# 5. LOG FILES
# ============================================================================
Write-Header "5. Log Files"

if (Test-Path $LogDir) {
    Write-Status "Log Directory" $LogDir "Success"

    $logFiles = Get-ChildItem $LogDir -Filter "*.log" -ErrorAction SilentlyContinue
    foreach ($log in $logFiles) {
        Write-SubItem "$($log.Name): $([math]::Round($log.Length / 1KB, 2)) KB (Modified: $($log.LastWriteTime))"
    }
} else {
    Write-Status "Log Directory" "NOT FOUND" "Warning"
}

# Show recent logs
if (Test-Path $MainLog) {
    Write-Host ""
    Write-Host "  Recent Agent Log Entries:" -ForegroundColor $InfoColor
    Write-Host "  " + ("-" * 50) -ForegroundColor Gray
    Get-Content $MainLog -Tail $LogLines | ForEach-Object {
        $line = $_
        $color = "Gray"
        if ($_ -match "error|fail|exception" ) { $color = "Red" }
        elseif ($_ -match "warn") { $color = "Yellow" }
        elseif ($_ -match "info") { $color = "White" }
        Write-Host "    $_" -ForegroundColor $color
    }
}

if (Test-Path $ErrorLog) {
    $errorContent = Get-Content $ErrorLog -Tail 20
    if ($errorContent) {
        Write-Host ""
        Write-Host "  Recent Error Log Entries:" -ForegroundColor $ErrorColor
        Write-Host "  " + ("-" * 50) -ForegroundColor Gray
        $errorContent | ForEach-Object {
            Write-Host "    $_" -ForegroundColor $ErrorColor
        }
    }
}

# ============================================================================
# 6. NETWORK
# ============================================================================
Write-Header "6. Network Status"

# Check if agent API is responding
$apiPort = 8443
if ($config -and $config.apiPort) {
    $apiPort = $config.apiPort
}

try {
    $tcpTest = Test-NetConnection -ComputerName localhost -Port $apiPort -WarningAction SilentlyContinue
    if ($tcpTest.TcpTestSucceeded) {
        Write-Status "Agent API Port ($apiPort)" "Listening" "Success"
    } else {
        Write-Status "Agent API Port ($apiPort)" "Not listening" "Warning"
    }
} catch {
    Write-Status "Agent API Port ($apiPort)" "Could not test" "Warning"
}

# Check parent connectivity if configured
if ($config -and $config.parentApiUrl) {
    try {
        $uri = [System.Uri]$config.parentApiUrl
        $parentTest = Test-NetConnection -ComputerName $uri.Host -Port $uri.Port -WarningAction SilentlyContinue
        if ($parentTest.TcpTestSucceeded) {
            Write-Status "Parent API" "Reachable ($($uri.Host):$($uri.Port))" "Success"
        } else {
            Write-Status "Parent API" "NOT reachable ($($uri.Host):$($uri.Port))" "Error"
            $issues += "Cannot reach parent API"
        }
    } catch {
        Write-Status "Parent API" "Invalid URL or test failed" "Warning"
    }
}

# Check mDNS port
try {
    $mdnsTest = Test-NetConnection -ComputerName localhost -Port 5353 -WarningAction SilentlyContinue
    Write-Status "mDNS Port (5353)" $(if ($mdnsTest.TcpTestSucceeded) { "Available" } else { "Not bound (may be normal)" }) "Info"
} catch {}

# ============================================================================
# 7. WINDOWS EVENT LOG
# ============================================================================
Write-Header "7. Windows Event Log"

try {
    $events = Get-EventLog -LogName Application -Source "Allow2*" -Newest 10 -ErrorAction SilentlyContinue
    if ($events) {
        foreach ($event in $events) {
            $color = switch ($event.EntryType) {
                "Error"       { "Red" }
                "Warning"     { "Yellow" }
                "Information" { "Gray" }
                default       { "White" }
            }
            Write-Host "    [$($event.TimeGenerated)] $($event.EntryType): $($event.Message.Substring(0, [Math]::Min(100, $event.Message.Length)))..." -ForegroundColor $color
        }
    } else {
        Write-Status "Event Log" "No Allow2 entries found" "Info"
    }
} catch {
    Write-Status "Event Log" "Could not read (requires elevation)" "Warning"
}

# Service Control Manager events
try {
    $scmEvents = Get-EventLog -LogName System -Source "Service Control Manager" -Newest 50 -ErrorAction SilentlyContinue |
                 Where-Object { $_.Message -like "*Allow2*" } |
                 Select-Object -First 5
    if ($scmEvents) {
        Write-Host ""
        Write-Host "  Service Control Manager Events:" -ForegroundColor $InfoColor
        foreach ($event in $scmEvents) {
            $color = switch ($event.EntryType) {
                "Error"   { "Red" }
                "Warning" { "Yellow" }
                default   { "Gray" }
            }
            Write-Host "    [$($event.TimeGenerated)] $($event.Message)" -ForegroundColor $color
        }
    }
} catch {}

# ============================================================================
# 8. SYSTEM REQUIREMENTS
# ============================================================================
Write-Header "8. System Requirements"

# OS Version
$os = Get-WmiObject -Class Win32_OperatingSystem
Write-Status "Windows Version" "$($os.Caption) ($($os.Version))" "Info"

# Architecture
Write-Status "Architecture" $env:PROCESSOR_ARCHITECTURE "Info"

# Memory
$totalMemGB = [math]::Round($os.TotalVisibleMemorySize / 1MB, 2)
$freeMemGB = [math]::Round($os.FreePhysicalMemory / 1MB, 2)
Write-Status "Memory" "$freeMemGB GB free of $totalMemGB GB" "Info"

# Disk space
$disk = Get-WmiObject -Class Win32_LogicalDisk -Filter "DeviceID='C:'"
$freeDiskGB = [math]::Round($disk.FreeSpace / 1GB, 2)
$color = if ($freeDiskGB -lt 1) { "Error" } elseif ($freeDiskGB -lt 5) { "Warning" } else { "Success" }
Write-Status "Disk Space (C:)" "$freeDiskGB GB free" $color

# ============================================================================
# SUMMARY
# ============================================================================
Write-Header "DIAGNOSTIC SUMMARY"

if ($issues.Count -eq 0) {
    Write-Host ""
    Write-Host "  All checks passed! The agent appears to be running correctly." -ForegroundColor $SuccessColor
    Write-Host ""
} else {
    Write-Host ""
    Write-Host "  Issues Found: $($issues.Count)" -ForegroundColor $ErrorColor
    Write-Host ""
    foreach ($issue in $issues) {
        Write-Host "    - $issue" -ForegroundColor $ErrorColor
    }
    Write-Host ""
    Write-Host "  Suggested Actions:" -ForegroundColor $WarningColor

    if ($issues -contains "Service is not installed") {
        Write-Host "    1. Install the agent using the installer from the parent app" -ForegroundColor $WarningColor
    }
    if ($issues -contains "Service is not running" -or $issues -contains "Agent process is not running") {
        Write-Host "    2. Start the service: sc start Allow2AutomateAgent" -ForegroundColor $WarningColor
    }
    if ($issues -contains "Configuration file not found") {
        Write-Host "    3. Download a new installer with config from the parent app" -ForegroundColor $WarningColor
    }
    if ($issues -contains "Agent ID not configured" -or $issues -contains "Auth token not configured") {
        Write-Host "    4. Re-download installer from parent app to get valid credentials" -ForegroundColor $WarningColor
    }
    if ($issues -contains "Cannot reach parent API") {
        Write-Host "    5. Check network connectivity and firewall settings" -ForegroundColor $WarningColor
        Write-Host "       Ensure parent app is running and accessible" -ForegroundColor $WarningColor
    }
    Write-Host ""
}

# Quick commands reference
Write-Host "  Quick Commands:" -ForegroundColor $InfoColor
Write-Host "    Start Service:   sc start Allow2AutomateAgent" -ForegroundColor Gray
Write-Host "    Stop Service:    sc stop Allow2AutomateAgent" -ForegroundColor Gray
Write-Host "    Restart Service: sc stop Allow2AutomateAgent && timeout /t 2 && sc start Allow2AutomateAgent" -ForegroundColor Gray
Write-Host "    View Logs:       Get-Content '$MainLog' -Tail 100" -ForegroundColor Gray
Write-Host "    Follow Logs:     Get-Content '$MainLog' -Wait -Tail 20" -ForegroundColor Gray
Write-Host ""
