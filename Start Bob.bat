@echo off
title Bob - Hermes Server
cd /d "%~dp0hermes"

echo ============================================
echo   Menyalakan otak Bob (Hermes)...
echo ============================================
echo.

REM Install dependency otomatis kalau folder node_modules belum ada
if not exist "node_modules" (
    echo [setup] node_modules belum ada, menjalankan npm install...
    call npm install
    echo.
)

REM Buka browser ke Bob setelah server siap (delay 3 detik)
start "" /b cmd /c "timeout /t 3 /nobreak >nul & start http://localhost:3000"

echo Server jalan di http://localhost:3000
echo Browser akan terbuka otomatis sebentar lagi.
echo.
echo JANGAN tutup jendela ini selama pakai Bob.
echo Tutup jendela ini untuk mematikan server.
echo ============================================
echo.

node server.js

echo.
echo Server berhenti. Tekan tombol apa saja untuk menutup.
pause >nul
