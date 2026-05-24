@echo off
echo ========================================
echo   TidyDesk Workspace Cleanup Script
echo ========================================
echo.
echo This script will:
echo 1. Delete temporary diagnostic scripts
echo 2. Delete outdated documentation
echo 3. Archive completed feature docs to docs/archive/v3.4.1/
echo.
echo Press Ctrl+C to cancel, or
pause

echo.
echo [1/3] Creating archive directory...
if not exist "docs\archive\v3.4.1" mkdir "docs\archive\v3.4.1"
echo Created: docs\archive\v3.4.1\

echo.
echo [2/3] Deleting temporary files...

REM Screenshot fix related
if exist "diagnose-screenshot.cjs" del "diagnose-screenshot.cjs" && echo Deleted: diagnose-screenshot.cjs
if exist "QUICK_TEST.bat" del "QUICK_TEST.bat" && echo Deleted: QUICK_TEST.bat
if exist "test-diagnose.bat" del "test-diagnose.bat" && echo Deleted: test-diagnose.bat
if exist "test-app.bat" del "test-app.bat" && echo Deleted: test-app.bat
if exist "README_SCREENSHOT_FIX.md" del "README_SCREENSHOT_FIX.md" && echo Deleted: README_SCREENSHOT_FIX.md
if exist "SCREENSHOT_FIX_SUMMARY.md" del "SCREENSHOT_FIX_SUMMARY.md" && echo Deleted: SCREENSHOT_FIX_SUMMARY.md
if exist "TEST_SCREENSHOT_FIX.md" del "TEST_SCREENSHOT_FIX.md" && echo Deleted: TEST_SCREENSHOT_FIX.md
if exist "WORK_COMPLETE.md" del "WORK_COMPLETE.md" && echo Deleted: WORK_COMPLETE.md

REM Performance diagnostic scripts
if exist "analyze-processes.cjs" del "analyze-processes.cjs" && echo Deleted: analyze-processes.cjs
if exist "diagnose-current-state.cjs" del "diagnose-current-state.cjs" && echo Deleted: diagnose-current-state.cjs
if exist "diagnose-extra-processes.cjs" del "diagnose-extra-processes.cjs" && echo Deleted: diagnose-extra-processes.cjs
if exist "diagnose-handles.ps1" del "diagnose-handles.ps1" && echo Deleted: diagnose-handles.ps1
if exist "diagnose-performance.cjs" del "diagnose-performance.cjs" && echo Deleted: diagnose-performance.cjs
if exist "diagnose-processes.ps1" del "diagnose-processes.ps1" && echo Deleted: diagnose-processes.ps1
if exist "diagnose-ui.cjs" del "diagnose-ui.cjs" && echo Deleted: diagnose-ui.cjs
if exist "test-handles.cjs" del "test-handles.cjs" && echo Deleted: test-handles.cjs
if exist "test-performance-ipc.cjs" del "test-performance-ipc.cjs" && echo Deleted: test-performance-ipc.cjs
if exist "test-performance.cjs" del "test-performance.cjs" && echo Deleted: test-performance.cjs
if exist "monitor-performance.cjs" del "monitor-performance.cjs" && echo Deleted: monitor-performance.cjs

REM Audit files
if exist "deep-audit.cjs" del "deep-audit.cjs" && echo Deleted: deep-audit.cjs
if exist "audit-report.json" del "audit-report.json" && echo Deleted: audit-report.json
if exist "AUDIT_SUMMARY.md" del "AUDIT_SUMMARY.md" && echo Deleted: AUDIT_SUMMARY.md

REM Other temporary files
if exist "fix-existing-stickers.cjs" del "fix-existing-stickers.cjs" && echo Deleted: fix-existing-stickers.cjs
if exist "convert-icon.cjs" del "convert-icon.cjs" && echo Deleted: convert-icon.cjs
if exist "create-icon.cjs" del "create-icon.cjs" && echo Deleted: create-icon.cjs
if exist "merge-icons.cjs" del "merge-icons.cjs" && echo Deleted: merge-icons.cjs
if exist "kill-tidydesk.bat" del "kill-tidydesk.bat" && echo Deleted: kill-tidydesk.bat
if exist "cleanup_docs.bat" del "cleanup_docs.bat" && echo Deleted: cleanup_docs.bat
if exist "implementation_plan.md" del "implementation_plan.md" && echo Deleted: implementation_plan.md
if exist "task.md" del "task.md" && echo Deleted: task.md
if exist "walkthrough.md" del "walkthrough.md" && echo Deleted: walkthrough.md
if exist "RELEASE_v3.4.1_FINAL.md" del "RELEASE_v3.4.1_FINAL.md" && echo Deleted: RELEASE_v3.4.1_FINAL.md
if exist "$null" del "$null" && echo Deleted: $null

REM Screenshot docs
if exist "docs\development\SCREENSHOT_FIX_IMPLEMENTATION.md" del "docs\development\SCREENSHOT_FIX_IMPLEMENTATION.md" && echo Deleted: docs\development\SCREENSHOT_FIX_IMPLEMENTATION.md
if exist "docs\development\SCREENSHOT_TROUBLESHOOTING.md" del "docs\development\SCREENSHOT_TROUBLESHOOTING.md" && echo Deleted: docs\development\SCREENSHOT_TROUBLESHOOTING.md

echo.
echo [3/3] Archiving completed feature docs...

REM Performance optimization docs
if exist "docs\development\STAGE1_LAZY_WINDOW_RESULTS.md" move "docs\development\STAGE1_LAZY_WINDOW_RESULTS.md" "docs\archive\v3.4.1\" >nul && echo Archived: STAGE1_LAZY_WINDOW_RESULTS.md
if exist "docs\development\STAGE2_PROCESS_ANALYSIS.md" move "docs\development\STAGE2_PROCESS_ANALYSIS.md" "docs\archive\v3.4.1\" >nul && echo Archived: STAGE2_PROCESS_ANALYSIS.md
if exist "docs\development\STAGE2_SUCCESS_SUMMARY.md" move "docs\development\STAGE2_SUCCESS_SUMMARY.md" "docs\archive\v3.4.1\" >nul && echo Archived: STAGE2_SUCCESS_SUMMARY.md
if exist "docs\development\STAGE3_HANDLE_ANALYSIS_COMPLETE.md" move "docs\development\STAGE3_HANDLE_ANALYSIS_COMPLETE.md" "docs\archive\v3.4.1\" >nul && echo Archived: STAGE3_HANDLE_ANALYSIS_COMPLETE.md
if exist "docs\development\STAGE3_HANDLE_LEAK_PLAN.md" move "docs\development\STAGE3_HANDLE_LEAK_PLAN.md" "docs\archive\v3.4.1\" >nul && echo Archived: STAGE3_HANDLE_LEAK_PLAN.md
if exist "docs\development\PERFORMANCE_OPTIMIZATION_COMPLETE.md" move "docs\development\PERFORMANCE_OPTIMIZATION_COMPLETE.md" "docs\archive\v3.4.1\" >nul && echo Archived: PERFORMANCE_OPTIMIZATION_COMPLETE.md

REM Phase 2 docs
if exist "docs\development\PHASE2_CRITICAL_BUG_FOUND.md" move "docs\development\PHASE2_CRITICAL_BUG_FOUND.md" "docs\archive\v3.4.1\" >nul && echo Archived: PHASE2_CRITICAL_BUG_FOUND.md
if exist "docs\development\PHASE2_FINAL_TEST_RESULTS.md" move "docs\development\PHASE2_FINAL_TEST_RESULTS.md" "docs\archive\v3.4.1\" >nul && echo Archived: PHASE2_FINAL_TEST_RESULTS.md
if exist "docs\development\PHASE2_INTEGRATION_COMPLETE.md" move "docs\development\PHASE2_INTEGRATION_COMPLETE.md" "docs\archive\v3.4.1\" >nul && echo Archived: PHASE2_INTEGRATION_COMPLETE.md
if exist "docs\development\PHASE2_TEST_RESULTS.md" move "docs\development\PHASE2_TEST_RESULTS.md" "docs\archive\v3.4.1\" >nul && echo Archived: PHASE2_TEST_RESULTS.md

REM Other old docs
if exist "docs\development\PROCESS_LEAK_FIX_PLAN.md" move "docs\development\PROCESS_LEAK_FIX_PLAN.md" "docs\archive\v3.4.1\" >nul && echo Archived: PROCESS_LEAK_FIX_PLAN.md
if exist "docs\development\CRITICAL_ISSUES_FOUND.md" move "docs\development\CRITICAL_ISSUES_FOUND.md" "docs\archive\v3.4.1\" >nul && echo Archived: CRITICAL_ISSUES_FOUND.md
if exist "docs\development\AUDIT_FINDINGS.md" move "docs\development\AUDIT_FINDINGS.md" "docs\archive\v3.4.1\" >nul && echo Archived: AUDIT_FINDINGS.md
if exist "docs\development\ROOT_CAUSE_ANALYSIS.md" move "docs\development\ROOT_CAUSE_ANALYSIS.md" "docs\archive\v3.4.1\" >nul && echo Archived: ROOT_CAUSE_ANALYSIS.md

REM Completed features
if exist "docs\development\ADVANCED_FEATURES_COMPLETE.md" move "docs\development\ADVANCED_FEATURES_COMPLETE.md" "docs\archive\v3.4.1\" >nul && echo Archived: ADVANCED_FEATURES_COMPLETE.md
if exist "docs\development\IMPLEMENTATION_COMPLETE.md" move "docs\development\IMPLEMENTATION_COMPLETE.md" "docs\archive\v3.4.1\" >nul && echo Archived: IMPLEMENTATION_COMPLETE.md
if exist "docs\development\APP_PICKER_FEATURE.md" move "docs\development\APP_PICKER_FEATURE.md" "docs\archive\v3.4.1\" >nul && echo Archived: APP_PICKER_FEATURE.md
if exist "docs\development\APP_PICKER_WINDOW_UPGRADE.md" move "docs\development\APP_PICKER_WINDOW_UPGRADE.md" "docs\archive\v3.4.1\" >nul && echo Archived: APP_PICKER_WINDOW_UPGRADE.md
if exist "docs\development\BACKGROUND_SCAN_IMPLEMENTATION.md" move "docs\development\BACKGROUND_SCAN_IMPLEMENTATION.md" "docs\archive\v3.4.1\" >nul && echo Archived: BACKGROUND_SCAN_IMPLEMENTATION.md
if exist "docs\development\FILE_MANAGEMENT_UPGRADE.md" move "docs\development\FILE_MANAGEMENT_UPGRADE.md" "docs\archive\v3.4.1\" >nul && echo Archived: FILE_MANAGEMENT_UPGRADE.md
if exist "docs\development\INCREMENTAL_UPDATE_IMPLEMENTATION.md" move "docs\development\INCREMENTAL_UPDATE_IMPLEMENTATION.md" "docs\archive\v3.4.1\" >nul && echo Archived: INCREMENTAL_UPDATE_IMPLEMENTATION.md
if exist "docs\development\DELETE_FIX.md" move "docs\development\DELETE_FIX.md" "docs\archive\v3.4.1\" >nul && echo Archived: DELETE_FIX.md
if exist "docs\development\ICON_DISPLAY_FIX.md" move "docs\development\ICON_DISPLAY_FIX.md" "docs\archive\v3.4.1\" >nul && echo Archived: ICON_DISPLAY_FIX.md
if exist "docs\development\TRAY_ICON_FIX.md" move "docs\development\TRAY_ICON_FIX.md" "docs\archive\v3.4.1\" >nul && echo Archived: TRAY_ICON_FIX.md
if exist "docs\development\STICKER_ALWAYSONTOP_FIX.md" move "docs\development\STICKER_ALWAYSONTOP_FIX.md" "docs\archive\v3.4.1\" >nul && echo Archived: STICKER_ALWAYSONTOP_FIX.md
if exist "docs\development\SHORTCUT_VALIDATION_IMPROVEMENTS.md" move "docs\development\SHORTCUT_VALIDATION_IMPROVEMENTS.md" "docs\archive\v3.4.1\" >nul && echo Archived: SHORTCUT_VALIDATION_IMPROVEMENTS.md

echo.
echo ========================================
echo   Cleanup Complete!
echo ========================================
echo.
echo Summary:
echo - Deleted 35+ temporary files
echo - Archived 25+ completed docs to docs\archive\v3.4.1\
echo - Workspace is now clean and ready for migration
echo.
echo Next steps:
echo 1. Review .kiro/specs/tidydesk-stack-migration/ for migration plan
echo 2. Start TypeScript migration (Phase 1)
echo 3. Delete this cleanup script: del cleanup-workspace.bat
echo.
pause
