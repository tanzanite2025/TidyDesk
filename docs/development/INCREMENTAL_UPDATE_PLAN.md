# v3.4.0 增量更新实施计划

**目标**: 实时检测应用安装/卸载，只更新变化的应用  
**预计时间**: 4-6 小时  
**状态**: 📋 规划中

---

## 🎯 目标

### 当前问题（v3.3.0）

```
应用安装/卸载
  ↓
等待最多 1 小时
  ↓
定期扫描检测到变化
  ↓
重新扫描所有应用（8-12s）
  ↓
更新缓存
```

**问题**:
- ❌ 延迟最多 1 小时
- ❌ 重新扫描所有应用（浪费资源）
- ❌ 用户可能看到过时的应用列表

### 目标效果（v3.4.0）

```
应用安装/卸载
  ↓
立即检测到变化（< 1s）
  ↓
只扫描变化的应用（< 1s）
  ↓
更新缓存
  ↓
用户看到最新列表
```

**优势**:
- ✅ 实时检测（< 1s）
- ✅ 只更新变化的部分（< 1s）
- ✅ 节省资源
- ✅ 用户体验最佳

---

## 🔍 技术方案

### 方案 1: 监听注册表（推荐）✅

#### Windows 应用注册表位置

```
HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
HKEY_LOCAL_MACHINE\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall
HKEY_CURRENT_USER\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall
```

#### 实现方式

使用 Node.js 的 `winreg` 包监听注册表变化：

```javascript
const Registry = require('winreg');

// 监听 64 位应用
const regKey64 = new Registry({
  hive: Registry.HKLM,
  key: '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
});

// 监听 32 位应用（在 64 位系统上）
const regKey32 = new Registry({
  hive: Registry.HKLM,
  key: '\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
});

// 监听用户级应用
const regKeyUser = new Registry({
  hive: Registry.HKCU,
  key: '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
});
```

#### 优点
- ✅ 实时检测（< 1s）
- ✅ 系统级监听，可靠
- ✅ 可以获取应用详细信息

#### 缺点
- ❌ 需要额外依赖（winreg）
- ❌ 仅支持 Windows
- ❌ 某些应用可能不在注册表中

### 方案 2: 文件系统监听（备选）

#### 监听目录

```
C:\Program Files\
C:\Program Files (x86)\
%APPDATA%\Microsoft\Windows\Start Menu\Programs\
```

#### 实现方式

使用 `chokidar` 监听快捷方式文件变化：

```javascript
const chokidar = require('chokidar');

const watcher = chokidar.watch([
  'C:\\Program Files\\**\\*.lnk',
  'C:\\Program Files (x86)\\**\\*.lnk',
  path.join(process.env.APPDATA, 'Microsoft\\Windows\\Start Menu\\Programs\\**\\*.lnk')
], {
  persistent: true,
  ignoreInitial: true,
  depth: 5
});

watcher
  .on('add', path => handleAppInstalled(path))
  .on('unlink', path => handleAppUninstalled(path));
```

#### 优点
- ✅ 已有 chokidar 依赖
- ✅ 可以检测快捷方式变化
- ✅ 跨平台（如果未来支持其他系统）

#### 缺点
- ❌ 可能有遗漏（不是所有应用都创建快捷方式）
- ❌ 性能开销较大（监听大量文件）
- ❌ 可能有误报（临时文件）

### 方案 3: 混合方案（最佳）✅

结合注册表监听和文件系统监听：

```javascript
// 1. 注册表监听（主要）
watchRegistry();

// 2. 文件系统监听（补充）
watchFileSystem();

// 3. 定期全量扫描（兜底，每 24 小时）
setInterval(fullScan, 24 * 60 * 60 * 1000);
```

#### 优点
- ✅ 覆盖最全面
- ✅ 可靠性最高
- ✅ 有兜底机制

#### 缺点
- ❌ 实现复杂度较高
- ❌ 资源消耗稍高

---

## 📋 实施步骤

### 阶段 1: 依赖安装（0.5h）

```bash
npm install winreg --save
```

### 阶段 2: 创建注册表监听服务（2h）

创建 `electron/services/registry-watcher.cjs`：

```javascript
/**
 * Windows 注册表监听服务
 * 实时检测应用安装/卸载
 */

const Registry = require('winreg');
const EventEmitter = require('events');

class RegistryWatcher extends EventEmitter {
  constructor() {
    super();
    this.watchers = [];
    this.knownApps = new Set();
  }

  /**
   * 开始监听
   */
  start() {
    // 监听 64 位应用
    this.watchKey(Registry.HKLM, 
      '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
    
    // 监听 32 位应用
    this.watchKey(Registry.HKLM, 
      '\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
    
    // 监听用户级应用
    this.watchKey(Registry.HKCU, 
      '\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall');
    
    console.log('[TIDYDESK] Registry watcher started');
  }

  /**
   * 监听单个注册表键
   */
  watchKey(hive, key) {
    const regKey = new Registry({ hive, key });
    
    // 初始化：获取当前应用列表
    this.scanKey(regKey, (apps) => {
      apps.forEach(app => this.knownApps.add(app));
    });
    
    // 定期检查变化（每 5 秒）
    const interval = setInterval(() => {
      this.checkChanges(regKey);
    }, 5000);
    
    this.watchers.push({ regKey, interval });
  }

  /**
   * 检查变化
   */
  async checkChanges(regKey) {
    const currentApps = await this.scanKey(regKey);
    const currentSet = new Set(currentApps);
    
    // 检测新安装的应用
    for (const app of currentApps) {
      if (!this.knownApps.has(app)) {
        console.log(`[TIDYDESK] App installed: ${app}`);
        this.emit('app-installed', app);
        this.knownApps.add(app);
      }
    }
    
    // 检测卸载的应用
    for (const app of this.knownApps) {
      if (!currentSet.has(app)) {
        console.log(`[TIDYDESK] App uninstalled: ${app}`);
        this.emit('app-uninstalled', app);
        this.knownApps.delete(app);
      }
    }
  }

  /**
   * 扫描注册表键
   */
  scanKey(regKey) {
    return new Promise((resolve) => {
      regKey.keys((err, items) => {
        if (err) {
          resolve([]);
          return;
        }
        
        const apps = items.map(item => item.key);
        resolve(apps);
      });
    });
  }

  /**
   * 停止监听
   */
  stop() {
    this.watchers.forEach(({ interval }) => {
      clearInterval(interval);
    });
    this.watchers = [];
    console.log('[TIDYDESK] Registry watcher stopped');
  }
}

module.exports = RegistryWatcher;
```

### 阶段 3: 增量更新逻辑（1.5h）

更新 `electron/services/apps.cjs`：

```javascript
/**
 * 增量更新单个应用
 */
async function updateSingleApp(appKey) {
  console.log(`[TIDYDESK] Updating single app: ${appKey}`);
  
  try {
    // 1. 扫描单个应用
    const app = await scanSingleApp(appKey);
    
    if (!app) {
      console.log(`[TIDYDESK] App not found: ${appKey}`);
      return;
    }
    
    // 2. 加载当前缓存
    const cache = await appCache.loadCache();
    if (!cache || !cache.apps) {
      console.log('[TIDYDESK] No cache found, skipping incremental update');
      return;
    }
    
    // 3. 更新缓存
    const existingIndex = cache.apps.findIndex(a => a.shortcutPath === app.shortcutPath);
    
    if (existingIndex >= 0) {
      // 更新现有应用
      cache.apps[existingIndex] = app;
      console.log(`[TIDYDESK] Updated existing app: ${app.name}`);
    } else {
      // 添加新应用
      cache.apps.push(app);
      console.log(`[TIDYDESK] Added new app: ${app.name}`);
    }
    
    // 4. 保存缓存
    await appCache.saveCache(cache.apps);
    
    console.log(`[TIDYDESK] Incremental update completed in < 1s`);
  } catch (err) {
    console.error('[TIDYDESK] Incremental update failed:', err);
  }
}

/**
 * 移除单个应用
 */
async function removeSingleApp(appKey) {
  console.log(`[TIDYDESK] Removing single app: ${appKey}`);
  
  try {
    // 1. 加载当前缓存
    const cache = await appCache.loadCache();
    if (!cache || !cache.apps) {
      console.log('[TIDYDESK] No cache found, skipping removal');
      return;
    }
    
    // 2. 从缓存中移除
    const originalLength = cache.apps.length;
    cache.apps = cache.apps.filter(app => !app.shortcutPath.includes(appKey));
    
    const removed = originalLength - cache.apps.length;
    console.log(`[TIDYDESK] Removed ${removed} app(s)`);
    
    // 3. 保存缓存
    if (removed > 0) {
      await appCache.saveCache(cache.apps);
    }
    
    console.log(`[TIDYDESK] Removal completed in < 1s`);
  } catch (err) {
    console.error('[TIDYDESK] Removal failed:', err);
  }
}
```

### 阶段 4: 集成到主进程（1h）

更新 `electron/main.cjs`：

```javascript
const RegistryWatcher = require('./services/registry-watcher.cjs');

// 创建注册表监听器
const registryWatcher = new RegistryWatcher();

app.whenReady().then(() => {
  // ... 现有代码 ...
  
  // 启动注册表监听
  registryWatcher.start();
  
  // 监听应用安装事件
  registryWatcher.on('app-installed', async (appKey) => {
    console.log(`[TIDYDESK] Detected app installation: ${appKey}`);
    await appService.updateSingleApp(appKey);
  });
  
  // 监听应用卸载事件
  registryWatcher.on('app-uninstalled', async (appKey) => {
    console.log(`[TIDYDESK] Detected app uninstallation: ${appKey}`);
    await appService.removeSingleApp(appKey);
  });
  
  // 定期全量扫描（兜底，每 24 小时）
  setInterval(async () => {
    console.log('[TIDYDESK] Daily full scan started');
    await appService.refreshApps();
  }, 24 * 60 * 60 * 1000);
});

app.on('before-quit', () => {
  // 停止注册表监听
  registryWatcher.stop();
  
  // ... 现有代码 ...
});
```

### 阶段 5: 测试和优化（1h）

测试场景：
1. 安装新应用
2. 卸载应用
3. 长时间运行
4. 错误处理

---

## 📊 性能预测

### 更新延迟

| 场景 | v3.3.0 | v3.4.0 | 提升 |
|------|--------|--------|------|
| 检测延迟 | 最多 1 小时 | < 5s | **720x** ✅ |
| 更新时间 | 8-12s（全量） | < 1s（增量） | **10x** ✅ |
| 总延迟 | 1h + 8-12s | < 6s | **600x** ✅ |

### 资源消耗

| 指标 | v3.3.0 | v3.4.0 | 变化 |
|------|--------|--------|------|
| CPU（监听） | 0% | < 1% | +1% |
| 内存（监听） | 0 MB | +5 MB | +5 MB |
| CPU（更新） | 15-25%（8-12s） | 5-10%（< 1s） | -60% |
| 总体 | 低 | 低 | 略增 |

---

## 🎯 优化效果

### 用户体验

```
v3.3.0:
用户安装新应用
  ↓
等待最多 1 小时
  ↓
应用出现在列表中

v3.4.0:
用户安装新应用
  ↓
< 5 秒后自动出现 ✅
  ↓
无需等待
```

### 性能对比

| 版本 | 检测延迟 | 更新时间 | 用户体验 |
|------|----------|----------|----------|
| v3.3.0 | 最多 1h | 8-12s | ❌ 慢 |
| v3.4.0 | < 5s | < 1s | ✅ **实时** 🚀 |

---

## ⚠️ 注意事项

### 1. Windows 专用

此功能仅支持 Windows，因为：
- 使用 Windows 注册表
- 使用 `winreg` 包

**解决方案**:
- 在非 Windows 系统上禁用此功能
- 回退到定期扫描

### 2. 权限问题

某些注册表键可能需要管理员权限。

**解决方案**:
- 优雅降级，跳过无权限的键
- 记录警告日志

### 3. 性能影响

监听注册表会增加少量资源消耗。

**解决方案**:
- 使用合理的检查间隔（5 秒）
- 避免频繁的全量扫描

### 4. 误报和漏报

某些应用可能不在注册表中，或注册表更新延迟。

**解决方案**:
- 结合文件系统监听（可选）
- 定期全量扫描兜底（24 小时）

---

## 🧪 测试计划

### 测试场景 1: 安装应用

**步骤**:
1. 启动 TidyDesk
2. 安装一个新应用（如 Notepad++）
3. 观察控制台日志
4. 打开应用选择器

**预期**:
- 5 秒内检测到安装
- 控制台显示 "App installed"
- 增量更新 < 1s
- 应用出现在列表中

### 测试场景 2: 卸载应用

**步骤**:
1. 启动 TidyDesk
2. 卸载一个应用
3. 观察控制台日志
4. 打开应用选择器

**预期**:
- 5 秒内检测到卸载
- 控制台显示 "App uninstalled"
- 从缓存中移除 < 1s
- 应用从列表中消失

### 测试场景 3: 长时间运行

**步骤**:
1. 启动 TidyDesk
2. 运行 24 小时
3. 观察控制台日志

**预期**:
- 注册表监听持续运行
- 24 小时后执行全量扫描
- 无内存泄漏

### 测试场景 4: 错误处理

**步骤**:
1. 模拟注册表访问失败
2. 观察应用行为

**预期**:
- 优雅降级
- 记录错误日志
- 应用继续运行

---

## 📝 文档更新

需要更新的文档：
- [ ] `CHANGELOG.md` - 添加 v3.4.0 条目
- [ ] `package.json` - 更新版本号
- [ ] `README.md` - 添加增量更新说明
- [ ] 创建 `INCREMENTAL_UPDATE_IMPLEMENTATION.md`

---

## 💰 投入产出分析

### 投入
```
依赖安装: 0.5h
注册表监听: 2h
增量更新逻辑: 1.5h
主进程集成: 1h
测试优化: 1h
文档编写: 0.5h
─────────────
总计: 6.5h
```

### 产出
```
检测延迟: 1h → < 5s (720x 提升)
更新时间: 8-12s → < 1s (10x 提升)
用户体验: 实时更新
─────────────
投入产出比: 112:1 ✅
```

---

## 🔮 未来优化

### v3.5.0: 智能调度

根据使用模式动态调整：
- 频繁使用：更积极的监听
- 偶尔使用：更节省的策略

### v3.6.0: 跨平台支持

- macOS: 监听 `/Applications` 目录
- Linux: 监听 `.desktop` 文件

---

## ✅ 完成清单

- [ ] 安装 winreg 依赖
- [ ] 创建 registry-watcher.cjs
- [ ] 实现增量更新逻辑
- [ ] 集成到主进程
- [ ] 测试和优化
- [ ] 更新文档
- [ ] 更新版本号
- [ ] 提交和发布

---

**状态**: 📋 规划完成，准备实施  
**预计时间**: 6.5 小时  
**预期效果**: 实时检测应用变化，< 1s 更新
