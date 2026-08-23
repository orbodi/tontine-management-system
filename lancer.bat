@echo off
setlocal EnableExtensions
cd /d "%~dp0"

set "API_HOST=127.0.0.1"
set "API_PORT=8000"

echo ========================================
echo  DON DE DIEU — demarrage API + Front
echo ========================================
echo.

where node >nul 2>&1
if errorlevel 1 (
  echo [ERREUR] Node.js n'est pas installe ou pas dans le PATH.
  echo Telechargez-le sur https://nodejs.org
  pause
  exit /b 1
)

set "PY_CMD="
py -3.12 -c "import sys" >nul 2>&1
if not errorlevel 1 (
  set "PY_CMD=py -3.12"
) else (
  py -3 -c "import sys" >nul 2>&1
  if not errorlevel 1 (
    set "PY_CMD=py -3"
  ) else (
    where python >nul 2>&1
    if not errorlevel 1 (
      set "PY_CMD=python"
    )
  )
)

if not defined PY_CMD (
  echo [ERREUR] Python n'est pas installe ou pas dans le PATH.
  echo Installez Python 3.12 depuis https://www.python.org
  echo ^(ou le lanceur "py" avec Python 3.12^)
  pause
  exit /b 1
)

if not exist "node_modules\" (
  echo [Front] Installation des dependances npm...
  call npm install
  if errorlevel 1 (
    echo [ERREUR] Echec de npm install.
    pause
    exit /b 1
  )
  echo.
)

if not exist "backend\.venv\Scripts\python.exe" (
  echo [API] Creation de l'environnement virtuel Python...
  %PY_CMD% -m venv "backend\.venv"
  if errorlevel 1 (
    echo [ERREUR] Impossible de creer backend\.venv
    pause
    exit /b 1
  )
)

if not exist "backend\.venv\Scripts\uvicorn.exe" (
  echo [API] Installation des dependances Python...
  call "backend\.venv\Scripts\python.exe" -m pip install --upgrade pip
  call "backend\.venv\Scripts\pip.exe" install -r "backend\requirements.txt"
  if errorlevel 1 (
    echo [ERREUR] Echec de pip install.
    pause
    exit /b 1
  )
  echo.
)

REM --- API deja joignable ? ---
set "API_READY=0"
powershell -NoProfile -Command "try { $r = Invoke-WebRequest -UseBasicParsing -Uri 'http://%API_HOST%:%API_PORT%/api/health' -TimeoutSec 2; if ($r.StatusCode -eq 200) { exit 0 } else { exit 1 } } catch { exit 1 }" >nul 2>&1
if not errorlevel 1 (
  set "API_READY=1"
  echo [API] Deja demarree sur http://%API_HOST%:%API_PORT% — reutilisation.
) else (
  call :free_port %API_PORT%
  echo [API] Demarrage FastAPI sur http://%API_HOST%:%API_PORT% ...
  start "DON DE DIEU - API" /D "%~dp0backend" cmd /k ".venv\Scripts\uvicorn.exe app.main:app --reload --host %API_HOST% --port %API_PORT%"
  timeout /t 3 /nobreak >nul
)

echo [Front] Demarrage Vite ^(navigateur^)...
echo.
echo Front : http://localhost:5173
echo API   : http://%API_HOST%:%API_PORT%/api/health
echo Docs  : http://%API_HOST%:%API_PORT%/docs
echo.
echo Fermez cette fenetre ou Ctrl+C pour arreter le front.
echo La fenetre "DON DE DIEU - API" reste ouverte pour le backend.
echo.

call npm run start
exit /b %ERRORLEVEL%

:free_port
set "PORT=%~1"
for /f "tokens=5" %%P in ('netstat -ano ^| findstr /R /C:":%PORT% .*LISTENING"') do (
  echo [API] Port %PORT% occupe ^(PID %%P^) — arret du processus...
  taskkill /PID %%P /F >nul 2>&1
)
timeout /t 1 /nobreak >nul
exit /b 0
