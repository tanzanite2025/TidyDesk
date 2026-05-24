import React, { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { nativeClient } from '../native/native-client';
import { CreateTodoCardInput, MoveTodoCardInput, TodoBoard, TodoCard, TodoCounts, TodoState, UpdateTodoCardInput } from '../types/todo';

const nativeApi = nativeClient;

interface TodoContextType {
  board: TodoBoard | null;
  cards: TodoCard[];
  counts: TodoCounts;
  isLoading: boolean;
  error: string | null;
  cardsByColumn: Record<string, TodoCard[]>;
  refreshTodos: () => Promise<void>;
  createCard: (payload: CreateTodoCardInput) => Promise<TodoCard | null>;
  updateCard: (payload: UpdateTodoCardInput) => Promise<void>;
  deleteCard: (cardId: string) => Promise<void>;
  moveCard: (payload: MoveTodoCardInput) => Promise<void>;
  clearError: () => void;
}

const TodoContext = createContext<TodoContextType | undefined>(undefined);

const emptyCounts: TodoCounts = { total: 0, open: 0, done: 0 };
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
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    },
    {
      id: 'sim-card-3',
      boardId: 'sim-board',
      columnId: 'done',
      title: 'Rail 手柄',
      content: '- [x] 三个竖向入口',
      tags: [],
      archived: false,
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString()
    }
  ],
  counts: { total: 3, open: 2, done: 1 }
};

function applyTodoState(state: TodoState, setBoard: (board: TodoBoard | null) => void, setCards: (cards: TodoCard[]) => void, setCounts: (counts: TodoCounts) => void) {
  setBoard(state.boards.find(board => board.id === state.activeBoardId) || state.boards[0] || null);
  setCards(state.cards || []);
  setCounts(state.counts || emptyCounts);
}

export const TodoProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [board, setBoard] = useState<TodoBoard | null>(null);
  const [cards, setCards] = useState<TodoCard[]>([]);
  const [counts, setCounts] = useState<TodoCounts>(emptyCounts);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refreshTodos = useCallback(async () => {
    if (!nativeApi.isAvailable()) {
      applyTodoState(simulatedTodoState, setBoard, setCards, setCounts);
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const state = await nativeApi.todos.readState();
      applyTodoState(state, setBoard, setCards, setCounts);
    } catch (err) {
      setError(`读取待办失败: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshTodos();

    if (!nativeApi.isAvailable()) return undefined;
    return nativeApi.todos.onCountsUpdated(nextCounts => {
      setCounts(nextCounts);
    });
  }, [refreshTodos]);

  const cardsByColumn = useMemo(() => {
    if (!board) return {};

    const cardMap = new Map(cards.filter(card => !card.archived).map(card => [card.id, card]));
    const grouped: Record<string, TodoCard[]> = {};

    for (const column of board.columns) {
      const ordered = (board.cardOrder[column.id] || [])
        .map(cardId => cardMap.get(cardId))
        .filter((card): card is TodoCard => Boolean(card));

      const missing = cards.filter(card => !card.archived && card.columnId === column.id && !ordered.some(item => item.id === card.id));
      grouped[column.id] = [...ordered, ...missing];
    }

    return grouped;
  }, [board, cards]);

  const createCard = async (payload: CreateTodoCardInput): Promise<TodoCard | null> => {
    if (!nativeApi.isAvailable()) return null;

    try {
      const state = await nativeApi.todos.createCard(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
      return state.cards[state.cards.length - 1] || null;
    } catch (err) {
      setError(`创建待办失败: ${err instanceof Error ? err.message : String(err)}`);
      return null;
    }
  };

  const updateCard = async (payload: UpdateTodoCardInput) => {
    if (!nativeApi.isAvailable()) return;

    try {
      const state = await nativeApi.todos.updateCard(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
    } catch (err) {
      setError(`保存待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const deleteCard = async (cardId: string) => {
    if (!nativeApi.isAvailable()) return;

    try {
      const state = await nativeApi.todos.deleteCard(cardId);
      applyTodoState(state, setBoard, setCards, setCounts);
    } catch (err) {
      setError(`删除待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const moveCard = async (payload: MoveTodoCardInput) => {
    if (!nativeApi.isAvailable()) return;

    try {
      const state = await nativeApi.todos.moveCard(payload);
      applyTodoState(state, setBoard, setCards, setCounts);
    } catch (err) {
      setError(`移动待办失败: ${err instanceof Error ? err.message : String(err)}`);
    }
  };

  const clearError = () => setError(null);

  return (
    <TodoContext.Provider value={{ board, cards, counts, isLoading, error, cardsByColumn, refreshTodos, createCard, updateCard, deleteCard, moveCard, clearError }}>
      {children}
    </TodoContext.Provider>
  );
};

export const useTodos = () => {
  const context = useContext(TodoContext);
  if (!context) throw new Error('useTodos must be used within TodoProvider');
  return context;
};
