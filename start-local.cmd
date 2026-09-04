@echo off
setlocal
cd /d "%~dp0"
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0start-local.ps1" -OpenBrowser -RestartExisting
if errorlevel 1 pause
