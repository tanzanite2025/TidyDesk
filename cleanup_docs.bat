@echo off
echo ========================================
echo TidyDesk 文档清理脚本
echo ========================================
echo.
echo 此脚本将：
echo 1. 创建归档目录
echo 2. 移动历史文档到归档
echo 3. 删除重复/过时文档
echo.
echo 按任意键继续，或关闭窗口取消...
pause >nul
echo.

echo [1/4] 创建归档目录...
if not exist docs mkdir docs
if not exist docs\archive mkdir docs\archive
if not exist docs\archive\v3.0 mkdir docs\archive\v3.0
if not exist docs\archive\git-setup mkdir docs\archive\git-setup
echo 目录创建完成！
echo.

echo [2/4] 移动历史开发文档到归档...
if exist ANIMATION_FIXES.md move ANIMATION_FIXES.md docs\archive\v3.0\
if exist ANIMATION_IMPROVEMENTS.md move ANIMATION_IMPROVEMENTS.md docs\archive\v3.0\
if exist CODE_AUDIT_REPORT.md move CODE_AUDIT_REPORT.md docs\archive\v3.0\
if exist DEEP_AUDIT_FINDINGS.md move DEEP_AUDIT_FINDINGS.md docs\archive\v3.0\
if exist DEEP_FIXES_APPLIED.md move DEEP_FIXES_APPLIED.md docs\archive\v3.0\
if exist FIXES_APPLIED.md move FIXES_APPLIED.md docs\archive\v3.0\
if exist OPTIMIZATION_SUMMARY.md move OPTIMIZATION_SUMMARY.md docs\archive\v3.0\
if exist VISUAL_UNITY_IMPROVEMENTS.md move VISUAL_UNITY_IMPROVEMENTS.md docs\archive\v3.0\
if exist RELEASE_v3.0.1.md move RELEASE_v3.0.1.md docs\archive\v3.0\
echo 历史文档归档完成！
echo.

echo [3/4] 移动 Git 配置文档到归档...
if exist GIT_CONFIGURATION_SUMMARY.md move GIT_CONFIGURATION_SUMMARY.md docs\archive\git-setup\
if exist GIT_READY_CHECKLIST.md move GIT_READY_CHECKLIST.md docs\archive\git-setup\
if exist GIT_SETUP_GUIDE.md move GIT_SETUP_GUIDE.md docs\archive\git-setup\
echo Git 文档归档完成！
echo.

echo [4/4] 删除重复/过时文档...
if exist FINAL_SUMMARY.md del FINAL_SUMMARY.md
if exist PROJECT_COMPLETE.md del PROJECT_COMPLETE.md
if exist PROJECT_COMPLETION_REPORT.md del PROJECT_COMPLETION_REPORT.md
if exist PROJECT_STATUS.md del PROJECT_STATUS.md
if exist NEXT_STEPS.md del NEXT_STEPS.md
echo 重复文档删除完成！
echo.

echo ========================================
echo 清理完成！
echo ========================================
echo.
echo 归档位置：
echo - docs\archive\v3.0\ - 历史开发文档
echo - docs\archive\git-setup\ - Git 配置文档
echo.
echo 已删除的重复文档：
echo - FINAL_SUMMARY.md
echo - PROJECT_COMPLETE.md
echo - PROJECT_COMPLETION_REPORT.md
echo - PROJECT_STATUS.md
echo - NEXT_STEPS.md
echo.
pause
