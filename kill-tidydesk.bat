@echo off
echo ========================================
echo 强制关闭所有 TidyDesk 进程
echo ========================================
echo.

taskkill /F /IM TidyDesk.exe /T

echo.
echo ========================================
echo 所有 TidyDesk 进程已关闭
echo ========================================
echo.
pause
