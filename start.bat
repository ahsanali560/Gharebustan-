@echo off
cd /d "%~dp0"
title Gharabustan Server
echo Server shuru ho raha hai...
if not exist server.js (
  echo server.js nahi mili. Pehle zip ko Extract All karo, phir extract hue folder se start.bat chalao.
  pause
  exit /b
)
node server.js
pause
