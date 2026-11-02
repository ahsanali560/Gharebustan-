@echo off
net session >nul 2>&1
if %errorlevel% neq 0 (
  echo Admin ijazat chahiye, ek window poochegi. "Yes" dabao.
  powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
  exit /b
)
netsh advfirewall firewall delete rule name="Gharabustan 3000" >nul 2>&1
netsh advfirewall firewall add rule name="Gharabustan 3000" dir=in action=allow protocol=TCP localport=3000 profile=any
echo.
echo Ho gaya. Ab start.bat chalao aur phone se link kholo.
pause
