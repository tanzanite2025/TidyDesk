export type FileCategory =
  | 'document'
  | 'image'
  | 'archive'
  | 'app'
  | 'developer'
  | 'temporary'
  | 'other'
  | 'folder';

export interface TidyFile {
  id: string;
  name: string;
  path: string;
  size: number;
  category: FileCategory;
  extension: string;
  modifiedAt: string;
  isSimulated: boolean;
  parentId: string | null;
  realHandle?: FileSystemFileHandle;
  isValid?: boolean;
  targetPath?: string;
  icon?: string;
}

export interface TidyFolder {
  id: string;
  name: string;
  path: string;
  category: 'folder';
  modifiedAt: string;
  isSimulated: boolean;
  parentId: string | null;
  realHandle?: FileSystemDirectoryHandle;
}

export interface DesktopHealthInfo {
  score: number;
  totalFiles: number;
  totalFolders: number;
  totalSize: number;
  tempFileCount: number;
  largeFileCount: number;
  suggestion: string;
  status: 'HEALTHY' | 'ALERT' | 'CRITICAL';
}
