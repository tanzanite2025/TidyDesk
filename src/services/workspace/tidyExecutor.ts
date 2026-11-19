import { nativeClient } from '../../native/native-client';
import type { TidyFile, TidyFolder } from '../../types/file';
import type { ImportExternalFilesResult, ImportSkippedReason } from '../../types/tidydesk-api';
import { proposeTidyActions } from '../../utils/tidyEngine';

export interface SmartTidySummary {
  success: number;
  failed: number;
  errors: string[];
}

export function buildSimulatedFolder(name: string): TidyFolder {
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

function importSkippedReasonLabel(reason: ImportSkippedReason): string {
  switch (reason) {
    case 'missing':
      return '源文件不存在';
    case 'alreadyInDrawer':
      return '已在抽屉内';
    case 'protected':
      return '受保护项目';
    default:
      return '已跳过';
  }
}

function fileNameFromPath(filePath: string): string {
  return filePath.split(/[\\/]/).filter(Boolean).pop() || filePath;
}

function appendImportResultErrors(results: { failed: number; errors: string[] }, importResult: ImportExternalFilesResult) {
  const skipped = importResult.skipped || [];
  const failed = importResult.failed || [];

  results.failed += skipped.length + failed.length;
  for (const item of skipped) {
    results.errors.push(`${fileNameFromPath(item.source)}: ${importSkippedReasonLabel(item.reason)}`);
  }
  for (const item of failed) {
    results.errors.push(`${fileNameFromPath(item.source)}: ${item.error}`);
  }
}

export async function executeNativeSmartTidy(
  files: TidyFile[],
  rule: 'category' | 'date' | 'temp'
): Promise<SmartTidySummary> {
  const suggestions = proposeTidyActions(files, rule);
  const results: SmartTidySummary = { success: 0, failed: 0, errors: [] };
  if (suggestions.length === 0) {
    return results;
  }

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
        appendImportResultErrors(results, importResult);
        if (!importResult.skipped && !importResult.failed && addedCount < batch.length) {
          results.failed += batch.length - addedCount;
        }
      }
    } catch (err: unknown) {
      results.failed += groupedPaths.length;
      results.errors.push(`${targetFolder}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return results;
}

export function executeSimulatedSmartTidy(
  files: TidyFile[],
  folders: TidyFolder[],
  rule: 'category' | 'date' | 'temp'
): { results: SmartTidySummary; nextFolders: TidyFolder[]; nextFiles: TidyFile[] } {
  const suggestions = proposeTidyActions(files, rule);
  const results: SmartTidySummary = { success: 0, failed: 0, errors: [] };
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

  return { results, nextFolders, nextFiles };
}
