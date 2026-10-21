@echo off
title Bob - Stop Server
echo Mematikan server Bob (Hermes)...

REM Matikan proses node yang jalan di port 3000
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":3000" ^| findstr "LISTENING"') do (
    echo Menutup proses PID %%a
    taskkill /F /PID %%a >nul 2>&1
)

echo Selesai.
timeout /t 2 /nobreak >nul
