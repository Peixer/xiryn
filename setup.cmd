@echo off
rem Xiryn - one-step setup for Windows. Double-click this file, or run setup.cmd
rem in a terminal. It runs setup.ps1, which asks before installing anything.
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0setup.ps1" %*
if errorlevel 1 pause
