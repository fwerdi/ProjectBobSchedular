@echo off
title Bob - Hermes + Tunnel
cd /d "%~dp0hermes"

echo ============================================
echo   Menyalakan otak Bob (Hermes) + Tunnel
echo ============================================
echo.

REM Install dependency otomatis kalau belum ada
if not exist "node_modules" (
    echo [setup] npm install...
    call npm install
    echo.
)

REM Cari cloudflared.exe
set "CF=C:\Program Files (x86)\cloudflared\cloudflared.exe"
if not exist "%CF%" set "CF=C:\Program Files\cloudflared\cloudflared.exe"

REM Jalankan Hermes di jendela terpisah
start "Bob - Hermes Server" cmd /k "cd /d "%~dp0hermes" && node server.js"

REM Beri waktu server siap
timeout /t 3 /nobreak >nul

echo.
echo ============================================
echo   ALAMAT TUNNEL (buat ditempel di web Bob):
echo   Cari baris "https://xxxx.trycloudflare.com"
echo   di bawah ini, lalu copy ke tombol gear web.
echo ============================================
echo.
echo JANGAN tutup jendela ini - ini tunnel-nya.
echo.

REM Jalankan tunnel (alamat muncul di jendela ini)
"%CF%" tunnel --url http://localhost:3000

echo.
echo Tunnel berhenti. Tekan tombol apa saja untuk menutup.
pause >nul
