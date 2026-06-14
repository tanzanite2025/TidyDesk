import { createTauriNativeClient } from './tauri-adapter';
import type { NativeClient } from './types';
import type { OpenAppPickerPayload } from '../types/tidydesk-api';

export const nativeClient: NativeClient = createTauriNativeClient();

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
    openAppPicker: payload => dispatchCommand('open_app_picker_poc', { payload }),
    closeAppPicker: () => dispatchCommand('close_app_picker_poc'),
    cancelSnip: () => dispatchCommand('snip_cancel')
  };
}

export type { NativeClient } from './types';
