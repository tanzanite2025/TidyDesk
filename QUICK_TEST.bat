@echo off
setlocal enabledelayedexpansion

echo.
echo ========================================
echo   TidyDesk Screenshot Fix - Quick Test
echo ========================================
echo.
echo Test Steps:
echo.
echo 1. Run diagnostic tool (test system support)
echo 2. Start application (test actual function)
echo 3. Click screenshot button
echo.
echo ========================================
echo.

:menu
echo.
echo Please select an option:
echo.
echo [1] Run diagnostic tool (test transparent window)
echo [2] Start application (npm run desktop)
echo [3] View test guide
echo [4] View fix summary
echo [0] Exit
echo.
set /p choice="Enter option (0-4): "

if "%choice%"=="1" goto diagnose
if "%choice%"=="2" goto start_app
if "%choice%"=="3" goto test_guide
if "%choice%"=="4" goto summary
if "%choice%"=="0" goto end
echo Invalid option, please try again
echo.
goto menu

:diagnose
echo.
echo ========================================
echo   Running Diagnostic Tool
echo ========================================
echo.
echo Starting diagnostic tool...
echo Expected: 3 test windows with semi-transparent overlay
echo If you can see desktop content, system supports transparent windows
echo Press Esc to close test windows
echo.
pause
call electron diagnose-screenshot.cjs
if errorlevel 1 (
    echo.
    echo ERROR: Failed to run diagnostic tool
    echo Make sure electron is installed: npm install -g electron
    echo.
) else (
    echo.
    echo Diagnostic complete!
    echo.
)
pause
goto menu

:start_app
echo.
echo ========================================
echo   Starting Application
echo ========================================
echo.
echo Starting TidyDesk...
echo This will start both Vite dev server and Electron
echo.
echo After startup:
echo 1. Click screenshot button
echo 2. Check if semi-transparent overlay is displayed
echo 3. Try to drag and select area
echo 4. Check if sticker is created successfully
echo.
pause
call npm run desktop
goto menu

:test_guide
echo.
echo ========================================
echo   Test Guide
echo ========================================
echo.
if exist TEST_SCREENSHOT_FIX.md (
    type TEST_SCREENSHOT_FIX.md
) else (
    echo ERROR: TEST_SCREENSHOT_FIX.md not found
)
echo.
pause
goto menu

:summary
echo.
echo ========================================
echo   Fix Summary
echo ========================================
echo.
if exist SCREENSHOT_FIX_SUMMARY.md (
    type SCREENSHOT_FIX_SUMMARY.md
) else (
    echo ERROR: SCREENSHOT_FIX_SUMMARY.md not found
)
echo.
pause
goto menu

:end
echo.
echo Thank you for using!
echo.
pause
exit /b 0
