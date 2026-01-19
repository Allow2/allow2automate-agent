@echo off
REM
REM Allow2 Automate Agent - Windows Uninstaller
REM
REM This script removes the Allow2 Automate Agent and Helper from your Windows system.
REM It verifies each removal step and reports what was cleaned up or what failed.
REM

setlocal EnableDelayedExpansion

echo Allow2 Automate Agent - Uninstaller
echo ====================================
echo.

REM Check for admin privileges
net session >nul 2>&1
if %errorLevel% neq 0 (
    echo This script must be run as Administrator.
    echo Right-click and select "Run as administrator"
    pause
    exit /b 1
)

echo This will remove:
echo   - Windows Service (main agent)
echo   - User helper and autostart
echo   - Binaries and installation folder
echo   - Configuration files
echo   - Log files
echo   - Running processes
echo.
set /p confirm="Continue? (y/N): "

if /i not "%confirm%"=="y" (
    echo Uninstall cancelled.
    exit /b 0
)

REM Initialize tracking
set "REMAINING="
set "SUCCESS_COUNT=0"

echo.
echo === Stopping Processes ===

REM Kill helper processes
echo Stopping helper processes...
taskkill /F /IM "allow2automate-agent-helper.exe" >nul 2>&1
if %errorLevel% equ 0 (
    echo   Killed helper process(es)
    set /a SUCCESS_COUNT+=1
) else (
    echo   No helper processes running
)

REM Kill any stray agent processes (should be handled by service stop)
echo Stopping any stray agent processes...
taskkill /F /IM "allow2automate-agent.exe" >nul 2>&1
if %errorLevel% equ 0 (
    echo   Killed agent process(es)
    set /a SUCCESS_COUNT+=1
) else (
    echo   No stray agent processes running
)

echo.
echo === Stopping Services ===

REM Stop the Windows service
echo Stopping main agent service...
sc query Allow2AutomateAgent >nul 2>&1
if %errorLevel% equ 0 (
    sc stop Allow2AutomateAgent >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Stopped Windows service
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Service not running or already stopped
    )

    REM Wait for service to stop
    timeout /t 2 /nobreak >nul 2>&1

    REM Delete the service
    echo Deleting Windows service...
    sc delete Allow2AutomateAgent >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Deleted Windows service
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to delete service
        set "REMAINING=!REMAINING!Windows Service, "
    )
) else (
    echo   Service not registered
)

echo.
echo === Removing Files ===

REM Remove helper autostart from registry
echo Removing helper autostart from registry...
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Allow2AgentHelper" >nul 2>&1
if %errorLevel% equ 0 (
    reg delete "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Allow2AgentHelper" /f >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed registry autostart entry
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove registry autostart
        set "REMAINING=!REMAINING!Registry autostart, "
    )
) else (
    echo   Registry autostart not found (already removed)
)

REM Remove startup folder shortcut
echo Removing startup folder shortcut...
if exist "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Allow2 Agent Helper.lnk" (
    del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Allow2 Agent Helper.lnk" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed startup shortcut
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove startup shortcut
        set "REMAINING=!REMAINING!Startup shortcut, "
    )
) else (
    echo   Startup shortcut not found (already removed)
)

REM Remove main agent binary
echo Removing main agent binary...
if exist "C:\Program Files\Allow2\allow2automate-agent.exe" (
    del /f /q "C:\Program Files\Allow2\allow2automate-agent.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed main agent binary
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove main agent binary
        set "REMAINING=!REMAINING!Main agent binary, "
    )
) else (
    echo   Main agent binary not found (already removed)
)

REM Remove helper binary
echo Removing helper binary...
if exist "C:\Program Files\Allow2\AgentHelper\allow2automate-agent-helper.exe" (
    del /f /q "C:\Program Files\Allow2\AgentHelper\allow2automate-agent-helper.exe" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed helper binary
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove helper binary
        set "REMAINING=!REMAINING!Helper binary, "
    )
) else (
    echo   Helper binary not found (already removed)
)

REM Remove helper directory
echo Removing helper directory...
if exist "C:\Program Files\Allow2\AgentHelper" (
    rmdir /s /q "C:\Program Files\Allow2\AgentHelper" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed helper directory
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove helper directory
        set "REMAINING=!REMAINING!Helper directory, "
    )
) else (
    echo   Helper directory not found (already removed)
)

REM Remove main installation directory
echo Removing installation directory...
if exist "C:\Program Files\Allow2" (
    rmdir /s /q "C:\Program Files\Allow2" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed installation directory
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove installation directory (may have other files)
        set "REMAINING=!REMAINING!Installation directory, "
    )
) else (
    echo   Installation directory not found (already removed)
)

REM Remove log files
echo Removing log files...
if exist "C:\ProgramData\Allow2\*.log" (
    del /f /q "C:\ProgramData\Allow2\*.log" >nul 2>&1
    echo   Removed log files
)

REM Remove ProgramData directory
echo Removing data directory...
if exist "C:\ProgramData\Allow2" (
    rmdir /s /q "C:\ProgramData\Allow2" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed data directory
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove data directory
        set "REMAINING=!REMAINING!Data directory, "
    )
) else (
    echo   Data directory not found (already removed)
)

REM Remove user config directories
echo Removing user configuration...
if exist "%APPDATA%\Allow2" (
    rmdir /s /q "%APPDATA%\Allow2" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed user config directory
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove user config directory
    )
) else (
    echo   User config directory not found (already removed)
)

if exist "%LOCALAPPDATA%\Allow2" (
    rmdir /s /q "%LOCALAPPDATA%\Allow2" >nul 2>&1
    if %errorLevel% equ 0 (
        echo   Removed local app data directory
        set /a SUCCESS_COUNT+=1
    ) else (
        echo   Failed to remove local app data directory
    )
) else (
    echo   Local app data directory not found (already removed)
)

REM Remove temp files
echo Removing temporary files...
if exist "%TEMP%\allow2-helper-startup.flag" (
    del /f /q "%TEMP%\allow2-helper-startup.flag" >nul 2>&1
    echo   Removed startup flag file
)

echo.
echo === Verification ===

REM Re-check for remaining items
set "VERIFY_REMAINING="

REM Check for remaining processes
tasklist /FI "IMAGENAME eq allow2automate-agent-helper.exe" 2>nul | find /I "allow2automate-agent-helper.exe" >nul
if %errorLevel% equ 0 (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Helper process still running, "
)

tasklist /FI "IMAGENAME eq allow2automate-agent.exe" 2>nul | find /I "allow2automate-agent.exe" >nul
if %errorLevel% equ 0 (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Agent process still running, "
)

REM Check for remaining service
sc query Allow2AutomateAgent >nul 2>&1
if %errorLevel% equ 0 (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Windows service still registered, "
)

REM Check for remaining files
if exist "C:\Program Files\Allow2\allow2automate-agent.exe" (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Main agent binary, "
)
if exist "C:\Program Files\Allow2\AgentHelper\allow2automate-agent-helper.exe" (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Helper binary, "
)
if exist "C:\Program Files\Allow2" (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Installation directory, "
)

REM Check registry
reg query "HKCU\Software\Microsoft\Windows\CurrentVersion\Run" /v "Allow2AgentHelper" >nul 2>&1
if %errorLevel% equ 0 (
    set "VERIFY_REMAINING=!VERIFY_REMAINING!Registry autostart entry, "
)

echo.
echo ========================================

if "!VERIFY_REMAINING!"=="" (
    echo SUCCESS: Allow2 Automate Agent completely uninstalled!
    echo.
    echo Successfully removed !SUCCESS_COUNT! items.
) else (
    echo WARNING: Some items could not be removed:
    echo.
    echo   !VERIFY_REMAINING!
    echo.
    echo You may need to restart your computer and run this script again,
    echo or manually remove the remaining items.
)

echo.
echo ========================================
echo.

pause
