import React, { useEffect, useMemo, useState, useRef } from 'react';
import { useWorkspace } from '../../context/WorkspaceContext';
import { nativeClient } from '../../native/native-client';
import { isTauriRuntime } from '../../native/tauri-adapter';

const windowMode = new URLSearchParams(window.location.search).get('mode');
export type DrawerTab = 'files' | 'capture';

function getPathFromDroppedFile(file: globalThis.File): string | null {
  const fileWithPath = file as globalThis.File & { path?: string };
  if (fileWithPath.path) return fileWithPath.path;
  if (nativeClient.isAvailable() && !isTauriRuntime()) return nativeClient.windows.getPathForFile(file);
  return null;
}

export function useDrawerOperations() {
  const {
    files,
    folders,
    healthInfo,
    isLoading,
    refreshDesktop,
    createDrawer,
    renameItem,
    deleteItem,
    importExternalFiles,
    openFile,
    clearError,
    windowControl,
    cleanupInvalidShortcuts,
    validateAllShortcuts,
    repairShortcut,
    restoreToDesktop
  } = useWorkspace();

  const [searchQuery, setSearchQuery] = useState('');
  const [draggingOverDrawerId, setDraggingOverDrawerId] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isDrawerExpanded, setIsDrawerExpanded] = useState(false);
  const [renamingDrawerId, setRenamingDrawerId] = useState<string | null>(null);
  const [draftDrawerName, setDraftDrawerName] = useState('');
  const [isClosing, setIsClosing] = useState(false);
  const [isCreatingDrawer, setIsCreatingDrawer] = useState(false);
  const [isCleaningUp, setIsCleaningUp] = useState(false);
  const [isValidating, setIsValidating] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [activeDrawerTab, setActiveDrawerTab] = useState<DrawerTab>(windowMode === 'capture' ? 'capture' : 'files');
  const isDrawerExpandedRef = useRef(isDrawerExpanded);
  const tauriDroppedPathsRef = useRef<string[] | null>(null);
  
  const [debouncedSearchQuery, setDebouncedSearchQuery] = useState('');
  
  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearchQuery(searchQuery);
    }, 300);
    
    return () => clearTimeout(timer);
  }, [searchQuery]);
  
  useEffect(() => {
    isDrawerExpandedRef.current = isDrawerExpanded;
  }, [isDrawerExpanded]);

  const allDrawerFiles = useMemo(() => {
    const query = debouncedSearchQuery.trim().toLowerCase();
    return folders.map(drawer => {
      const drawerFiles = files.filter(file => file.parentId === drawer.id);
      const filtered = query 
        ? drawerFiles.filter(file => file.name.toLowerCase().includes(query))
        : drawerFiles;
      return { drawer, files: filtered };
    });
  }, [folders, files, debouncedSearchQuery]);

  const invalidShortcutsCount = useMemo(() => {
    return files.filter(file => file.parentId && file.isValid === false).length;
  }, [files]);

  useEffect(() => {
    if (!nativeClient.isAvailable()) return undefined;
    
    let closeTimer: ReturnType<typeof setTimeout> | undefined;

    const unsubscribe = nativeClient.windows.onDrawerState(payload => {
      if (!payload.expanded && isDrawerExpandedRef.current) {
        setIsClosing(true);
        if (closeTimer) clearTimeout(closeTimer);
        closeTimer = setTimeout(() => {
          setIsDrawerExpanded(false);
          setIsClosing(false);
          closeTimer = undefined;
        }, 200);
      } else {
        setIsDrawerExpanded(payload.expanded);
        setIsClosing(false);
      }
    });

    const unsubscribeModule = nativeClient.windows.onModuleState(payload => {
      if (payload.activeModule === 'capture') {
        setActiveDrawerTab('capture');
      } else if (payload.activeModule === 'files') {
        setActiveDrawerTab('files');
      }
    });
    
    return () => {
      if (closeTimer) clearTimeout(closeTimer);
      unsubscribe?.();
      unsubscribeModule?.();
    };
  }, []);

  useEffect(() => {
    if (!isTauriRuntime()) return undefined;

    let disposed = false;
    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/window')
      .then(api => api.getCurrentWindow().onDragDropEvent(event => {
        if (event.payload.type === 'drop') {
          tauriDroppedPathsRef.current = event.payload.paths;
          return;
        }
        if (event.payload.type === 'leave') {
          tauriDroppedPathsRef.current = null;
        }
      }))
      .then(nextUnlisten => {
        if (disposed) {
          nextUnlisten();
          return;
        }
        unlisten = nextUnlisten;
      })
      .catch(() => undefined);

    return () => {
      disposed = true;
      tauriDroppedPathsRef.current = null;
      unlisten?.();
    };
  }, []);

  function switchDrawerTab(tab: DrawerTab) {
    if (tab === activeDrawerTab) return;

    setActiveDrawerTab(tab);

    if (nativeClient.isAvailable()) {
      windowControl(tab === 'files' ? 'show-files-tab' : 'show-capture-tab');
      return;
    }
  }

  const [hasAttemptedDefaultDrawer, setHasAttemptedDefaultDrawer] = useState(false);

  useEffect(() => {
    if (folders.length === 0 && !hasAttemptedDefaultDrawer) {
      setHasAttemptedDefaultDrawer(true);
      createDrawer('收纳抽屉');
    }
  }, [createDrawer, folders.length, hasAttemptedDefaultDrawer]);

  async function handleDropOnDrawer(event: React.DragEvent, drawerId: string) {
    event.preventDefault();
    event.stopPropagation();
    setDraggingOverDrawerId(null);

    const browserFilePaths = Array.from(event.dataTransfer.files)
      .map(getPathFromDroppedFile)
      .filter((filePath): filePath is string => Boolean(filePath));

    const filePaths = (isTauriRuntime() && tauriDroppedPathsRef.current?.length
      ? tauriDroppedPathsRef.current
      : browserFilePaths)
      .filter((filePath, index, paths) => paths.indexOf(filePath) === index);

    tauriDroppedPathsRef.current = null;

    if (filePaths.length === 0) return;

    if (nativeClient.isAvailable()) {
      nativeClient.events.send('file-dropped');
    }

    await importExternalFiles(filePaths, drawerId);
    setNotice('已加入抽屉。这里只创建快捷入口，原桌面文件没有移动。');
  }

  async function handleCreateDrawer() {
    setIsCreatingDrawer(true);
    const name = `抽屉 ${folders.length + 1}`;
    await createDrawer(name);
    setIsCreatingDrawer(false);
  }

  async function submitDrawerRename(event: React.FormEvent, drawerId: string) {
    event.preventDefault();
    const nextName = draftDrawerName.trim();
    if (!nextName) return;

    await renameItem(drawerId, 'folder', nextName);
    setRenamingDrawerId(null);
  }

  async function handleCleanupInvalidShortcuts() {
    if (invalidShortcutsCount === 0) return;
    
    if (!confirm(`发现 ${invalidShortcutsCount} 个失效的快捷方式（目标文件已移动或删除）。\n\n是否删除这些失效的快捷方式？\n\n注意：这不会影响原文件。`)) {
      return;
    }

    setIsCleaningUp(true);
    try {
      const cleaned = await cleanupInvalidShortcuts();
      setNotice(`已清理 ${cleaned} 个失效的快捷方式`);
    } catch (err) {
      setError(`清理失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsCleaningUp(false);
    }
  }

  async function handleValidateAll() {
    setIsValidating(true);
    try {
      const stats = await validateAllShortcuts();
      if (stats.repaired > 0) {
        setNotice(`验证完成：自动修复了 ${stats.repaired} 个快捷方式`);
      } else if (stats.invalid > 0) {
        setNotice(`验证完成：发现 ${stats.invalid} 个失效的快捷方式`);
      } else {
        setNotice(`验证完成：所有快捷方式都有效`);
      }
    } catch (err) {
      setError(`验证失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsValidating(false);
    }
  }

  async function handleRepairShortcut(fileId: string, fileName: string) {
    try {
      const repaired = await repairShortcut(fileId);
      if (repaired) {
        setNotice(`成功修复快捷方式: ${fileName}`);
      } else {
        setError(`无法修复快捷方式: ${fileName}。未在常见位置找到目标文件。`);
      }
    } catch (err) {
      setError(`修复失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function handleRestoreToDesktop(fileId: string, fileName: string) {
    if (!confirm(`将 "${fileName}" 还原到桌面？\n\n文件将从抽屉移回桌面，快捷方式将被删除。`)) {
      return;
    }

    try {
      const restored = await restoreToDesktop(fileId);
      if (restored) {
        setNotice(`已还原到桌面: ${fileName}`);
      } else {
        setError(`无法还原: ${fileName}。此文件不是由 TidyDesk 管理的。`);
      }
    } catch (err) {
      setError(`还原失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  async function openAppPicker(folderName: string) {
    try {
      if (!nativeClient.isAvailable()) {
        setError('打开应用选择器功能不可用');
        return;
      }

      await nativeClient.apps.openPicker({ targetFolder: folderName });
    } catch (err) {
      setError(`打开应用选择器失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return {
    files,
    folders,
    healthInfo,
    isLoading,
    refreshDesktop,
    createDrawer,
    renameItem,
    deleteItem,
    importExternalFiles,
    openFile,
    clearError,
    windowControl,
    cleanupInvalidShortcuts,
    validateAllShortcuts,
    repairShortcut,
    restoreToDesktop,
    
    searchQuery,
    setSearchQuery,
    draggingOverDrawerId,
    setDraggingOverDrawerId,
    notice,
    setNotice,
    error,
    setError,
    isDrawerExpanded,
    setIsDrawerExpanded,
    renamingDrawerId,
    setRenamingDrawerId,
    draftDrawerName,
    setDraftDrawerName,
    isClosing,
    isCreatingDrawer,
    isCleaningUp,
    isValidating,
    showSettings,
    setShowSettings,
    activeDrawerTab,
    allDrawerFiles,
    invalidShortcutsCount,
    
    switchDrawerTab,
    handleDropOnDrawer,
    handleCreateDrawer,
    submitDrawerRename,
    handleCleanupInvalidShortcuts,
    handleValidateAll,
    handleRepairShortcut,
    handleRestoreToDesktop,
    openAppPicker
  };
}
