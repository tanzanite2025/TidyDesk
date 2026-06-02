import React, { useEffect, useMemo, useState } from 'react';
import { Search, X, Loader2, AppWindow, Globe, Code, FileText, MessageSquare, Play } from 'lucide-react';
import { nativeClient } from '../native/native-client';
import type { InstalledApp } from '../types/tidydesk-api';


interface AppPickerProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectApp: (app: InstalledApp) => void;
  targetFolder: string;
}

export const AppPicker: React.FC<AppPickerProps> = ({ isOpen, onClose, onSelectApp, targetFolder }) => {
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');

  useEffect(() => {
    if (!isOpen) return;
    let disposed = false;
    const loadApps = async () => {
      setIsLoading(true);
      try {
        if (!nativeClient.isAvailable()) return;
        const result = await nativeClient.apps.scanInstalled();
        if (disposed) return;
        if (result.success) {
          setApps(result.apps);
        }
      } catch {
        // error handled by finally
      } finally {
        if (!disposed) setIsLoading(false);
      }
    };
    loadApps();
    return () => { disposed = true; };
  }, [isOpen]);

  const filteredApps = useMemo(() => {
    let filtered = apps;
    if (selectedCategory !== 'all') {
      filtered = filtered.filter(app => app.category === selectedCategory);
    }
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase();
      filtered = filtered.filter(app =>
        app.name.toLowerCase().includes(query) ||
        app.targetPath.toLowerCase().includes(query)
      );
    }
    return filtered;
  }, [apps, searchQuery, selectedCategory]);

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

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
      <div className="relative w-[600px] max-h-[80vh] rounded-xl bg-[#1a1d2e] border border-white/10 shadow-2xl flex flex-col">
        {/* 头部 */}
        <div className="flex items-center justify-between border-b border-white/10 px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold text-slate-100">添加应用</h2>
            <p className="text-xs text-slate-500 mt-0.5">选择要添加到 "{targetFolder}" 的应用</p>
          </div>
          <button
            onClick={onClose}
            className="rounded-lg p-2 text-slate-400 hover:bg-white/5 hover:text-slate-200 transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* 搜索栏 */}
        <div className="px-6 py-4 border-b border-white/10">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" size={18} />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="搜索应用名称..."
              className="w-full rounded-lg bg-white/5 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-slate-100 placeholder-slate-500 focus:border-sky-500/50 focus:outline-none focus:ring-2 focus:ring-sky-500/20"
            />
          </div>
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
              {filteredApps.map((app) => (
                <button
                  key={app.shortcutPath}
                  onClick={() => onSelectApp(app)}
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
                      {app.targetPath}
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

        {/* 底部统计 */}
        <div className="border-t border-white/10 px-6 py-3">
          <p className="text-xs text-slate-500">
            找到 {filteredApps.length} 个应用
            {searchQuery && ` (共 ${apps.length} 个)`}
          </p>
        </div>
      </div>
    </div>
  );
};
