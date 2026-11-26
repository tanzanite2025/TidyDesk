import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { NativeClient } from '../native/types';
import { compareCardsByPosition } from '../native/web-http-helpers';
import {
  AccountSessionSnapshot,
  AddTodoAttachmentBytesInput,
  AddTodoCommentInput,
  CreateTodoCardInput,
  DeleteTodoCommentInput,
  MoveTodoCardInput,
  TodoBoard,
  TodoCard,
  TodoCardComment,
  TodoCommentNotificationPayload,
  TodoCounts,
  TodoState,
  TodoUnreadCommentSummary,
  UpdateTodoAttachmentMetaInput,
  UpdateTodoCardInput,
  WorkspaceMemberInfo
} from '../types/todo';

interface TodoContextType {
  board: TodoBoard | null;
  cards: TodoCard[];
  counts: TodoCounts;
  unreadSummary: TodoUnreadCommentSummary;
  latestCommentNotification: TodoCommentNotificationPayload | null;
  isLoading: boolean;
  isUploadingAttachment: boolean;
  error: string | null;
  cardsByColumn: Record<string, TodoCard[]>;
  refreshTodos: () => Promise<void>;
  createCard: (payload: CreateTodoCardInput) => Promise<TodoCard | null>;
  updateCard: (payload: UpdateTodoCardInput) => Promise<boolean>;
  deleteCard: (cardId: string) => Promise<boolean>;
  moveCard: (payload: MoveTodoCardInput) => Promise<void>;
  getCardDetail: (cardId: string) => Promise<TodoCard | null>;
  addAttachmentBytes: (payload: AddTodoAttachmentBytesInput) => Promise<boolean>;
  pickAndAddAttachment: (cardId: string, subtaskId?: string | null) => Promise<boolean>;
  deleteAttachment: (cardId: string, attachmentId: string, subtaskId?: string | null) => Promise<boolean>;
  setCardCover: (cardId: string, attachmentId: string | null) => Promise<boolean>;
  updateAttachmentMeta: (payload: UpdateTodoAttachmentMetaInput) => Promise<boolean>;
  startSnipForCard: (cardId: string, subtaskId?: string | null) => Promise<void>;
  listCardComments: (cardId: string) => Promise<TodoCardComment[]>;
  addCardComment: (payload: AddTodoCommentInput) => Promise<TodoCardComment>;
  deleteCardComment: (payload: DeleteTodoCommentInput) => Promise<TodoCardComment[]>;
  markCardCommentsRead: (cardId: string) => Promise<void>;
  markAllCommentsRead: () => Promise<void>;
  consumePendingFocusCard: () => Promise<string | null>;
  onFocusCardRequested: (callback: (cardId: string) => void) => () => void;
  dismissCommentNotification: () => void;
  listWorkspaceMembers: (workspaceId?: string) => Promise<WorkspaceMemberInfo[]>;
  getAccountSession: () => Promise<AccountSessionSnapshot | null>;
  onCommentsUpdated: (callback: (payload: { cardIds: string[] }) => void) => () => void;
  clearError: () => void;
}

const TodoContext = createContext<TodoContextType | undefined>(undefined);

const emptyCounts: TodoCounts = { total: 0, open: 0, done: 0 };
const emptyUnreadSummary: TodoUnreadCommentSummary = {
  unreadTotal: 0,
  mentionTotal: 0,
  items: []
};
const simulatedTodoState: TodoState = {
  activeBoardId: 'sim-board',
  boards: [{
    id: 'sim-board',
    title: '待办',
    columns: [
      { id: 'todo', title: '待处理' },
      { id: 'doing', title: '进行中' },
      { id: 'done', title: '已完成' }
    ],
    cardOrder: {
      todo: ['sim-card-1'],
      doing: ['sim-card-2'],
      done: ['sim-card-3']
    },
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString()
  }],
  cards: [
    {
      id: 'sim-card-1',
      boardId: 'sim-board',
      columnId: 'todo',
      title: '整理发布清单',
      content: '# 整理发布清单\n\n- [ ] 检查构建\n- [ ] 写发布说明\n\n| 项目 | 状态 |\n| --- | --- |\n| Build | OK |',
      tags: [],
      archived: false,
      subtasks: [],
      subtaskTotal: 0,
      subtaskCompleted: 0,
      previewAttachments: [],
      extraAttachmentCount: 0,
      attachments: [],
      attachmentCount: 0,
      coverAttachmentId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    {
      id: 'sim-card-2',
      boardId: 'sim-board',
      columnId: 'doing',
      title: '快速记录入口',
      content: '支持 **Markdown** 和剪贴板捕获。',
      tags: [],
      archived: false,
      subtasks: [],
      subtaskTotal: 0,
      subtaskCompleted: 0,
      previewAttachments: [],
      extraAttachmentCount: 0,
      attachments: [],
      attachmentCount: 0,
      coverAttachmentId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    {
      id: 'sim-card-3',
      boardId: 'sim-board',
      columnId: 'done',
      title: '桌面悬浮侧边栏',
      content: '- [x] 待办 / 抽屉 / 快捷记录快捷入口',
      tags: [],
      archived: false,
      subtasks: [],
      subtaskTotal: 0,
      subtaskCompleted: 0,
      previewAttachments: [],
      extraAttachmentCount: 0,
      attachments: [],
      attachmentCount: 0,
      coverAttachmentId: null,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }
  ],
  counts: { total: 3, open: 2, done: 1 }
};

function applyTodoState(
  state: TodoState,
  setBoard: (board: TodoBoard | null) => void,
  setCards: (cards: TodoCard[]) => void,
  setCounts: (counts: TodoCounts) => void
) {
  setBoard(state.boards.find(board => board.id === state.activeBoardId) || state.boards[0] || null);
  setCards(state.cards || []);
  setCounts(state.counts || emptyCounts);
}

export const TodoProvider: React.FC<{ children: ReactNode; client: NativeClient }> = ({ children, client }) => {
  const [board, setBoard] = useState<TodoBoard | null>(null);
  const [cards, setCards] = useState<TodoCard[]>([]);
  const [counts, setCounts] = useState<TodoCounts>(emptyCounts);
  const [unreadSummary, setUnreadSummary] = useState<TodoUnreadCommentSummary>(emptyUnreadSummary);
  const [latestCommentNotification, setLatestCommentNotification] =
    useState<TodoCommentNotificationPayload | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isUploadingAttachment, setIsUploadingAttachment] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTodos = useCallback(async () => {
    if (!client.isAvailable()) {
      applyTodoState(simulatedTodoState, setBoard, setCards, setCounts);
      setUnreadSummary(emptyUnreadSummary);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const state = await client.todos.readState();
      applyTodoState(state, setBoard, setCards, setCounts);
      const unread = await client.todos.getUnreadCommentSummary();
      setUnreadSummary(unread);
    } catch (err) {
      setError(`读取待办失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, [client]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void refreshTodos();
    }, 0);

    return () => {
      window.clearTimeout(timer);
    };
  }, [refreshTodos]);

  useEffect(() => {
    if (!client.isAvailable()) return undefined;
    const unsubCounts = client.todos.onCountsUpdated(nextCounts => {
      setCounts(nextCounts);
    });
    const unsubState = client.todos.onUpdated(nextState => {
      applyTodoState(nextState, setBoard, setCards, setCounts);
    });
    const unsubSnipError = client.todos.onSnipError?.(payload => {
      if (payload?.error) {
        setError(`截屏添加到待办失败: ${payload.error}`);
      }
    });
    const unsubUnread = client.todos.onUnreadCommentsUpdated?.(summary => {
      setUnreadSummary(summary || emptyUnreadSummary);
    });
    const unsubNotif = client.todos.onCommentNotification?.(payload => {
      if (payload?.cardId) {
        setLatestCommentNotification(payload);
      }
    });
    const unsubAccount = client.accounts.onSessionChanged(() => {
      setBoard(null);
      setCards([]);
      setCounts({ total: 0, open: 0, done: 0 });
      setUnreadSummary(emptyUnreadSummary);
      setLatestCommentNotification(null);
      void refreshTodos();
    });
    return () => {
      unsubCounts?.();
      unsubState?.();
      unsubSnipError?.();
      unsubUnread?.();
      unsubNotif?.();
      unsubAccount?.();
    };
  }, [client, refreshTodos]);

  const cardsByColumn = useMemo(() => {
    if (!board) return {};

    const activeCards = cards.filter(card => !card.archived && !card.deletedAt);
    const grouped: Record<string, TodoCard[]> = {};

    for (const column of board.columns) {
      const columnCards = activeCards.filter(card => card.columnId === column.id);
      const hasExplicitPositions = columnCards.every(card => Boolean(card.position));
      if (hasExplicitPositions) {
        grouped[column.id] = [...columnCards].sort(compareCardsByPosition);
      } else {
        const cardMap = new Map(columnCards.map(card => [card.id, card]));
        const ordered = (board.cardOrder[column.id] || [])
          .map(cardId => cardMap.get(cardId))
          .filter((card): card is TodoCard => Boolean(card));
        const missing = columnCards.filter(card => !ordered.some(item => item.id === card.id));
        grouped[column.id] = [...ordered, ...missing];
      }
    }

    return grouped;
  }, [board, cards]);

  const createCard = useCallback(async (payload: CreateTodoCardInput): Promise<TodoCard | null> => {
    if (!client.isAvailable()) return null;

    try {
      const state = await client.todos.createCard(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
      return state.cards[state.cards.length - 1] || null;
    } catch (err) {
      setError(`创建待办失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }, [client]);

  const updateCard = useCallback(async (payload: UpdateTodoCardInput) => {
    if (!client.isAvailable()) return false;

    try {
      const state = await client.todos.updateCard(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
      return true;
    } catch (err) {
      setError(`保存待办失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [client]);

  const deleteCard = useCallback(async (cardId: string): Promise<boolean> => {
    if (!client.isAvailable()) return false;

    try {
      const state = await client.todos.deleteCard(cardId);
      applyTodoState(state, setBoard, setCards, setCounts);
      return true;
    } catch (err) {
      setError(`删除待办失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [client]);

  const moveCard = useCallback(async (payload: MoveTodoCardInput) => {
    if (!client.isAvailable()) return;

    try {
      const state = await client.todos.moveCard(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
    } catch (err) {
      setError(`移动待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [client]);

  const getCardDetail = useCallback(async (cardId: string): Promise<TodoCard | null> => {
    if (!client.isAvailable()) {
      return cards.find(card => card.id === cardId) || null;
    }
    try {
      return await client.todos.getCardDetail(cardId);
    } catch (err) {
      setError(`读取卡片详情失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  }, [cards, client]);

  const addAttachmentBytes = useCallback(async (payload: AddTodoAttachmentBytesInput) => {
    if (!client.isAvailable()) return false;
    setIsUploadingAttachment(true);
    setError(null);
    try {
      const state = await client.todos.addAttachmentBytes(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
      return true;
    } catch (err) {
      setError(`保存图片附件失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [client]);

  const pickAndAddAttachment = useCallback(async (cardId: string, subtaskId?: string | null) => {
    if (!client.isAvailable()) return false;
    setIsUploadingAttachment(true);
    setError(null);
    try {
      const result = await client.todos.pickAndAddAttachment(cardId, subtaskId);
      if (!result.canceled && result.state) {
        applyTodoState(result.state, setBoard, setCards, setCounts);
        return true;
      }
      return false;
    } catch (err) {
      setError(`添加本地图片失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    } finally {
      setIsUploadingAttachment(false);
    }
  }, [client]);

  const deleteAttachment = useCallback(async (
    cardId: string,
    attachmentId: string,
    subtaskId?: string | null
  ) => {
    if (!client.isAvailable()) return false;
    setError(null);
    try {
      const state = await client.todos.deleteAttachment({ cardId, subtaskId, attachmentId });
      applyTodoState(state, setBoard, setCards, setCounts);
      return true;
    } catch (err) {
      setError(`删除图片附件失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [client]);

  const setCardCover = useCallback(async (cardId: string, attachmentId: string | null) => {
    if (!client.isAvailable()) return false;
    setError(null);
    try {
      const state = await client.todos.setCardCover({ cardId, attachmentId });
      applyTodoState(state, setBoard, setCards, setCounts);
      return true;
    } catch (err) {
      setError(`更新封面失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [client]);

  const updateAttachmentMeta = useCallback(async (payload: UpdateTodoAttachmentMetaInput) => {
    if (!client.isAvailable()) return false;
    setError(null);
    try {
      const state = await client.todos.updateAttachmentMeta(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
      return true;
    } catch (err) {
      setError(`更新附件预览设置失败: ${err instanceof Error ? err.message : String(err)}`);
      return false;
    }
  }, [client]);

  const startSnipForCard = useCallback(async (cardId: string, subtaskId?: string | null) => {
    if (!client.isAvailable()) return;
    setError(null);
    try {
      await client.todos.startSnipForCard(cardId, subtaskId);
    } catch (err) {
      setError(`启动截图失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [client]);

  const listCardComments = useCallback(async (cardId: string): Promise<TodoCardComment[]> => {
    if (!client.isAvailable()) return [];
    return client.todos.listCardComments(cardId);
  }, [client]);

  const addCardComment = useCallback(async (payload: AddTodoCommentInput): Promise<TodoCardComment> => {
    if (!client.isAvailable()) {
      throw new Error('当前运行在预览模式，无法发表评论');
    }
    return client.todos.addCardComment(payload);
  }, [client]);

  const deleteCardComment = useCallback(async (
    payload: DeleteTodoCommentInput
  ): Promise<TodoCardComment[]> => {
    if (!client.isAvailable()) {
      throw new Error('当前运行在预览模式，无法删除评论');
    }
    return client.todos.deleteCardComment(payload);
  }, [client]);

  const listWorkspaceMembers = useCallback(async (
    workspaceId?: string
  ): Promise<WorkspaceMemberInfo[]> => {
    if (!client.isAvailable() || !client.accounts.listWorkspaceMembers) return [];
    return client.accounts.listWorkspaceMembers(workspaceId);
  }, [client]);

  const getAccountSession = useCallback(async (): Promise<AccountSessionSnapshot | null> => {
    if (!client.isAvailable()) return null;
    return client.accounts.getSession();
  }, [client]);

  const onCommentsUpdated = useCallback((callback: (payload: { cardIds: string[] }) => void) => {
    if (!client.isAvailable() || !client.todos.onCommentsUpdated) {
      return () => {};
    }
    return client.todos.onCommentsUpdated(callback) || (() => {});
  }, [client]);

  const markCardCommentsRead = useCallback(async (cardId: string) => {
    if (!client.isAvailable()) return;
    try {
      const next = await client.todos.markCardCommentsRead(cardId);
      setUnreadSummary(next);
    } catch (err) {
      setError(`标记评论已读失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [client]);

  const markAllCommentsRead = useCallback(async () => {
    if (!client.isAvailable()) return;
    try {
      const next = await client.todos.markAllCommentsRead();
      setUnreadSummary(next);
    } catch (err) {
      setError(`全部标为已读失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  }, [client]);

  const consumePendingFocusCard = useCallback(async () => {
    if (!client.isAvailable() || !client.todos.consumePendingFocusCard) return null;
    try {
      return await client.todos.consumePendingFocusCard();
    } catch (err) {
      console.error('[TIDYDESK] Failed to consume pending focus card:', err);
      return null;
    }
  }, [client]);

  const onFocusCardRequested = useCallback((callback: (cardId: string) => void) => {
    if (!client.isAvailable() || !client.todos.onFocusCardRequested) {
      return () => {};
    }
    return client.todos.onFocusCardRequested(payload => {
      if (payload?.cardId) callback(payload.cardId);
    }) || (() => {});
  }, [client]);

  const dismissCommentNotification = useCallback(() => {
    setLatestCommentNotification(null);
  }, []);

  const clearError = useCallback(() => setError(null), []);

  const contextValue = useMemo(
    () => ({
      board,
      cards,
      counts,
      unreadSummary,
      latestCommentNotification,
      isLoading,
      isUploadingAttachment,
      error,
      cardsByColumn,
      refreshTodos,
      createCard,
      updateCard,
      deleteCard,
      moveCard,
      getCardDetail,
      addAttachmentBytes,
      pickAndAddAttachment,
      deleteAttachment,
      setCardCover,
      updateAttachmentMeta,
      startSnipForCard,
      listCardComments,
      addCardComment,
      deleteCardComment,
      markCardCommentsRead,
      markAllCommentsRead,
      consumePendingFocusCard,
      onFocusCardRequested,
      dismissCommentNotification,
      listWorkspaceMembers,
      getAccountSession,
      onCommentsUpdated,
      clearError
    }),
    [
      board,
      cards,
      counts,
      unreadSummary,
      latestCommentNotification,
      isLoading,
      isUploadingAttachment,
      error,
      cardsByColumn,
      refreshTodos,
      createCard,
      updateCard,
      deleteCard,
      moveCard,
      getCardDetail,
      addAttachmentBytes,
      pickAndAddAttachment,
      deleteAttachment,
      setCardCover,
      updateAttachmentMeta,
      startSnipForCard,
      listCardComments,
      addCardComment,
      deleteCardComment,
      markCardCommentsRead,
      markAllCommentsRead,
      consumePendingFocusCard,
      onFocusCardRequested,
      dismissCommentNotification,
      listWorkspaceMembers,
      getAccountSession,
      onCommentsUpdated,
      clearError
    ]
  );

  return (
    <TodoContext.Provider value={contextValue}>
      {children}
    </TodoContext.Provider>
  );
};

export const useTodos = () => {
  const context = useContext(TodoContext);
  if (!context) throw new Error('useTodos must be used within TodoProvider');
  return context;
};
