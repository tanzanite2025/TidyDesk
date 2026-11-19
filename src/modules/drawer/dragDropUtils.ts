import { nativeClient } from '../../native/native-client';
import { isTauriRuntime } from '../../native/tauri-adapter';
import type { ImportExternalFilesResult, ImportSkippedReason } from '../../types/tidydesk-api';

/**
 * Resolve a filesystem path from a DOM File dropped onto a drawer card.
 */
export function getPathFromDroppedFile(file: globalThis.File): string | null {
  const fileWithPath = file as globalThis.File & { path?: string };
  if (fileWithPath.path) return fileWithPath.path;
  if (nativeClient.isAvailable() && !isTauriRuntime()) return nativeClient.windows.getPathForFile(file);
  return null;
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

/**
 * Format user-facing status notice after importing files into a drawer.
 */
export function importResultNotice(result: ImportExternalFilesResult | null, requestedCount: number): string {
  if (!result) {
    return '导入未完成，请查看错误提示。';
  }

  const addedCount = result.added?.length || 0;
  const skippedCount = result.skipped?.length || 0;
  const failedCount = result.failed?.length || 0;
  if (skippedCount === 0 && failedCount === 0) {
    return `已加入抽屉 ${addedCount || requestedCount} 个项目。桌面普通文件会收纳到 TidyDesk storage，外部文件会复制后创建快捷入口。`;
  }

  const details = [
    ...result.skipped.map(item => `${fileNameFromPath(item.source)}：${importSkippedReasonLabel(item.reason)}`),
    ...result.failed.map(item => `${fileNameFromPath(item.source)}：${item.error}`)
  ].slice(0, 3);
  const moreCount = skippedCount + failedCount - details.length;
  const detailText = details.length > 0
    ? ` 原因：${details.join('；')}${moreCount > 0 ? `；另有 ${moreCount} 项` : ''}`
    : '';

  return `导入完成：成功 ${addedCount}，跳过 ${skippedCount}，失败 ${failedCount}。${detailText}`;
}
