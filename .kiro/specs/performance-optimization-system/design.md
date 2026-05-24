# TidyDesk 性能优化系统 - 技术设计

**Feature**: performance-optimization-system  
**Type**: 系统性能优化  
**Priority**: Critical  
**Created**: 2026-05-24

---

## 1. 概述

### 1.1 背景

TidyDesk 当前存在严重的性能问题：

**症状**:
- 进程泄漏：7 个进程同时运行（正常 2-3 个）
- 应用卡顿：打开待办、抽屉等功能时严重卡顿
- CPU 占用高：一个进程 CPU 使用率达到 172%
- 句柄泄漏：一个进程句柄数达到 2162

**根本原因**:
1. 注册表监听器频繁轮询（每 5 秒 × 3 个监听器）
2. 定时器和事件监听器没有正确清理
3. 没有性能监控和限流机制
4. 缺乏资源管理和自我保护机制

### 1.2 设计目标

构建一个**系统性的性能优化架构**，包括：

1. **进程管理系统** - 防止进程泄漏，确保进程正常退出
2. **资源监控系统** - 实时监控 CPU、内存、句柄使用情况
3. **智能限流系统** - 防止频繁操作导致卡顿
4. **自动降级机制** - 资源紧张时自动降级功能
5. **性能诊断工具** - 快速定位性能问题

### 1.3 设计原则

- **长期方案**：不是临时补丁，而是可持续的架构
- **自我保护**：系统能够自动检测和恢复
- **可观测性**：提供完整的性能指标和日志
- **可扩展性**：易于添加新的监控指标和优化策略

---

## 2. 高层设计

### 2.1 系统架构

```
┌─────────────────────────────────────────────────────────────┐
│                     TidyDesk Application                     │
├─────────────────────────────────────────────────────────────┤
│                                                               │
│  ┌────────────────────────────────────────────────────┐    │
│  │         Performance Management Layer                │    │
│  ├────────────────────────────────────────────────────┤    │
│  │                                                      │    │
│  │  ┌──────────────┐  ┌──────────────┐  ┌──────────┐ │    │
│  │  │   Resource   │  │   Throttle   │  │  Health  │ │    │
│  │  │   Monitor    │  │   Manager    │  │  Check   │ │    │
│  │  └──────┬───────┘  └──────┬───────┘  └────┬─────┘ │    │
│  │         │                  │                │       │    │
│  │         └──────────┬───────┴────────────────┘       │    │
│  │                    │                                 │    │
│  │         ┌──────────▼──────────┐                     │    │
│  │         │  Performance Core   │                     │    │
│  │         │  - Metrics Store    │                     │    │
│  │         │  - Alert System     │                     │    │
│  │         │  - Auto Degradation │                     │    │
│  │         └─────────────────────┘                     │    │
│  └────────────────────────────────────────────────────┘    │
│                                                               │
├─────────────────────────────────────────────────────────────┤
│                    Application Services                       │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐      │
│  │ Registry │ │   Apps   │ │ Windows  │ │ Stickers │      │
│  │ Watcher  │ │ Service  │ │ Service  │ │ Service  │      │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘      │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 核心组件

#### 2.2.1 Resource Monitor（资源监控器）

**职责**:
- 监控进程数量、CPU、内存、句柄使用情况
- 定期采集性能指标
- 检测异常资源使用

**关键指标**:
- 进程数量（目标：≤ 3）
- CPU 使用率（目标：< 10%）
- 内存使用（目标：< 200MB）
- 句柄数量（目标：< 500）

#### 2.2.2 Throttle Manager（限流管理器）

**职责**:
- 控制高频操作的执行频率
- 防止资源密集型操作同时执行
- 提供智能防抖和节流

**限流策略**:
- 注册表监听：30 秒轮询 + 2 秒防抖
- 应用扫描：防止并发，使用锁机制
- 文件监听：批量处理，延迟执行

#### 2.2.3 Health Check（健康检查）

**职责**:
- 定期检查系统健康状态
- 检测进程泄漏、内存泄漏
- 触发自动恢复机制

**检查项**:
- 进程数量异常（> 4 个）
- 内存持续增长（> 300MB）
- CPU 持续高占用（> 50%）
- 句柄泄漏（> 1000）

#### 2.2.4 Performance Core（性能核心）

**职责**:
- 存储和管理性能指标
- 触发告警和自动降级
- 提供性能数据查询接口

**功能**:
- Metrics Store：时序数据存储
- Alert System：阈值告警
- Auto Degradation：自动降级策略

---

## 3. 低层设计

### 3.1 Resource Monitor 实现

#### 3.1.1 数据结构

```javascript
class ResourceMonitor {
  constructor() {
    this.metrics = {
      processes: [],      // 进程列表
      cpu: [],           // CPU 使用率历史
      memory: [],        // 内存使用历史
      handles: []        // 句柄数量历史
    };
    this.interval = null;
    this.sampleInterval = 5000; // 5 秒采样一次
    this.historySize = 60;      // 保留 60 个样本（5 分钟）
  }
}
```

#### 3.1.2 核心算法

```javascript
// 采集性能指标
async collectMetrics() {
  const processes = await this.getProcessList();
  const totalCpu = processes.reduce((sum, p) => sum + p.cpu, 0);
  const totalMemory = processes.reduce((sum, p) => sum + p.memory, 0);
  const totalHandles = processes.reduce((sum, p) => sum + p.handles, 0);
  
  // 添加到历史记录
  this.addMetric('processes', processes.length);
  this.addMetric('cpu', totalCpu);
  this.addMetric('memory', totalMemory);
  this.addMetric('handles', totalHandles);
  
  // 检查异常
  this.checkAnomalies();
}

// 检测异常
checkAnomalies() {
  const current = this.getCurrentMetrics();
  
  if (current.processes > 4) {
    this.emit('anomaly', { type: 'process-leak', value: current.processes });
  }
  if (current.cpu > 50) {
    this.emit('anomaly', { type: 'high-cpu', value: current.cpu });
  }
  if (current.memory > 300 * 1024 * 1024) {
    this.emit('anomaly', { type: 'high-memory', value: current.memory });
  }
  if (current.handles > 1000) {
    this.emit('anomaly', { type: 'handle-leak', value: current.handles });
  }
}
```

### 3.2 Throttle Manager 实现

#### 3.2.1 数据结构

```javascript
class ThrottleManager {
  constructor() {
    this.throttles = new Map();  // key -> { lastCall, timer, queue }
    this.locks = new Map();      // key -> { locked, promise }
  }
}
```

#### 3.2.2 核心算法

```javascript
// 智能节流
throttle(key, fn, delay = 1000) {
  if (!this.throttles.has(key)) {
    this.throttles.set(key, { lastCall: 0, timer: null, queue: [] });
  }
  
  const throttle = this.throttles.get(key);
  const now = Date.now();
  
  if (now - throttle.lastCall >= delay) {
    // 立即执行
    throttle.lastCall = now;
    return fn();
  } else {
    // 延迟执行
    if (throttle.timer) clearTimeout(throttle.timer);
    throttle.timer = setTimeout(() => {
      throttle.lastCall = Date.now();
      fn();
    }, delay - (now - throttle.lastCall));
  }
}

// 互斥锁
async lock(key, fn) {
  if (!this.locks.has(key)) {
    this.locks.set(key, { locked: false, promise: null });
  }
  
  const lock = this.locks.get(key);
  
  if (lock.locked) {
    // 等待锁释放
    await lock.promise;
  }
  
  lock.locked = true;
  lock.promise = (async () => {
    try {
      return await fn();
    } finally {
      lock.locked = false;
      lock.promise = null;
    }
  })();
  
  return lock.promise;
}
```

### 3.3 Health Check 实现

#### 3.3.1 数据结构

```javascript
class HealthCheck {
  constructor(resourceMonitor) {
    this.monitor = resourceMonitor;
    this.checks = [];
    this.interval = null;
    this.checkInterval = 30000; // 30 秒检查一次
  }
}
```

#### 3.3.2 核心算法

```javascript
// 执行健康检查
async runChecks() {
  const metrics = this.monitor.getCurrentMetrics();
  const issues = [];
  
  // 检查进程数量
  if (metrics.processes > 4) {
    issues.push({
      severity: 'critical',
      type: 'process-leak',
      message: `进程数量异常: ${metrics.processes} (正常: ≤3)`,
      action: 'restart-recommended'
    });
  }
  
  // 检查内存使用
  const memoryMB = metrics.memory / 1024 / 1024;
  if (memoryMB > 300) {
    issues.push({
      severity: 'warning',
      type: 'high-memory',
      message: `内存使用过高: ${memoryMB.toFixed(0)}MB (正常: <200MB)`,
      action: 'gc-recommended'
    });
  }
  
  // 检查 CPU 使用
  if (metrics.cpu > 50) {
    issues.push({
      severity: 'warning',
      type: 'high-cpu',
      message: `CPU 使用率过高: ${metrics.cpu.toFixed(1)}% (正常: <10%)`,
      action: 'throttle-operations'
    });
  }
  
  // 检查句柄泄漏
  if (metrics.handles > 1000) {
    issues.push({
      severity: 'critical',
      type: 'handle-leak',
      message: `句柄数量异常: ${metrics.handles} (正常: <500)`,
      action: 'cleanup-resources'
    });
  }
  
  // 触发自动恢复
  if (issues.length > 0) {
    this.emit('health-issues', issues);
    this.autoRecover(issues);
  }
  
  return { healthy: issues.length === 0, issues };
}

// 自动恢复
autoRecover(issues) {
  for (const issue of issues) {
    switch (issue.action) {
      case 'restart-recommended':
        this.emit('recommend-restart');
        break;
      case 'gc-recommended':
        if (global.gc) global.gc();
        break;
      case 'throttle-operations':
        this.emit('enable-throttle');
        break;
      case 'cleanup-resources':
        this.emit('cleanup-resources');
        break;
    }
  }
}
```

### 3.4 Performance Core 实现

#### 3.4.1 数据结构

```javascript
class PerformanceCore {
  constructor() {
    this.resourceMonitor = new ResourceMonitor();
    this.throttleManager = new ThrottleManager();
    this.healthCheck = new HealthCheck(this.resourceMonitor);
    this.degradationLevel = 0; // 0: 正常, 1: 轻度降级, 2: 重度降级
  }
}
```

#### 3.4.2 自动降级策略

```javascript
// 根据资源使用情况自动降级
updateDegradationLevel() {
  const metrics = this.resourceMonitor.getCurrentMetrics();
  const memoryMB = metrics.memory / 1024 / 1024;
  
  let newLevel = 0;
  
  // 轻度降级条件
  if (metrics.cpu > 30 || memoryMB > 200 || metrics.handles > 800) {
    newLevel = 1;
  }
  
  // 重度降级条件
  if (metrics.cpu > 50 || memoryMB > 300 || metrics.handles > 1000) {
    newLevel = 2;
  }
  
  if (newLevel !== this.degradationLevel) {
    this.degradationLevel = newLevel;
    this.applyDegradation(newLevel);
  }
}

// 应用降级策略
applyDegradation(level) {
  switch (level) {
    case 0: // 正常模式
      this.emit('degradation', {
        level: 'normal',
        actions: ['恢复所有功能']
      });
      break;
      
    case 1: // 轻度降级
      this.emit('degradation', {
        level: 'light',
        actions: [
          '注册表监听间隔延长到 60 秒',
          '禁用非关键动画',
          '延迟后台任务'
        ]
      });
      break;
      
    case 2: // 重度降级
      this.emit('degradation', {
        level: 'heavy',
        actions: [
          '暂停注册表监听',
          '禁用所有动画',
          '暂停后台扫描',
          '建议用户重启应用'
        ]
      });
      break;
  }
}
```

---

## 4. 集成方案

### 4.1 与现有服务集成

#### 4.1.1 Registry Watcher 集成

```javascript
// 在 registry-watcher.cjs 中
class RegistryWatcher extends EventEmitter {
  constructor(performanceCore) {
    super();
    this.performanceCore = performanceCore;
    this.baseInterval = 30000; // 基础间隔 30 秒
  }
  
  async watchKey(hive, key, label) {
    // 使用性能核心的节流管理器
    const interval = setInterval(() => {
      this.performanceCore.throttleManager.throttle(
        `registry-${label}`,
        () => this.checkChanges(regKey, label),
        this.getAdaptiveInterval()
      );
    }, this.baseInterval);
  }
  
  // 根据降级级别调整间隔
  getAdaptiveInterval() {
    const level = this.performanceCore.degradationLevel;
    switch (level) {
      case 0: return 30000;  // 30 秒
      case 1: return 60000;  // 60 秒
      case 2: return 0;      // 暂停
    }
  }
}
```

#### 4.1.2 Apps Service 集成

```javascript
// 在 apps.cjs 中
function createAppService({ performanceCore, ... }) {
  async function scanInstalledApps(forceRefresh = false) {
    // 使用锁机制防止并发
    return performanceCore.throttleManager.lock('app-scan', async () => {
      // 原有扫描逻辑
      const apps = await scanInstalledAppsInternal();
      return apps;
    });
  }
}
```

#### 4.1.3 Main Process 集成

```javascript
// 在 main.cjs 中
const { PerformanceCore } = require('./services/performance-core.cjs');

const performanceCore = new PerformanceCore();

// 启动性能监控
performanceCore.start();

// 监听性能事件
performanceCore.on('health-issues', (issues) => {
  console.warn('[PERFORMANCE] Health issues detected:', issues);
  
  // 通知用户
  if (issues.some(i => i.severity === 'critical')) {
    windowService.sendTo('drawer', 'performance-warning', {
      message: '检测到性能问题，建议重启应用',
      issues
    });
  }
});

performanceCore.on('degradation', (info) => {
  console.log(`[PERFORMANCE] Degradation level: ${info.level}`);
  console.log('[PERFORMANCE] Actions:', info.actions);
});

// 清理时停止监控
app.on('before-quit', () => {
  performanceCore.stop();
});
```

### 4.2 资源清理机制

#### 4.2.1 统一资源管理器

```javascript
class ResourceManager {
  constructor() {
    this.timers = new Set();
    this.intervals = new Set();
    this.listeners = new Map();
  }
  
  // 注册定时器
  registerTimer(timer) {
    this.timers.add(timer);
    return timer;
  }
  
  // 注册间隔器
  registerInterval(interval) {
    this.intervals.add(interval);
    return interval;
  }
  
  // 注册事件监听器
  registerListener(emitter, event, handler) {
    const key = `${emitter.constructor.name}-${event}`;
    if (!this.listeners.has(key)) {
      this.listeners.set(key, []);
    }
    this.listeners.get(key).push({ emitter, handler });
    emitter.on(event, handler);
  }
  
  // 清理所有资源
  cleanup() {
    // 清理定时器
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
    
    // 清理间隔器
    for (const interval of this.intervals) {
      clearInterval(interval);
    }
    this.intervals.clear();
    
    // 清理事件监听器
    for (const [key, listeners] of this.listeners) {
      for (const { emitter, handler } of listeners) {
        emitter.removeListener(key.split('-')[1], handler);
      }
    }
    this.listeners.clear();
  }
}
```

---

## 5. 性能诊断工具

### 5.1 实时性能面板

```javascript
// 创建性能诊断窗口
function createPerformancePanel() {
  const panel = new BrowserWindow({
    width: 800,
    height: 600,
    title: 'TidyDesk Performance Monitor'
  });
  
  // 定期发送性能数据
  setInterval(() => {
    const metrics = performanceCore.getMetrics();
    panel.webContents.send('performance-update', metrics);
  }, 1000);
}
```

### 5.2 性能报告生成

```javascript
// 生成性能报告
function generatePerformanceReport() {
  const metrics = performanceCore.getMetrics();
  const issues = performanceCore.healthCheck.getIssues();
  
  return {
    timestamp: new Date().toISOString(),
    summary: {
      processes: metrics.processes,
      cpu: `${metrics.cpu.toFixed(1)}%`,
      memory: `${(metrics.memory / 1024 / 1024).toFixed(0)}MB`,
      handles: metrics.handles
    },
    issues: issues,
    recommendations: generateRecommendations(metrics, issues)
  };
}
```

---

## 6. 实施计划

### 6.1 Phase 1: 核心框架（1-2 天）

- [ ] 实现 ResourceMonitor
- [ ] 实现 ThrottleManager
- [ ] 实现 HealthCheck
- [ ] 实现 PerformanceCore

### 6.2 Phase 2: 服务集成（1-2 天）

- [ ] 集成 Registry Watcher
- [ ] 集成 Apps Service
- [ ] 集成 Main Process
- [ ] 实现 ResourceManager

### 6.3 Phase 3: 诊断工具（1 天）

- [ ] 实现性能面板
- [ ] 实现报告生成
- [ ] 添加性能日志

### 6.4 Phase 4: 测试和优化（1 天）

- [ ] 压力测试
- [ ] 性能基准测试
- [ ] 优化阈值参数

---

## 7. 成功指标

### 7.1 性能目标

- 进程数量：≤ 3 个
- CPU 使用率：< 10%（空闲时 < 5%）
- 内存使用：< 200MB
- 句柄数量：< 500
- 启动时间：< 2 秒

### 7.2 稳定性目标

- 无进程泄漏
- 无内存泄漏
- 无句柄泄漏
- 7×24 小时稳定运行

---

**设计完成时间**: 2026-05-24  
**预计实施时间**: 4-5 天  
**优先级**: Critical
