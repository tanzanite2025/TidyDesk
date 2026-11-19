import { nativeClient } from '../../native/native-client';
import type { TidyFile } from '../../types/file';
import type { FileIconRequest, FileIconResult } from '../../types/tidydesk-api';

const FILE_ICON_BATCH_SIZE = 24;

export function mergeFileIcons(files: TidyFile[], icons: FileIconResult[]): TidyFile[] {
  if (icons.length === 0) {
    return files;
  }

  const iconsById = new Map(icons.map(item => [item.id, item.icon || undefined]));
  return files.map(file => {
    if (!iconsById.has(file.id)) {
      return file;
    }
    return {
      ...file,
      icon: iconsById.get(file.id)
    };
  });
}

export async function loadFileIcons(
  files: TidyFile[],
  onBatch: (icons: FileIconResult[]) => void,
  isCancelled: () => boolean
): Promise<void> {
  // 优先加载已收纳到抽屉内展示的文件图标，再补充桌面根目录文件图标
  const orderedFiles = [
    ...files.filter(file => file.parentId !== null),
    ...files.filter(file => file.parentId === null)
  ];
  const requests: FileIconRequest[] = orderedFiles.map(file => ({
    id: file.id,
    path: file.path,
    targetPath: file.targetPath
  }));
  for (let start = 0; start < requests.length; start += FILE_ICON_BATCH_SIZE) {
    if (isCancelled()) return;
    const batch = requests.slice(start, start + FILE_ICON_BATCH_SIZE);
    const icons = await nativeClient.files.readIcons(batch);
    if (isCancelled()) return;
    if (icons.length > 0) {
      onBatch(icons);
    }
  }
}
