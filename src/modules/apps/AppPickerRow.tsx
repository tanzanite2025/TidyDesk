import React from 'react';
import { AppWindow, Code, FileText, Globe, MessageSquare, Play } from 'lucide-react';
import type { InstalledApp } from '../../types/tidydesk-api';

const CATEGORY_NAMES: Record<string, string> = {
  all: '全部',
  browser: '浏览器',
  development: '开发工具',
  office: '办公软件',
  communication: '通讯工具',
  media: '媒体工具',
  other: '其他'
};

export const APP_CATEGORIES = ['all', 'browser', 'development', 'office', 'communication', 'media', 'other'] as const;

export function getCategoryIcon(category: string) {
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
}

export function getCategoryName(category: string): string {
  return CATEGORY_NAMES[category] || category;
}

interface AppPickerRowProps {
  app: InstalledApp;
  onSelect: (app: InstalledApp) => void;
}

/**
 * Single installed-application row displayed inside AppPickerApp.
 */
export const AppPickerRow: React.FC<AppPickerRowProps> = ({ app, onSelect }) => {
  return (
    <button
      onClick={() => onSelect(app)}
      data-testid="app-picker-app"
      className="flex items-center gap-3 rounded-lg border border-white/10 bg-white/5 px-4 py-3 text-left transition-all hover:bg-white/10 hover:border-white/20"
    >
      <div className="flex-shrink-0">
        {app.icon ? (
          <img src={app.icon} alt={app.name} className="h-8 w-8" />
        ) : (
          <div className="grid h-8 w-8 place-items-center rounded-lg bg-slate-700/50 text-slate-400">
            {getCategoryIcon(app.category)}
          </div>
        )}
      </div>

      <div className="flex-1 min-w-0">
        <div className="font-medium text-slate-100 text-sm truncate">
          {app.name}
        </div>
        <div className="text-xs text-slate-500 truncate mt-0.5">
          {app.targetPath || app.shortcutPath}
        </div>
      </div>

      <div className="flex-shrink-0">
        <span className="inline-flex items-center gap-1 rounded-md bg-white/5 px-2 py-1 text-xs text-slate-400">
          {getCategoryIcon(app.category)}
          {getCategoryName(app.category)}
        </span>
      </div>
    </button>
  );
};
