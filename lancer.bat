@echo off
cd /d "%~dp0"

where node >nul 2>&1
if errorlevel 1 (
  echo Node.js n'est pas installe ou pas dans le PATH.
  echo Telechargez-le sur https://nodejs.org
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo Installation des dependances...
  call npm install
  if errorlevel 1 (
    echo Echec de npm install.
    pause
    exit /b 1
  )
)

echo Demarrage de DON DE DIEU (ouverture du navigateur)...
call npm run start
