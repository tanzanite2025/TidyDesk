export async function invoke(): Promise<never> {
  throw new Error('[CRITICAL] @tauri-apps/api/core invoke is unavailable in pure mobile build');
}

export function convertFileSrc(): never {
  throw new Error('[CRITICAL] @tauri-apps/api/core convertFileSrc is unavailable in pure mobile build');
}

export async function listen(): Promise<() => void> {
  throw new Error('[CRITICAL] @tauri-apps/api/event listen is unavailable in pure mobile build');
}
