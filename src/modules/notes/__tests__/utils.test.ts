import { describe, expect, it } from 'vitest';
import type { QuickNote } from '../../../types/quick-note';
import {
  appendChecklistLine,
  formatTimeLabel,
  noteMatchesQuery,
  parseChecklistItems,
  parseStickyLocalDraft,
  parseTimestampMs,
  sortNotes,
  stickyDraftStorageKey,
  titleFromContent,
  toggleChecklistLine
} from '../utils';

describe('notes utils', () => {
  it('parses both numeric millisecond strings and ISO timestamps', () => {
    const ms = 1795507699123;
    expect(parseTimestampMs(String(ms))).toBe(ms);
    expect(parseTimestampMs('2026-11-24T08:00:00Z')).toBe(Date.parse('2026-11-24T08:00:00Z'));
    expect(Number.isNaN(parseTimestampMs(''))).toBe(true);
    expect(formatTimeLabel(String(ms))).not.toBe('刚刚');
  });

  it('sorts notes cleanly with numeric epoch timestamps', () => {
    const notes: QuickNote[] = [
      {
        id: 'n1',
        title: 'Old Note',
        content: '',
        pinned: false,
        favorite: false,
        createdAt: '1700000000000',
        updatedAt: '1700000000000'
      },
      {
        id: 'n2',
        title: 'New Note',
        content: '',
        pinned: false,
        favorite: false,
        createdAt: '1700000005000',
        updatedAt: '1700000005000'
      }
    ];
    expect(sortNotes(notes, 'updated').map(n => n.id)).toEqual(['n2', 'n1']);
    expect(sortNotes(notes, 'title').map(n => n.id)).toEqual(['n2', 'n1']);
  });

  it('parses, appends, and toggles markdown checklist lines', () => {
    const initial = appendChecklistLine('买牛奶', '鸡蛋');
    expect(initial).toBe('买牛奶\n- [ ] 鸡蛋');

    const withSecond = appendChecklistLine(initial, '面包');
    const items = parseChecklistItems(withSecond);
    expect(items).toEqual([
      { lineIndex: 1, checked: false, text: '鸡蛋' },
      { lineIndex: 2, checked: false, text: '面包' }
    ]);

    const toggled = toggleChecklistLine(withSecond, 1);
    expect(parseChecklistItems(toggled)[0].checked).toBe(true);
    expect(toggleChecklistLine(toggled, 1)).toBe(withSecond);
  });

  it('validates local sticky draft recovery payloads loudly', () => {
    const validRaw = JSON.stringify({
      noteId: 'note-1',
      title: '草稿标题',
      content: '正文',
      savedAt: 1795507699999
    });
    expect(parseStickyLocalDraft(validRaw, 'note-1')).toEqual({
      noteId: 'note-1',
      title: '草稿标题',
      content: '正文',
      savedAt: 1795507699999
    });

    expect(() => parseStickyLocalDraft(validRaw, 'note-2')).toThrow(/\[CRITICAL\]/);
    expect(() => parseStickyLocalDraft('{corrupt', 'note-1')).toThrow();
    expect(stickyDraftStorageKey('note-1', 'alice:private:alice')).not.toBe(
      stickyDraftStorageKey('note-1', 'alice:default')
    );
  });

  it('filters multi-keyword queries and extracts fallback titles', () => {
    const note: QuickNote = {
      id: 'n1',
      title: 'TidyDesk 发布计划',
      content: '检查 Cargo test 与 Vitest',
      pinned: false,
      favorite: false,
      createdAt: '1',
      updatedAt: '1'
    };
    expect(noteMatchesQuery(note, 'tidydesk vitest')).toBe(true);
    expect(noteMatchesQuery(note, 'tidydesk missing')).toBe(false);
    expect(titleFromContent('\n  第一行标题  \n第二行')).toBe('第一行标题');
  });
});
