@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"

where node >nul 2>nul
if errorlevel 1 (
  echo.
  echo  Node.js nao encontrado.
  echo  Instale em https://nodejs.org e abra este arquivo novamente.
  echo.
  pause
  exit /b 1
)

if not exist node_modules (
  echo.
  echo  Primeira execucao: instalando dependencias...
  echo.
  call npm install
  if errorlevel 1 (
    echo.
    echo  Falha ao instalar as dependencias. Verifique sua internet.
    echo.
    pause
    exit /b 1
  )
)

echo.
echo  Iniciando o COTEC Facil...
start "" powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep -Seconds 2; Start-Process 'http://localhost:3000'"
node server.js

echo.
echo  Servidor encerrado.
pause
