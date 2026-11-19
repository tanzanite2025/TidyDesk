import React from 'react';
import { AppWindow, Loader2, RefreshCw, Search, X } from 'lucide-react';
import { useInstalledApps } from './modules/apps/useInstalledApps';
import { APP_CATEGORIES, AppPickerRow, getCategoryIcon, getCategoryName } from './modules/apps/AppPickerRow';

export const AppPickerApp: React.FC = () => {
  const {
    apps,
    filteredApps,
    searchQuery,
    setSearchQuery,
    isLoading,
    isRefreshing,
    isLoadingIcons,
    selectedCategory,
    setSelectedCategory,
    targetFolder,
    error,
    notice,
    cacheInfo,
    isTauriAppPicker,
    handleRefresh,
    handleSelectApp,
    handleClose
  } = useInstalledApps();

  return (
    <div data-testid="app-picker-root" className="flex h-screen w-full flex-col bg-[#1a1d2e]">
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

      <div className="flex items-center justify-between border-b border-white/10 px-6 py-4" style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
        <div style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
          <h2 className="text-lg font-semibold text-slate-100">{isTauriAppPicker ? 'App Picker' : '添加应用'}</h2>
          <p className="text-xs text-slate-500 mt-0.5">
            {isTauriAppPicker
              ? '扫描应用并添加到抽屉'
              : `选择要添加到 "${targetFolder || '...'}" 的应用`}
          </p>
        </div>
        <button
          onClick={handleClose}
          data-testid="app-picker-close"
          className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <X size={20} />
        </button>
      </div>

      {isTauriAppPicker && (
        <div className="border-b border-cyan-500/20 bg-cyan-500/10 px-6 py-3 text-xs text-cyan-100">
          targetPath 由 Rust 解析，点击条目会复制快捷方式到 "{targetFolder || '收纳抽屉'}"。
        </div>
      )}

      <div className="px-6 py-4 border-b border-white/10 flex gap-3">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            data-testid="app-picker-search"
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

      <div className="px-6 py-3 border-b border-white/10 flex gap-2 overflow-x-auto">
        {APP_CATEGORIES.map(category => (
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

      <div className="flex-1 overflow-y-auto px-6 py-4">
        {isLoading ? (
          <div className="flex flex-col items-center justify-center py-12 text-slate-500">
            <Loader2 className="animate-spin mb-3" size={32} />
            <p className="text-sm">{cacheInfo?.valid ? '正在读取应用缓存...' : '正在扫描已安装的应用...'}</p>
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
            {filteredApps.map(app => (
              <AppPickerRow key={app.shortcutPath} app={app} onSelect={handleSelectApp} />
            ))}
          </div>
        )}
      </div>

      <div className="border-t border-white/10 px-6 py-3 flex items-center justify-between">
        <p className="text-xs text-slate-500">
          找到 {filteredApps.length} 个应用
          {searchQuery && ` (共 ${apps.length} 个)`}
          {isLoadingIcons && '，图标后台加载中...'}
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
