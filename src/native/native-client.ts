import { createTauriNativeClient } from './tauri-adapter';
import type { NativeClient } from './types';

export const nativeClient: NativeClient = createTauriNativeClient();

export type { NativeClient } from './types';
