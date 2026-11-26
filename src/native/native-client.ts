import { createTauriNativeClient } from './tauri-adapter';
import { createWebHttpNativeClient } from './web-http-adapter';
import type { NativeCapabilities, NativeClient } from './types';
import type { OpenAppPickerPayload } from '../types/tidydesk-api';

function isMobileWebMode(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as {
    __TAURI_INTERNALS__?: unknown;
    __TIDYDESK_MOBILE__?: boolean;
  };
  if (win.__TAURI_INTERNALS__) return false;
  if (win.__TIDYDESK_MOBILE__) return true;
  return new URLSearchParams(window.location.search).get('mode') === 'mobile';
}

export const nativeClient: NativeClient = isMobileWebMode()
  ? createWebHttpNativeClient()
  : createTauriNativeClient();

export function getNativeCapabilities(): NativeCapabilities {
  return (
    nativeClient.capabilities ?? {
      canScreenSnip: true,
      canUseNativeFileDialog: true,
      canUseGlobalHotkeys: true,
      platformLayout: 'desktop'
    }
  );
}

interface TidyDeskTestBridge {
  isTauriAvailable: () => boolean;
  openFilesDrawer: () => Promise<void>;
  collapseDrawer: () => Promise<void>;
  startScreenshot: () => Promise<void>;
  getWindowSnapshot: () => Promise<unknown>;
  resetWindowState: () => Promise<unknown>;
  openTodoWindow: () => Promise<void>;
  closeTodoWindow: () => Promise<void>;
  openAppPicker: (payload?: OpenAppPickerPayload) => Promise<void>;
  closeAppPicker: () => Promise<void>;
  cancelSnip: () => Promise<void>;
}

declare global {
  interface Window {
    __TIDYDESK_TEST__?: TidyDeskTestBridge;
  }
}

const shouldExposeTestBridge = import.meta.env.DEV || import.meta.env.VITE_TIDYDESK_E2E === '1';

async function invokeCommand(command: string, args?: Record<string, unknown>) {
  const api = await import('@tauri-apps/api/core');
  await api.invoke(command, args);
}

function dispatchCommand(command: string, args?: Record<string, unknown>) {
  void invokeCommand(command, args).catch(error => {
    console.error(`[TIDYDESK][TEST] command failed: ${command}`, error);
  });
  return Promise.resolve();
}

if (typeof window !== 'undefined' && shouldExposeTestBridge) {
  window.__TIDYDESK_TEST__ = {
    isTauriAvailable: () => nativeClient.isAvailable(),
    openFilesDrawer: () => invokeCommand('tests_open_files_drawer'),
    collapseDrawer: () => invokeCommand('tests_collapse_drawer'),
    startScreenshot: () => dispatchCommand('tests_start_snip'),
    getWindowSnapshot: () => invokeCommand('tests_get_window_snapshot'),
    resetWindowState: () => invokeCommand('tests_reset_window_state'),
    openTodoWindow: () => invokeCommand('open_todo_window'),
    closeTodoWindow: () => invokeCommand('close_todo_window'),
    openAppPicker: payload => dispatchCommand('open_app_picker', { payload }),
    closeAppPicker: () => dispatchCommand('close_app_picker'),
    cancelSnip: () => dispatchCommand('snip_cancel')
  };
}

export type { NativeClient } from './types';
