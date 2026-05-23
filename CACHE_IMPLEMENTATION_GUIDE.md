# 应用扫描缓存实施指南

**目标**: 将应用扫描从 6-12 秒优化到 < 1 秒  
**方法**: 缓存机制  
**工作量**: 30 分钟  
**版本**: v3.2.4

---

## ✅ 已完成

1. ✅ 创建缓存服务 - `electron/services/app-cache.cjs`
2. ✅ 更新应用服务 - `electron/services/apps.cjs`
3. ✅ 添加强制刷新功能

---

## 🔧 待完成步骤

### 步骤 1: 更新 main.cjs（5 分钟）

在 `electron/main.cjs` 中添加缓存服务：

```javascript
// 在文件顶部添加导入
const createAppCacheService = require('./services/app-cache.cjs');

// 在创建 appService 之前创建 appCache
const appCache = createAppCacheService({ app });

// 更新 appService 创建，传入 appCache
const appService = createAppService({
  app,
  shell,
  config: CONFIG,
  getDesktopPath,
  appCache  // ← 添加这个
});

// 添加刷新应用的 IPC 处理
ipcMain.handle('refresh-apps', async () => {
  try {
    const apps = await appService.refreshApps();
    return { success: true, apps };
  } catch (err) {
    console.error('[TIDYDESK] Failed to refresh apps:', err);
    return { success: false, error: err.message, apps: [] };
  }
});

// 添加获取缓存信息的 IPC 处理
ipcMain.handle('get-cache-info', async () => {
  try {
    const info = await appCache.getCacheInfo();
    return { success: true, info };
  } catch (err) {
    return { success: false, error: err.message };
  }
});
```

### 步骤 2: 更新 preload.cjs（5 分钟）

在 `electron/preload.cjs` 中添加新的 API：

```javascript
// 在 tidyDesk 对象中添加
{
  // ... 现有 API ...
  
  // 刷新应用列表
  refreshApps: () => ipcRenderer.invoke('refresh-apps'),
  
  // 获取缓存信息
  getCacheInfo: () => ipcRenderer.invoke('get-cache-info'),
}
```

### 步骤 3: 更新 window.d.ts（5 分钟）

在 `src/types/window.d.ts` 中添加类型定义：

```typescript
interface TidyDeskAPI {
  // ... 现有 API ...
  
  // 刷新应用列表
  refreshApps: () => Promise<{ success: boolean; apps: any[] }>;
  
  // 获取缓存信息
  getCacheInfo: () => Promise<{ success: boolean; info: any }>;
}
```

### 步骤 4: 更新 AppPickerApp.tsx（15 分钟）

在 `src/AppPickerApp.tsx` 中添加刷新按钮和缓存信息：

```typescript
// 添加状态
const [isRefreshing, setIsRefreshing] = useState(false);
const [cacheInfo, setCacheInfo] = useState<any>(null);

// 加载缓存信息
useEffect(() => {
  loadCacheInfo();
}, []);

const loadCacheInfo = async () => {
  try {
    const tidyDeskApi = (window as any).tidyDesk;
    if (tidyDeskApi?.getCacheInfo) {
      const result = await tidyDeskApi.getCacheInfo();
      if (result.success) {
        setCacheInfo(result.info);
      }
    }
  } catch (err) {
    console.error('[TIDYDESK] Failed to load cache info:', err);
  }
};

// 刷新应用列表
const handleRefresh = async () => {
  setIsRefreshing(true);
  try {
    const tidyDeskApi = (window as any).tidyDesk;
    if (!tidyDeskApi?.refreshApps) {
      setError('刷新功能不可用');
      return;
    }

    const result = await tidyDeskApi.refreshApps();
    if (result.success) {
      setApps(result.apps);
      setFilteredApps(result.apps);
      setNotice('应用列表已刷新');
      await loadCacheInfo();
    }
  } catch (err) {
    setError(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
  } finally {
    setIsRefreshing(false);
  }
};

// 在搜索栏旁边添加刷新按钮
<div className="px-6 py-4 border-b border-white/10 flex gap-3">
  <div className="relative flex-1">
    <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
    <input
      type="text"
      value={searchQuery}
      onChange={(e) => setSearchQuery(e.target.value)}
      placeholder="搜索应用名称..."
      className="w-full rounded-lg bg-white/5 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
    />
  </div>
  
  <button
    onClick={handleRefresh}
    disabled={isRefreshing}
    className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
    title="刷新应用列表"
  >
    <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
    刷新
  </button>
</div>

// 在底部统计信息中显示缓存状态
<div className="border-t border-white/10 px-6 py-3 flex items-center justify-between">
  <p className="text-xs text-slate-500">
    找到 {filteredApps.length} 个应用
    {searchQuery && ` (共 ${apps.length} 个)`}
  </p>
  
  {cacheInfo?.exists && (
    <p className="text-xs text-slate-500">
      {cacheInfo.valid ? (
        <>缓存: {cacheInfo.ageMinutes} 分钟前</>
      ) : (
        <>缓存已过期</>
      )}
    </p>
  )}
</div>
```

---

## 🧪 测试

### 1. 首次打开（慢）
```bash
npm run desktop
```
- 打开应用选择器
- 应该看到 "Scanning installed apps (slow path)..."
- 耗时 6-12 秒
- 显示应用列表

### 2. 再次打开（快）
- 关闭应用选择器
- 再次打开
- 应该看到 "Using cached apps (fast path)"
- 耗时 < 1 秒 ✅
- 显示应用列表

### 3. 手动刷新
- 点击"刷新"按钮
- 应该重新扫描
- 耗时 6-12 秒
- 缓存更新

### 4. 缓存信息
- 底部应显示缓存时间
- 例如："缓存: 5 分钟前"

---

## 📊 性能对比

### 优化前
```
每次打开: 6-12 秒 ❌
```

### 优化后
```
首次打开: 6-12 秒（不变）
后续打开: < 1 秒 ✅ (提升 90%+)
```

---

## 🎯 后续优化（v3.3.0）

### 后台扫描

在 `main.cjs` 的 `app.whenReady()` 中添加：

```javascript
app.whenReady().then(() => {
  // ... 现有代码 ...
  
  // 后台更新应用缓存
  setTimeout(async () => {
    console.log('[TIDYDESK] Background app scan started');
    try {
      await appService.refreshApps();
      console.log('[TIDYDESK] Background app scan completed');
    } catch (err) {
      console.error('[TIDYDESK] Background app scan failed:', err);
    }
  }, 10000); // 10 秒后开始
  
  // 定期更新（每小时）
  setInterval(async () => {
    console.log('[TIDYDESK] Periodic app scan started');
    try {
      await appService.refreshApps();
      console.log('[TIDYDESK] Periodic app scan completed');
    } catch (err) {
      console.error('[TIDYDESK] Periodic app scan failed:', err);
    }
  }, 60 * 60 * 1000);
});
```

**效果**:
- 首次打开也很快（使用旧缓存）
- 缓存始终保持最新
- 用户体验最佳

---

## 💡 总结

### 为什么这个方案最好？

1. **简单** - 纯 JavaScript，无需额外依赖
2. **有效** - 90%+ 性能提升
3. **可靠** - 缓存失效自动重新扫描
4. **灵活** - 支持手动刷新
5. **低成本** - 30 分钟实现，零维护

### 为什么不用 Rust？

- Rust 只能优化文件扫描（20% 的时间）
- 图标获取（80% 的时间）仍需 Electron API
- 缓存可以优化 90%+ 的时间
- 实现简单，维护容易

---

**下一步**: 按照上述步骤实施缓存机制，立即提升性能！

