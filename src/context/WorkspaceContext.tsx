import React, {
  createContext,
  ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import { nativeClient } from '../native/native-client';
import { DesktopHealthInfo, TidyFile, TidyFolder } from '../types/file';
import type { ImportExternalFilesResult, WindowAction } from '../types/tidydesk-api';
import { calculateDesktopHealth, generateSimulatedFiles, proposeTidyActions } from '../utils/tidyEngine';

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
  executeSmartTidy: (rule: 'category' | 'date' | 'temp') => Promise<{ success: number; failed: number; errors: string[] }>;
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

function buildSimulatedFolder(name: string): TidyFolder {
  return {
    id: `fol-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    path: `AppData\\TidyDesk\\drawers\\${name}`,
    category: 'folder',
    modifiedAt: new Date().toISOString(),
    isSimulated: true,
    parentId: null
  };
}

function fileNameWithExtension(file: TidyFile): string {
  if (!file.extension || file.name.endsWith(file.extension)) {
    return file.name;
  }
  return `${file.name}${file.extension}`;
}

function fileExtensionFromName(fileName: string): string {
  const lowerName = fileName.toLowerCase();
  for (const ext of ['.tar.gz', '.tar.bz2', '.tar.xz']) {
    if (lowerName.endsWith(ext)) {
      return fileName.slice(fileName.length - ext.length);
    }
  }

  const lastDot = fileName.lastIndexOf('.');
  return lastDot > 0 ? fileName.slice(lastDot) : '';
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

    if (nativeClient.isAvailable()) {
      try {
        const data = await nativeClient.files.readDesktopFiles();
        setFiles(data.files || []);
        setFolders(data.folders || []);
        setSelectedFileId(null);
      } catch (err: unknown) {
        setError(`Failed to scan drawers: ${err instanceof Error ? err.message : String(err)}`);
      } finally {
        setIsLoading(false);
      }
      return;
    }

    const simulated = generateSimulatedFiles();
    setFiles(simulated);
    setFolders([buildSimulatedFolder('收纳抽屉')]);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    void refreshDesktop();

    if (!nativeClient.isAvailable()) {
      return undefined;
    }

    const unsubscribeDeleted = nativeClient.shortcuts.onTargetFileDeleted(payload => {
      setError(`Detected ${payload.shortcutCount} shortcut(s) whose target files were removed.`);
      void refreshDesktop();
    });

    const unsubscribeRestored = nativeClient.shortcuts.onTargetFileRestored(() => {
      void refreshDesktop();
    });

    const unsubscribeValidated = nativeClient.shortcuts.onValidated(stats => {
      if (stats.repaired > 0) {
        setError(`Auto-repaired ${stats.repaired} shortcut(s).`);
      }
      void refreshDesktop();
    });

    return () => {
      unsubscribeDeleted?.();
      unsubscribeRestored?.();
      unsubscribeValidated?.();
    };
  }, [refreshDesktop]);

  const healthInfo = useMemo(
    () => calculateDesktopHealth(files, folders.length),
    [files, folders.length]
  );

  const clearError = () => setError(null);

  const windowControl = (action: WindowAction) => {
    if (nativeClient.isAvailable()) {
      nativeClient.windows.control(action);
    }
  };

  const createDrawer = async (name: string) => {
    const nextName = name.trim();
    if (!nextName) return;

    if (nativeClient.isAvailable()) {
      try {
        await nativeClient.drawers.create(nextName);
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`Failed to create drawer: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    setFolders(prev => (
      prev.some(folder => folder.name === nextName)
        ? prev
        : [...prev, buildSimulatedFolder(nextName)]
    ));
  };

  const deleteItem = async (id: string, type: 'file' | 'folder') => {
    const item = type === 'file'
      ? files.find(file => file.id === id)
      : folders.find(folder => folder.id === id);
    if (!item) return;

    if (nativeClient.isAvailable()) {
      try {
        const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
        const itemName = type === 'file'
          ? fileNameWithExtension(item as TidyFile)
          : item.name;

        await nativeClient.drawers.deleteItem({ name: itemName, parentFolder });
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`Failed to delete drawer entry: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (type === 'file') {
      setFiles(prev => prev.filter(file => file.id !== id));
      return;
    }

    setFolders(prev => prev.filter(folder => folder.id !== id));
    setFiles(prev => prev.filter(file => file.parentId !== id));
  };

  const renameItem = async (id: string, type: 'file' | 'folder', newName: string) => {
    const nextName = newName.trim();
    if (!nextName) return;

    const item = type === 'file'
      ? files.find(file => file.id === id)
      : folders.find(folder => folder.id === id);
    if (!item) return;

    if (nativeClient.isAvailable()) {
      try {
        const parentFolder = item.parentId ? drawerNameFromId(folders, item.parentId) : null;
        const finalName = type === 'file'
          ? `${nextName}${fileExtensionFromName(item.name)}`
          : nextName;

        await nativeClient.drawers.renameItem({
          oldName: item.name,
          newName: finalName,
          parentFolder
        });
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`Failed to rename drawer entry: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (type === 'file') {
      setFiles(prev => prev.map(file => (
        file.id === id ? { ...file, name: nextName } : file
      )));
      return;
    }

    setFolders(prev => prev.map(folder => (
      folder.id === id ? { ...folder, name: nextName, path: `AppData\\TidyDesk\\drawers\\${nextName}` } : folder
    )));
  };

  const importExternalFiles = async (filePaths: string[], folderId: string | null) => {
    if (filePaths.length === 0) return;

    if (nativeClient.isAvailable()) {
      try {
        await nativeClient.files.importExternalFiles({
          filePaths,
          targetFolder: drawerNameFromId(folders, folderId)
        });
        await refreshDesktop();
      } catch (err: unknown) {
        setError(`Failed to import files: ${err instanceof Error ? err.message : String(err)}`);
      }
      return;
    }

    if (!folderId) return;
    setFiles(prev => prev.map(file => (
      filePaths.includes(file.path) ? { ...file, parentId: folderId } : file
    )));
  };

  const moveFileToDrawer = async (fileId: string, folderId: string | null) => {
    const file = files.find(item => item.id === fileId);
    if (!file) return;
    await importExternalFiles([file.path], folderId);
  };

  const executeSmartTidy = async (rule: 'category' | 'date' | 'temp') => {
    const suggestions = proposeTidyActions(files, rule);
    const results = { success: 0, failed: 0, errors: [] as string[] };
    const shouldRefreshDesktop = nativeClient.isAvailable();

    if (suggestions.length === 0) {
      return results;
    }

    if (nativeClient.isAvailable()) {
      const groupedSuggestions = new Map<string, string[]>();

      for (const suggestion of suggestions) {
        const file = files.find(item => item.id === suggestion.fileId);
        if (!file) {
          results.failed++;
          results.errors.push(`${suggestion.fileName}: missing source file`);
          continue;
        }

        const group = groupedSuggestions.get(suggestion.targetFolder) || [];
        group.push(file.path);
        groupedSuggestions.set(suggestion.targetFolder, group);
      }

      for (const [targetFolder, groupedPaths] of groupedSuggestions) {
        try {
          await nativeClient.drawers.create(targetFolder);

          for (let index = 0; index < groupedPaths.length; index += 100) {
            const batch = groupedPaths.slice(index, index + 100);
            const importResult: ImportExternalFilesResult = await nativeClient.files.importExternalFiles({
              filePaths: batch,
              targetFolder
            });
            const addedCount = Array.isArray(importResult.added) ? importResult.added.length : 0;

            results.success += addedCount;
            if (addedCount < batch.length) {
              results.failed += batch.length - addedCount;
            }
          }
        } catch (err: unknown) {
          results.failed += groupedPaths.length;
          results.errors.push(`${targetFolder}: ${err instanceof Error ? err.message : String(err)}`);
        }
      }

    } else {
      const folderIdsByName = new Map(folders.map(folder => [folder.name, folder.id]));
      const nextFolders = [...folders];
      let nextFiles = [...files];

      for (const suggestion of suggestions) {
        let folderId = folderIdsByName.get(suggestion.targetFolder) || null;
        if (!folderId) {
          const newFolder = buildSimulatedFolder(suggestion.targetFolder);
          folderId = newFolder.id;
          folderIdsByName.set(newFolder.name, newFolder.id);
          nextFolders.push(newFolder);
        }

        const file = nextFiles.find(item => item.id === suggestion.fileId);
        if (!file) {
          results.failed++;
          results.errors.push(`${suggestion.fileName}: missing source file`);
          continue;
        }

        nextFiles = nextFiles.map(item => (
          item.id === suggestion.fileId
            ? { ...item, parentId: folderId }
            : item
        ));
        results.success++;
      }

      setFolders(nextFolders);
      setFiles(nextFiles);
    }

    if (results.failed > 0) {
      setError(`Smart tidy finished with ${results.success} success(es) and ${results.failed} failure(s).`);
    }

    if (shouldRefreshDesktop && results.success > 0) {
      await refreshDesktop();
    }

    return results;
  };

  const openFile = async (filePath: string) => {
    if (!filePath) return;

    if (nativeClient.isAvailable()) {
      try {
        await nativeClient.files.open(filePath);
      } catch (err: unknown) {
        setError(`Failed to open drawer entry: ${err instanceof Error ? err.message : String(err)}`);
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
      } catch {
        // best-effort cleanup
      }
    }

    if (cleanedCount > 0) {
      await refreshDesktop();
    }

    return cleanedCount;
  };

  const validateAllShortcuts = async () => {
    if (!nativeClient.isAvailable()) {
      return { total: 0, valid: 0, invalid: 0, repaired: 0 };
    }

    try {
      const stats = await nativeClient.shortcuts.validateAll();
      if (stats.repaired > 0 || stats.invalid > 0) {
        await refreshDesktop();
      }
      return stats;
    } catch (err: unknown) {
      setError(`Validation failed: ${err instanceof Error ? err.message : String(err)}`);
      return { total: 0, valid: 0, invalid: 0, repaired: 0 };
    }
  };

  const repairShortcut = async (fileId: string): Promise<boolean> => {
    const file = files.find(nextFile => nextFile.id === fileId);
    if (!file || !file.targetPath || !nativeClient.isAvailable()) {
      return false;
    }

    try {
      const result = await nativeClient.shortcuts.repair({
        shortcutPath: file.path,
        targetPath: file.targetPath
      });

      if (result.repaired) {
        await refreshDesktop();
      }

      return result.repaired;
    } catch (err: unknown) {
      setError(`Repair failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  const restoreToDesktop = async (fileId: string): Promise<boolean> => {
    const file = files.find(nextFile => nextFile.id === fileId);
    if (!file || !nativeClient.isAvailable()) {
      return false;
    }

    try {
      const result = await nativeClient.files.restoreToDesktop({
        shortcutPath: file.path
      });

      if (result.success) {
        await refreshDesktop();
      }

      return result.success;
    } catch (err: unknown) {
      setError(`Restore failed: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  };

  return (
    <WorkspaceContext.Provider
      value={{
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
      }}
    >
      {children}
    </WorkspaceContext.Provider>
  );
};

export const useWorkspace = () => {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error('[CRITICAL] useWorkspace must be used within WorkspaceProvider.');
  }
  return context;
};
