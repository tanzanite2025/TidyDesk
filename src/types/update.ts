export type UpdateRuntime = 'electron' | 'tauri';
export type UpdateChannel = 'stable' | 'beta' | 'nightly';
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'up-to-date'
  | 'downloading'
  | 'ready-to-install'
  | 'installing'
  | 'ready-to-restart'
  | 'unsupported'
  | 'error';
export type UpdateIssueReason =
  | 'development-build'
  | 'not-configured'
  | 'unsupported-runtime'
  | 'unknown';

export interface UpdateMetadata {
  name: string;
  version: string;
  isPackaged: boolean;
  runtime: UpdateRuntime;
  channel: UpdateChannel;
  updaterAvailable: boolean;
}

export interface UpdateSnapshot {
  state: UpdateState;
  currentVersion: string;
  availableVersion?: string;
  releaseDate?: string;
  releaseNotes?: string;
  percent?: number;
  message?: string;
  reason?: UpdateIssueReason;
  canCheck: boolean;
  canDownload: boolean;
  canInstall: boolean;
}

export function createIdleUpdateSnapshot(metadata: Pick<UpdateMetadata, 'version'>): UpdateSnapshot {
  return {
    state: 'idle',
    currentVersion: metadata.version,
    canCheck: true,
    canDownload: false,
    canInstall: false
  };
}

export function createUnsupportedUpdateSnapshot(
  metadata: Pick<UpdateMetadata, 'version'>,
  reason: UpdateIssueReason,
  message: string
): UpdateSnapshot {
  return {
    state: 'unsupported',
    currentVersion: metadata.version,
    message,
    reason,
    canCheck: false,
    canDownload: false,
    canInstall: false
  };
}

export function createErrorUpdateSnapshot(
  metadata: Pick<UpdateMetadata, 'version'>,
  message: string
): UpdateSnapshot {
  return {
    state: 'error',
    currentVersion: metadata.version,
    message,
    reason: 'unknown',
    canCheck: true,
    canDownload: false,
    canInstall: false
  };
}

export function createCheckingUpdateSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    state: 'checking',
    canCheck: false,
    canDownload: false,
    canInstall: false
  };
}

export function createDownloadingUpdateSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    state: 'downloading',
    canCheck: false,
    canDownload: false,
    canInstall: false
  };
}

export function createInstallingUpdateSnapshot(snapshot: UpdateSnapshot): UpdateSnapshot {
  return {
    ...snapshot,
    state: 'installing',
    canCheck: false,
    canDownload: false,
    canInstall: false
  };
}
