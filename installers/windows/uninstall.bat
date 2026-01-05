@echo off
REM
REM Allow2 Automate Agent - Windows Uninstaller
REM
REM This script removes the Allow2 Automate Agent from your Windows system.
REM

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
echo   - Binaries at C:\Program Files\Allow2\
echo   - Configuration files
echo   - Log files
echo.
set /p confirm="Continue? (y/N): "

if /i not "%confirm%"=="y" (
    echo Uninstall cancelled.
    exit /b 0
)

echo.
echo Stopping main agent service...
sc stop Allow2AutomateAgent >nul 2>&1
if %errorLevel% neq 0 echo Service not running

echo Deleting service...
sc delete Allow2AutomateAgent >nul 2>&1
if %errorLevel% neq 0 echo Service not registered

echo Removing helper autostart...
del /f /q "%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Allow2 Agent Helper.lnk" 2>nul

echo Removing files...
del /f /q "C:\Program Files\Allow2\allow2automate-agent.exe" 2>nul
del /f /q "C:\Program Files\Allow2\AgentHelper\allow2automate-agent-helper.exe" 2>nul
rmdir /s /q "C:\Program Files\Allow2\AgentHelper" 2>nul
rmdir /s /q "C:\Program Files\Allow2" 2>nul
del /f /q "C:\ProgramData\Allow2\*.log" 2>nul
rmdir /s /q "C:\ProgramData\Allow2" 2>nul

echo.
echo ✓ Allow2 Automate Agent and Helper have been successfully uninstalled.
echo.
pause
