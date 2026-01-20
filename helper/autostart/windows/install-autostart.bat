@echo off
REM Create startup shortcut for allow2automate-agent-helper

set HELPER_EXE=C:\Program Files\Allow2\agent\helper\allow2automate-agent-helper.exe
set STARTUP_FOLDER=%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup
set SHORTCUT=%STARTUP_FOLDER%\allow2automate-agent-helper.lnk

echo Creating startup shortcut...

REM Create shortcut using PowerShell
powershell -Command "$WScriptShell = New-Object -ComObject WScript.Shell; $Shortcut = $WScriptShell.CreateShortcut('%SHORTCUT%'); $Shortcut.TargetPath = '%HELPER_EXE%'; $Shortcut.WorkingDirectory = 'C:\Program Files\Allow2\agent\helper'; $Shortcut.Description = 'allow2automate-agent-helper'; $Shortcut.Save()"

if %ERRORLEVEL% EQU 0 (
    echo Startup shortcut created successfully
) else (
    echo Failed to create startup shortcut
    exit /b 1
)
