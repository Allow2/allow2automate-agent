# Windows Installer Build Pipeline - Design Document

## Overview

This document specifies the implementation of a signed Windows executable installer built with Inno Setup, distributed via GitHub Releases. The installer supports automatic discovery of a JSON configuration file or allows the user to browse for one during installation.

## Requirements

1. **Installer Format**: Signed EXE installer built with Inno Setup
1. **Distribution**: GitHub Releases (triggered by version tags)
1. **Code Signing**: Both the application binary and installer must be signed with a code signing certificate
1. **Configuration File Handling**:
- Auto-discover `config.json` in the same directory as the installer
- If not found, prompt the user to browse for a config file
- Allow installation to proceed without config (manual configuration later)

-----

## Repository Structure

Create/modify the following files in the repository:

```
.github/
└── workflows/
    └── build-release.yml          # GitHub Actions workflow
installer/
└── setup.iss                      # Inno Setup script
```

-----

## GitHub Secrets Required

Configure these secrets in the repository settings (Settings → Secrets and variables → Actions → New repository secret):

|Secret Name                 |Description                           |
|----------------------------|--------------------------------------|
|`CODE_SIGNING_CERT_BASE64`  |PFX certificate file encoded as Base64|
|`CODE_SIGNING_CERT_PASSWORD`|Password for the PFX certificate      |

### How to encode the certificate

Run this PowerShell command locally to convert your PFX file to Base64:

```powershell
$certBytes = [IO.File]::ReadAllBytes("C:\path\to\your-certificate.pfx")
$base64 = [Convert]::ToBase64String($certBytes)
$base64 | Set-Clipboard
Write-Host "Base64 string copied to clipboard"
```

-----

## File: `.github/workflows/build-release.yml`

Create this GitHub Actions workflow file:

```yaml
name: Build and Release Windows Installer

on:
  push:
    tags:
      - 'v*'
  workflow_dispatch:
    inputs:
      version:
        description: 'Version number (without v prefix)'
        required: false
        default: '0.0.0-dev'

env:
  APP_NAME: "YourAppName"  # CHANGE THIS: Your application name
  APP_BINARY: "your-app.exe"  # CHANGE THIS: Your built executable name

jobs:
  build-windows:
    runs-on: windows-latest
    
    steps:
      - name: Checkout repository
        uses: actions/checkout@v4

      - name: Determine version
        id: version
        run: |
          if ("${{ github.ref_type }}" -eq "tag") {
            $version = "${{ github.ref_name }}"
          } elseif ("${{ github.event.inputs.version }}") {
            $version = "v${{ github.event.inputs.version }}"
          } else {
            $version = "v0.0.0-dev"
          }
          echo "VERSION=$version" >> $env:GITHUB_OUTPUT
          echo "Version: $version"
        shell: pwsh

      #############################################
      # BUILD STEP - CUSTOMIZE FOR YOUR PROJECT
      #############################################
      # Replace this section with your actual build commands
      # Examples for different project types:
      #
      # .NET:
      #   dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o dist
      #
      # Rust:
      #   cargo build --release
      #   Copy-Item "target\release\your-app.exe" -Destination "dist\"
      #
      # Node.js (with pkg):
      #   npm ci
      #   npx pkg . --target node18-win-x64 --output dist/your-app.exe
      #
      # Go:
      #   go build -ldflags="-s -w" -o dist/your-app.exe .
      #
      # Python (with PyInstaller):
      #   pip install pyinstaller
      #   pyinstaller --onefile --distpath dist src/main.py
      #############################################
      
      - name: Build application
        run: |
          New-Item -ItemType Directory -Force -Path dist
          # TODO: Add your build commands here
          # Example placeholder:
          # dotnet publish -c Release -r win-x64 --self-contained -p:PublishSingleFile=true -o dist
          Write-Host "BUILD STEP: Replace this with your actual build commands"
        shell: pwsh

      #############################################
      # CODE SIGNING
      #############################################

      - name: Decode code signing certificate
        run: |
          $certBytes = [Convert]::FromBase64String("${{ secrets.CODE_SIGNING_CERT_BASE64 }}")
          $certPath = "${{ runner.temp }}\codesign.pfx"
          [IO.File]::WriteAllBytes($certPath, $certBytes)
          echo "CERT_PATH=$certPath" >> $env:GITHUB_ENV
        shell: pwsh

      - name: Find signtool.exe
        id: signtool
        run: |
          $signtool = Get-ChildItem -Path "C:\Program Files (x86)\Windows Kits\10\bin" -Recurse -Filter "signtool.exe" | 
            Where-Object { $_.FullName -match "x64" } | 
            Sort-Object { [version]($_.FullName -replace '.*\\(\d+\.\d+\.\d+\.\d+)\\.*', '$1') } -Descending |
            Select-Object -First 1 -ExpandProperty FullName
          echo "SIGNTOOL_PATH=$signtool" >> $env:GITHUB_OUTPUT
          Write-Host "Using signtool: $signtool"
        shell: pwsh

      - name: Sign application binary
        run: |
          & "${{ steps.signtool.outputs.SIGNTOOL_PATH }}" sign `
            /f "${{ env.CERT_PATH }}" `
            /p "${{ secrets.CODE_SIGNING_CERT_PASSWORD }}" `
            /fd SHA256 `
            /tr http://timestamp.digicert.com `
            /td SHA256 `
            /d "${{ env.APP_NAME }}" `
            "dist\${{ env.APP_BINARY }}"
        shell: pwsh

      - name: Verify application signature
        run: |
          & "${{ steps.signtool.outputs.SIGNTOOL_PATH }}" verify /pa "dist\${{ env.APP_BINARY }}"
        shell: pwsh

      #############################################
      # INSTALLER BUILD
      #############################################

      - name: Install Inno Setup
        run: choco install innosetup -y

      - name: Build installer
        run: |
          & "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" `
            "/DAppVersion=${{ steps.version.outputs.VERSION }}" `
            "/DAppBinary=${{ env.APP_BINARY }}" `
            "/DAppName=${{ env.APP_NAME }}" `
            "/DCertFile=${{ env.CERT_PATH }}" `
            "/DCertPassword=${{ secrets.CODE_SIGNING_CERT_PASSWORD }}" `
            "/DSignToolPath=${{ steps.signtool.outputs.SIGNTOOL_PATH }}" `
            "installer\setup.iss"
        shell: pwsh

      - name: Verify installer signature
        run: |
          $installer = Get-ChildItem -Path "installer\Output\*.exe" | Select-Object -First 1
          & "${{ steps.signtool.outputs.SIGNTOOL_PATH }}" verify /pa $installer.FullName
        shell: pwsh

      #############################################
      # CLEANUP AND RELEASE
      #############################################

      - name: Clean up certificate
        if: always()
        run: |
          if (Test-Path "${{ env.CERT_PATH }}") {
            Remove-Item -Path "${{ env.CERT_PATH }}" -Force
          }
        shell: pwsh

      - name: Upload build artifact
        uses: actions/upload-artifact@v4
        with:
          name: windows-installer
          path: installer/Output/*.exe
          retention-days: 30

      - name: Create GitHub Release
        if: startsWith(github.ref, 'refs/tags/')
        uses: softprops/action-gh-release@v2
        with:
          files: installer/Output/*.exe
          generate_release_notes: true
          draft: false
          prerelease: ${{ contains(github.ref_name, '-beta') || contains(github.ref_name, '-alpha') || contains(github.ref_name, '-rc') }}
        env:
          GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

-----

## File: `installer/setup.iss`

Create this Inno Setup script:

```iss
; =============================================================================
; Inno Setup Script for Windows Installer
; =============================================================================
; Build parameters (passed from command line):
;   /DAppVersion=v1.0.0
;   /DAppBinary=your-app.exe
;   /DAppName=YourAppName
;   /DCertFile=path\to\cert.pfx
;   /DCertPassword=password
;   /DSignToolPath=path\to\signtool.exe
; =============================================================================

; Defaults for local development builds
#ifndef AppVersion
  #define AppVersion "v0.0.0-dev"
#endif
#ifndef AppBinary
  #define AppBinary "your-app.exe"
#endif
#ifndef AppName
  #define AppName "YourAppName"
#endif

[Setup]
; Basic application information
AppId={{GENERATE-NEW-GUID-HERE}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Your Name or Company
AppPublisherURL=https://github.com/yourusername/yourrepo
AppSupportURL=https://github.com/yourusername/yourrepo/issues
AppUpdatesURL=https://github.com/yourusername/yourrepo/releases

; Installation directories
DefaultDirName={autopf}\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes

; Output settings
OutputDir=Output
OutputBaseFilename={#AppName}-Setup-{#AppVersion}
Compression=lzma2/ultra64
SolidCompression=yes

; Platform settings
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

; Privileges - allows install without admin if user chooses
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog

; Visual settings
WizardStyle=modern
; Uncomment and set path if you have an icon:
; SetupIconFile=..\assets\icon.ico
; UninstallDisplayIcon={app}\{#AppBinary}

; Code signing configuration (only when certificates provided)
#ifdef CertFile
  #ifdef SignToolPath
    #define SignToolCmd SignToolPath + ' sign /f "' + CertFile + '" /p "' + CertPassword + '" /fd SHA256 /tr http://timestamp.digicert.com /td SHA256 /d "' + AppName + '" $f'
    SignTool=customsign {#SignToolCmd}
  #endif
  SignedUninstaller=yes
#endif

[Languages]
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"; Flags: unchecked

[Files]
; Main application binary (must be pre-signed before installer build)
Source: "..\dist\{#AppBinary}"; DestDir: "{app}"; Flags: ignoreversion

; Configuration file - handled by custom code for auto-discovery/browse
Source: "{code:GetConfigSourcePath}"; DestDir: "{app}"; DestName: "config.json"; \
  Flags: ignoreversion external skipifsourcedoesntexist; Check: ShouldInstallConfigFile

; Add any additional files your application needs:
; Source: "..\dist\*.dll"; DestDir: "{app}"; Flags: ignoreversion
; Source: "..\dist\data\*"; DestDir: "{app}\data"; Flags: ignoreversion recursesubdirs

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppBinary}"
Name: "{group}\{cm:UninstallProgram,{#AppName}}"; Filename: "{uninstallexe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppBinary}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppBinary}"; Description: "{cm:LaunchProgram,{#AppName}}"; \
  Flags: nowait postinstall skipifsilent

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
  ConfigNames: array[0..3] of string;
  I: Integer;
begin
  Result := False;
  SearchDir := GetInstallerDirectory;
  
  // List of config file names to search for (in priority order)
  ConfigNames[0] := 'config.json';
  ConfigNames[1] := 'settings.json';
  ConfigNames[2] := 'app-config.json';
  ConfigNames[3] := StringChangeEx(ExpandConstant('{#AppName}'), ' ', '', True) + '-config.json';
  
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

// Show file browser dialog for config selection
function BrowseForConfigFile: Boolean;
var
  OpenDialog: TOpenDialog;
begin
  Result := False;
  
  OpenDialog := TOpenDialog.Create(nil);
  try
    OpenDialog.Title := 'Select Configuration File';
    OpenDialog.Filter := 'JSON Configuration Files (*.json)|*.json|All Files (*.*)|*.*';
    OpenDialog.DefaultExt := 'json';
    OpenDialog.Options := [ofFileMustExist, ofPathMustExist, ofHideReadOnly, ofEnableSizing];
    OpenDialog.InitialDir := GetInstallerDirectory;
    
    if OpenDialog.Execute then
    begin
      ConfigFilePath := OpenDialog.FileName;
      Log('User selected config file: ' + ConfigFilePath);
      Result := True;
    end
    else
    begin
      Log('User cancelled config file selection');
    end;
  finally
    OpenDialog.Free;
  end;
end;

// Called at the start of installation
function InitializeSetup: Boolean;
var
  UserChoice: Integer;
begin
  Result := True;
  ConfigFileSelected := False;
  ConfigFilePath := '';
  
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
    'A configuration file may be required to connect to your server or service.' + #13#10 + #13#10 +
    'Would you like to browse for a configuration file?' + #13#10 + #13#10 +
    '  • Click YES to browse for a config file' + #13#10 +
    '  • Click NO to continue without one (configure manually later)' + #13#10 +
    '  • Click CANCEL to abort installation',
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
                    'Continue installation without a configuration file?',
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
    InstalledConfigPath := ExpandConstant('{app}\config.json');
    
    if FileExists(InstalledConfigPath) then
    begin
      Log('Installation completed successfully with configuration file');
    end
    else
    begin
      Log('Installation completed without configuration file');
      // Optionally show a reminder
      MsgBox('Installation complete!' + #13#10 + #13#10 +
             'Note: No configuration file was installed. You may need to create ' +
             'or copy a config.json file to:' + #13#10 + #13#10 +
             '  ' + ExpandConstant('{app}') + #13#10 + #13#10 +
             'before running the application.',
             mbInformation, MB_OK);
    end;
  end;
end;

// Cleanup on installation cancel/failure
procedure DeinitializeSetup;
begin
  // Any cleanup code if needed
end;
```

-----

## Implementation Checklist

When implementing this in your repository, complete the following steps:

### 1. Repository Setup

- [ ] Create `.github/workflows/` directory if it doesn’t exist
- [ ] Create `installer/` directory if it doesn’t exist
- [ ] Copy `build-release.yml` to `.github/workflows/build-release.yml`
- [ ] Copy `setup.iss` to `installer/setup.iss`

### 2. Customise the Workflow

In `.github/workflows/build-release.yml`:

- [ ] Change `APP_NAME` environment variable to your application name
- [ ] Change `APP_BINARY` environment variable to your executable filename
- [ ] Replace the placeholder build step with your actual build commands

### 3. Customise the Installer Script

In `installer/setup.iss`:

- [ ] Generate a new GUID for `AppId` (use PowerShell: `[guid]::NewGuid().ToString()`)
- [ ] Update `AppPublisher` with your name or company
- [ ] Update `AppPublisherURL`, `AppSupportURL`, `AppUpdatesURL` with your repository URLs
- [ ] Uncomment and set `SetupIconFile` if you have an application icon
- [ ] Add any additional files your application needs in the `[Files]` section

### 4. Configure GitHub Secrets

In your repository settings (Settings → Secrets and variables → Actions):

- [ ] Add `CODE_SIGNING_CERT_BASE64` secret with your Base64-encoded PFX certificate
- [ ] Add `CODE_SIGNING_CERT_PASSWORD` secret with your certificate password

### 5. Test the Build

- [ ] Run the workflow manually first (Actions → Build and Release → Run workflow)
- [ ] Download and test the installer artifact
- [ ] Verify code signing by right-clicking the exe → Properties → Digital Signatures
- [ ] Test config file auto-discovery (place config.json next to installer)
- [ ] Test config file browse dialog (run installer without config.json nearby)

### 6. Create a Release

```bash
git tag v1.0.0
git push origin v1.0.0
```

-----

## User Instructions

Include these instructions in your README or documentation for end users:

### Installation

1. Download the latest installer from the [Releases page](https://github.com/yourusername/yourrepo/releases/latest)
1. **If you have a configuration file**: Place your `config.json` in the same folder as the downloaded installer before running it
1. Run the installer
1. If no configuration file is found, you’ll be prompted to browse for one or continue without it
1. Follow the installation wizard

### Configuration

The application requires a `config.json` file to connect to your server. You can either:

- Place the config file next to the installer before installation (recommended)
- Browse for the config file during installation when prompted
- Manually copy the config file to the installation directory after installation:
  - Default location: `C:\Users\<username>\AppData\Local\Programs\YourAppName\`
  - Or if installed for all users: `C:\Program Files\YourAppName\`

-----

## Troubleshooting

### Build Failures

**Certificate decoding fails**: Ensure the Base64 string has no line breaks or extra whitespace.

**Signtool not found**: The workflow searches for signtool.exe automatically. If it fails, check that Windows SDK is installed on the runner.

**Inno Setup compilation errors**: Run locally first with: `"C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\setup.iss`

### Signing Issues

**Timestamp server errors**: Try alternative timestamp servers:

- `http://timestamp.digicert.com`
- `http://timestamp.sectigo.com`
- `http://timestamp.comodoca.com`
- `http://tsa.starfieldtech.com`

**SmartScreen warnings**: New certificates need to build reputation. Consider an EV certificate for immediate trust, or submit your app to Microsoft’s malware analysis service.

### Installation Issues

**Config file not detected**: Ensure the file is named exactly `config.json` (case-sensitive) and is in the same directory as the installer executable.

**Access denied during install**: The installer defaults to per-user installation. If installing to Program Files, admin rights are required.
