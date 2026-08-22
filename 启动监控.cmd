@echo off
cd /d "%~dp0"

set "PYTHON="
where python >nul 2>nul && set "PYTHON=python"

if not defined PYTHON (
    if exist "C:\Users\15799\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe" (
        set "PYTHON=C:\Users\15799\.cache\codex-runtimes\codex-primary-runtime\dependencies\python\python.exe"
    )
)

if not defined PYTHON (
    echo Python was not found.
    pause
    exit /b 1
)

echo Starting Bilibili follower monitor...
"%PYTHON%" app.py
pause
