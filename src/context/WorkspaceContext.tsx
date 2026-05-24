import React, { createContext, useCallback, useContext, useEffect, useState, useMemo, ReactNode } from 'react';
import { nativeClient } from '../native/native-client';
import { TidyFile, TidyFolder, DesktopHealthInfo } from '../types/file';
import type { WindowAction } from '../types/tidydesk-api';
import { calculateDesktopHealth, generateSimulatedFiles, proposeTidyActions } from '../utils/tidyEngine';

const nativeApi = nativeClient;

interface WorkspaceContextType {
  files: TidyFile[];
  folders: TidyFolder[];
  selectedFileId: string | null;
  healthInfo: DesktopHealthInfo;
  isLoading: boolean;
  error: string | null;

  refreshDesktop: () => Promise<void>;
  setSelectedFileId: (id: string | null) => void;
  createDrawer: (name: string) => Promise<void>;
  deleteItem: (id: string, type: 'file' | 'folder') => Promise<void>;
  renameItem: (id: string, type: 'file' | 'folder', newName: string) => Promise<void>;
  moveFileToDrawer: (fileId: string, folderId: string | null) => Promise<void>;
  executeSmartTidy: (rule: 'category' | 'date' | 'temp') => Promise<{success: number; failed: number; errors: string[]}>;
  importExternalFiles: (filePaths: string[], folderId: string | null) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  clearError: () => void;
  windowControl: (action: WindowAction) => void;
  cleanupInvalidShortcuts: () => Promise<number>;
  validateAllShortcuts: () => Promise<{ total: number; valid: number; invalid: number; repaired: number }>;
  repairShortcut: (fileId: string) => Promise<boolean>;
  restoreToDesktop: (fileId: string) => Promise<boolean>;
}

const WorkspaceContext = createContext<WorkspaceContextType | undefined>(undefined);

function drawerNameFromId(folders: TidyFolder[], folderId: string | null): string | null {
  if (!folderId) return null;
  return folders.find(folder => folder.id === folderId)?.name || null;
}

export const WorkspaceProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [files, setFiles] = useState<TidyFile[]>([]);
  const [folders, setFolders] = useState<TidyFolder[]>([]);
  const [selectedFileId, setSelectedFileId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshDesktop = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    if (nativeApi.isAvailable()) {
      try {
        const data = await nativeApi.files.readDesktopFiles();
        setFiles(data.files || []);
        setFolders(data.folders || []);
        setSelectedFileId(null);
      } catch (err: unknown) {
        setError(`[CRITICAL] 桌面抽屉扫描失败: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const simulated = generateSimulatedFiles();
    setFiles(simulated);
    setFolders([
      { id: 'fol-1', name: '收纳抽屉', path: 'AppData\\TidyDesk\\drawers\\收纳抽屉', category: 'folder', modifiedAt: new Date().toISOString(), isSimulated: true, parentId: null }
    ]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshDesktop();
    
    // 监听文件监控事件
    if (nativeApi.isAvailable()) {
      const unsubscribeDeleted = nativeApi.shortcuts.onTargetFileDeleted((payload) => {
        console.log(`[TIDYDESK] Target file deleted: ${payload.targetPath} (${payload.shortcutCount} shortcuts affected)`);
        setError(`检测到 ${payload.shortcutCount} 个快捷方式的目标文件被删除`);
        refreshDesktop();
      });
      
      const unsubscribeRestored = nativeApi.shortcuts.onTargetFileRestored((payload) => {
        console.log(`[TIDYDESK] Target file restored: ${payload.targetPath}`);
        refreshDesktop();
      });
      
      const unsubscribeValidated = nativeApi.shortcuts.onValidated((stats) => {
        console.log(`[TIDYDESK] Periodic validation: ${stats.valid}/${stats.total} valid, ${stats.repaired} repaired`);
        if (stats.repaired > 0) {
          setError(`自动修复了 ${stats.repaired} 个快捷方式`);
        }
        refreshDesktop();
      });
      
      return () => {
        unsubscribeDeleted?.();
        unsubscribeRestored?.();
        unsubscribeValidated?.();
      };
    }
    return undefined;
  }, [refreshDesktop]);

  const healthInfo = useMemo(
    () => calculateDesktopHealth(files, folders.length),
    [files, folders.length]
  );
  
  const clearError = () => setError(null);

  const windowControl = (action: WindowAction) => {
    if (nativeApi.isAvailable()) nativeApi.windows.control(action);
  };

  const createDrawer = async (name: string) => {
    const nextName = name.trim();
    if (!nextName) return;

    if (nativeApi.isAvailable()) {
      try {
        await nativeApi.drawers.create(nextName);
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`[CRITICAL] 创建抽屉失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    setFolders(prev => [...prev, {
      id: `fol-${Date.now()}`,
      name: nextName,
      path: `AppData\\TidyDesk\\drawers\\${nextName}`,
      category: 'folder',
      modifiedAt: new Date().toISOString(),
      isSimulated: true,
      parentId: null
    }]);
  };

  const deleteItem = async (id: string, type: 'file' | 'folder') => {
    const item = type === 'file' ? files.find(file => file.id === id) : folders.find(folder => folder.id === id);
    if (!item) return;

    if (nativeApi.isAvailable()) {
      try {
        const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
        
        // 对于文件，使用完整的文件名（包含扩展名）
        let itemName = item.name;
        if (type === 'file' && 'extension' in item && item.extension) {
          // 如果 name 中没有扩展名，添加它
          if (!itemName.endsWith(item.extension)) {
            itemName = `${itemName}${item.extension}`;
          }
        }
        
        await nativeApi.drawers.deleteItem({ name: itemName, parentFolder });
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`[CRITICAL] 删除抽屉入口失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (type === 'file') setFiles(prev => prev.filter(file => file.id !== id));
    else setFolders(prev => prev.filter(folder => folder.id !== id));
  };

  const renameItem = async (id: string, type: 'file' | 'folder', newName: string) => {
    const item = type === 'file' ? files.find(file => file.id === id) : folders.find(folder => folder.id === id);
    if (!item || !newName.trim()) return;

    if (nativeApi.isAvailable()) {
      try {
        const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
        
        // 改进的扩展名处理
        let finalName = newName.trim();
        if (type === 'file') {
          const getFileExtension = (fileName: string): string => {
            // 处理特殊的双扩展名
            const doubleExtensions = ['.tar.gz', '.tar.bz2', '.tar.xz'];
            for (const ext of doubleExtensions) {
              if (fileName.toLowerCase().endsWith(ext)) {
                return ext;
              }
            }
            
            // 普通扩展名
            const lastDot = fileName.lastIndexOf('.');
            return lastDot > 0 ? fileName.slice(lastDot) : '';
          };
          
          const extension = getFileExtension(item.name);
          if (extension && item.name.includes('.')) {
            finalName = `${newName.trim()}${extension}`;
          }
        }
        
        await nativeApi.drawers.renameItem({
          oldName: item.name,
          newName: finalName,
          parentFolder
        });
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`[CRITICAL] 重命名抽屉入口失败: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (type === 'file') setFiles(prev => prev.map(file => file.id === id ? { ...file, name: newName.trim() } : file));
    else setFolders(prev => prev.map(folder => folder.id === id ? { ...folder, name: newName.trim() } : folder));
  };

  const importExternalFiles = async (filePaths: string[], folderId: string | null) => {
    if (filePaths.length === 0) return;

    if (nativeApi.isAvailable()) {
      try {
        await nativeApi.files.importExternalFiles({
          filePaths,
          targetFolder: drawerNameFromId(folders, folderId)
        });
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`[CRITICAL] 拖入收纳失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const moveFileToDrawer = async (fileId: string, folderId: string | null) => {
    const file = files.find(item => item.id === fileId);
    if (!file) return;
    await importExternalFiles([file.path], folderId);
  };

  const executeSmartTidy = async (rule: 'category' | 'date' | 'temp') => {
    const suggestions = proposeTidyActions(files, rule);
    const results = { success: 0, failed: 0, errors: [] as string[] };
    
    for (const suggestion of suggestions) {
      try {
        const file = files.find(item => item.id === suggestion.fileId);
        const folder = folders.find(f => f.name === '收纳抽屉') || folders[0];
        
        if (!folder) {
          setError('未找到目标抽屉，请先创建一个抽屉');
          return results;
        }
        
        if (file) {
          await importExternalFiles([file.path], folder.id);
          results.success++;
        }
      } catch (err: unknown) {
        results.failed++;
        const errorMsg = err instanceof Error ? err.message : String(err);
        results.errors.push(`${suggestion.fileName}: ${errorMsg}`);
        console.error(`[TIDYDESK] Failed to tidy file ${suggestion.fileName}:`, err);
      }
    }
    
    // 显示结果摘要
    if (results.failed > 0) {
      setError(`整理完成：成功 ${results.success} 个，失败 ${results.failed} 个。部分文件可能无法访问。`);
    } else if (results.success > 0) {
      // 成功后刷新
      await refreshDesktop();
    }
    
    return results;
  };

  const openFile = async (filePath: string) => {
    if (!filePath) return;

    if (nativeApi.isAvailable()) {
      try {
        await nativeApi.files.open(filePath);
      } catch (err: unknown) {
        setError(`[CRITICAL] 打开抽屉入口失败: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  };

  const cleanupInvalidShortcuts = async (): Promise<number> => {
    const invalidFiles = files.filter(file => file.parentId && file.isValid === false);
    
    if (invalidFiles.length === 0) {
      return 0;
    }

    let cleanedCount = 0;
    for (const file of invalidFiles) {
      try {
        await deleteItem(file.id, 'file');
        cleanedCount++;
      } catch (err) {
        console.error(`[TIDYDESK] Failed to delete invalid shortcut: ${file.name}`, err);
      }
    }

    if (cleanedCount > 0) {
      await refreshDesktop();
    }

    return cleanedCount;
  };

  const validateAllShortcuts = async () => {
    if (!nativeApi.isAvailable()) {
      return { total: 0, valid: 0, invalid: 0, repaired: 0 };
    }

    try {
      const stats = await nativeApi.shortcuts.validateAll();
      if (stats.repaired > 0 || stats.invalid > 0) {
        await refreshDesktop();
      }
      return stats;
    } catch (err: unknown) {
      setError(`验证失败: ${err instanceof Error ? err.message : String(err)}`);
      return { total: 0, valid: 0, invalid: 0, repaired: 0 };
    }
  };

  const repairShortcut = async (fileId: string): Promise<boolean> => {
    const file = files.find(f => f.id === fileId);
    if (!file || !file.targetPath || !nativeApi.isAvailable()) {
      return false;
    }

    try {
      const result = await nativeApi.shortcuts.repair({
        shortcutPath: file.path,
        targetPath: file.targetPath
      });

      if (result.repaired) {
        await refreshDesktop();
      }

      return result.repaired;
    } catch (err: unknown) {
      setError(`修复失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const restoreToDesktop = async (fileId: string): Promise<boolean> => {
    const file = files.find(f => f.id === fileId);
    if (!file || !nativeApi.isAvailable()) {
      return false;
    }

    try {
      const result = await nativeApi.files.restoreToDesktop({
        shortcutPath: file.path
      });

      if (result.success) {
        await refreshDesktop();
      }

      return result.success;
    } catch (err: unknown) {
      setError(`还原失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  return (
    <WorkspaceContext.Provider value={{
      files,
      folders,
      selectedFileId,
      healthInfo,
      isLoading,
      error,
      refreshDesktop,
      setSelectedFileId,
      createDrawer,
      deleteItem,
      renameItem,
      moveFileToDrawer,
      executeSmartTidy,
      importExternalFiles,
      openFile,
      clearError,
      windowControl,
      cleanupInvalidShortcuts,
      validateAllShortcuts,
      repairShortcut,
      restoreToDesktop
    }}>
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) throw new Error('[CRITICAL] useWorkspace must be used within WorkspaceProvider.');
  return context;
};
