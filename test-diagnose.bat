@echo off
echo.
echo Running Screenshot Diagnostic Tool...
echo.
echo Expected: 3 test windows with semi-transparent overlay
echo If you can see desktop content, the fix is working
echo Press Esc to close each test window
echo.
pause
electron diagnose-screenshot.cjs
pause
