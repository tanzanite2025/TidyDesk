import type { QuickNote } from '../../types/quick-note';

export type SortMode = 'updated' | 'created' | 'title';

export interface QuickNoteSection {
  key: string;
  label: string;
  notes: QuickNote[];
}

export function titleFromContent(content: string): string {
  return content
    .split(/\r?\n/)
    .map(line => line.trim())
    .find(Boolean)
    ?.slice(0, 80) || '未命名记录';
}

export function parseTimestampMs(value: string): number {
  const trimmed = value.trim();
  if (!trimmed) return Number.NaN;
  if (/^\d{10,16}$/.test(trimmed)) {
    const numeric = Number(trimmed);
    return trimmed.length <= 10 ? numeric * 1000 : numeric;
  }
  return Date.parse(trimmed);
}

export function formatTimeLabel(value: string): string {
  const timestamp = parseTimestampMs(value);
  if (Number.isNaN(timestamp)) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  }).format(new Date(timestamp));
}

export async function copyText(text: string): Promise<void> {
  if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', 'true');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

export function notePreview(content: string): string {
  return content
    .split(/\r?\n/)
    .map(line => line.replace(/^#+\s*/, '').replace(/^- \[[ xX]\]\s*/, '').trim())
    .filter(Boolean)
    .slice(0, 3)
    .join(' · ');
}

export function timestampNumber(value: string): number {
  const timestamp = parseTimestampMs(value);
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

export function sortNotes(notes: QuickNote[], sortMode: SortMode): QuickNote[] {
  return [...notes].sort((left, right) => {
    if (sortMode === 'title') {
      return left.title.localeCompare(right.title, 'zh-CN')
        || timestampNumber(right.updatedAt) - timestampNumber(left.updatedAt);
    }

    if (sortMode === 'created') {
      return timestampNumber(right.createdAt) - timestampNumber(left.createdAt)
        || timestampNumber(right.updatedAt) - timestampNumber(left.updatedAt);
    }

    return timestampNumber(right.updatedAt) - timestampNumber(left.updatedAt)
      || timestampNumber(right.createdAt) - timestampNumber(left.createdAt);
  });
}

export function noteMatchesQuery(note: QuickNote, query: string): boolean {
  const normalized = query.trim().toLowerCase();
  if (!normalized) return true;

  const haystack = `${note.title}\n${note.content}`.toLowerCase();
  return normalized.split(/\s+/).every(part => haystack.includes(part));
}

export function dayStart(timestamp: number): number {
  const next = new Date(timestamp);
  next.setHours(0, 0, 0, 0);
  return next.getTime();
}

export function noteTimeBucket(note: QuickNote): 'today' | 'recent' | 'earlier' {
  const diffDays = Math.floor((dayStart(Date.now()) - dayStart(timestampNumber(note.updatedAt))) / 86400000);
  if (diffDays <= 0) return 'today';
  if (diffDays <= 7) return 'recent';
  return 'earlier';
}

export function buildSections(notes: QuickNote[], sortMode: SortMode): QuickNoteSection[] {
  const sorted = sortNotes(notes, sortMode);
  const pinned = sorted.filter(note => note.pinned);
  const favorites = sorted.filter(note => !note.pinned && note.favorite);
  const regular = sorted.filter(note => !note.pinned && !note.favorite);
  const today = regular.filter(note => noteTimeBucket(note) === 'today');
  const recent = regular.filter(note => noteTimeBucket(note) === 'recent');
  const earlier = regular.filter(note => noteTimeBucket(note) === 'earlier');

  return [
    pinned.length > 0 ? { key: 'pinned', label: '置顶', notes: pinned } : null,
    favorites.length > 0 ? { key: 'favorite', label: '收藏', notes: favorites } : null,
    today.length > 0 ? { key: 'today', label: '今天', notes: today } : null,
    recent.length > 0 ? { key: 'recent', label: '最近', notes: recent } : null,
    earlier.length > 0 ? { key: 'earlier', label: '更早', notes: earlier } : null
  ].filter((section): section is QuickNoteSection => Boolean(section));
}

export interface QuickNoteChecklistItem {
  lineIndex: number;
  checked: boolean;
  text: string;
}

const CHECKLIST_LINE_RE = /^(\s*)-\s+\[([ xX])\]\s*(.*)$/;

export function parseChecklistItems(content: string): QuickNoteChecklistItem[] {
  const lines = content.split(/\r?\n/);
  const items: QuickNoteChecklistItem[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const match = CHECKLIST_LINE_RE.exec(lines[i]);
    if (!match) continue;
    items.push({
      lineIndex: i,
      checked: match[2].toLowerCase() === 'x',
      text: match[3] || ''
    });
  }
  return items;
}

export function toggleChecklistLine(content: string, lineIndex: number): string {
  const lines = content.split(/\r?\n/);
  if (lineIndex < 0 || lineIndex >= lines.length) {
    return content;
  }
  const match = CHECKLIST_LINE_RE.exec(lines[lineIndex]);
  if (!match) {
    return content;
  }
  const nextMark = match[2].toLowerCase() === 'x' ? ' ' : 'x';
  lines[lineIndex] = `${match[1]}- [${nextMark}] ${match[3]}`;
  return lines.join('\n');
}

export function appendChecklistLine(content: string, label = ''): string {
  const itemLine = `- [ ] ${label}`;
  if (!content.trim()) {
    return itemLine;
  }
  const endsWithNewline = /\r?\n$/.test(content);
  return endsWithNewline ? `${content}${itemLine}` : `${content}\n${itemLine}`;
}

export interface StickyLocalDraft {
  noteId: string;
  title: string;
  content: string;
  savedAt: number;
}

export function stickyDraftStorageKey(noteId: string, scope = 'local:default'): string {
  return `tidydesk-sticky-draft:${scope}:${noteId}`;
}

export function parseStickyLocalDraft(raw: string | null, expectedNoteId: string): StickyLocalDraft | null {
  if (!raw) return null;
  const parsed: unknown = JSON.parse(raw);
  if (!parsed || typeof parsed !== 'object') {
    throw new Error('[CRITICAL] Invalid local sticky draft object shape');
  }
  const candidate = parsed as Partial<StickyLocalDraft>;
  if (
    candidate.noteId !== expectedNoteId ||
    typeof candidate.title !== 'string' ||
    typeof candidate.content !== 'string' ||
    typeof candidate.savedAt !== 'number'
  ) {
    throw new Error('[CRITICAL] Local sticky draft payload validation failed');
  }
  return {
    noteId: candidate.noteId,
    title: candidate.title,
    content: candidate.content,
    savedAt: candidate.savedAt
  };
}
