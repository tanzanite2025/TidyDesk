@echo off
echo ========================================
echo TidyDesk 发布脚本
echo ========================================
echo.

echo [1/4] 清理旧构建...
if exist dist rmdir /s /q dist
if exist release rmdir /s /q release
echo 清理完成！
echo.

echo [2/4] 构建应用...
call npm run build
if errorlevel 1 (
    echo 构建失败！
    pause
    exit /b 1
)
echo 构建完成！
echo.

echo [3/4] 发布到 GitHub...
call npm run publish
if errorlevel 1 (
    echo 发布失败！
    pause
    exit /b 1
)
echo 发布完成！
echo.

echo [4/4] 打开 GitHub Releases 页面...
start https://github.com/tanzanite2025/TidyDesk/releases
echo.

echo ========================================
echo 发布成功！
echo ========================================
pause
