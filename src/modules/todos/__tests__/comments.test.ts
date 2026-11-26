import { describe, expect, it } from 'vitest';
import type { TodoCard, TodoCardComment } from '../../../types/todo';
import {
  computeUnreadCommentSummary,
  extractCommentMentions,
  findActiveMentionToken,
  insertMentionAtCursor,
  splitCommentBodyWithMentions,
  truncateCommentPreview
} from '../commentUtils';

function makeCard(id: string, title: string, deletedAt: string | null = null): TodoCard {
  return {
    id,
    boardId: 'b1',
    columnId: 'todo',
    title,
    tags: [],
    archived: false,
    deletedAt,
    createdAt: '100',
    updatedAt: '100'
  };
}

function makeComment(
  id: string,
  cardId: string,
  authorId: string,
  body: string,
  createdAt: string,
  mentions: string[] = extractCommentMentions(body)
): TodoCardComment {
  return {
    id,
    cardId,
    authorId,
    authorName: authorId.toUpperCase(),
    body,
    mentions,
    createdAt,
    updatedAt: createdAt,
    deletedAt: null
  };
}

describe('Todo card comments @mention helpers', () => {
  it('extracts unique valid @mentions in appearance order', () => {
    expect(
      extractCommentMentions('请 @alice 核对，抄送 @bob_1 和 @charlie-dev，再通知一次 @alice')
    ).toEqual(['alice', 'bob_1', 'charlie-dev']);
  });

  it('detects active @query token right before cursor for autocomplete', () => {
    const text = '请 @al';
    expect(findActiveMentionToken(text, text.length)).toEqual({
      query: 'al',
      startIndex: 2,
      endIndex: 5
    });

    const emptyAt = '@';
    expect(findActiveMentionToken(emptyAt, 1)).toEqual({
      query: '',
      startIndex: 0,
      endIndex: 1
    });

    expect(findActiveMentionToken('email@example.com', 17)).toBeNull();
  });

  it('replaces active mention range and preserves suffix text', () => {
    const text = '请 @al 尽快确认';
    const range = findActiveMentionToken(text, 5);
    expect(range).not.toBeNull();
    const res = insertMentionAtCursor(text, range!, 'alice');
    expect(res).toEqual({
      nextText: '请 @alice  尽快确认',
      nextCursorPos: 9
    });
  });

  it('splits comment body into plain text and mention segments', () => {
    expect(splitCommentBodyWithMentions('你好 @bob 请查收')).toEqual([
      { kind: 'text', text: '你好 ' },
      { kind: 'mention', text: '@bob', userId: 'bob' },
      { kind: 'text', text: ' 请查收' }
    ]);
  });

  it('computes per-card unread counts, prioritizes @mentions, and ignores self/deleted cards', () => {
    const cardsById = new Map<string, TodoCard>([
      ['card-1', makeCard('card-1', '普通讨论卡')],
      ['card-2', makeCard('card-2', '重要提醒卡')],
      ['card-del', makeCard('card-del', '已删卡', '999')]
    ]);
    const commentsByCardId = new Map<string, TodoCardComment[]>([
      [
        'card-1',
        [
          makeComment('c1', 'card-1', 'alice', '自己发的不算未读', '1000'),
          makeComment('c2', 'card-1', 'bob', '别人新评论', '2000')
        ]
      ],
      [
        'card-2',
        [
          makeComment('c3', 'card-2', 'charlie', '请 @alice 复核部署脚本', '1500'),
          makeComment('c4', 'card-2', 'bob', '之前已读过的消息', '900')
        ]
      ],
      ['card-del', [makeComment('c5', 'card-del', 'bob', '已删卡忽略', '3000')]],
      ['card-removed', [makeComment('c6', 'card-removed', 'bob', '已从看板移除的卡忽略', '4000')]]
    ]);

    const summary = computeUnreadCommentSummary({
      cardsById,
      commentsByCardId,
      readTimestamps: { 'card-2': 1000 },
      currentUserId: 'alice'
    });

    expect(summary.unreadTotal).toBe(2);
    expect(summary.mentionTotal).toBe(1);
    expect(summary.items.map(i => i.cardId)).toEqual(['card-2', 'card-1']);
    expect(summary.items[0].mentionCount).toBe(1);
    expect(summary.items[0].latestAuthorName).toBe('CHARLIE');

    const localOnly = computeUnreadCommentSummary({
      cardsById,
      commentsByCardId,
      readTimestamps: {},
      currentUserId: 'local'
    });
    expect(localOnly).toEqual({ unreadTotal: 0, mentionTotal: 0, items: [] });

    expect(truncateCommentPreview('   第一行\n  第二行   测试文本  ', 8)).toBe('第一行 第二行 …');
  });

  it('skips notifications and unread counts for removed cards absent from cardsById even with @mentions', () => {
    const summary = computeUnreadCommentSummary({
      cardsById: new Map<string, TodoCard>([['card-active', makeCard('card-active', '有效卡片')]]),
      commentsByCardId: new Map<string, TodoCardComment[]>([
        ['card-gone', [makeComment('c9', 'card-gone', 'bob', '@alice 请看这条', '5000')]]
      ]),
      readTimestamps: {},
      currentUserId: 'alice'
    });
    expect(summary).toEqual({ unreadTotal: 0, mentionTotal: 0, items: [] });
  });
});
