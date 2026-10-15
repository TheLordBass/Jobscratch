@echo off
title JobScratch JobSpy helper
cd /d "%~dp0"
if exist ".venv\Scripts\python.exe" (
  ".venv\Scripts\python.exe" helper.py %*
) else (
  python helper.py %*
)
if errorlevel 1 pause
