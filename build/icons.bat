@echo off
rem Regenerates the app icons from resources\img\logos\ACLLogo.png:
rem   resources\img\icon.png  window/taskbar icon (256 px)
rem   build\icon.ico          exe icon, embedded by build.bat (16-256 px)
cd /d "%~dp0"
set LOGO=..\resources\img\logos\ACLLogo.png
if not exist ico mkdir ico
for %%s in (16 24 32) do powershell -NoProfile -ExecutionPolicy Bypass -File make-icon.ps1 -Logo "%cd%\%LOGO%" -Out "%cd%\ico\%%s.png" -Size %%s -Fill 1
for %%s in (48 64 128 256) do powershell -NoProfile -ExecutionPolicy Bypass -File make-icon.ps1 -Logo "%cd%\%LOGO%" -Out "%cd%\ico\%%s.png" -Size %%s -Fill 1
node make-ico.js icon.ico ico\16.png ico\24.png ico\32.png ico\48.png ico\64.png ico\128.png ico\256.png
copy /y ico\256.png ..\resources\img\icon.png >nul
rmdir /s /q ico
echo Icons updated.
