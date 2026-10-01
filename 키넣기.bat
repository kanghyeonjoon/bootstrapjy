@echo off
chcp 65001 >nul
cd /d "%~dp0"
echo 메모장이 열립니다.
echo.
echo   GEMINI_API_KEY=  뒤에 Gemini 키(AIza...)를 붙여넣고
echo   저장(Ctrl+S) 후 메모장을 닫으세요.
echo.
echo   키는 aistudio.google.com/apikey 에서 무료로 만듭니다 (카드 등록 불필요).
echo.
echo 그 다음 실행.bat 을 껐다가 다시 켜야 적용됩니다.
echo.
notepad .env.local
