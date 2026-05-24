import React, { useEffect, useState } from 'react';
import { Search, X, Loader2, AppWindow, Globe, Code, FileText, MessageSquare, Play, RefreshCw } from 'lucide-react';
import { nativeClient } from './native/native-client';
import type { AppCacheInfo, InstalledApp } from './types/tidydesk-api';


export const AppPickerApp: React.FC = () => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [filteredApps, setFilteredApps] = useState<InstalledApp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [targetFolder, setTargetFolder] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [cacheInfo, setCacheInfo] = useState<AppCacheInfo | null>(null);
  const isTauriAppPickerPoc = cacheInfo?.source === 'tauri-sidecar-metadata' || cacheInfo?.source === 'tauri-sidecar-target-aware';
  const isTauriMetadataOnly = cacheInfo?.source === 'tauri-sidecar-metadata';
  const isTauriTargetAware = cacheInfo?.source === 'tauri-sidecar-target-aware';

  useEffect(() => {
    loadTargetFolder();
    loadApps();
    loadCacheInfo();
  }, []);

  useEffect(() => {
    filterApps();
  }, [searchQuery, selectedCategory, apps]);

  // 监听目标文件夹设置
  useEffect(() => {
    const nativeApi = nativeClient;
    if (nativeApi.isAvailable()) {
      const unsubscribe = nativeApi.apps.onSetTargetFolder((folder: string) => {
        setTargetFolder(folder);
      });
      return unsubscribe;
    }
    return undefined;
  }, []);

  const loadTargetFolder = async () => {
    try {
      const nativeApi = nativeClient;
      if (!nativeApi.isAvailable()) {
        console.error('[TIDYDESK] getAppPickerTarget API not available');
        return;
      }

      const result = await nativeApi.apps.getPickerTarget();
      if (result.targetFolder) {
        setTargetFolder(result.targetFolder);
      }
    } catch (err) {
      console.error('[TIDYDESK] Failed to load target folder:', err);
    }
  };

  const loadCacheInfo = async () => {
    try {
      const nativeApi = nativeClient;
      if (nativeApi.isAvailable()) {
        const result = await nativeApi.apps.getCacheInfo();
        if (result.success) {
          setCacheInfo(result.info ?? null);
        }
      }
    } catch (err) {
      console.error('[TIDYDESK] Failed to load cache info:', err);
    }
  };

  const loadApps = async () => {
    setIsLoading(true);
    try {
      const nativeApi = nativeClient;
      if (!nativeApi.isAvailable()) {
        console.error('[TIDYDESK] scanInstalledApps API not available');
        return;
      }

      const result = await nativeApi.apps.scanInstalled();
      if (result.success) {
        setApps(result.apps);
        setFilteredApps(result.apps);
      }
    } catch (err) {
      console.error('[TIDYDESK] Failed to load apps:', err);
      setError('加载应用列表失败');
    } finally {
      setIsLoading(false);
    }
  };

  const filterApps = () => {
    let filtered = apps;

    // 按分类过滤
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(app => app.category === selectedCategory);
    }

    // 按搜索词过滤
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(app =>
        app.name.toLowerCase().includes(query) ||
        app.targetPath.toLowerCase().includes(query)
      );
    }

    setFilteredApps(filtered);
  };

  const handleRefresh = async () => {
    setIsRefreshing(true);
    setError('');
    try {
      const nativeApi = nativeClient;
      if (!nativeApi.isAvailable()) {
        setError('刷新功能不可用');
        return;
      }

      const result = await nativeApi.apps.refresh();
      if (result.success) {
        setApps(result.apps);
        setFilteredApps(result.apps);
        setNotice('应用列表已刷新');
        await loadCacheInfo();
        
        // 清除成功提示
        setTimeout(() => setNotice(''), 3000);
      } else {
        setError('刷新失败');
      }
    } catch (err) {
      setError(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  };

  const handleSelectApp = async (app: InstalledApp) => {
    try {
      if (isTauriMetadataOnly) {
        setNotice(`Tauri PoC 当前只验证应用扫描与 target 解析，暂不添加应用: ${app.name}`);
        setTimeout(() => setNotice(''), 3000);
        return;
      }

      const nativeApi = nativeClient;
      if (!nativeApi.isAvailable()) {
        setError('添加应用功能不可用');
        return;
      }

      await nativeApi.apps.addToDrawer({
        shortcutPath: app.shortcutPath,
        targetFolder: targetFolder
      });

      setNotice(`已添加应用: ${app.name}`);
      
      // 延迟关闭窗口，让用户看到成功提示
      setTimeout(() => {
        handleClose();
      }, 1000);
    } catch (err) {
      setError(`添加应用失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const handleClose = async () => {
    try {
      const nativeApi = nativeClient;
      if (nativeApi.isAvailable()) {
        await nativeApi.apps.closePicker();
      }
    } catch (err) {
      console.error('[TIDYDESK] Failed to close app picker:', err);
    }
  };

  const getCategoryIcon = (category: string) => {
    switch (category) {
      case 'browser':
        return <Globe size={16} />;
      case 'development':
        return <Code size={16} />;
      case 'office':
        return <FileText size={16} />;
      case 'communication':
        return <MessageSquare size={16} />;
      case 'media':
        return <Play size={16} />;
      default:
        return <AppWindow size={16} />;
    }
  };

  const getCategoryName = (category: string) => {
    const names: Record<string, string> = {
      all: '全部',
      browser: '浏览器',
      development: '开发工具',
      office: '办公软件',
      communication: '通讯工具',
      media: '媒体工具',
      other: '其他'
    };
    return names[category] || category;
  };

  const categories = ['all', 'browser', 'development', 'office', 'communication', 'media', 'other'];

  return (
    <div className="flex h-screen w-full flex-col bg-[#1a1d2e]">
      {/* 通知和错误提示 */}
      {notice && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-emerald-500/20 border border-emerald-500/30 px-4 py-2 text-sm text-emerald-200 shadow-lg">
          {notice}
        </div>
      )}
      {error && (
        <div className="fixed top-4 right-4 z-50 rounded-lg bg-red-500/20 border border-red-500/30 px-4 py-2 text-sm text-red-200 shadow-lg">
          {error}
        </div>
      )}

      {/* 头部 */}
      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <h2 className="text-lg font-semibold text-slate-100">{isTauriAppPickerPoc ? 'AppPicker Tauri PoC' : '添加应用'}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isTauriAppPickerPoc
              ? '验证 Go sidecar 扫描、Tauri target 解析与添加到抽屉，暂不提取 icon'
              : `选择要添加到 "${targetFolder || '...'}" 的应用`}
          </p>
        </div>
        <button
          onClick={handleClose}
          className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X size={20} />
        </button>
      </div>

      {isTauriAppPickerPoc && (
        <div className="border-b border-cyan-500/20 bg-cyan-500/10 px-6 py-3 text-xs text-cyan-100">
          {isTauriTargetAware
            ? `Tauri add-to-drawer PoC：targetPath 由 Rust 解析，点击条目会复制快捷方式到 "${targetFolder || '收纳抽屉'}"。`
            : 'Tauri metadata-only PoC：列表来自 Go sidecar `apps.scanMetadata`，点击条目不会执行添加动作。'}
        </div>
      )}

      {/* 搜索栏和刷新按钮 */}
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
          disabled={isRefreshing || isLoading}
          className="flex items-center gap-2 px-4 py-2.5 rounded-lg bg-white/5 border border-white/10 text-sm text-slate-300 hover:bg-white/10 hover:border-white/20 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          title="刷新应用列表"
        >
          <RefreshCw size={16} className={isRefreshing ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {/* 分类标签 */}
      <div className="px-6 py-3 border-b border-white/10 flex gap-2 overflow-x-auto">
        {categories.map(category => (
          <button
            key={category}
            onClick={() => setSelectedCategory(category)}
            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ${
              selectedCategory === category
                ? 'bg-sky-500/20 text-sky-200 border border-sky-500/30'
                : 'bg-white/5 text-slate-400 border border-white/10 hover:bg-white/10 hover:text-slate-300'
            }`}
          >
            {category !== 'all' && getCategoryIcon(category)}
            {getCategoryName(category)}
          </button>
        ))}
      </div>

      {/* 应用列表 */}
      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Loader2 className="animate-spin mb-3" size={32} />
            <p className="text-sm">正在扫描已安装的应用...</p>
          </div>
        ) : filteredApps.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <AppWindow className="mb-3 opacity-40" size={32} />
            <p className="text-sm">
              {searchQuery ? '未找到匹配的应用' : '未找到已安装的应用'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2">
            {filteredApps.map((app, index) => (
              <button
                key={index}
                onClick={() => handleSelectApp(app)}
                className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left transition-all hover:bg-white/10 hover:border-white/20"
              >
                {/* 应用图标 */}
                <div className="flex-shrink-0">
                  {app.icon ? (
                    <img src={app.icon} alt={app.name} className="h-8 w-8" />
                  ) : (
                    <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-700/50 text-slate-400">
                      {getCategoryIcon(app.category)}
                    </div>
                  )}
                </div>

                {/* 应用信息 */}
                <div className="flex-1 min-w-0">
                  <div className="font-medium text-slate-100 text-sm truncate">
                    {app.name}
                  </div>
                  <div className="text-xs text-slate-500 truncate mt-0.5">
                    {app.targetPath || app.shortcutPath}
                  </div>
                </div>

                {/* 分类标签 */}
                <div className="flex-shrink-0">
                  <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-400">
                    {getCategoryIcon(app.category)}
                    {getCategoryName(app.category)}
                  </span>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* 底部统计和缓存信息 */}
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
    </div>
  );
};
