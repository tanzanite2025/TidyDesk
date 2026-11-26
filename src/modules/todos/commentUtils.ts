import type {
  TodoCard,
  TodoCardComment,
  TodoUnreadCommentItem,
  TodoUnreadCommentSummary
} from '../../types/todo';

export interface CommentMentionTokenRange {
  query: string;
  startIndex: number;
  endIndex: number;
}

export type CommentBodySegment =
  | { kind: 'text'; text: string }
  | { kind: 'mention'; text: string; userId: string };

const MENTION_GLOBAL_REGEX = /@([a-zA-Z0-9_-]{1,64})/g;

/**
 * Extract deduplicated `@userId` identifiers in order of appearance, matching backend extraction.
 */
export function extractCommentMentions(body: string): string[] {
  const seen = new Set<string>();
  const mentions: string[] = [];
  for (const match of body.matchAll(MENTION_GLOBAL_REGEX)) {
    const id = match[1];
    if (id && !seen.has(id)) {
      seen.add(id);
      mentions.push(id);
    }
  }
  return mentions;
}

/**
 * Detect whether the cursor sits inside an active `@query` mention token suitable for autocomplete.
 */
export function findActiveMentionToken(
  text: string,
  cursorPos: number
): CommentMentionTokenRange | null {
  const clamped = Math.max(0, Math.min(cursorPos, text.length));
  const beforeCursor = text.slice(0, clamped);
  const match = /(^|[\s([{"'，。！？、：；])@([a-zA-Z0-9_-]{0,64})$/.exec(beforeCursor);
  if (!match) return null;

  const prefixLen = match[1].length;
  const startIndex = beforeCursor.length - match[0].length + prefixLen;
  return {
    query: match[2],
    startIndex,
    endIndex: clamped
  };
}

/**
 * Replace an active `@query` span with `@userId ` and return updated text + cursor offset.
 */
export function insertMentionAtCursor(
  text: string,
  range: CommentMentionTokenRange,
  userId: string
): { nextText: string; nextCursorPos: number } {
  const token = `@${userId} `;
  const nextText = `${text.slice(0, range.startIndex)}${token}${text.slice(range.endIndex)}`;
  return {
    nextText,
    nextCursorPos: range.startIndex + token.length
  };
}

/**
 * Split comment body into plain text and `@mention` segments for safe React rendering.
 */
export function splitCommentBodyWithMentions(body: string): CommentBodySegment[] {
  const segments: CommentBodySegment[] = [];
  let cursor = 0;

  for (const match of body.matchAll(MENTION_GLOBAL_REGEX)) {
    const index = match.index ?? 0;
    if (index > cursor) {
      segments.push({ kind: 'text', text: body.slice(cursor, index) });
    }
    const full = match[0];
    const userId = match[1];
    segments.push({ kind: 'mention', text: full, userId });
    cursor = index + full.length;
  }

  if (cursor < body.length) {
    segments.push({ kind: 'text', text: body.slice(cursor) });
  }

  if (segments.length === 0) {
    segments.push({ kind: 'text', text: body });
  }

  return segments;
}

export function truncateCommentPreview(raw: string, maxChars = 72): string {
  const normalized = raw.trim().replace(/\s+/g, ' ');
  const chars = Array.from(normalized);
  if (chars.length <= maxChars) return normalized;
  return `${chars.slice(0, maxChars).join('')}…`;
}

/**
 * Pure unread comment summary calculation matching Rust SQLite unread logic:
 * excludes deleted cards/comments, self-authored or local comments, and respects per-card read cursors.
 */
export function computeUnreadCommentSummary(params: {
  cardsById: Map<string, TodoCard>;
  commentsByCardId: Map<string, TodoCardComment[]>;
  readTimestamps: Record<string, number>;
  currentUserId?: string | null;
}): TodoUnreadCommentSummary {
  const actorId = (params.currentUserId || '').trim();
  if (!actorId || actorId === 'local') {
    return { unreadTotal: 0, mentionTotal: 0, items: [] };
  }

  const items: TodoUnreadCommentItem[] = [];
  let unreadTotal = 0;
  let mentionTotal = 0;

  for (const [cardId, comments] of params.commentsByCardId.entries()) {
    const card = params.cardsById.get(cardId);
    if (!card || card.deletedAt) continue;

    const readAt = Number(params.readTimestamps[cardId] || 0);
    const unread = comments
      .filter(cmt => {
        if (cmt.deletedAt) return false;
        if (!cmt.authorId || cmt.authorId === 'local' || cmt.authorId === actorId) return false;
        const createdTs = Number(cmt.createdAt || 0);
        return createdTs > readAt;
      })
      .sort((a, b) => Number(a.createdAt || 0) - Number(b.createdAt || 0));

    if (unread.length === 0) continue;

    let cardMentionCount = 0;
    for (const cmt of unread) {
      if (cmt.mentions?.includes(actorId)) {
        cardMentionCount += 1;
      }
    }

    const latest = unread[unread.length - 1];
    unreadTotal += unread.length;
    mentionTotal += cardMentionCount;

    items.push({
      cardId,
      cardTitle: card?.title?.trim() || '未命名待办',
      unreadCount: unread.length,
      mentionCount: cardMentionCount,
      latestCommentId: latest.id,
      latestAuthorId: latest.authorId,
      latestAuthorName: latest.authorName || latest.authorId,
      latestBodyPreview: truncateCommentPreview(latest.body, 72),
      latestCreatedAt: latest.createdAt
    });
  }

  items.sort((a, b) => {
    if (b.mentionCount !== a.mentionCount) return b.mentionCount - a.mentionCount;
    const diff = Number(b.latestCreatedAt || 0) - Number(a.latestCreatedAt || 0);
    if (diff !== 0) return diff;
    return a.cardId.localeCompare(b.cardId);
  });

  return { unreadTotal, mentionTotal, items };
}
