@echo off
setlocal
set SCRIPT_DIR=%~dp0
set BACKEND_DIR=%SCRIPT_DIR%backend
set FRONTEND_DIR=%SCRIPT_DIR%frontend

echo == CraftLaunch Setup ==
echo.

echo =^> Installing Python dependencies...
cd /d "%BACKEND_DIR%"
pip install -r requirements.txt
if %errorlevel% neq 0 (
    echo ERROR: pip install failed. Is Python 3.10+ installed?
    pause & exit /b 1
)

echo.
echo =^> Installing Node.js dependencies...
cd /d "%FRONTEND_DIR%"
where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: npm not found. Install Node.js 18+ from nodejs.org
    pause & exit /b 1
)
npm install
if %errorlevel% neq 0 ( pause & exit /b 1 )

echo.
echo =^> Building React frontend...
npm run build
if %errorlevel% neq 0 ( pause & exit /b 1 )

echo.
echo =^> Done! Run CraftLaunch with:
echo     python backend\main.py
echo.
echo Or for development:
echo     cd frontend ^&^& npm run dev       (terminal 1)
echo     python backend\main.py --dev      (terminal 2)
echo.
pause
