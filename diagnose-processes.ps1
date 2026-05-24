# 诊断 Electron 进程
Write-Host "=" * 80
Write-Host "诊断 Electron 进程"
Write-Host "=" * 80
Write-Host ""

# 获取所有 electron.exe 进程
$processes = Get-Process -Name electron -ErrorAction SilentlyContinue

if ($processes.Count -eq 0) {
    Write-Host "未找到 electron.exe 进程"
    exit 1
}

Write-Host "找到 $($processes.Count) 个 electron.exe 进程"
Write-Host ""

# 分析每个进程
$processInfo = @()
foreach ($proc in $processes) {
    try {
        $commandLine = (Get-CimInstance Win32_Process -Filter "ProcessId = $($proc.Id)").CommandLine
        
        # 解析进程类型
        $type = "Main Process"
        $details = ""
        
        if ($commandLine -match "--type=gpu-process") {
            $type = "GPU Process"
        }
        elseif ($commandLine -match "--type=renderer") {
            $type = "Renderer Process"
            
            if ($commandLine -match "mode=rail") {
                $details = "(handleWindow)"
            }
            elseif ($commandLine -match "mode=drawer") {
                $details = "(drawerWindow)"
            }
            elseif ($commandLine -match "mode=todos") {
                $details = "(todoWindow)"
            }
            elseif ($commandLine -match "mode=capture") {
                $details = "(captureWindow)"
            }
            elseif ($commandLine -match "mode=app-picker") {
                $details = "(appPickerWindow)"
            }
            else {
                $details = "(Unknown Window)"
            }
        }
        elseif ($commandLine -match "--type=utility") {
            $type = "Utility Process"
            
            if ($commandLine -match "network\.mojom\.NetworkService") {
                $details = "(Network Service)"
            }
            elseif ($commandLine -match "storage\.mojom\.StorageService") {
                $details = "(Storage Service)"
            }
            elseif ($commandLine -match "audio\.mojom\.AudioService") {
                $details = "(Audio Service)"
            }
            else {
                $details = "(Unknown Utility)"
            }
        }
        
        $processInfo += [PSCustomObject]@{
            PID = $proc.Id
            Type = $type
            Details = $details
            Memory_MB = [math]::Round($proc.WorkingSet64 / 1MB, 2)
            Handles = $proc.HandleCount
            CPU_Percent = $proc.CPU
        }
    }
    catch {
        Write-Host "无法获取进程 $($proc.Id) 的信息: $_"
    }
}

# 按类型分组
$grouped = $processInfo | Group-Object -Property Type

Write-Host "进程分类统计:"
Write-Host "-" * 80
Write-Host ""

$totalProcesses = 0
foreach ($group in $grouped) {
    Write-Host "$($group.Name): $($group.Count) 个"
    $totalProcesses += $group.Count
    
    foreach ($proc in $group.Group) {
        Write-Host "  PID $($proc.PID) $($proc.Details)"
        Write-Host "    内存: $($proc.Memory_MB) MB"
        Write-Host "    句柄: $($proc.Handles)"
    }
    Write-Host ""
}

Write-Host "=" * 80
Write-Host "总进程数: $totalProcesses"
Write-Host "=" * 80
Write-Host ""

# 分析额外进程
Write-Host "额外进程分析:"
Write-Host "-" * 80
Write-Host ""

$expected = @{
    "Main Process" = 1
    "GPU Process" = 1
    "Renderer Process" = 2  # handleWindow + drawerWindow
}

$extraProcesses = 0
foreach ($type in $expected.Keys) {
    $actual = ($grouped | Where-Object { $_.Name -eq $type }).Count
    if ($null -eq $actual) { $actual = 0 }
    
    $diff = $actual - $expected[$type]
    
    if ($diff -gt 0) {
        Write-Host "❌ ${type}: 预期 $($expected[$type]) 个，实际 $actual 个，多了 $diff 个"
        $extraProcesses += $diff
    }
    elseif ($diff -lt 0) {
        Write-Host "⚠️  ${type}: 预期 $($expected[$type]) 个，实际 $actual 个，少了 $(-$diff) 个"
    }
    else {
        Write-Host "✅ ${type}: $actual 个（正常）"
    }
}

# 检查意外的进程类型
foreach ($group in $grouped) {
    if (-not $expected.ContainsKey($group.Name)) {
        Write-Host "❓ $($group.Name): $($group.Count) 个（意外的进程类型）"
        $extraProcesses += $group.Count
    }
}

Write-Host ""
Write-Host "=" * 80
Write-Host "额外进程总数: $extraProcesses"
Write-Host "=" * 80
Write-Host ""

# 统计总资源使用
$totalMemory = ($processInfo | Measure-Object -Property Memory_MB -Sum).Sum
$totalHandles = ($processInfo | Measure-Object -Property Handles -Sum).Sum

Write-Host "资源使用统计:"
Write-Host "-" * 80
Write-Host "总内存: $([math]::Round($totalMemory, 2)) MB"
Write-Host "总句柄: $totalHandles"
Write-Host ""

# 建议
Write-Host "=" * 80
Write-Host "建议:"
Write-Host "-" * 80
Write-Host ""

if (($grouped | Where-Object { $_.Name -eq "Utility Process" }).Count -gt 0) {
    Write-Host "⚠️  检测到 Utility Process，这是 Electron 的辅助进程"
    Write-Host "   - Network Service: 网络服务"
    Write-Host "   - Storage Service: 存储服务"
    Write-Host "   - Audio Service: 音频服务"
    Write-Host "   这些进程是 Electron 自动创建的，无法避免"
    Write-Host ""
}

$rendererCount = ($grouped | Where-Object { $_.Name -eq "Renderer Process" }).Count
if ($rendererCount -gt 2) {
    Write-Host "❌ 检测到多余的渲染进程！"
    Write-Host "   可能原因:"
    Write-Host "   1. todoWindow 或 captureWindow 被意外创建"
    Write-Host "   2. appPickerWindow 正在运行"
    Write-Host "   3. 有隐藏的窗口未销毁"
    Write-Host "   建议: 检查 windows.cjs 中的窗口创建逻辑"
    Write-Host ""
}

Write-Host "=" * 80
