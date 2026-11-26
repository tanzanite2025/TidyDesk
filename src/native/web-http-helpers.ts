import type {
  TodoBoard,
  TodoCard,
  TodoCounts
} from '../types/todo';
import type { NativeClient } from './types';

export const WEB_SESSION_STORAGE_KEY = 'tidydesk_mobile_session_v1';
export const WEB_ENDPOINT_STORAGE_KEY = 'tidydesk_mobile_endpoint_v1';
const THUMB_MAX_EDGE = 480;
const RANK_ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';

export interface StoredWebSession {
  userId: string;
  displayName?: string;
  serverEndpoint: string;
  workspaceId?: string;
  token: string;
  lastSyncCursor?: string | null;
  lastSyncAt?: string | null;
}

export const DEFAULT_MOBILE_BOARD: TodoBoard = {
  id: 'default-board',
  title: '待办',
  columns: [
    { id: 'todo', title: '待处理' },
    { id: 'doing', title: '进行中' },
    { id: 'done', title: '已完成' }
  ],
  cardOrder: { todo: [], doing: [], done: [] },
  createdAt: new Date(0).toISOString(),
  updatedAt: new Date(0).toISOString()
};

export function createUuid(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `mob-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

const SHA256_K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
]);

export function computePureSha256Hex(bytes: Uint8Array): string {
  const rotr = (x: number, n: number) => (x >>> n) | (x << (32 - n));
  const bitLen = bytes.length * 8;
  const paddedLen = Math.ceil((bytes.length + 9) / 64) * 64;
  const padded = new Uint8Array(paddedLen);
  padded.set(bytes);
  padded[bytes.length] = 0x80;
  const view = new DataView(padded.buffer);
  view.setUint32(paddedLen - 8, Math.floor(bitLen / 0x100000000), false);
  view.setUint32(paddedLen - 4, bitLen >>> 0, false);

  let h0 = 0x6a09e667;
  let h1 = 0xbb67ae85;
  let h2 = 0x3c6ef372;
  let h3 = 0xa54ff53a;
  let h4 = 0x510e527f;
  let h5 = 0x9b05688c;
  let h6 = 0x1f83d9ab;
  let h7 = 0x5be0cd19;
  const w = new Uint32Array(64);

  for (let offset = 0; offset < paddedLen; offset += 64) {
    for (let i = 0; i < 16; i += 1) {
      w[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3);
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10);
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0;
    }
    let a = h0;
    let b = h1;
    let c = h2;
    let d = h3;
    let e = h4;
    let f = h5;
    let g = h6;
    let h = h7;
    for (let i = 0; i < 64; i += 1) {
      const s1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + s1 + ch + SHA256_K[i] + w[i]) >>> 0;
      const s0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (s0 + maj) >>> 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }
    h0 = (h0 + a) >>> 0;
    h1 = (h1 + b) >>> 0;
    h2 = (h2 + c) >>> 0;
    h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0;
    h5 = (h5 + f) >>> 0;
    h6 = (h6 + g) >>> 0;
    h7 = (h7 + h) >>> 0;
  }

  return [h0, h1, h2, h3, h4, h5, h6, h7]
    .map(n => n.toString(16).padStart(8, '0'))
    .join('');
}

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto !== 'undefined' && crypto.subtle) {
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    ) as ArrayBuffer;
    const digest = await crypto.subtle.digest('SHA-256', copy);
    return Array.from(new Uint8Array(digest))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  }
  return computePureSha256Hex(bytes);
}

export async function createThumbAndDimensions(
  bytes: Uint8Array,
  mimeType: string
): Promise<{ width: number; height: number; thumbBytes: Uint8Array }> {
  const blob = new Blob(
    [bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer],
    { type: mimeType }
  );
  const objectUrl = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('无法解析所选图片格式'));
      el.src = objectUrl;
    });
    const width = img.naturalWidth || 1;
    const height = img.naturalHeight || 1;
    const scale = Math.min(1, THUMB_MAX_EDGE / Math.max(width, height));
    const tw = Math.max(1, Math.round(width * scale));
    const th = Math.max(1, Math.round(height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = tw;
    canvas.height = th;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      return { width, height, thumbBytes: bytes };
    }
    ctx.drawImage(img, 0, 0, tw, th);
    const thumbBlob = await new Promise<Blob | null>(resolve =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!thumbBlob) {
      return { width, height, thumbBytes: bytes };
    }
    return {
      width,
      height,
      thumbBytes: new Uint8Array(await thumbBlob.arrayBuffer())
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

export function summarizeMarkdown(content: string): string {
  for (const line of content.split(/\r?\n/)) {
    const stripped = line
      .trim()
      .replace(/^#+\s*/, '')
      .replace(/^- \[[ xX]\]\s*/, '')
      .trim();
    if (stripped) return stripped.slice(0, 140);
  }
  return '';
}

/** Strict UTF-16 codepoint comparator aligned with Rust `ranking.rs` lexicographic order. */
export function compareCardsByPosition(a: TodoCard, b: TodoCard): number {
  const posA = a.position ?? '';
  const posB = b.position ?? '';
  if (posA !== posB) {
    return posA < posB ? -1 : 1;
  }
  const createdA = a.createdAt ?? '';
  const createdB = b.createdAt ?? '';
  if (createdA !== createdB) {
    return createdA < createdB ? -1 : 1;
  }
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function rankBeforeValue(upper: string): string {
  for (let i = 0; i < upper.length; i += 1) {
    const idx = RANK_ALPHABET.indexOf(upper[i]);
    if (idx > 1) {
      return `${upper.slice(0, i)}${RANK_ALPHABET[Math.floor(idx / 2)]}`;
    }
    if (idx === 1) {
      return `${upper.slice(0, i)}0V`;
    }
  }
  return `${upper}V`;
}

function rankAfterValue(lower: string): string {
  for (let i = lower.length - 1; i >= 0; i -= 1) {
    const idx = RANK_ALPHABET.indexOf(lower[i]);
    if (idx >= 0 && idx + 1 < RANK_ALPHABET.length) {
      const nextIdx = Math.floor((idx + RANK_ALPHABET.length) / 2);
      const bump = nextIdx === idx ? idx + 1 : nextIdx;
      return `${lower.slice(0, i)}${RANK_ALPHABET[bump]}`;
    }
  }
  return `${lower}V`;
}

export function computePositionForColumn(
  existingCards: TodoCard[],
  columnId: string,
  beforeId?: string
): string {
  const sorted = existingCards
    .filter(c => !c.deletedAt && c.columnId === columnId)
    .sort(compareCardsByPosition);
  if (sorted.length === 0) return '000G';

  if (beforeId) {
    const idx = sorted.findIndex(c => c.id === beforeId);
    if (idx >= 0) {
      if (idx === 0) {
        return sorted[0].position ? rankBeforeValue(sorted[0].position) : '0008';
      }
      const prev = sorted[idx - 1].position;
      const next = sorted[idx].position;
      if (prev && next && prev < next) {
        return `${prev}V`;
      }
    }
  }

  const head = sorted[0]?.position;
  return head ? rankBeforeValue(head) : rankAfterValue('000G');
}

export function computeTodoCounts(cards: TodoCard[]): TodoCounts {
  let total = 0;
  let open = 0;
  let done = 0;
  for (const card of cards) {
    if (card.deletedAt || card.archived) continue;
    total += 1;
    if (card.columnId === 'done') done += 1;
    else open += 1;
  }
  return { total, open, done };
}

export function isEmbeddedMobileOrigin(): boolean {
  if (typeof window === 'undefined') return false;
  const win = window as unknown as { __TIDYDESK_MOBILE__?: boolean };
  const protocol = window.location?.protocol || '';
  const hostname = window.location?.hostname || '';
  if (protocol === 'capacitor:' || protocol === 'file:') return true;
  if (win.__TIDYDESK_MOBILE__ && (hostname === 'localhost' || hostname === '127.0.0.1' || !hostname)) {
    return true;
  }
  return false;
}

export function readStoredServerEndpoint(): string {
  try {
    return (localStorage.getItem(WEB_ENDPOINT_STORAGE_KEY) || '').trim().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export function writeStoredServerEndpoint(endpoint: string | null) {
  try {
    const clean = (endpoint || '').trim().replace(/\/+$/, '');
    if (!clean) {
      localStorage.removeItem(WEB_ENDPOINT_STORAGE_KEY);
    } else {
      localStorage.setItem(WEB_ENDPOINT_STORAGE_KEY, clean);
    }
  } catch {
    // Ignore storage errors in restricted webviews
  }
}

export function resolveDefaultMobileServerEndpoint(): string {
  const remembered = readStoredServerEndpoint();
  if (remembered) return remembered;
  if (typeof window === 'undefined') return 'http://127.0.0.1:8787';
  if (isEmbeddedMobileOrigin()) return '';
  return (window.location.origin || '').trim().replace(/\/+$/, '');
}

export function normalizeMobileServerEndpoint(raw?: string | null): string {
  const candidate = (raw || resolveDefaultMobileServerEndpoint()).trim().replace(/\/+$/, '');
  if (!candidate) {
    throw new Error('请输入协同服务端地址（例如 http://192.168.1.10:8787）');
  }
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error('服务端地址格式无效，请以 http:// 或 https:// 开头');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('服务端地址仅支持 http:// 或 https:// 协议');
  }
  return candidate;
}

export function readStoredWebSession(): StoredWebSession | null {
  try {
    const raw =
      localStorage.getItem(WEB_SESSION_STORAGE_KEY) ??
      sessionStorage.getItem(WEB_SESSION_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredWebSession;
    if (!parsed.userId || !parsed.serverEndpoint || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function writeStoredWebSession(session: StoredWebSession | null) {
  try {
    if (!session) {
      localStorage.removeItem(WEB_SESSION_STORAGE_KEY);
      sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
    } else {
      const encoded = JSON.stringify(session);
      localStorage.setItem(WEB_SESSION_STORAGE_KEY, encoded);
      sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
      writeStoredServerEndpoint(session.serverEndpoint);
    }
  } catch {
    // Ignore storage quota issues in private browsing contexts
  }
}

export function parseSseSyncCursor(rawFrame: string): string | null {
  if (!rawFrame.includes('event: sync-changed')) return null;
  for (const line of rawFrame.split(/\r?\n/)) {
    if (line.startsWith('data:')) {
      try {
        const parsed = JSON.parse(line.slice(5).trim()) as { cursor?: unknown };
        return typeof parsed.cursor === 'string' ? parsed.cursor : null;
      } catch {
        return null;
      }
    }
  }
  return null;
}

export function findFallbackCoverId(card: TodoCard): string | null {
  if (card.attachments && card.attachments.length > 0) {
    return card.attachments[0].id;
  }
  for (const sub of card.subtasks || []) {
    if (sub.deletedAt) continue;
    if (sub.attachments && sub.attachments.length > 0) {
      return sub.attachments[0].id;
    }
  }
  return null;
}

type DesktopOnlyNamespaces = Pick<
  NativeClient,
  | 'stickyNotes'
  | 'files'
  | 'drawers'
  | 'shortcuts'
  | 'apps'
  | 'windows'
  | 'toolWindows'
  | 'resident'
  | 'hotkeys'
  | 'clipboard'
  | 'capture'
  | 'stickers'
  | 'updates'
  | 'events'
  | 'backup'
>;

export function createDesktopUnsupportedStubs(): DesktopOnlyNamespaces {
  const unsupportedDesktop = (name: string): never => {
    throw new Error(`${name} 仅在 Windows 桌面端可用`);
  };

  return {
    stickyNotes: {
      list: async () => ({ stickies: [] }),
      open: () => unsupportedDesktop('stickyNotes'),
      unpin: () => unsupportedDesktop('stickyNotes'),
      updateOptions: () => unsupportedDesktop('stickyNotes'),
      onUpdated: () => undefined
    },
    files: {
      readDesktopFiles: () => unsupportedDesktop('files'),
      readIcons: () => unsupportedDesktop('files'),
      importExternalFiles: () => unsupportedDesktop('files'),
      open: () => unsupportedDesktop('files'),
      restoreToDesktop: () => unsupportedDesktop('files')
    },
    drawers: {
      create: () => unsupportedDesktop('drawers'),
      renameItem: () => unsupportedDesktop('drawers'),
      deleteItem: () => unsupportedDesktop('drawers')
    },
    shortcuts: {
      validateAll: () => unsupportedDesktop('shortcuts'),
      repair: () => unsupportedDesktop('shortcuts'),
      onTargetFileDeleted: () => undefined,
      onTargetFileRestored: () => undefined,
      onValidated: () => undefined
    },
    apps: {
      scanInstalled: () => unsupportedDesktop('apps'),
      refresh: () => unsupportedDesktop('apps'),
      getCacheInfo: () => unsupportedDesktop('apps'),
      openPicker: () => unsupportedDesktop('apps'),
      closePicker: () => unsupportedDesktop('apps'),
      getPickerTarget: () => unsupportedDesktop('apps'),
      onSetTargetFolder: () => undefined,
      onIconsUpdated: () => undefined,
      addToDrawer: () => unsupportedDesktop('apps')
    },
    windows: {
      control: () => undefined,
      getShellState: async () => ({ expanded: false, activeModule: null }),
      notifyDrawerReady: () => undefined,
      getPathForFile: () => '',
      onDrawerState: () => undefined,
      onModuleState: () => undefined
    },
    toolWindows: {
      openTodo: (_cardId?: string) => unsupportedDesktop('toolWindows'),
      closeTodo: () => unsupportedDesktop('toolWindows')
    },
    resident: {
      getSettings: () => unsupportedDesktop('resident'),
      updateSettings: () => unsupportedDesktop('resident'),
      showHandle: () => unsupportedDesktop('resident'),
      hideHandle: () => unsupportedDesktop('resident'),
      openSettings: () => unsupportedDesktop('resident'),
      onOpenSettings: () => undefined
    },
    hotkeys: {
      getSettings: () => unsupportedDesktop('hotkeys'),
      validateBinding: () => unsupportedDesktop('hotkeys'),
      updateBinding: () => unsupportedDesktop('hotkeys'),
      resetDefaults: () => unsupportedDesktop('hotkeys')
    },
    clipboard: {
      readText: async () => ''
    },
    capture: {
      onOpened: () => undefined,
      completeSnipSelection: () => unsupportedDesktop('capture'),
      cancelSnip: () => unsupportedDesktop('capture'),
      getBackgroundImage: () => unsupportedDesktop('capture')
    },
    stickers: {
      get: async () => null,
      togglePin: () => unsupportedDesktop('stickers'),
      copy: () => unsupportedDesktop('stickers'),
      saveAs: () => unsupportedDesktop('stickers'),
      close: () => unsupportedDesktop('stickers'),
      onUpdated: () => undefined
    },
    updates: {
      getMetadata: () => unsupportedDesktop('updates'),
      getState: () => unsupportedDesktop('updates'),
      check: () => unsupportedDesktop('updates'),
      download: () => unsupportedDesktop('updates'),
      cancelDownload: () => unsupportedDesktop('updates'),
      install: () => unsupportedDesktop('updates'),
      onChange: () => undefined
    },
    events: {
      send: () => undefined
    },
    backup: {
      listSnapshots: async () => [],
      createSnapshot: () => unsupportedDesktop('backup'),
      verifySnapshot: () => unsupportedDesktop('backup'),
      restoreSnapshot: () => unsupportedDesktop('backup')
    }
  };
}
