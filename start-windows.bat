@echo off
cd /d "%~dp0"
echo.
echo Wishloom will open at http://127.0.0.1:8080
 echo Press Ctrl+C to stop.
echo.
py -3 app.py
if errorlevel 1 (
  echo.
  echo If Python is installed but 'py' is unavailable, try: python app.py
  pause
)
