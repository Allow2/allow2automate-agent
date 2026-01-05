@echo off
REM Create startup shortcut for Allow2 Agent Helper

set HELPER_EXE=C:\Program Files\Allow2\AgentHelper\allow2automate-agent-helper.exe
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_FOLDER%\Allow2 Agent Helper.lnk

echo Creating startup shortcut...

REM Create shortcut using PowerShell
powershell -Command "$WScriptShell = New-Object -ComObject WScript.Shell; $Shortcut = $WScriptShell.CreateShortcut('%SHORTCUT%'); $Shortcut.TargetPath = '%HELPER_EXE%'; $Shortcut.WorkingDirectory = 'C:\Program Files\Allow2\AgentHelper'; $Shortcut.Description = 'Allow2 Agent Helper - System tray and notifications'; $Shortcut.Save()"

if %ERRORLEVEL% EQU 0 (
    echo Startup shortcut created successfully
) else (
    echo Failed to create startup shortcut
    exit /b 1
)
