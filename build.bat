@echo off
rem Package dist\assetto-launcher (exe + resources.neu) and a release zip.
cd /d "%~dp0"
call npx -y @neutralinojs/neu@11 build --release || exit /b 1

rem Embed the app icon in the exe (Explorer, shortcuts, pinned taskbar). The
rem window icon at runtime comes from resources\img\icon.png.
set EXE=dist\assetto-launcher\assetto-launcher-win_x64.exe
call npx -y resedit-cli --in "%EXE%" --out "%EXE%.tmp" --icon 1,build\icon.ico || exit /b 1
move /y "%EXE%.tmp" "%EXE%" >nul

rem Re-zip so the release zip carries the patched exe.
del dist\assetto-launcher-release.zip 2>nul
"%SystemRoot%\System32\tar.exe" -a -cf dist\assetto-launcher-release.zip -C dist assetto-launcher
echo Built dist\assetto-launcher and dist\assetto-launcher-release.zip

rem Installer (Inno Setup 6), when installed: dist\Assetto-Launcher-Setup-<version>.exe
set ISCC=
for %%P in ("%LOCALAPPDATA%\Programs\Inno Setup 6\ISCC.exe" "%ProgramFiles(x86)%\Inno Setup 6\ISCC.exe" "%ProgramFiles%\Inno Setup 6\ISCC.exe") do if exist %%P set ISCC=%%P
if not defined ISCC (echo Inno Setup 6 not found: skipped the installer & exit /b 0)
for /f "tokens=2 delims=:, " %%V in ('findstr /c:"\"version\"" neutralino.config.json') do set VER=%%~V
%ISCC% /Q /DAppVersion=%VER% build\installer.iss || exit /b 1
echo Built dist\Assetto-Launcher-Setup-%VER%.exe
