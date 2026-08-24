@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "API_HOST=0.0.0.0"
set "API_PORT=8000"
set "API_CHECK=127.0.0.1"

echo ========================================
echo  DON DE DIEU - demarrage API + Front
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 goto err_node

set "PY_CMD="
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 set "PY_CMD=py -3.12"
if not defined PY_CMD (
  py -3 -c "import sys" >nul 2>&1
  if not errorlevel 1 set "PY_CMD=py -3"
)
if not defined PY_CMD (
  where python >nul 2>&1
  if not errorlevel 1 set "PY_CMD=python"
)
if not defined PY_CMD goto err_python

if not exist "node_modules\" (
  echo [Front] Installation des dependances npm...
  call npm install
  if errorlevel 1 goto err_npm
  echo.
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo [API] Creation de l'environnement virtuel Python...
  call %PY_CMD% -m venv "backend\.venv"
  if errorlevel 1 goto err_venv
)

if not exist "backend\.venv\Scripts\uvicorn.exe" (
  echo [API] Installation des dependances Python...
  call "backend\.venv\Scripts\python.exe" -m pip install --upgrade pip
  call "backend\.venv\Scripts\pip.exe" install -r "backend\requirements.txt"
  if errorlevel 1 goto err_pip
  echo.
)

REM --- API joignable et ecoute sur le reseau (0.0.0.0) ? ---
set "API_OK=0"
set "API_LAN=0"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://%API_CHECK%:%API_PORT%/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 set "API_OK=1"
netstat -ano | findstr "LISTENING" | findstr "0.0.0.0:%API_PORT%" >nul 2>&1
if not errorlevel 1 set "API_LAN=1"
if "%API_OK%"=="1" if "%API_LAN%"=="1" (
  echo [API] Deja demarree sur 0.0.0.0:%API_PORT% - reutilisation.
  goto apres_api
)
if "%API_OK%"=="1" (
  echo [API] Instance locale detectee ^(127.0.0.1 seulement^) - redemarrage pour le reseau...
) else (
  echo [API] Demarrage necessaire...
)
goto demarrer_api

:demarrer_api
echo [API] Liberation du port %API_PORT% si necessaire...
powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort %API_PORT% -State Listen -ErrorAction SilentlyContinue | ForEach-Object { Stop-Process -Id $_.OwningProcess -Force -ErrorAction SilentlyContinue }" >nul 2>&1
timeout /t 2 /nobreak >nul
echo [API] Demarrage FastAPI sur 0.0.0.0:%API_PORT% - localhost + reseau local...
start "DON DE DIEU - API" /D "%~dp0backend" cmd /k ".venv\Scripts\uvicorn.exe app.main:app --reload --host 0.0.0.0 --port %API_PORT%"
timeout /t 4 /nobreak >nul

:apres_api
echo [Front] Demarrage Vite - navigateur...
echo.

set "LAN_IP="
for /f "tokens=2 delims=:" %%A in ('ipconfig ^| findstr /C:"IPv4"') do (
  for /f "tokens=*" %%B in ("%%A") do set "LAN_IP=%%B"
)

echo Front local  : http://localhost:5173
if defined LAN_IP echo Front reseau : http://%LAN_IP%:5173
if defined LAN_IP echo API reseau   : http://%LAN_IP%:%API_PORT%/api/health
echo API local    : http://%API_CHECK%:%API_PORT%/api/health
echo Docs         : http://%API_CHECK%:%API_PORT%/docs
echo.
echo Fermez cette fenetre ou Ctrl+C pour arreter le front.
echo La fenetre "DON DE DIEU - API" reste ouverte pour le backend.
echo.

call npm run start
set "EXIT_CODE=%ERRORLEVEL%"
if not "%EXIT_CODE%"=="0" (
  echo.
  echo [ERREUR] Le front s'est arrete avec le code %EXIT_CODE%.
  pause
)
exit /b %EXIT_CODE%

:err_node
echo [ERREUR] Node.js n'est pas installe ou pas dans le PATH.
echo Telechargez-le sur https://nodejs.org
pause
exit /b 1

:err_python
echo [ERREUR] Python n'est pas installe ou pas dans le PATH.
echo Installez Python 3.12 depuis https://www.python.org
pause
exit /b 1

:err_npm
echo [ERREUR] Echec de npm install.
pause
exit /b 1

:err_venv
echo [ERREUR] Impossible de creer backend\.venv
pause
exit /b 1

:err_pip
echo [ERREUR] Echec de pip install.
pause
exit /b 1
