const fs = require('fs');
const path = require('path');

const defaultBoardId = 'default-board';
const defaultColumns = [
  { id: 'todo', title: '待处理' },
  { id: 'doing', title: '进行中' },
  { id: 'done', title: '已完成' }
];

function createTodoService({ app }) {
  function getRoot() {
    return path.join(app.getPath('userData'), 'todos');
  }

  function getCardsRoot() {
    return path.join(getRoot(), 'cards');
  }

  function getIndexPath() {
    return path.join(getRoot(), 'boards.json');
  }

  function ensureDir(dirPath) {
    fs.mkdirSync(dirPath, { recursive: true });
  }

  function isPathInside(childPath, parentPath) {
    const relative = path.relative(path.resolve(parentPath), path.resolve(childPath));
    return relative === '' || (!!relative && !relative.startsWith('..') && !path.isAbsolute(relative));
  }

  function createId(prefix) {
    return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
  }

  function safeTitle(title, fallback = '未命名待办') {
    const normalized = String(title || '').replace(/\s+/g, ' ').trim();
    return (normalized || fallback).slice(0, 120);
  }

  function createDefaultIndex(now = new Date().toISOString()) {
    return {
      version: 1,
      activeBoardId: defaultBoardId,
      boards: [{
        id: defaultBoardId,
        title: '待办',
        columns: defaultColumns,
        cardOrder: {
          todo: [],
          doing: [],
          done: []
        },
        createdAt: now,
        updatedAt: now
      }],
      cards: []
    };
  }

  function normalizeIndex(index) {
    const now = new Date().toISOString();
    const fallback = createDefaultIndex(now);
    const normalized = index && typeof index === 'object' ? index : fallback;
    const board = Array.isArray(normalized.boards) && normalized.boards[0]
      ? normalized.boards[0]
      : fallback.boards[0];

    board.id = board.id || defaultBoardId;
    board.title = safeTitle(board.title, '待办');
    board.columns = Array.isArray(board.columns) && board.columns.length > 0
      ? board.columns
      : defaultColumns;
    board.cardOrder = board.cardOrder && typeof board.cardOrder === 'object' ? board.cardOrder : {};

    for (const column of board.columns) {
      if (!Array.isArray(board.cardOrder[column.id])) {
        board.cardOrder[column.id] = [];
      }
    }

    normalized.version = 1;
    normalized.activeBoardId = normalized.activeBoardId || board.id;
    normalized.boards = [board];
    normalized.cards = Array.isArray(normalized.cards) ? normalized.cards : [];

    const validColumnIds = new Set(board.columns.map(column => column.id));
    const cardIds = new Set();
    normalized.cards = normalized.cards
      .filter(card => card && typeof card.id === 'string')
      .map(card => {
        const columnId = validColumnIds.has(card.columnId) ? card.columnId : 'todo';
        cardIds.add(card.id);
        return {
          id: card.id,
          boardId: card.boardId || board.id,
          columnId,
          title: safeTitle(card.title),
          tags: Array.isArray(card.tags) ? card.tags.slice(0, 8) : [],
          archived: Boolean(card.archived),
          createdAt: card.createdAt || now,
          updatedAt: card.updatedAt || now
        };
      });

    for (const column of board.columns) {
      board.cardOrder[column.id] = board.cardOrder[column.id].filter(id => cardIds.has(id));
    }

    for (const card of normalized.cards) {
      if (!board.cardOrder[card.columnId].includes(card.id)) {
        board.cardOrder[card.columnId].push(card.id);
      }
    }

    return normalized;
  }

  function ensureStorage() {
    ensureDir(getRoot());
    ensureDir(getCardsRoot());

    const indexPath = getIndexPath();
    if (!fs.existsSync(indexPath)) {
      fs.writeFileSync(indexPath, JSON.stringify(createDefaultIndex(), null, 2), 'utf8');
    }
  }

  async function readIndex() {
    ensureStorage();

    try {
      const raw = await fs.promises.readFile(getIndexPath(), 'utf8');
      return normalizeIndex(JSON.parse(raw));
    } catch (err) {
      console.warn('[TIDYDESK] Failed to read todo index, recreating', err.message);
      const fallback = createDefaultIndex();
      await writeIndex(fallback);
      return fallback;
    }
  }

  async function writeIndex(index) {
    ensureStorage();
    await fs.promises.writeFile(getIndexPath(), JSON.stringify(normalizeIndex(index), null, 2), 'utf8');
  }

  function getCardPath(cardId) {
    const fileName = `${String(cardId).replace(/[^a-zA-Z0-9_-]/g, '_')}.md`;
    const targetPath = path.join(getCardsRoot(), fileName);
    if (!isPathInside(targetPath, getCardsRoot())) {
      throw new Error('Unsafe todo card path');
    }
    return targetPath;
  }

  async function readCardContent(cardId) {
    const cardPath = getCardPath(cardId);
    try {
      return await fs.promises.readFile(cardPath, 'utf8');
    } catch (err) {
      if (err.code === 'ENOENT') return '';
      throw err;
    }
  }

  async function writeCardContent(cardId, content) {
    await fs.promises.writeFile(getCardPath(cardId), String(content || ''), 'utf8');
  }

  function getCountsFromIndex(index) {
    const total = index.cards.filter(card => !card.archived).length;
    const open = index.cards.filter(card => !card.archived && card.columnId !== 'done').length;
    const done = index.cards.filter(card => !card.archived && card.columnId === 'done').length;
    return { total, open, done };
  }

  async function getState() {
    const index = await readIndex();
    const cards = await Promise.all(index.cards.map(async card => ({
      ...card,
      content: await readCardContent(card.id)
    })));

    return {
      activeBoardId: index.activeBoardId,
      boards: index.boards,
      cards,
      counts: getCountsFromIndex(index)
    };
  }

  async function getCounts() {
    const index = await readIndex();
    return getCountsFromIndex(index);
  }

  function removeCardFromOrders(board, cardId) {
    for (const column of board.columns) {
      board.cardOrder[column.id] = (board.cardOrder[column.id] || []).filter(id => id !== cardId);
    }
  }

  async function createCard(payload = {}) {
    const index = await readIndex();
    const board = index.boards[0];
    const validColumnIds = new Set(board.columns.map(column => column.id));
    const content = String(payload.content || '');
    const firstContentLine = content.split(/\r?\n/).find(line => line.trim());
    const title = safeTitle(payload.title || firstContentLine, '新待办');
    const columnId = validColumnIds.has(payload.columnId) ? payload.columnId : 'todo';
    const now = new Date().toISOString();
    const card = {
      id: createId('card'),
      boardId: board.id,
      columnId,
      title,
      tags: [],
      archived: false,
      createdAt: now,
      updatedAt: now
    };

    index.cards.push(card);
    board.cardOrder[columnId] = [card.id, ...(board.cardOrder[columnId] || [])];
    board.updatedAt = now;

    await writeCardContent(card.id, content);
    await writeIndex(index);
    return getState();
  }

  async function updateCard(payload = {}) {
    if (!payload.id || typeof payload.id !== 'string') {
      throw new Error('Missing todo card id');
    }

    const index = await readIndex();
    const board = index.boards[0];
    const card = index.cards.find(item => item.id === payload.id);
    if (!card) throw new Error('Todo card not found');

    const validColumnIds = new Set(board.columns.map(column => column.id));
    const now = new Date().toISOString();

    if (typeof payload.title === 'string') {
      card.title = safeTitle(payload.title);
    }
    if (typeof payload.columnId === 'string' && validColumnIds.has(payload.columnId) && payload.columnId !== card.columnId) {
      removeCardFromOrders(board, card.id);
      board.cardOrder[payload.columnId] = [card.id, ...(board.cardOrder[payload.columnId] || [])];
      card.columnId = payload.columnId;
    }
    if (Array.isArray(payload.tags)) {
      card.tags = payload.tags.map(tag => safeTitle(tag, '')).filter(Boolean).slice(0, 8);
    }
    if (typeof payload.archived === 'boolean') {
      card.archived = payload.archived;
    }
    if (typeof payload.content === 'string') {
      await writeCardContent(card.id, payload.content);
    }

    card.updatedAt = now;
    board.updatedAt = now;

    await writeIndex(index);
    return getState();
  }

  async function deleteCard(cardId) {
    const index = await readIndex();
    const board = index.boards[0];
    index.cards = index.cards.filter(card => card.id !== cardId);
    removeCardFromOrders(board, cardId);
    board.updatedAt = new Date().toISOString();

    try {
      await fs.promises.unlink(getCardPath(cardId));
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }

    await writeIndex(index);
    return getState();
  }

  async function moveCard(payload = {}) {
    if (!payload.id || typeof payload.id !== 'string') throw new Error('Missing todo card id');
    if (!payload.columnId || typeof payload.columnId !== 'string') throw new Error('Missing todo column id');

    const index = await readIndex();
    const board = index.boards[0];
    const card = index.cards.find(item => item.id === payload.id);
    if (!card) throw new Error('Todo card not found');

    const column = board.columns.find(item => item.id === payload.columnId);
    if (!column) throw new Error('Todo column not found');

    removeCardFromOrders(board, card.id);
    const order = board.cardOrder[column.id] || [];
    const beforeIndex = payload.beforeId ? order.indexOf(payload.beforeId) : -1;
    if (beforeIndex >= 0) {
      order.splice(beforeIndex, 0, card.id);
    } else {
      order.push(card.id);
    }

    board.cardOrder[column.id] = order;
    card.columnId = column.id;
    card.updatedAt = new Date().toISOString();
    board.updatedAt = card.updatedAt;

    await writeIndex(index);
    return getState();
  }

  return {
    ensureStorage,
    getState,
    getCounts,
    createCard,
    updateCard,
    deleteCard,
    moveCard
  };
}

module.exports = createTodoService;
