@echo off
setlocal
where node >nul 2>nul
if errorlevel 1 (
  echo Node.js 22 or newer is required. Install Node.js from https://nodejs.org/
  pause
  exit /b 1
)
echo Starting SettleTrace. Open the local URL reported below after startup.
echo Press Ctrl+C to stop. Sandbox and AI credentials are optional environment variables.
node "%~dp0scripts\start-workspace.mjs" %*
