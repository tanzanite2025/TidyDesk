import type { NativeClient } from './types';
import type { InstalledApp, InstalledAppsResult } from '../types/tidydesk-api';

type TauriInvoke = <T>(command: string, args?: Record<string, unknown>) => Promise<T>;

interface TauriRuntimeWindow extends Window {
  __TAURI_INTERNALS__?: unknown;
}

interface ShortcutMetadata {
  name?: string;
  shortcutPath?: string;
  source?: string;
  category?: string;
  size?: number;
  modifiedAt?: string;
  depth?: number;
}

interface ScanMetadataResult {
  shortcuts?: ShortcutMetadata[];
  scannedPaths?: string[];
  durationMs?: number;
}

export function isTauriRuntime(): boolean {
  if (typeof window === 'undefined') return false;
  const tauriWindow = window as TauriRuntimeWindow;
  return Boolean(tauriWindow.__TAURI_INTERNALS__) || navigator.userAgent.toLowerCase().includes('tauri');
}

async function invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> {
  const api = await import('@tauri-apps/api/core');
  return (api.invoke as TauriInvoke)<T>(command, args);
}

function unavailable(feature: string): never {
  throw new Error(`Tauri NativeClient feature is not implemented yet: ${feature}`);
}

function unsupportedPromise(feature: string): Promise<never> {
  return Promise.reject(new Error(`Tauri NativeClient feature is not implemented yet: ${feature}`));
}

function mapMetadataToInstalledApps(metadata: ScanMetadataResult): InstalledApp[] {
  const shortcuts = Array.isArray(metadata.shortcuts) ? metadata.shortcuts : [];
  return shortcuts
    .filter(item => item.shortcutPath && item.name)
    .map(item => ({
      name: String(item.name),
      shortcutPath: String(item.shortcutPath),
      targetPath: '',
      icon: null,
      category: String(item.category || 'other')
    }));
}

async function scanInstalledAppsMetadataOnly(): Promise<InstalledAppsResult> {
  try {
    const metadata = await invoke<ScanMetadataResult>('apps_scan_metadata');
    return {
      success: true,
      apps: mapMetadataToInstalledApps(metadata)
    };
  } catch (err) {
    return {
      success: false,
      apps: [],
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

export function createTauriNativeClient(): NativeClient {
  return {
    isAvailable: isTauriRuntime,
    files: {
      readDesktopFiles: () => unsupportedPromise('files.readDesktopFiles'),
      importExternalFiles: () => unsupportedPromise('files.importExternalFiles'),
      open: () => unsupportedPromise('files.open'),
      restoreToDesktop: () => unsupportedPromise('files.restoreToDesktop')
    },
    drawers: {
      create: () => unsupportedPromise('drawers.create'),
      renameItem: () => unsupportedPromise('drawers.renameItem'),
      deleteItem: () => unsupportedPromise('drawers.deleteItem')
    },
    shortcuts: {
      validateAll: () => unsupportedPromise('shortcuts.validateAll'),
      repair: () => unsupportedPromise('shortcuts.repair'),
      onTargetFileDeleted: () => undefined,
      onTargetFileRestored: () => undefined,
      onValidated: () => undefined
    },
    todos: {
      readState: () => unsupportedPromise('todos.readState'),
      getCounts: () => unsupportedPromise('todos.getCounts'),
      createCard: () => unsupportedPromise('todos.createCard'),
      updateCard: () => unsupportedPromise('todos.updateCard'),
      deleteCard: () => unsupportedPromise('todos.deleteCard'),
      moveCard: () => unsupportedPromise('todos.moveCard'),
      onCountsUpdated: () => undefined
    },
    apps: {
      scanInstalled: scanInstalledAppsMetadataOnly,
      refresh: scanInstalledAppsMetadataOnly,
      getCacheInfo: async () => {
        try {
          const metadata = await invoke<ScanMetadataResult>('apps_scan_metadata');
          return {
            success: true,
            info: {
              exists: false,
              valid: false,
              appCount: Array.isArray(metadata.shortcuts) ? metadata.shortcuts.length : 0,
              lastScanTime: Date.now(),
              source: 'tauri-sidecar-metadata',
              durationMs: metadata.durationMs,
              scannedPaths: metadata.scannedPaths
            }
          };
        } catch (err) {
          return {
            success: false,
            error: err instanceof Error ? err.message : String(err)
          };
        }
      },
      openPicker: () => invoke('open_app_picker_poc'),
      closePicker: () => invoke('close_app_picker_poc'),
      getPickerTarget: async () => ({ targetFolder: null }),
      onSetTargetFolder: () => undefined,
      addToDrawer: () => unsupportedPromise('apps.addToDrawer')
    },
    windows: {
      control: () => undefined,
      getPathForFile: () => unavailable('windows.getPathForFile'),
      onDrawerState: () => undefined,
      onModuleState: () => undefined
    },
    clipboard: {
      readText: () => unsupportedPromise('clipboard.readText')
    },
    capture: {
      onOpened: () => undefined,
      completeSnipSelection: () => unsupportedPromise('capture.completeSnipSelection'),
      cancelSnip: () => unsupportedPromise('capture.cancelSnip')
    },
    stickers: {
      get: () => unsupportedPromise('stickers.get'),
      togglePin: () => unsupportedPromise('stickers.togglePin'),
      copy: () => unsupportedPromise('stickers.copy'),
      saveAs: () => unsupportedPromise('stickers.saveAs'),
      close: () => unsupportedPromise('stickers.close'),
      onUpdated: () => undefined
    },
    updates: {
      getAppVersion: async () => ({ version: 'tauri-poc', name: 'TidyDesk Tauri PoC', isPackaged: false }),
      checkForUpdates: () => unsupportedPromise('updates.checkForUpdates'),
      downloadUpdate: () => unsupportedPromise('updates.downloadUpdate'),
      installUpdate: () => unsupportedPromise('updates.installUpdate'),
      onStatus: () => undefined
    },
    events: {
      send: () => undefined
    }
  };
}
