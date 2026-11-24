import { describe, expect, it } from 'vitest';
import {
  createCheckingUpdateSnapshot,
  createDownloadingUpdateSnapshot,
  createErrorUpdateSnapshot,
  createIdleUpdateSnapshot,
  createInstallingUpdateSnapshot,
  isActionableUpdateSnapshot,
  type UpdateMetadata,
  type UpdateSnapshot
} from '../../../types/update';

const META: UpdateMetadata = {
  name: 'TidyDesk',
  version: '0.0.2',
  isPackaged: true,
  runtime: 'tauri',
  channel: 'stable',
  updaterAvailable: true
};

describe('update snapshot helpers', () => {
  it('preserves retryable download context on download errors', () => {
    const downloading: UpdateSnapshot = {
      state: 'downloading',
      currentVersion: '0.0.2',
      availableVersion: '0.0.3',
      releaseDate: '2026-11-24T12:00:00Z',
      releaseNotes: '- 修复更新器状态机',
      percent: 42,
      canCheck: false,
      canDownload: false,
      canInstall: false
    };

    const errored = createErrorUpdateSnapshot(META, '连接超时', downloading);
    expect(errored.state).toBe('error');
    expect(errored.availableVersion).toBe('0.0.3');
    expect(errored.releaseNotes).toBe('- 修复更新器状态机');
    expect(errored.canCheck).toBe(true);
    expect(errored.canDownload).toBe(true);
    expect(errored.canInstall).toBe(false);
    expect(isActionableUpdateSnapshot(errored)).toBe(true);
  });

  it('locks action flags while checking, downloading, or installing', () => {
    const idle = createIdleUpdateSnapshot(META);
    expect(isActionableUpdateSnapshot(idle)).toBe(false);

    const checking = createCheckingUpdateSnapshot(idle);
    expect(checking.canCheck).toBe(false);
    expect(checking.canDownload).toBe(false);
    expect(checking.canInstall).toBe(false);

    const downloading = createDownloadingUpdateSnapshot({
      ...idle,
      state: 'available',
      availableVersion: '0.0.3',
      canDownload: true
    });
    expect(downloading.state).toBe('downloading');
    expect(isActionableUpdateSnapshot(downloading)).toBe(true);
    expect(downloading.canDownload).toBe(false);

    const installing = createInstallingUpdateSnapshot({
      ...downloading,
      state: 'ready-to-install',
      canInstall: true
    });
    expect(installing.state).toBe('installing');
    expect(installing.canInstall).toBe(false);
  });
});
