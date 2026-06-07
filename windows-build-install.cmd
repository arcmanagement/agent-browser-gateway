@echo off
setlocal
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\build-install-windows-x64.ps1" %*
exit /b %ERRORLEVEL%
