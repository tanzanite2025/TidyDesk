export type FileCategory = 'document' | 'image' | 'archive' | 'app' | 'developer' | 'temporary' | 'other' | 'folder';

export interface TidyFile {
  id: string;
  name: string;
  path: string;
  size: number;
  category: FileCategory;
  extension: string;
  modifiedAt: string;
  isSimulated: boolean;
  parentId: string | null; // null represents the Desktop root
  // Web File System Access API Handle, if in real mode
  realHandle?: FileSystemFileHandle;
}

export interface TidyFolder {
  id: string;
  name: string;
  path: string;
  category: 'folder';
  modifiedAt: string;
  isSimulated: boolean;
  parentId: string | null;
  // Web File System Access API Handle, if in real mode
  realHandle?: FileSystemDirectoryHandle;
}

export interface DesktopHealthInfo {
  score: number; // 0 - 100
  totalFiles: number;
  totalFolders: number;
  totalSize: number; // in bytes
  tempFileCount: number;
  largeFileCount: number; // > 100MB
  suggestion: string;
  status: 'HEALTHY' | 'ALERT' | 'CRITICAL';
}
