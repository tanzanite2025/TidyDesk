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
  message: string,
  previous?: UpdateSnapshot | null
): UpdateSnapshot {
  const preserveDownloadContext = Boolean(
    previous?.availableVersion &&
      (previous.state === 'available' ||
        previous.state === 'downloading' ||
        (previous.state === 'error' && previous.canDownload))
  );
  const preserveInstallContext = Boolean(
    previous?.availableVersion &&
      (previous.state === 'ready-to-install' ||
        previous.state === 'installing' ||
        (previous.state === 'error' && previous.canInstall))
  );
  const preserveMeta = preserveDownloadContext || preserveInstallContext;

  return {
    state: 'error',
    currentVersion: metadata.version,
    availableVersion: preserveMeta ? previous?.availableVersion : undefined,
    releaseDate: preserveMeta ? previous?.releaseDate : undefined,
    releaseNotes: preserveMeta ? previous?.releaseNotes : undefined,
    message,
    reason: 'unknown',
    canCheck: true,
    canDownload: preserveDownloadContext,
    canInstall: preserveInstallContext
  };
}

export function isActionableUpdateSnapshot(snapshot: UpdateSnapshot | null | undefined): boolean {
  if (!snapshot) return false;
  if (
    snapshot.state === 'available' ||
    snapshot.state === 'downloading' ||
    snapshot.state === 'ready-to-install'
  ) {
    return true;
  }
  return (
    snapshot.state === 'error' &&
    Boolean(snapshot.availableVersion) &&
    (snapshot.canDownload || snapshot.canInstall)
  );
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
