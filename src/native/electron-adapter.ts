import { getTidyDeskApi } from './tidydesk-client';
import type { NativeClient } from './types';
import type { TidyDeskAPI } from '../types/tidydesk-api';
import type { UpdateMetadata, UpdateSnapshot } from '../types/update';
import {
  createCheckingUpdateSnapshot,
  createDownloadingUpdateSnapshot,
  createErrorUpdateSnapshot,
  createIdleUpdateSnapshot,
  createInstallingUpdateSnapshot,
  createUnsupportedUpdateSnapshot
} from '../types/update';

function requireApi(api: TidyDeskAPI | null): TidyDeskAPI {
  if (!api) {
    throw new Error('TidyDesk native API is not available');
  }
  return api;
}

function unsupportedPromise(feature: string): Promise<never> {
  return Promise.reject(new Error(`Electron NativeClient feature is not implemented: ${feature}`));
}

function normalizeElectronMetadata(info: Awaited<ReturnType<TidyDeskAPI['getAppVersion']>>): UpdateMetadata {
  return {
    name: info.name,
    version: info.version,
    isPackaged: info.isPackaged,
    runtime: 'electron',
    channel: 'stable',
    updaterAvailable: info.isPackaged
  };
}

function normalizeReleaseNotes(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(item => {
        if (typeof item === 'string') return item;
        if (item && typeof item === 'object' && 'note' in item && typeof item.note === 'string') {
          return item.note;
        }
        return '';
      })
      .filter(Boolean)
      .join('\n\n') || undefined;
  }
  return undefined;
}

function payloadStatus(payload: unknown): string | undefined {
  if (!payload || typeof payload !== 'object' || !('status' in payload)) return undefined;
  const value = (payload as { status?: unknown }).status;
  return typeof value === 'string' ? value : undefined;
}

function normalizeElectronSnapshot(
  payload: Awaited<ReturnType<TidyDeskAPI['checkForUpdates']>> | Record<string, unknown>,
  metadata: UpdateMetadata
): UpdateSnapshot {
  const status = typeof payload.status === 'string' ? payload.status : 'error';

  if (status === 'checking') {
    return createCheckingUpdateSnapshot(createIdleUpdateSnapshot(metadata));
  }

  if (status === 'available') {
    return {
      state: 'available',
      currentVersion: metadata.version,
      availableVersion: typeof payload.version === 'string' ? payload.version : undefined,
      releaseDate: typeof payload.releaseDate === 'string' ? payload.releaseDate : undefined,
      releaseNotes: normalizeReleaseNotes(payload.releaseNotes),
      canCheck: true,
      canDownload: true,
      canInstall: false
    };
  }

  if (status === 'not-available') {
    return {
      ...createIdleUpdateSnapshot(metadata),
      state: 'up-to-date',
      message: '已是最新版本'
    };
  }

  if (status === 'downloading') {
    return {
      ...createDownloadingUpdateSnapshot(createIdleUpdateSnapshot(metadata)),
      percent: typeof payload.percent === 'number' ? payload.percent : undefined,
      message: typeof payload.message === 'string' ? payload.message : undefined
    };
  }

  if (status === 'downloaded') {
    return {
      state: 'ready-to-install',
      currentVersion: metadata.version,
      availableVersion: typeof payload.version === 'string' ? payload.version : undefined,
      releaseNotes: normalizeReleaseNotes(payload.releaseNotes),
      canCheck: false,
      canDownload: false,
      canInstall: true
    };
  }

  if (status === 'dev-mode') {
    return createUnsupportedUpdateSnapshot(
      metadata,
      'development-build',
      typeof payload.message === 'string' ? payload.message : '开发模式下不检查更新'
    );
  }

  if (status === 'success') {
    return createIdleUpdateSnapshot(metadata);
  }

  return createErrorUpdateSnapshot(
    metadata,
    typeof payload.message === 'string' ? payload.message : '更新流程发生未知错误'
  );
}

export function createElectronNativeClient(): NativeClient {
  const getApi = () => getTidyDeskApi();

  return {
    isAvailable: () => Boolean(getApi()),
    files: {
      readDesktopFiles: () => requireApi(getApi()).readDesktopFiles(),
      importExternalFiles: payload => requireApi(getApi()).importExternalFiles(payload),
      open: filePath => requireApi(getApi()).openFile(filePath),
      restoreToDesktop: payload => requireApi(getApi()).restoreToDesktop(payload)
    },
    drawers: {
      create: name => requireApi(getApi()).createDrawer(name),
      renameItem: payload => requireApi(getApi()).renameItem(payload),
      deleteItem: payload => requireApi(getApi()).deleteItem(payload)
    },
    shortcuts: {
      validateAll: () => requireApi(getApi()).validateAllShortcuts(),
      repair: payload => requireApi(getApi()).repairShortcut(payload),
      onTargetFileDeleted: callback => getApi()?.onTargetFileDeleted(callback),
      onTargetFileRestored: callback => getApi()?.onTargetFileRestored(callback),
      onValidated: callback => getApi()?.onShortcutsValidated(callback)
    },
    todos: {
      readState: () => requireApi(getApi()).readTodoState(),
      getCounts: () => requireApi(getApi()).getTodoCounts(),
      createCard: payload => requireApi(getApi()).createTodoCard(payload),
      updateCard: payload => requireApi(getApi()).updateTodoCard(payload),
      deleteCard: cardId => requireApi(getApi()).deleteTodoCard(cardId),
      moveCard: payload => requireApi(getApi()).moveTodoCard(payload),
      onCountsUpdated: callback => getApi()?.onTodoCountsUpdated(callback)
    },
    quickNotes: {
      readState: () => unsupportedPromise('quickNotes.readState'),
      createNote: () => unsupportedPromise('quickNotes.createNote'),
      updateNote: () => unsupportedPromise('quickNotes.updateNote'),
      deleteNote: () => unsupportedPromise('quickNotes.deleteNote')
    },
    apps: {
      scanInstalled: () => requireApi(getApi()).scanInstalledApps(),
      refresh: () => requireApi(getApi()).refreshApps(),
      getCacheInfo: () => requireApi(getApi()).getCacheInfo(),
      openPicker: payload => requireApi(getApi()).openAppPicker(payload),
      closePicker: () => requireApi(getApi()).closeAppPicker(),
      getPickerTarget: () => requireApi(getApi()).getAppPickerTarget(),
      onSetTargetFolder: callback => getApi()?.onSetTargetFolder(callback),
      addToDrawer: payload => requireApi(getApi()).addAppToDrawer(payload)
    },
    windows: {
      control: action => requireApi(getApi()).windowControl(action),
      getPathForFile: file => requireApi(getApi()).getPathForFile(file),
      onDrawerState: callback => getApi()?.onDrawerState(callback),
      onModuleState: callback => getApi()?.onModuleState(callback)
    },
    toolWindows: {
      openTodo: async () => {
        requireApi(getApi()).windowControl('open-todos');
      },
      closeTodo: async () => {
        requireApi(getApi()).windowControl('close-panel');
      }
    },
    clipboard: {
      readText: () => requireApi(getApi()).getClipboardText()
    },
    capture: {
      onOpened: callback => getApi()?.onCaptureOpened(callback),
      completeSnipSelection: rect => requireApi(getApi()).completeSnipSelection(rect),
      cancelSnip: () => requireApi(getApi()).cancelSnip()
    },
    stickers: {
      get: stickerId => requireApi(getApi()).getSticker(stickerId),
      togglePin: stickerId => requireApi(getApi()).toggleStickerPin(stickerId),
      copy: stickerId => requireApi(getApi()).copySticker(stickerId),
      saveAs: stickerId => requireApi(getApi()).saveStickerAs(stickerId),
      close: stickerId => requireApi(getApi()).closeSticker(stickerId),
      onUpdated: callback => getApi()?.onStickerUpdated(callback)
    },
    updates: {
      getMetadata: async () => normalizeElectronMetadata(await requireApi(getApi()).getAppVersion()),
      getState: async () => {
        const metadata = normalizeElectronMetadata(await requireApi(getApi()).getAppVersion());
        return metadata.updaterAvailable
          ? createIdleUpdateSnapshot(metadata)
          : createUnsupportedUpdateSnapshot(metadata, 'development-build', '开发模式下不检查更新');
      },
      check: async () => {
        const api = requireApi(getApi());
        const metadata = normalizeElectronMetadata(await api.getAppVersion());
        const payload = await api.checkForUpdates();
        if (payload.status === 'success') {
          return createCheckingUpdateSnapshot(createIdleUpdateSnapshot(metadata));
        }
        return normalizeElectronSnapshot(payload, metadata);
      },
      download: async () => {
        const api = requireApi(getApi());
        const metadata = normalizeElectronMetadata(await api.getAppVersion());
        const payload = await api.downloadUpdate();
        if (payloadStatus(payload) === 'success') {
          return createDownloadingUpdateSnapshot(createIdleUpdateSnapshot(metadata));
        }
        return normalizeElectronSnapshot((payload ?? {}) as Record<string, unknown>, metadata);
      },
      install: async () => {
        const api = requireApi(getApi());
        const metadata = normalizeElectronMetadata(await api.getAppVersion());
        const payload = await api.installUpdate();
        if (payloadStatus(payload) === 'success') {
          return createInstallingUpdateSnapshot(createIdleUpdateSnapshot(metadata));
        }
        return normalizeElectronSnapshot((payload ?? {}) as Record<string, unknown>, metadata);
      },
      onChange: callback => getApi()?.onUpdateStatus(async payload => {
        try {
          const metadata = normalizeElectronMetadata(await requireApi(getApi()).getAppVersion());
          callback(normalizeElectronSnapshot(payload, metadata));
        } catch (err) {
          callback(
            createErrorUpdateSnapshot(
              { version: 'unknown' },
              err instanceof Error ? err.message : String(err)
            )
          );
        }
      })
    },
    events: {
      send: channel => requireApi(getApi()).send(channel)
    }
  };
}
