# 阶段 2: 进程泄漏深度分析

**分析时间**: 2026-05-24 08:15  
**状态**: 🔍 调查中  
**发现**: 严重的进程泄漏问题

---

## 问题发现

### 当前进程统计

```
总进程数: 10 个
```

**详细分类**:

| 进程类型 | 数量 | 预期 | 状态 | 内存 | 句柄 |
|---------|------|------|------|------|------|
| **Main Process** | 2 | 1 | ❌ 多 1 个 | 186 MB | 2279 |
| **GPU Process** | 2 | 1 | ❌ 多 1 个 | 222 MB | 1260 |
| **Renderer Process** | 3 | 2 | ❌ 多 1 个 | 213 MB | 939 |
| **Utility Process** | 3 | 0-1 | ⚠️ Electron 自动创建 | 171 MB | 812 |
| **总计** | **10** | **4-5** | ❌ 多 5-6 个 | **792 MB** | **5290** |

### 详细进程列表

```
PID 31100: Main Process - 96.25 MB, 1435 句柄
PID 79252: Main Process - 89.90 MB, 844 句柄   ← 额外的主进程！

PID 80220: GPU Process - 140.34 MB, 831 句柄
PID 81916: GPU Process - 81.49 MB, 429 句柄    ← 额外的 GPU 进程！

PID 32144: Renderer Process - 88.64 MB, 397 句柄
PID 60164: Renderer Process - 63.21 MB, 271 句柄
PID 103980: Renderer Process - 60.83 MB, 271 句柄  ← 额外的渲染进程！

PID 62132: Utility Process - 48.38 MB, 318 句柄
PID 76168: Utility Process - 62.14 MB, 284 句柄
PID 78648: Utility Process - 60.29 MB, 210 句柄
```

---

## 根本原因分析

### 问题 1: 为什么有 2 个主进程？

**可能原因**:
1. **应用启动了两次**
   - 常驻机制可能有问题
   - 单实例锁定失败
   - 用户手动启动了两次

2. **进程未正确退出**
   - 上一次运行的进程没有完全退出
   - 僵尸进程

**调查方向**:
- 检查 `electron/resident.cjs` 的单实例锁定逻辑
- 检查 `app.requestSingleInstanceLock()` 是否正常工作

### 问题 2: 为什么有 2 个 GPU 进程？

**可能原因**:
1. **每个主进程创建一个 GPU 进程**
   - 如果有 2 个主进程，就会有 2 个 GPU 进程
   - 这是 Electron 的正常行为

2. **GPU 进程崩溃后重启**
   - Electron 会自动重启崩溃的 GPU 进程
   - 但旧进程可能没有完全退出

**结论**: 这是主进程泄漏的副作用

### 问题 3: 为什么有 3 个渲染进程？

**预期**: 2 个（handleWindow + drawerWindow）  
**实际**: 3 个  
**差距**: +1 个

**可能原因**:
1. **todoWindow 或 captureWindow 被意外创建**
   - 虽然修改了 `createWindows()`，但可能在其他地方被创建
   - 可能在启动时触发了某个事件

2. **appPickerWindow 正在运行**
   - 用户可能打开了应用选择器

3. **隐藏的窗口未销毁**
   - 某个窗口被隐藏但没有销毁

**调查方向**:
- 检查所有 `BrowserWindow` 的创建位置
- 检查是否有事件监听器在启动时触发窗口创建

### 问题 4: 为什么有 3 个 Utility 进程？

**Utility 进程类型**:
- Network Service（网络服务）
- Storage Service（存储服务）
- Audio Service（音频服务）

**说明**:
- 这些是 Electron 自动创建的辅助进程
- 用于隔离不同的服务，提高安全性和稳定性
- **无法避免**，这是 Electron 的架构设计

**结论**: 这不是问题，是正常行为

---

## 缓存损坏问题

### 问题描述

应用启动时陷入无限循环，不断输出：

```
[TIDYDESK] Failed to load cache: Unexpected non-whitespace character after JSON at position 154627 (line 538 column 2)
[TIDYDESK] No cache found, skipping removal
```

### 根本原因

**文件**: `C:\Users\P16V\AppData\Roaming\TidyDesk\Cache\apps.json`

**问题**: JSON 文件损坏，可能原因：
1. 应用崩溃时正在写入缓存
2. 磁盘空间不足
3. 文件系统错误

### 解决方案

**临时方案**: 删除损坏的缓存文件

```powershell
Remove-Item "$env:APPDATA\TidyDesk\Cache\apps.json" -Force
```

**长期方案**: 改进缓存写入逻辑
1. 使用原子写入（先写临时文件，再重命名）
2. 添加 JSON 验证
3. 添加错误恢复机制

---

## 修复计划

### 优先级 P0（紧急）

#### 1. 修复主进程泄漏

**目标**: 确保只有 1 个主进程

**步骤**:
1. 检查 `electron/resident.cjs` 的单实例锁定
2. 确保 `app.requestSingleInstanceLock()` 正常工作
3. 添加日志，记录主进程启动和退出

**预期效果**:
- 主进程: 2 → 1
- GPU 进程: 2 → 1（副作用）
- 总进程: 10 → 8

#### 2. 找出额外的渲染进程

**目标**: 确保只有 2 个渲染进程（handleWindow + drawerWindow）

**步骤**:
1. 在 `createWindows()` 中添加日志
2. 检查所有 `new BrowserWindow()` 的调用位置
3. 检查是否有事件监听器在启动时创建窗口

**预期效果**:
- 渲染进程: 3 → 2
- 总进程: 8 → 7

#### 3. 改进缓存写入逻辑

**目标**: 防止缓存文件损坏

**步骤**:
1. 使用原子写入（`fs.writeFile` → 临时文件 + `fs.rename`）
2. 添加 JSON 验证
3. 添加错误恢复机制（自动删除损坏的缓存）

**预期效果**:
- 避免应用崩溃
- 提高稳定性

### 优先级 P1（重要）

#### 4. 修复句柄泄漏

**当前**: 5290 句柄  
**目标**: <500 句柄  
**差距**: +4790 句柄

**步骤**:
1. 审查所有定时器和监听器
2. 将更多资源迁移到 ResourceManager
3. 特别检查文件监控和注册表监听

#### 5. 优化内存使用

**当前**: 792 MB  
**目标**: <200 MB  
**差距**: +592 MB

**步骤**:
1. 减少应用缓存大小
2. 优化图标存储
3. 减少性能监控历史数据

---

## 预期效果

### 修复前（当前）

```
进程数量: 10 个
├─ Main Process: 2 个 ❌
├─ GPU Process: 2 个 ❌
├─ Renderer Process: 3 个 ❌
└─ Utility Process: 3 个ⓘ

CPU 使用率: ~8%
内存使用: 792 MB
句柄数量: 5290
```

### 修复后（目标）

```
进程数量: 4-5 个 ✅
├─ Main Process: 1 个 ✅
├─ GPU Process: 1 个 ✅
├─ Renderer Process: 2 个 ✅
└─ Utility Process: 0-1 个ⓘ

CPU 使用率: ~5%
内存使用: <200 MB
句柄数量: <500
```

**改善**:
- 进程数量: -50% to -60%
- 内存使用: -75%
- 句柄数量: -90%

---

## 下一步行动

1. ✅ 删除损坏的缓存文件
2. ✅ 诊断进程泄漏
3. ⏳ 修复主进程泄漏（检查 resident.cjs）
4. ⏳ 找出额外的渲染进程
5. ⏳ 改进缓存写入逻辑
6. ⏳ 修复句柄泄漏

---

**创建时间**: 2026-05-24 08:15  
**状态**: 调查中  
**优先级**: P0

