@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo.
echo   ==============================
echo    레퍼런스 (이 PC에서 실행)
echo   ==============================
echo.
if not exist node_modules echo [최초 1회] 준비 중입니다. 몇 분 걸릴 수 있어요...
if not exist node_modules call npm install
echo 서버를 켜는 중입니다. 잠시 후 브라우저가 열립니다...
start "server" cmd /k npm run dev
timeout /t 8 >nul
start "" http://localhost:3100
echo.
echo - 안 열리면 http://localhost:3100 으로 직접 들어가세요.
echo - 다 쓰면 새로 뜬 "server" 창을 닫으면 꺼집니다.
echo.
pause
