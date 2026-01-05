@echo off
REM Remove startup shortcut for Allow2 Agent Helper

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_FOLDER%\Allow2 Agent Helper.lnk

echo Removing startup shortcut...

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo Startup shortcut removed
) else (
    echo Startup shortcut not found
)
