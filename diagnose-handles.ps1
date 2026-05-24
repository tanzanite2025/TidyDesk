# 诊断句柄使用情况
# 需要 Sysinternals Handle.exe 工具

Write-Host "=== TidyDesk 句柄诊断 ===" -ForegroundColor Cyan
Write-Host ""

# 检查 handle.exe 是否存在
$handleExe = "C:\Tools\handle64.exe"
if (-not (Test-Path $handleExe)) {
    Write-Host "❌ 未找到 handle.exe" -ForegroundColor Red
    Write-Host ""
    Write-Host "请下载 Sysinternals Handle:" -ForegroundColor Yellow
    Write-Host "https://learn.microsoft.com/en-us/sysinternals/downloads/handle"
    Write-Host ""
    Write-Host "下载后解压到 C:\Tools\ 目录"
    exit 1
}

# 获取主进程 PID
$mainProc = Get-Process electron -ErrorAction SilentlyContinue | Where-Object {
    $cmd = (Get-CimInstance Win32_Process -Filter "ProcessId = $($_.Id)" -ErrorAction SilentlyContinue).CommandLine
    $cmd -and -not ($cmd -match "--type=")
} | Select-Object -First 1

if (-not $mainProc) {
    Write-Host "❌ 未找到 TidyDesk 主进程" -ForegroundColor Red
    exit 1
}

$pid = $mainProc.Id
Write-Host "主进程 PID: $pid" -ForegroundColor Green
Write-Host "句柄数量: $($mainProc.HandleCount)" -ForegroundColor Yellow
Write-Host ""

# 使用 handle.exe 分析句柄
Write-Host "正在分析句柄类型..." -ForegroundColor Cyan
$output = & $handleExe -p $pid -nobanner 2>$null

# 统计句柄类型
$handleTypes = @{}
foreach ($line in $output) {
    if ($line -match '^\s+\w+\s+\w+\s+(\w+)\s+') {
        $type = $matches[1]
        if ($handleTypes.ContainsKey($type)) {
            $handleTypes[$type]++
        } else {
            $handleTypes[$type] = 1
        }
    }
}

Write-Host ""
Write-Host "=== 句柄类型统计 ===" -ForegroundColor Green
Write-Host ""

$sorted = $handleTypes.GetEnumerator() | Sort-Object -Property Value -Descending
foreach ($item in $sorted) {
    $percentage = [math]::Round($item.Value / $mainProc.HandleCount * 100, 1)
    Write-Host "$($item.Key): $($item.Value) ($percentage%)"
}

Write-Host ""
Write-Host "=== 详细分析 ===" -ForegroundColor Green
Write-Host ""

# 分析文件句柄
$fileHandles = $output | Where-Object { $_ -match 'File' }
Write-Host "文件句柄: $($fileHandles.Count)" -ForegroundColor Yellow

# 分析事件句柄
$eventHandles = $output | Where-Object { $_ -match 'Event' }
Write-Host "事件句柄: $($eventHandles.Count)" -ForegroundColor Yellow

# 分析线程句柄
$threadHandles = $output | Where-Object { $_ -match 'Thread' }
Write-Host "线程句柄: $($threadHandles.Count)" -ForegroundColor Yellow

Write-Host ""
Write-Host "=== 建议 ===" -ForegroundColor Cyan
Write-Host ""

if ($fileHandles.Count > 100) {
    Write-Host "⚠️  文件句柄过多 ($($fileHandles.Count))，可能是文件监控导致" -ForegroundColor Yellow
    Write-Host "   建议: 减少文件监控范围"
}

if ($eventHandles.Count > 100) {
    Write-Host "⚠️  事件句柄过多 ($($eventHandles.Count))，可能是事件监听器未清理" -ForegroundColor Yellow
    Write-Host "   建议: 检查事件监听器"
}

if ($threadHandles.Count > 50) {
    Write-Host "⚠️  线程句柄过多 ($($threadHandles.Count))，可能是线程泄漏" -ForegroundColor Yellow
    Write-Host "   建议: 检查异步操作"
}

Write-Host ""
