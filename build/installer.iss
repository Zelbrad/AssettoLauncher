; Inno Setup script: dist\Assetto-Launcher-Setup-<version>.exe from dist\assetto-launcher.
; build.bat runs it when Inno Setup 6 (ISCC.exe) is installed.
;
; Per-user install (no admin prompt) into %LOCALAPPDATA%\Programs\Assetto Launcher:
; the launcher keeps its settings and caches next to its exe (.storage, .cache,
; .tmp), so it must live somewhere the user can write. Installing a newer
; version over it keeps them. Settings backups are in Documents and are never
; touched.

#define AppName "Assetto Launcher"
#ifndef AppVersion
  #define AppVersion "0.1.0"
#endif
#define AppExe "assetto-launcher-win_x64.exe"

[Setup]
AppId={{6E0B9C2A-3F4D-4A8E-9B1C-7D2E5F8A1C34}
AppName={#AppName}
AppVersion={#AppVersion}
AppVerName={#AppName} {#AppVersion}
AppPublisher=Assetto Launcher
DefaultDirName={localappdata}\Programs\{#AppName}
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
PrivilegesRequired=lowest
OutputDir=..\dist
OutputBaseFilename=Assetto-Launcher-Setup-{#AppVersion}
SetupIconFile=icon.ico
UninstallDisplayIcon={app}\{#AppExe}
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
; WebView2 ships with Windows 10 (April 2018+) and 11.
MinVersion=10.0.17134
CloseApplications=yes

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"

[Files]
Source: "..\dist\assetto-launcher\{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "..\dist\assetto-launcher\resources.neu"; DestDir: "{app}"; Flags: ignoreversion

[Icons]
Name: "{userprograms}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{userdesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Run]
Filename: "{app}\{#AppExe}"; Description: "{cm:LaunchProgram,{#AppName}}"; Flags: nowait postinstall skipifsilent

[UninstallDelete]
; The launcher's own data (settings, caches, window state). Backups in Documents stay.
Type: filesandordirs; Name: "{app}\.storage"
Type: filesandordirs; Name: "{app}\.cache"
Type: filesandordirs; Name: "{app}\.tmp"
Type: files; Name: "{app}\neutralinojs.log"
