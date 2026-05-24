import { createElectronNativeClient } from './electron-adapter';
import { createTauriNativeClient, isTauriRuntime } from './tauri-adapter';
import type { NativeClient } from './types';

export const nativeClient: NativeClient = isTauriRuntime()
  ? createTauriNativeClient()
  : createElectronNativeClient();

export type { NativeClient } from './types';
