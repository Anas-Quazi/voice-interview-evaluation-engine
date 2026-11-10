@echo off
cd /d "%~dp0"

if not exist .env copy .env.example .env >nul
findstr /c:"your_gnani_key_here" /c:"your_gemini_key_here" .env >nul
if not errorlevel 1 (
  echo Paste your GNANI and GEMINI API keys into the file that opens, save it, then close it.
  notepad .env
)

set "PY="
py -3.11 -c "" >nul 2>&1 && set "PY=py -3.11"
if not defined PY py -3 -c "" >nul 2>&1 && set "PY=py -3"
if not defined PY python -c "" >nul 2>&1 && set "PY=python"
if not defined PY (
  echo Python was not found. Install it from python.org, then run this again.
  pause
  exit /b 1
)

if not exist .venv\Scripts\python.exe %PY% -m venv .venv
.venv\Scripts\python.exe -m pip install -q -r backend\requirements.txt
if errorlevel 1 (
  echo Installing packages failed. Check your internet connection and try again.
  pause
  exit /b 1
)

echo.
echo Opening http://localhost:8000 - press Ctrl+C here to stop the app.
start "" cmd /c "timeout /t 4 >nul & start http://localhost:8000"
cd backend
..\.venv\Scripts\python.exe -m uvicorn app:app --port 8000
pause
