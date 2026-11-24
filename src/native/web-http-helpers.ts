import type {
  TodoBoard,
  TodoCard,
  TodoCounts
} from '../types/todo';
import type { NativeClient } from './types';

export const WEB_SESSION_STORAGE_KEY = 'tidydesk_mobile_session_v1';
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

export async function computeSha256Hex(bytes: Uint8Array): Promise<string> {
  if (typeof crypto === 'undefined' || !crypto.subtle) {
    throw new Error('当前浏览器不支持 WebCrypto SHA-256（需 HTTPS 或 localhost）');
  }
  const copy = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  ) as ArrayBuffer;
  const digest = await crypto.subtle.digest('SHA-256', copy);
  return Array.from(new Uint8Array(digest))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
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

export function readStoredWebSession(): StoredWebSession | null {
  try {
    const raw = sessionStorage.getItem(WEB_SESSION_STORAGE_KEY);
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
      sessionStorage.removeItem(WEB_SESSION_STORAGE_KEY);
    } else {
      sessionStorage.setItem(WEB_SESSION_STORAGE_KEY, JSON.stringify(session));
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
  | 'quickNotes'
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
>;

export function createDesktopUnsupportedStubs(): DesktopOnlyNamespaces {
  const unsupportedDesktop = (name: string): never => {
    throw new Error(`${name} 仅在 Windows 桌面端可用`);
  };

  return {
    quickNotes: {
      readState: async () => ({ notes: [] }),
      createNote: () => unsupportedDesktop('quickNotes'),
      updateNote: () => unsupportedDesktop('quickNotes'),
      deleteNote: () => unsupportedDesktop('quickNotes')
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
      getPathForFile: () => '',
      onDrawerState: () => undefined,
      onModuleState: () => undefined
    },
    toolWindows: {
      openTodo: () => unsupportedDesktop('toolWindows'),
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
      install: () => unsupportedDesktop('updates'),
      onChange: () => undefined
    },
    events: {
      send: () => undefined
    }
  };
}
