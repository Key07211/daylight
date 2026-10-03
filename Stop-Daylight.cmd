@echo off
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\Stop-Daylight.ps1"
if errorlevel 1 pause
