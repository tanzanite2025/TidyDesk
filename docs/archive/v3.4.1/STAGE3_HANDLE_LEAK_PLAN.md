# 阶段 3: 句柄泄漏修复计划

**开始时间**: 2026-05-24 19:00  
**目标**: 句柄数量从 2322 降到 <500  
**状态**: 🔍 分析中

---

## 当前状态

### 句柄分布

```
PID 45664: 210 句柄   (可能是 npm 进程)
PID 54060: 1002 句柄  ← 主进程（问题所在）
PID 60380: 307 句柄   (渲染进程)
PID 79424: 316 句柄   (Utility 进程)
PID 91588: 487 句柄   (GPU 进程)

总计: 2322 句柄
目标: <500 句柄
差距: +1822 句柄 (+364%)
```

### 问题分析

**主进程占用 1002 个句柄**，这是不正常的。

正常情况下，主进程应该只有 200-300 个句柄。

---

## 可能的句柄泄漏源

### 1. 定时器和间隔器

**当前使用的定时器**:
- `backgroundScanTimer` - 10 秒后执行一次
- `dailyScanTimer` - 每 24 小时执行一次
- `memoryCheckInterval` - 每 60 秒（resident.cjs）
- `cacheCleanupInterval` - 每 24 小时（resident.cjs）
- ResourceMonitor 采样 - 每 5 秒
- HealthCheck 检查 - 每 30 秒
- Registry Watcher 扫描 - 每 30-60 秒（自适应）
- 文件监控验证 - 每 5 分钟

**预估句柄**: ~10 个

### 2. 事件监听器

**IPC 监听器**:
- `read-desktop-files`
- `create-desktop-folder`
- `rename-desktop-item`
- `delete-desktop-item`
- `import-external-files`
- `open-desktop-file`
- `restore-to-desktop`
- `scan-installed-apps`
- `refresh-apps`
- `get-cache-info`
- `open-app-picker`
- `close-app-picker`
- `get-app-picker-target`
- `add-app-to-drawer`
- `todo-*` (7 个)
- `clipboard-read-text`
- `validate-all-shortcuts`
- `repair-shortcut`
- `get-performance-status`
- `get-resource-stats`
- `detect-resource-leaks`
- `window-control`

**预估**: ~25 个 IPC 监听器

**窗口事件监听器**:
- handleWindow: `closed`, `did-finish-load`
- drawerWindow: `blur`, `focus`, `closed`
- todoWindow: `blur`, `focus`, `closed`
- captureWindow: `blur`, `closed`
- appPickerWindow: `closed`

**预估**: ~15 个窗口事件监听器

**App 事件监听器**:
- `window-all-closed`
- `before-quit`
- `activate`
- `second-instance`
- `child-process-gone`

**预估**: ~5 个 App 事件监听器

**其他事件监听器**:
- PerformanceCore: `health-issues`, `degradation`, `recommend-restart`
- RegistryWatcher: `app-installed`, `app-uninstalled`
- PowerMonitor: `suspend`, `resume`, `shutdown`

**预估**: ~8 个其他事件监听器

**总计**: ~53 个事件监听器

### 3. 文件句柄

**文件监控（chokidar）**:
- 桌面文件监控
- 抽屉文件夹监控
- 可能监控了大量文件

**预估**: 50-200 个句柄（取决于监控的文件数量）

**日志文件**:
- electron-log 可能打开了日志文件

**预估**: 1-5 个句柄

### 4. 注册表监听

**RegistryWatcher**:
- 监听注册表变化
- 可能使用了 Windows API

**预估**: 10-50 个句柄

### 5. 性能监控

**ResourceMonitor**:
- 每 5 秒执行 PowerShell 命令
- 可能没有正确清理子进程

**预估**: 10-50 个句柄

### 6. 网络连接

**Electron 更新检查**:
- electron-updater 可能保持连接

**预估**: 5-10 个句柄

---

## 诊断步骤

### 步骤 1: 使用 Process Explorer 分析句柄类型

**工具**: Sysinternals Process Explorer

**步骤**:
1. 下载 Process Explorer
2. 以管理员身份运行
3. 找到主进程（PID 54060）
4. 查看句柄详情
5. 按类型分组统计

**预期结果**: 找出哪种类型的句柄最多

### 步骤 2: 审查所有定时器

**文件**:
- `electron/main.cjs`
- `electron/resident.cjs`
- `electron/services/performance/resource-monitor.cjs`
- `electron/services/performance/health-check.cjs`
- `electron/services/registry-watcher.cjs`
- `electron/services/drawers.cjs`

**检查**:
- 是否所有定时器都注册到 ResourceManager
- 是否在 `before-quit` 中清理
- 是否有重复创建的定时器

### 步骤 3: 审查所有事件监听器

**检查**:
- 是否有重复注册的监听器
- 是否在不需要时移除监听器
- 是否有内存泄漏（闭包引用）

### 步骤 4: 审查文件监控

**文件**: `electron/services/drawers.cjs`

**检查**:
- chokidar 监控了多少文件
- 是否正确关闭监控
- 是否有重复监控

### 步骤 5: 审查注册表监听

**文件**: `electron/services/registry-watcher.cjs`

**检查**:
- 是否正确关闭监听
- 是否有句柄泄漏

---

## 修复方案

### 方案 1: 优化性能监控采样频率

**当前**: 每 5 秒采样一次  
**优化**: 每 30 秒采样一次

**预期效果**: 减少 PowerShell 子进程创建频率

**修改**:
```javascript
performanceCore = new PerformanceCore({
  monitor: {
    sampleInterval: 30000, // 5000 → 30000
    historySize: 60,
    processName: app.isPackaged ? 'TidyDesk.exe' : 'electron.exe'
  },
  health: {
    checkInterval: 60000 // 30000 → 60000
  },
  // ...
});
```

### 方案 2: 减少文件监控范围

**当前**: 可能监控了整个桌面和所有抽屉文件夹  
**优化**: 只监控必要的文件夹

**预期效果**: 减少文件句柄数量

### 方案 3: 优化注册表监听

**当前**: 每 30-60 秒扫描一次  
**优化**: 每 5 分钟扫描一次

**预期效果**: 减少注册表访问频率

### 方案 4: 确保所有资源正确清理

**检查**:
- 所有定时器在 `before-quit` 中清理
- 所有事件监听器在不需要时移除
- 所有文件句柄正确关闭

---

## 实施计划

### Phase 1: 诊断（30 分钟）

1. ✅ 统计当前句柄数量
2. ⏳ 审查所有定时器
3. ⏳ 审查所有事件监听器
4. ⏳ 审查文件监控
5. ⏳ 审查注册表监听

### Phase 2: 修复（1 小时）

1. ⏳ 优化性能监控采样频率
2. ⏳ 减少文件监控范围
3. ⏳ 优化注册表监听频率
4. ⏳ 确保资源正确清理

### Phase 3: 验证（30 分钟）

1. ⏳ 重新启动应用
2. ⏳ 统计句柄数量
3. ⏳ 长时间运行测试（10 分钟）
4. ⏳ 再次统计句柄数量

---

## 预期效果

### 修复前

```
主进程: 1002 句柄
总计: 2322 句柄
```

### 修复后（预期）

```
主进程: 200-300 句柄
总计: <500 句柄
```

**改善**: -78% to -83%

---

## 下一步

1. 审查所有定时器的使用
2. 审查所有事件监听器
3. 检查文件监控范围
4. 实施优化方案

---

**创建时间**: 2026-05-24 19:00  
**状态**: 分析中  
**预计完成时间**: 2026-05-24 21:00

