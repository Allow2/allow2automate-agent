@echo off
REM Remove startup shortcut for allow2automate-agent-helper

set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_FOLDER%\allow2automate-agent-helper.lnk

echo Removing startup shortcut...

if exist "%SHORTCUT%" (
    del "%SHORTCUT%"
    echo Startup shortcut removed
) else (
    echo Startup shortcut not found
)
