import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { nativeClient } from '../../native/native-client';
import type { AppCacheInfo, InstalledApp } from '../../types/tidydesk-api';

/**
 * Manage installed apps scanning, buffered progressive icon hydration, and target drawer selection.
 */
export function useInstalledApps() {
  const noticeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const closeTimerRef = useRef<ReturnType<typeof setTimeout>>();
  const [apps, setApps] = useState<InstalledApp[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isLoadingIcons, setIsLoadingIcons] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string>('all');
  const [targetFolder, setTargetFolder] = useState<string>('');
  const [error, setError] = useState<string>('');
  const [notice, setNotice] = useState<string>('');
  const [cacheInfo, setCacheInfo] = useState<AppCacheInfo | null>(null);

  const loadTargetFolder = useCallback(async () => {
    try {
      if (!nativeClient.isAvailable()) return;
      const result = await nativeClient.apps.getPickerTarget();
      if (result.targetFolder) {
        setTargetFolder(result.targetFolder);
      }
    } catch {
      // target folder is optional
    }
  }, []);

  const loadCacheInfo = useCallback(async () => {
    try {
      if (!nativeClient.isAvailable()) return;
      const result = await nativeClient.apps.getCacheInfo();
      if (result.success) {
        setCacheInfo(result.info ?? null);
      }
    } catch {
      // cache info is optional
    }
  }, []);

  const loadApps = useCallback(async () => {
    setIsLoading(true);
    setIsLoadingIcons(false);
    try {
      if (!nativeClient.isAvailable()) return;
      const result = await nativeClient.apps.scanInstalled();
      if (result.success) {
        setApps(result.apps);
        setIsLoadingIcons(result.apps.length > 0);
      } else {
        setIsLoadingIcons(false);
      }
    } catch {
      setIsLoadingIcons(false);
      setError('加载应用列表失败');
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    const init = async () => {
      await loadTargetFolder();
      await loadCacheInfo();
      await loadApps();
      await loadCacheInfo();
    };
    void init();
  }, [loadApps, loadCacheInfo, loadTargetFolder]);

  useEffect(() => {
    return () => {
      if (noticeTimerRef.current) clearTimeout(noticeTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  useEffect(() => {
    if (!nativeClient.isAvailable()) return undefined;
    return nativeClient.apps.onSetTargetFolder((folder: string) => {
      setTargetFolder(folder);
    });
  }, []);

  useEffect(() => {
    if (!nativeClient.isAvailable()) return undefined;
    const pendingIcons = new Map<string, string | null>();
    let flushTimer: ReturnType<typeof setTimeout> | undefined;
    let pendingComplete = false;

    const flush = () => {
      flushTimer = undefined;
      if (pendingIcons.size > 0) {
        const snapshot = new Map(pendingIcons);
        pendingIcons.clear();
        setApps(current =>
          current.map(app => {
            const icon = snapshot.get(app.shortcutPath);
            return icon ? { ...app, icon } : app;
          })
        );
      }
      if (pendingComplete) {
        pendingComplete = false;
        setIsLoadingIcons(false);
      }
    };

    const unsubscribe = nativeClient.apps.onIconsUpdated(payload => {
      for (const update of payload.icons) {
        pendingIcons.set(update.shortcutPath, update.icon);
      }
      if (payload.complete) {
        pendingComplete = true;
      }
      if (payload.complete) {
        if (flushTimer) clearTimeout(flushTimer);
        flush();
      } else if (!flushTimer) {
        flushTimer = setTimeout(flush, 60);
      }
    });

    return () => {
      if (flushTimer) clearTimeout(flushTimer);
      unsubscribe?.();
    };
  }, []);

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

  const handleClose = useCallback(async () => {
    try {
      if (nativeClient.isAvailable()) {
        await nativeClient.apps.closePicker();
      }
    } catch {
      // close failure is non-critical
    }
  }, []);

  const handleRefresh = useCallback(async () => {
    setIsRefreshing(true);
    setIsLoadingIcons(false);
    setError('');
    try {
      if (!nativeClient.isAvailable()) {
        setError('刷新功能不可用');
        return;
      }

      const result = await nativeClient.apps.refresh();
      if (result.success) {
        setApps(result.apps);
        setIsLoadingIcons(result.apps.length > 0);
        setNotice('应用列表已刷新');
        await loadCacheInfo();

        noticeTimerRef.current = setTimeout(() => setNotice(''), 3000);
      } else {
        setIsLoadingIcons(false);
        setError('刷新失败');
      }
    } catch (err) {
      setIsLoadingIcons(false);
      setError(`刷新失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsRefreshing(false);
    }
  }, [loadCacheInfo]);

  const handleSelectApp = useCallback(async (app: InstalledApp) => {
    try {
      if (!nativeClient.isAvailable()) {
        setError('添加应用功能不可用');
        return;
      }

      await nativeClient.apps.addToDrawer({
        shortcutPath: app.shortcutPath,
        targetFolder
      });

      setNotice(`已添加应用: ${app.name}`);
      closeTimerRef.current = setTimeout(() => {
        void handleClose();
      }, 1000);
    } catch (err) {
      setError(`添加应用失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [handleClose, targetFolder]);

  return {
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
    isTauriAppPicker: cacheInfo?.source === 'tauri-rust-cache',
    handleRefresh,
    handleSelectApp,
    handleClose
  };
}
