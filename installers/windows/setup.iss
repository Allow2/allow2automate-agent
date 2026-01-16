; =============================================================================
; Allow2 Automate Agent - Inno Setup Script for Windows Installer
; =============================================================================
; Build parameters (passed from command line):
;   /DAppVersion=1.0.0
;   /DSourceDir=path\to\dist
; =============================================================================

; Defaults for local development builds
#ifndef AppVersion
  #define AppVersion "0.0.0-dev"
#endif
#ifndef SourceDir
  #define SourceDir "..\..\dist"
#endif

#define AppName "Allow2 Automate Agent"
#define AppPublisher "Allow2 Pty Ltd"
#define AppURL "https://github.com/allow2/allow2automate-agent"
#define AppExeName "allow2automate-agent.exe"
#define HelperExeName "allow2automate-agent-helper.exe"

[Setup]
; Basic application information
AppId={{E6A8C4D5-9B3F-4E2A-8F1C-7D6B5A4E3C2D}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher={#AppPublisher}
AppPublisherURL={#AppURL}
AppSupportURL={#AppURL}/issues
AppUpdatesURL={#AppURL}/releases

; Installation directories
DefaultDirName={autopf}\Allow2
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes

; Output settings
OutputDir=dist
OutputBaseFilename=allow2automate-agent-setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes

; Platform settings
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Privileges - requires admin for service installation
PrivilegesRequired=admin

; Visual settings
WizardStyle=modern

; Uninstall settings
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\{#AppExeName}

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "startservice"; Description: "Start the agent service after installation"; GroupDescription: "Service Options:"
Name: "installhelper"; Description: "Install user helper (tray icon for status)"; GroupDescription: "Additional Components:"; Flags: unchecked

[Files]
; Main application binary (must be pre-signed)
Source: "{#SourceDir}\allow2automate-agent-win.exe"; DestDir: "{app}"; DestName: "{#AppExeName}"; Flags: ignoreversion

; Helper binary (optional - only if it exists)
Source: "{#SourceDir}\allow2automate-agent-helper-win.exe"; DestDir: "{app}\Helper"; DestName: "{#HelperExeName}"; Flags: ignoreversion skipifsourcedoesntexist; Tasks: installhelper

; Configuration file - handled by custom code for auto-discovery/browse
Source: "{code:GetConfigSourcePath}"; DestDir: "{commonappdata}\Allow2"; DestName: "config.json"; \
  Flags: ignoreversion external skipifsourcedoesntexist onlyifdoesntexist; Check: ShouldInstallConfigFile

; Uninstall script
Source: "uninstall.bat"; DestDir: "{app}"; Flags: ignoreversion

[Dirs]
; Create data directory with appropriate permissions
Name: "{commonappdata}\Allow2"; Permissions: everyone-full
Name: "{commonappdata}\Allow2\logs"; Permissions: everyone-full

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExeName}"
Name: "{group}\Uninstall {#AppName}"; Filename: "{uninstallexe}"

[Run]
; Install Windows service
Filename: "{app}\{#AppExeName}"; Parameters: "install"; StatusMsg: "Installing Windows service..."; Flags: runhidden waituntilterminated
; Start service if requested
Filename: "sc.exe"; Parameters: "start Allow2AutomateAgent"; StatusMsg: "Starting service..."; Flags: runhidden waituntilterminated; Tasks: startservice
; Install helper autostart if requested
Filename: "{cmd}"; Parameters: "/c copy ""{app}\Helper\{#HelperExeName}"" ""%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Allow2 Agent Helper.exe"""; Flags: runhidden; Tasks: installhelper

[UninstallRun]
; Stop and remove service
Filename: "sc.exe"; Parameters: "stop Allow2AutomateAgent"; Flags: runhidden waituntilterminated
Filename: "sc.exe"; Parameters: "delete Allow2AutomateAgent"; Flags: runhidden waituntilterminated
; Remove helper autostart
Filename: "{cmd}"; Parameters: "/c del /f /q ""%APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup\Allow2 Agent Helper.exe"""; Flags: runhidden

[Code]
var
  ConfigFilePath: string;
  ConfigFileSelected: Boolean;

// Get the directory where the installer is located
function GetInstallerDirectory: string;
begin
  Result := ExtractFilePath(ExpandConstant('{srcexe}'));
end;

// Search for config file in installer directory
function AutoDiscoverConfigFile: Boolean;
var
  SearchDir: string;
  ConfigNames: array[0..4] of string;
  I: Integer;
begin
  Result := False;
  SearchDir := GetInstallerDirectory;

  // List of config file names to search for (in priority order)
  ConfigNames[0] := 'config.json';
  ConfigNames[1] := 'allow2-config.json';
  ConfigNames[2] := 'agent-config.json';
  ConfigNames[3] := 'settings.json';
  ConfigNames[4] := 'allow2automate-agent-config.json';

  for I := 0 to GetArrayLength(ConfigNames) - 1 do
  begin
    if FileExists(SearchDir + ConfigNames[I]) then
    begin
      ConfigFilePath := SearchDir + ConfigNames[I];
      Log('Auto-discovered config file: ' + ConfigFilePath);
      Result := True;
      Exit;
    end;
  end;

  Log('No config file found in installer directory');
end;

// Show file browser dialog for config selection using PowerShell
// This approach is more reliable than direct Windows API calls in Inno Setup
function BrowseForConfigFile: Boolean;
var
  ResultCode: Integer;
  TempFile: string;
  SelectedFileAnsi: AnsiString;
  SelectedFile: string;
  PSCommand: string;
  InitialDir: string;
begin
  Result := False;
  TempFile := ExpandConstant('{tmp}\selected_config.txt');
  InitialDir := GetInstallerDirectory;

  // Build PowerShell command to show file dialog
  // Using System.Windows.Forms.OpenFileDialog for reliable file selection
  PSCommand := '-NoProfile -ExecutionPolicy Bypass -Command "' +
    'Add-Type -AssemblyName System.Windows.Forms; ' +
    '$dialog = New-Object System.Windows.Forms.OpenFileDialog; ' +
    '$dialog.Filter = ''JSON Configuration Files (*.json)|*.json|All Files (*.*)|*.*''; ' +
    '$dialog.Title = ''Select Allow2 Configuration File''; ' +
    '$dialog.InitialDirectory = ''' + InitialDir + '''; ' +
    'if ($dialog.ShowDialog() -eq ''OK'') { ' +
    '  $dialog.FileName | Out-File -FilePath ''' + TempFile + ''' -Encoding ASCII -NoNewline ' +
    '}"';

  Log('Launching PowerShell file dialog...');

  if Exec('powershell.exe', PSCommand, '', SW_HIDE, ewWaitUntilTerminated, ResultCode) then
  begin
    if FileExists(TempFile) then
    begin
      // LoadStringFromFile requires AnsiString in Inno Setup Unicode
      if LoadStringFromFile(TempFile, SelectedFileAnsi) then
      begin
        SelectedFile := Trim(String(SelectedFileAnsi));
        if (SelectedFile <> '') and FileExists(SelectedFile) then
        begin
          ConfigFilePath := SelectedFile;
          Log('User selected config file: ' + ConfigFilePath);
          Result := True;
        end;
      end;
      DeleteFile(TempFile);
    end;
  end
  else
  begin
    Log('PowerShell execution failed with code: ' + IntToStr(ResultCode));
  end;

  if not Result then
    Log('User cancelled config file selection or dialog failed');
end;

// Check if config file already exists at destination
function ConfigFileExistsAtDestination: Boolean;
var
  DestPath: string;
begin
  DestPath := ExpandConstant('{commonappdata}\Allow2\config.json');
  Result := FileExists(DestPath);
  if Result then
    Log('Existing config file found at: ' + DestPath);
end;

// Called at the start of installation
function InitializeSetup: Boolean;
var
  UserChoice: Integer;
begin
  Result := True;
  ConfigFileSelected := False;
  ConfigFilePath := '';

  // Check if config already exists at destination - if so, skip config prompt
  if ConfigFileExistsAtDestination then
  begin
    Log('Config file already exists at destination, skipping config discovery');
    Exit;
  end;

  // Step 1: Try automatic discovery
  if AutoDiscoverConfigFile then
  begin
    ConfigFileSelected := True;
    MsgBox('A configuration file was found:' + #13#10 + #13#10 +
           '  ' + ExtractFileName(ConfigFilePath) + #13#10 + #13#10 +
           'This file will be included in the installation.',
           mbInformation, MB_OK);
    Exit;
  end;

  // Step 2: No config found - ask user what to do
  UserChoice := MsgBox(
    'No configuration file (config.json) was found in the installer directory.' + #13#10 + #13#10 +
    'A configuration file is required to connect the agent to your Allow2 account.' + #13#10 + #13#10 +
    'You can obtain a configuration file from the Allow2 parent app or web portal.' + #13#10 + #13#10 +
    'Would you like to browse for a configuration file?' + #13#10 + #13#10 +
    '  - Click YES to browse for a config file' + #13#10 +
    '  - Click NO to continue without one (configure manually later)' + #13#10 +
    '  - Click CANCEL to abort installation',
    mbConfirmation, MB_YESNOCANCEL);

  case UserChoice of
    IDYES:
      begin
        if BrowseForConfigFile then
        begin
          ConfigFileSelected := True;
        end
        else
        begin
          // User cancelled the browse dialog
          if MsgBox('No configuration file was selected.' + #13#10 + #13#10 +
                    'Continue installation without a configuration file?' + #13#10 + #13#10 +
                    'Note: The agent will not function until a config.json file is placed in:' + #13#10 +
                    '  C:\ProgramData\Allow2\',
                    mbConfirmation, MB_YESNO) = IDNO then
          begin
            Result := False;  // Abort installation
          end;
        end;
      end;
    IDNO:
      begin
        // Continue without config
        Log('User chose to continue without config file');
      end;
    IDCANCEL:
      begin
        Result := False;  // Abort installation
      end;
  end;
end;

// Check function for [Files] section - determines if config should be installed
function ShouldInstallConfigFile: Boolean;
begin
  Result := ConfigFileSelected and (ConfigFilePath <> '') and FileExists(ConfigFilePath);
end;

// Returns the path to the config file for [Files] section
function GetConfigSourcePath(Param: string): string;
begin
  if ShouldInstallConfigFile then
    Result := ConfigFilePath
  else
    Result := '';
end;

// Called after installation completes
procedure CurStepChanged(CurStep: TSetupStep);
var
  InstalledConfigPath: string;
begin
  if CurStep = ssPostInstall then
  begin
    InstalledConfigPath := ExpandConstant('{commonappdata}\Allow2\config.json');

    if FileExists(InstalledConfigPath) then
    begin
      Log('Installation completed successfully with configuration file');
    end
    else
    begin
      Log('Installation completed without configuration file');
      // Show reminder
      MsgBox('Installation complete!' + #13#10 + #13#10 +
             'IMPORTANT: No configuration file was installed. The agent will not' + #13#10 +
             'function until you add a config.json file to:' + #13#10 + #13#10 +
             '  C:\ProgramData\Allow2\config.json' + #13#10 + #13#10 +
             'You can obtain a configuration file from the Allow2 parent app.',
             mbInformation, MB_OK);
    end;
  end;
end;

// Cleanup on installation cancel/failure
procedure DeinitializeSetup;
begin
  // Any cleanup code if needed
end;
