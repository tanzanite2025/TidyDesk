# TidyDesk 清理脚本
# 删除所有不应该提交到 Git 的文件

Write-Host "🧹 TidyDesk 清理脚本" -ForegroundColor Cyan
Write-Host "================================" -ForegroundColor Cyan
Write-Host ""

# 删除日志文件
Write-Host "📝 删除日志文件..." -ForegroundColor Yellow
$logFiles = Get-ChildItem -Path . -Filter "*.log" -File
if ($logFiles) {
    foreach ($file in $logFiles) {
        Remove-Item $file.FullName -Force
        Write-Host "  ✓ 删除: $($file.Name)" -ForegroundColor Green
    }
} else {
    Write-Host "  ℹ 未找到日志文件" -ForegroundColor Gray
}

# 删除临时文件
Write-Host ""
Write-Host "🗑️  删除临时文件..." -ForegroundColor Yellow
$tempPatterns = @("*.tmp", "*.temp", "*.swp", "*.swo", "*~")
$tempCount = 0
foreach ($pattern in $tempPatterns) {
    $tempFiles = Get-ChildItem -Path . -Filter $pattern -File -Recurse -ErrorAction SilentlyContinue
    foreach ($file in $tempFiles) {
        Remove-Item $file.FullName -Force
        Write-Host "  ✓ 删除: $($file.Name)" -ForegroundColor Green
        $tempCount++
    }
}
if ($tempCount -eq 0) {
    Write-Host "  ℹ 未找到临时文件" -ForegroundColor Gray
}

# 删除 node_modules（如果存在）
Write-Host ""
Write-Host "📦 检查 node_modules..." -ForegroundColor Yellow
if (Test-Path "node_modules") {
    $size = (Get-ChildItem -Path "node_modules" -Recurse -File | Measure-Object -Property Length -Sum).Sum / 1MB
    Write-Host "  ⚠️  发现 node_modules (大小: $([math]::Round($size, 2)) MB)" -ForegroundColor Yellow
    $confirm = Read-Host "  是否删除? (y/N)"
    if ($confirm -eq 'y' -or $confirm -eq 'Y') {
        Remove-Item "node_modules" -Recurse -Force
        Write-Host "  ✓ 已删除 node_modules" -ForegroundColor Green
    } else {
        Write-Host "  ℹ 跳过删除" -ForegroundColor Gray
    }
} else {
    Write-Host "  ℹ node_modules 不存在" -ForegroundColor Gray
}

# 删除 dist 目录
Write-Host ""
Write-Host "🏗️  检查构建输出..." -ForegroundColor Yellow
$buildDirs = @("dist", "dist-electron", "out", "build")
foreach ($dir in $buildDirs) {
    if (Test-Path $dir) {
        $size = (Get-ChildItem -Path $dir -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
        Write-Host "  ⚠️  发现 $dir (大小: $([math]::Round($size, 2)) MB)" -ForegroundColor Yellow
        Remove-Item $dir -Recurse -Force
        Write-Host "  ✓ 已删除 $dir" -ForegroundColor Green
    }
}

# 删除缓存目录
Write-Host ""
Write-Host "💾 检查缓存..." -ForegroundColor Yellow
$cacheDirs = @(".cache", ".parcel-cache", ".rpt2_cache", ".rts2_cache_cjs", ".rts2_cache_es", ".rts2_cache_umd")
$cacheCount = 0
foreach ($dir in $cacheDirs) {
    if (Test-Path $dir) {
        Remove-Item $dir -Recurse -Force
        Write-Host "  ✓ 删除: $dir" -ForegroundColor Green
        $cacheCount++
    }
}
if ($cacheCount -eq 0) {
    Write-Host "  ℹ 未找到缓存目录" -ForegroundColor Gray
}

# 统计
Write-Host ""
Write-Host "================================" -ForegroundColor Cyan
Write-Host "✅ 清理完成！" -ForegroundColor Green
Write-Host ""

# 显示当前目录大小
$totalSize = (Get-ChildItem -Path . -Recurse -File -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum / 1MB
Write-Host "📊 当前项目大小: $([math]::Round($totalSize, 2)) MB" -ForegroundColor Cyan
Write-Host ""
