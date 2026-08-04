@echo off
setlocal
cd /d "%~dp0"

if not exist node_modules (
  echo Installing dependencies...
  npm install --production
  if errorlevel 1 (
    echo.
    echo ERROR: npm install failed!
    pause
    exit /b 1
  )
)

if exist node_modules\.bin\electron.cmd (
  echo Starting GPU Monitor...
  node_modules\.bin\electron.cmd .
) else (
  echo electron.cmd not found, trying npx...
  npx electron .
)

if errorlevel 1 (
  echo.
  echo Electron exited with an error.
)

pause
