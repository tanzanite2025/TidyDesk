import React, { createContext, useCallback, useContext, useEffect, useState, useMemo, ReactNode } from 'react';
import { TidyFile, TidyFolder, DesktopHealthInfo } from '../types/file';
import { calculateDesktopHealth, generateSimulatedFiles, proposeTidyActions } from '../utils/tidyEngine';

type WindowAction = 'close' | 'minimize' | 'expand-drawer' | 'collapse-drawer' | 'toggle-drawer';

type TidyDeskApi = {
  readDesktopFiles: () => Promise<{ files: TidyFile[]; folders: TidyFolder[] }>;
  createDrawer: (name: string) => Promise<unknown>;
  renameItem: (payload: { oldName: string; newName: string; parentFolder: string | null }) => Promise<unknown>;
  deleteItem: (payload: { name: string; parentFolder: string | null }) => Promise<unknown>;
  importExternalFiles: (payload: { filePaths: string[]; targetFolder: string | null }) => Promise<unknown>;
  openFile: (filePath: string) => Promise<unknown>;
  windowControl: (action: WindowAction) => void;
};

const tidyDeskApi: TidyDeskApi | null = (window as any).tidyDesk || null;

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
  executeSmartTidy: (rule: 'category' | 'date' | 'temp') => Promise<void>;
  importExternalFiles: (filePaths: string[], folderId: string | null) => Promise<void>;
  openFile: (filePath: string) => Promise<void>;
  clearError: () => void;
  windowControl: (action: WindowAction) => void;
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

    if (tidyDeskApi) {
      try {
        const data = await tidyDeskApi.readDesktopFiles();
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
  }, [refreshDesktop]);

  const healthInfo = useMemo(
    () => calculateDesktopHealth(files, folders.length),
    [files, folders.length]
  );
  
  const clearError = () => setError(null);

  const windowControl = (action: WindowAction) => {
    tidyDeskApi?.windowControl(action);
  };

  const createDrawer = async (name: string) => {
    const nextName = name.trim();
    if (!nextName) return;

    if (tidyDeskApi) {
      try {
        await tidyDeskApi.createDrawer(nextName);
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

    if (tidyDeskApi) {
      try {
        const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
        await tidyDeskApi.deleteItem({ name: item.name, parentFolder });
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

    if (tidyDeskApi) {
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
        
        await tidyDeskApi.renameItem({
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

    if (tidyDeskApi) {
      try {
        await tidyDeskApi.importExternalFiles({
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

    if (tidyDeskApi) {
      try {
        await tidyDeskApi.openFile(filePath);
      } catch (err: unknown) {
        setError(`[CRITICAL] 打开抽屉入口失败: ${err instanceof Error ? err.message : String(err)}`);
      }
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
      windowControl
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
