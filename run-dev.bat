@echo off
rem Run the launcher straight from the resources folder (no build step).
cd /d "%~dp0"
bin\neutralino-win_x64.exe --load-dir-res --path=. --window-enable-inspector=true
