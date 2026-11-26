import type { NativeClient } from './types';

export function isTauriRuntime(): boolean {
  return false;
}

export function createTauriNativeClient(): NativeClient {
  throw new Error('[CRITICAL] Tauri runtime adapter is unavailable in pure mobile build');
}
