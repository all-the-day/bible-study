@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo Starting bible-study...
echo Browser will open http://localhost:8765
echo Close this window to stop the server.
start "" http://localhost:8765
python -m http.server 8765
