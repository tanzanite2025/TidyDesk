import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CornerDownRight, Loader2, MessageSquare, RefreshCw, Send, Trash2, X } from 'lucide-react';
import { useTodos } from '../../context/TodoContext';
import type { AccountSessionSnapshot, TodoCardComment, WorkspaceMemberInfo } from '../../types/todo';
import {
  findActiveMentionToken,
  insertMentionAtCursor,
  splitCommentBodyWithMentions,
  type CommentMentionTokenRange
} from './commentUtils';

interface TodoCommentsSectionProps {
  cardId: string;
  onDraftDirtyChange?: (hasUnsavedDraft: boolean) => void;
}

const commentDraftCache = new Map<string, { draft: string; replyTo: TodoCardComment | null }>();

export function clearCommentDraftCache(cardId?: string) {
  if (cardId) {
    commentDraftCache.delete(cardId);
  } else {
    commentDraftCache.clear();
  }
}

function formatCommentTime(raw: string): string {
  const numeric = Number(raw);
  const date = Number.isFinite(numeric) ? new Date(numeric) : new Date(raw);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit'
  });
}

function initialsOf(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  return trimmed.slice(0, 1).toUpperCase();
}

export const TodoCommentsSection: React.FC<TodoCommentsSectionProps> = ({
  cardId,
  onDraftDirtyChange
}) => {
  const {
    listCardComments,
    addCardComment,
    deleteCardComment,
    markCardCommentsRead,
    listWorkspaceMembers,
    getAccountSession,
    onCommentsUpdated
  } = useTodos();

  const [comments, setComments] = useState<TodoCardComment[]>([]);
  const [members, setMembers] = useState<WorkspaceMemberInfo[]>([]);
  const [session, setSession] = useState<AccountSessionSnapshot | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [pendingDeleteId, setPendingDeleteId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [sectionError, setSectionError] = useState<string | null>(null);
  const [draft, setDraft] = useState(() => commentDraftCache.get(cardId)?.draft ?? '');
  const [replyTo, setReplyTo] = useState<TodoCardComment | null>(
    () => commentDraftCache.get(cardId)?.replyTo ?? null
  );
  const [mentionRange, setMentionRange] = useState<CommentMentionTokenRange | null>(null);
  const [mentionActiveIdx, setMentionActiveIdx] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    if (draft.length > 0 || replyTo) {
      commentDraftCache.set(cardId, { draft, replyTo });
    } else {
      commentDraftCache.delete(cardId);
    }
    onDraftDirtyChange?.(draft.trim().length > 0);
  }, [cardId, draft, onDraftDirtyChange, replyTo]);

  useEffect(() => {
    return () => {
      onDraftDirtyChange?.(false);
    };
  }, [onDraftDirtyChange]);

  const loadComments = useCallback(async () => {
    setIsLoading(true);
    setSectionError(null);
    try {
      const list = await listCardComments(cardId);
      setComments(list);
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsLoading(false);
    }
  }, [cardId, listCardComments]);

  const loadWorkspaceContext = useCallback(async () => {
    try {
      const snap = await getAccountSession();
      setSession(snap);
      if (snap?.authMode === 'account') {
        const fetched = await listWorkspaceMembers(snap.workspaceId);
        setMembers(fetched);
      } else {
        setMembers([]);
      }
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : String(err));
    }
  }, [getAccountSession, listWorkspaceMembers]);

  useEffect(() => {
    const cached = commentDraftCache.get(cardId);
    setDraft(cached?.draft ?? '');
    setReplyTo(cached?.replyTo ?? null);
    setMentionRange(null);
    setPendingDeleteId(null);
    void loadComments();
    void loadWorkspaceContext();
  }, [cardId, loadComments, loadWorkspaceContext]);

  useEffect(() => {
    return onCommentsUpdated(payload => {
      if (payload.cardIds.includes(cardId)) {
        void loadComments();
        void markCardCommentsRead(cardId);
      }
    });
  }, [cardId, loadComments, markCardCommentsRead, onCommentsUpdated]);

  const commentById = useMemo(() => {
    const map = new Map<string, TodoCardComment>();
    for (const cmt of comments) {
      map.set(cmt.id, cmt);
    }
    return map;
  }, [comments]);

  const filteredMembers = useMemo(() => {
    if (!mentionRange || members.length === 0) return [];
    const q = mentionRange.query.trim().toLowerCase();
    return members
      .filter(m => {
        if (!q) return true;
        return m.userId.toLowerCase().includes(q) || m.displayName.toLowerCase().includes(q);
      })
      .slice(0, 6);
  }, [members, mentionRange]);

  const currentActorId = session?.activeUserId || session?.detachedUserId || 'local';

  const canDeleteComment = (cmt: TodoCardComment): boolean => {
    if (cmt.authorId === 'local') return true;
    return cmt.authorId === currentActorId;
  };

  const applyMentionSelection = (member: WorkspaceMemberInfo) => {
    if (!mentionRange) return;
    const { nextText, nextCursorPos } = insertMentionAtCursor(draft, mentionRange, member.userId);
    setDraft(nextText);
    setMentionRange(null);
    setMentionActiveIdx(0);
    window.requestAnimationFrame(() => {
      const el = inputRef.current;
      if (!el) return;
      el.focus();
      el.setSelectionRange(nextCursorPos, nextCursorPos);
    });
  };

  const handleDraftChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const nextVal = e.target.value;
    const cursor = e.target.selectionStart ?? nextVal.length;
    setDraft(nextVal);
    const active = findActiveMentionToken(nextVal, cursor);
    setMentionRange(active);
    setMentionActiveIdx(0);
  };

  const handleSubmitComment = async () => {
    const trimmed = draft.trim();
    if (!trimmed || isSubmitting) return;
    setIsSubmitting(true);
    setSectionError(null);
    try {
      const created = await addCardComment({
        cardId,
        body: trimmed,
        parentId: replyTo?.id ?? null
      });
      setComments(prev => (prev.some(item => item.id === created.id) ? prev : [...prev, created]));
      commentDraftCache.delete(cardId);
      setDraft('');
      setReplyTo(null);
      setMentionRange(null);
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : String(err));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeleteComment = async (commentId: string) => {
    if (deletingId) return;
    setDeletingId(commentId);
    setSectionError(null);
    try {
      const next = await deleteCardComment({ cardId, commentId });
      setComments(next);
      setPendingDeleteId(null);
      if (replyTo?.id === commentId) {
        setReplyTo(null);
      }
    } catch (err) {
      setSectionError(err instanceof Error ? err.message : String(err));
    } finally {
      setDeletingId(null);
    }
  };

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // Allow Chinese/Japanese/Korean IME composition commits without prematurely triggering mentions or submit.
    if (e.nativeEvent.isComposing || e.keyCode === 229) {
      return;
    }

    if (filteredMembers.length > 0 && mentionRange) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setMentionActiveIdx(prev => (prev + 1) % filteredMembers.length);
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setMentionActiveIdx(prev => (prev - 1 + filteredMembers.length) % filteredMembers.length);
        return;
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault();
        const picked = filteredMembers[mentionActiveIdx] || filteredMembers[0];
        if (picked) applyMentionSelection(picked);
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        setMentionRange(null);
        return;
      }
    }

    if (e.key === 'Escape' && replyTo) {
      e.preventDefault();
      e.stopPropagation();
      setReplyTo(null);
      return;
    }

    if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation();
      void handleSubmitComment();
    }
  };

  return (
    <section className="rounded-xl border border-white/[0.08] bg-white/[0.02] p-3">
      <div className="mb-2.5 flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-200">
          <MessageSquare size={13} className="text-sky-400" />
          <span>协作评论</span>
          <span className="rounded-full bg-white/[0.07] px-1.5 py-0.5 font-mono text-[10px] text-slate-300">
            {comments.length}
          </span>
        </div>
        <button
          type="button"
          disabled={isLoading}
          onClick={() => void loadComments()}
          title="刷新评论"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-[10px] text-slate-400 hover:bg-white/[0.07] hover:text-slate-200 disabled:opacity-50"
        >
          <RefreshCw size={11} className={isLoading ? 'animate-spin' : ''} />
          刷新
        </button>
      </div>

      {sectionError && (
        <div className="mb-2 flex items-center justify-between gap-2 rounded-lg border border-rose-400/30 bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-200">
          <span className="min-w-0 flex-1 break-words">{sectionError}</span>
          <button
            type="button"
            onClick={() => setSectionError(null)}
            className="rounded p-0.5 text-rose-300 hover:bg-rose-400/20"
            title="关闭错误提示"
          >
            <X size={12} />
          </button>
        </div>
      )}

      {/* Timeline list */}
      <div className="max-h-56 space-y-2 overflow-y-auto pr-0.5">
        {isLoading && comments.length === 0 ? (
          <div className="flex items-center justify-center gap-1.5 py-4 text-[11px] text-slate-500">
            <Loader2 size={12} className="animate-spin" />
            <span>正在加载评论...</span>
          </div>
        ) : comments.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] py-4 text-center text-[11px] text-slate-500">
            暂无评论，输入内容并按 Ctrl+Enter 发送
            {members.length > 0 ? '，输入 @ 可提及工作区成员' : ''}
          </div>
        ) : (
          comments.map(cmt => {
            const parentCmt = cmt.parentId ? commentById.get(cmt.parentId) : undefined;
            const segments = splitCommentBodyWithMentions(cmt.body);

            return (
              <div
                key={cmt.id}
                className="group rounded-lg border border-white/[0.06] bg-white/[0.025] px-2.5 py-2"
              >
                <div className="flex items-center justify-between gap-2">
                  <div className="flex min-w-0 items-center gap-1.5">
                    <span className="grid h-5 w-5 shrink-0 place-items-center rounded-full bg-sky-500/20 text-[10px] font-bold text-sky-200">
                      {initialsOf(cmt.authorName)}
                    </span>
                    <span className="truncate text-[11px] font-semibold text-slate-200">
                      {cmt.authorName}
                    </span>
                    <span className="text-[10px] text-slate-500">
                      {formatCommentTime(cmt.createdAt)}
                    </span>
                  </div>
                  <div className="flex items-center gap-1 opacity-80 transition-opacity group-hover:opacity-100">
                    <button
                      type="button"
                      onClick={() => {
                        setReplyTo(cmt);
                        inputRef.current?.focus();
                      }}
                      className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.08] hover:text-sky-200"
                    >
                      回复
                    </button>
                    {canDeleteComment(cmt) &&
                      (pendingDeleteId === cmt.id ? (
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            disabled={deletingId === cmt.id}
                            onClick={() => void handleDeleteComment(cmt.id)}
                            className="rounded bg-rose-500/25 px-1.5 py-0.5 text-[10px] font-semibold text-rose-200 hover:bg-rose-500/35 disabled:opacity-50"
                          >
                            {deletingId === cmt.id ? '删除中' : '确认删除'}
                          </button>
                          <button
                            type="button"
                            disabled={deletingId === cmt.id}
                            onClick={() => setPendingDeleteId(null)}
                            className="rounded px-1.5 py-0.5 text-[10px] text-slate-400 hover:bg-white/[0.08]"
                          >
                            取消
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => setPendingDeleteId(cmt.id)}
                          title="删除评论"
                          className="rounded p-1 text-slate-500 hover:bg-rose-500/15 hover:text-rose-300"
                        >
                          <Trash2 size={11} />
                        </button>
                      ))}
                  </div>
                </div>

                {cmt.parentId && (
                  <div className="mt-1.5 flex items-center gap-1 rounded border-l-2 border-sky-400/50 bg-white/[0.03] px-2 py-1 text-[10px] text-slate-400">
                    <CornerDownRight size={10} className="shrink-0 text-sky-400" />
                    <span className="truncate">
                      {parentCmt
                        ? `回复 ${parentCmt.authorName}: ${parentCmt.body}`
                        : '回复已删除的评论'}
                    </span>
                  </div>
                )}

                <div className="mt-1.5 whitespace-pre-wrap break-words text-[12px] leading-relaxed text-slate-200">
                  {segments.map((seg, idx) =>
                    seg.kind === 'mention' ? (
                      <span
                        key={`${cmt.id}-seg-${idx}`}
                        className="mx-0.5 inline-block rounded bg-sky-500/20 px-1 py-0.2 font-semibold text-sky-200"
                      >
                        {seg.text}
                      </span>
                    ) : (
                      <React.Fragment key={`${cmt.id}-seg-${idx}`}>{seg.text}</React.Fragment>
                    )
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>

      {/* Composer */}
      <div className="relative mt-2.5 border-t border-white/[0.06] pt-2.5">
        {replyTo && (
          <div className="mb-1.5 flex items-center justify-between gap-2 rounded-md border border-sky-400/25 bg-sky-500/10 px-2 py-1 text-[10px] text-sky-200">
            <span className="truncate">
              正在回复 {replyTo.authorName}: {replyTo.body}
            </span>
            <button
              type="button"
              onClick={() => setReplyTo(null)}
              className="rounded p-0.5 hover:bg-sky-400/20"
              title="取消回复"
            >
              <X size={11} />
            </button>
          </div>
        )}

        {filteredMembers.length > 0 && mentionRange && (
          <div className="mb-1.5 overflow-hidden rounded-lg border border-sky-400/30 bg-[#121622] shadow-lg">
            {filteredMembers.map((member, idx) => (
              <button
                key={member.userId}
                type="button"
                onMouseDown={e => {
                  e.preventDefault();
                  applyMentionSelection(member);
                }}
                className={`flex w-full items-center justify-between gap-2 px-2.5 py-1.5 text-left text-[11px] ${
                  idx === mentionActiveIdx
                    ? 'bg-sky-500/25 text-sky-100'
                    : 'text-slate-300 hover:bg-white/[0.06]'
                }`}
              >
                <span className="truncate font-semibold">{member.displayName}</span>
                <span className="font-mono text-[10px] text-slate-400">@{member.userId}</span>
              </button>
            ))}
          </div>
        )}

        <div className="flex flex-col gap-1.5">
          <textarea
            ref={inputRef}
            rows={2}
            maxLength={4000}
            value={draft}
            onChange={handleDraftChange}
            onKeyDown={handleInputKeyDown}
            placeholder={
              members.length > 0
                ? '写下讨论或进度备注... 输入 @ 可提及成员 (Ctrl+Enter 发送)'
                : '写下讨论或进度备注... (Ctrl+Enter 发送)'
            }
            className="w-full resize-none rounded-lg border border-white/[0.08] bg-black/30 px-2.5 py-2 text-[12px] text-slate-100 placeholder:text-slate-500 focus:border-sky-400/50 focus:outline-none"
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-[10px] text-slate-500">
              Ctrl+Enter 快速发送
              {draft.length > 3500 && (
                <span className="ml-2 font-mono text-amber-300">{draft.length}/4000</span>
              )}
            </span>
            <button
              type="button"
              disabled={!draft.trim() || isSubmitting}
              onClick={() => void handleSubmitComment()}
              className="inline-flex items-center gap-1 rounded-lg bg-sky-500/25 px-3 py-1 text-[11px] font-semibold text-sky-100 hover:bg-sky-500/35 disabled:cursor-not-allowed disabled:opacity-45"
            >
              {isSubmitting ? <Loader2 size={11} className="animate-spin" /> : <Send size={11} />}
              发送评论
            </button>
          </div>
        </div>
      </div>
    </section>
  );
};
