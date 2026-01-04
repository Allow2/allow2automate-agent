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
echo   - Windows Service
echo   - Binary at C:\Program Files\Allow2\allow2automate-agent.exe
echo   - Configuration files
echo   - Log files
echo.
set /p confirm="Continue? (y/N): "

if /i not "%confirm%"=="y" (
    echo Uninstall cancelled.
    exit /b 0
)

echo.
echo Stopping service...
sc stop Allow2AutomateAgent >nul 2>&1
if %errorLevel% neq 0 echo Service not running

echo Deleting service...
sc delete Allow2AutomateAgent >nul 2>&1
if %errorLevel% neq 0 echo Service not registered

echo Removing files...
del /f /q "C:\Program Files\Allow2\allow2automate-agent.exe" 2>nul
rmdir /s /q "C:\Program Files\Allow2" 2>nul
del /f /q "C:\ProgramData\Allow2\*.log" 2>nul
rmdir /s /q "C:\ProgramData\Allow2" 2>nul

echo.
echo ✓ Allow2 Automate Agent has been successfully uninstalled.
echo.
pause
