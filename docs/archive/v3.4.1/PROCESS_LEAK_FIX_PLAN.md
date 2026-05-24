# 进程泄漏修复方案

**发现时间**: 2026-05-24  
**当前状态**: 7 个进程（目标 ≤3）  
**根本原因**: 启动时创建了所有窗口，每个窗口一个渲染进程

---

## 问题分析

### 当前进程结构

```
1. 主进程 (Main Process) - PID 16220
   - 窗口标题: "TIDYDESK ENGINE // UDS 1.0 PORTAL"
   - 内存: 108 MB, 句柄: 1085

2. GPU 进程 (GPU Process) - PID 8936
   - 内存: 111 MB, 句柄: 674

3-7. 渲染进程 (Renderer Processes) - 5 个
   - PID 40396: 80 MB, 416 句柄
   - PID 42232: 80 MB, 336 句柄
   - PID 47956: 81 MB, 415 句柄
   - PID 54528: 51 MB, 364 句柄
   - PID 54924: 84 MB, 422 句柄
```

### 窗口创建逻辑

在 `electron/services/windows.cjs` 的 `createWindows()` 中：

```javascript
function createWindows() {
  createDrawerWindow();    // 渲染进程 1
  createTodoWindow();      // 渲染进程 2
  createCaptureWindow();   // 渲染进程 3
  createHandleWindow();    // 渲染进程 4
  applyDrawerBounds(false, false);
}
```

**问题**: 所有窗口在启动时就被创建，即使用户可能不会使用待办或快速捕获功能。

### Electron 进程模型

- 每个 `BrowserWindow` 创建一个独立的渲染进程
- 即使窗口被 `hide()`，进程仍然存在
- 只有 `close()` 或 `destroy()` 才会销毁进程

---

## 修复方案

### 方案 1: 延迟创建窗口（推荐）

**目标**: 减少启动时的进程数量，只在需要时创建窗口

**修改**:

```javascript
function createWindows() {
  createHandleWindow();  // 必须：抽屉把手
  createDrawerWindow();  // 必须：抽屉窗口
  // todoWindow - 延迟创建（首次打开时）
  // captureWindow - 延迟创建（首次打开时）
  // appPickerWindow - 延迟创建（首次打开时）
  applyDrawerBounds(false, false);
}
```

**优点**:
- 启动时只有 4 个进程（主进程 + GPU + 2 个渲染进程）
- 内存占用减少 ~160 MB
- 启动速度更快

**缺点**:
- 首次打开待办/快速捕获时有轻微延迟（~100-200ms）

### 方案 2: 单渲染进程架构

**目标**: 所有功能在一个渲染进程中，通过路由切换

**修改**:
- 只创建一个主窗口
- 使用 React Router 切换视图
- 使用 CSS 实现抽屉、待办、快速捕获的布局

**优点**:
- 只有 3 个进程（主进程 + GPU + 1 个渲染进程）
- 内存占用最少
- 视图切换无延迟

**缺点**:
- 需要大量重构
- 窗口管理逻辑复杂
- 可能影响性能（所有功能在一个进程中）

### 方案 3: 混合方案

**目标**: 核心功能延迟创建，辅助功能按需创建

**修改**:
```javascript
function createWindows() {
  createHandleWindow();  // 必须
  createDrawerWindow();  // 必须
  // todoWindow - 延迟创建
  // captureWindow - 延迟创建
  // appPickerWindow - 按需创建（已经是按需）
}
```

**优点**:
- 平衡启动速度和功能完整性
- 改动最小

---

## 实施计划

### 阶段 1: 延迟创建待办和快速捕获窗口

**修改文件**: `electron/services/windows.cjs`

**步骤 1**: 修改 `createWindows()`

```javascript
function createWindows() {
  createHandleWindow();
  createDrawerWindow();
  // 移除 createTodoWindow() 和 createCaptureWindow()
  applyDrawerBounds(false, false);
}
```

**步骤 2**: 修改 `openTodoPanel()`

```javascript
function openTodoPanel() {
  // ... 现有逻辑 ...
  
  // 添加延迟创建逻辑
  if (!todoWindow || todoWindow.isDestroyed()) {
    createTodoWindow();  // 首次打开时创建
  }
  
  // ... 现有逻辑 ...
}
```

**步骤 3**: 修改 `openCapturePanel()`

```javascript
function openCapturePanel() {
  // ... 现有逻辑 ...
  
  // 添加延迟创建逻辑
  if (!captureWindow || captureWindow.isDestroyed()) {
    createCaptureWindow();  // 首次打开时创建
  }
  
  // ... 现有逻辑 ...
}
```

**预期效果**:
- 启动时进程数: 7 → 4
- 内存占用: 610 MB → ~450 MB
- 启动速度: 提升 ~20%

### 阶段 2: 优化窗口销毁逻辑

**问题**: 当前窗口关闭后不会销毁，只是隐藏

**修改**: 添加窗口销毁选项

```javascript
// 在 config.cjs 中添加配置
WINDOW: {
  // ... 现有配置 ...
  DESTROY_ON_CLOSE: true,  // 关闭时销毁窗口（而不是隐藏）
}
```

```javascript
// 在 windows.cjs 中
function closeActiveModule() {
  const closingModule = activeModule;
  
  if (closingModule === 'todos' && todoWindow && !todoWindow.isDestroyed()) {
    if (config.WINDOW.DESTROY_ON_CLOSE) {
      todoWindow.close();  // 销毁窗口
      todoWindow = null;
    } else {
      todoWindow.hide();   // 只隐藏
    }
  }
  
  // ... 类似处理 captureWindow ...
}
```

**预期效果**:
- 关闭待办后进程数: 4 → 3
- 内存占用: 进一步减少 ~80 MB

### 阶段 3: 测试和验证

**测试场景**:
1. 启动应用 → 检查进程数（应该是 4）
2. 打开待办 → 检查进程数（应该是 5）
3. 关闭待办 → 检查进程数（应该是 4 或 3，取决于配置）
4. 打开快速捕获 → 检查进程数
5. 打开应用选择器 → 检查进程数

**验证指标**:
- 启动时进程数 ≤ 4
- 所有功能打开时进程数 ≤ 7
- 关闭功能后进程正确减少
- 无内存泄漏
- 无句柄泄漏

---

## 句柄泄漏分析

### 当前句柄数量

```
总计: 3981 句柄
主进程: 1085 句柄
其他进程: 2896 句柄
```

### 可能原因

1. **定时器未清理**
   - `backgroundScanTimer`
   - `dailyScanTimer`
   - Registry Watcher 的定时器
   - 文件监控的定时器

2. **事件监听器未移除**
   - 窗口事件监听器
   - IPC 监听器
   - 文件系统监听器

3. **文件句柄未关闭**
   - 日志文件
   - 缓存文件
   - 配置文件

### 修复方案

**已完成**:
- ✅ ResourceManager 统一管理定时器和监听器
- ✅ 在 `before-quit` 中调用 `resourceManager.cleanup()`

**待完成**:
1. 将更多定时器迁移到 ResourceManager
2. 审查所有事件监听器
3. 确保文件句柄正确关闭

---

## 预期效果

### 修复前
- 进程数量: 7 个
- CPU 使用率: 6.12%
- 内存使用: 610 MB
- 句柄数量: 3981

### 修复后（阶段 1）
- 进程数量: **4 个** ✅ 降低 43%
- CPU 使用率: ~5%
- 内存使用: **~450 MB** ✅ 降低 26%
- 句柄数量: ~3000

### 修复后（阶段 2）
- 进程数量: **3-4 个** ✅ 达到目标
- CPU 使用率: ~5%
- 内存使用: **~370 MB** ✅ 降低 39%
- 句柄数量: ~2500

### 修复后（阶段 3 - 句柄泄漏）
- 进程数量: 3-4 个
- CPU 使用率: ~5%
- 内存使用: ~370 MB
- 句柄数量: **<500** ✅ 达到目标

---

## 时间估算

- 阶段 1: 1-2 小时
- 阶段 2: 1 小时
- 阶段 3: 2-3 小时
- **总计**: 4-6 小时

---

## 下一步

1. ✅ 分析进程结构
2. ✅ 找到根本原因
3. ⏳ 实施阶段 1（延迟创建窗口）
4. ⏳ 测试和验证
5. ⏳ 实施阶段 2（优化销毁逻辑）
6. ⏳ 修复句柄泄漏

---

**创建时间**: 2026-05-24  
**状态**: 待实施  
**优先级**: P0
