import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, getPrivateWorkspaceOwner, sanitizeWorkspaceId } from './fs_utils.mjs';
import { mergeCardOnServer } from './merge.mjs';

const SAFE_KEY_RE = /^[a-zA-Z0-9._-]{1,128}$/;

function createInitialDb() {
  return {
    version: 1,
    cursor: 0,
    workspaces: {
      default: {
        id: 'default',
        title: '默认协同工作区',
        members: {}
      }
    },
    cards: {},
    quickNotes: {},
    mediaBySha256: {},
    events: []
  };
}

export function createSyncStore(dataDir) {
  const rootDir = path.resolve(dataDir);
  const dbPath = path.join(rootDir, 'sync-db.json');
  const blobsDir = path.join(rootDir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });

  let db = createInitialDb();
  let lastStamp = '';

  function readStamp() {
    try {
      const st = fs.statSync(dbPath);
      return `${st.mtimeMs}:${st.size}:${st.ino}`;
    } catch (err) {
      if (err && err.code === 'ENOENT') return 'missing';
      throw err;
    }
  }

  function reloadIfChanged() {
    const stamp = readStamp();
    if (stamp === lastStamp) return;
    if (stamp === 'missing') {
      db = createInitialDb();
      lastStamp = stamp;
      return;
    }
    db = JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    lastStamp = stamp;
  }

  reloadIfChanged();

  function save() {
    atomicWriteJson(dbPath, db);
    lastStamp = readStamp();
  }

  function ensureWorkspaceAccess(userId, workspaceId = 'default') {
    reloadIfChanged();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    const privateOwner = getPrivateWorkspaceOwner(safeWsId);
    if (privateOwner && privateOwner !== userId) {
      const err = new Error(`私人工作区 "${safeWsId}" 仅限创建者本人访问`);
      err.status = 403;
      throw err;
    }

    if (!db.workspaces[safeWsId]) {
      db.workspaces[safeWsId] = {
        id: safeWsId,
        title: privateOwner ? `${privateOwner} 私人空间` : safeWsId,
        members: { [userId]: 'owner' }
      };
      save();
      return 'owner';
    }
    const ws = db.workspaces[safeWsId];
    if (!ws.members[userId]) {
      // First visit to shared workspace in MVP defaults to 'member' unless explicitly set (e.g. viewer in tests)
      ws.members[userId] = privateOwner === userId ? 'owner' : 'member';
      save();
    }
    return ws.members[userId];
  }

  function setWorkspaceRole(workspaceId, userId, role) {
    reloadIfChanged();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    if (!db.workspaces[safeWsId]) {
      db.workspaces[safeWsId] = { id: safeWsId, title: safeWsId, members: {} };
    }
    db.workspaces[safeWsId].members[userId] = role;
    save();
  }

  function listWorkspacesForUser(userId) {
    reloadIfChanged();
    const results = new Map();
    const defaultWs = db.workspaces.default;
    results.set('default', {
      workspaceId: 'default',
      title: defaultWs?.title || '默认协同工作区',
      role: defaultWs?.members?.[userId] || 'member',
      isPrivate: false
    });

    const privateId = `private:${userId}`;
    const privateWs = db.workspaces[privateId];
    results.set(privateId, {
      workspaceId: privateId,
      title: privateWs?.title || '个人私有空间',
      role: privateWs?.members?.[userId] || 'owner',
      isPrivate: true
    });

    for (const [id, ws] of Object.entries(db.workspaces)) {
      if (results.has(id)) continue;
      const privateOwner = getPrivateWorkspaceOwner(id);
      if (privateOwner && privateOwner !== userId) continue;
      if (ws?.members?.[userId]) {
        results.set(id, {
          workspaceId: id,
          title: ws.title || id,
          role: ws.members[userId],
          isPrivate: Boolean(privateOwner)
        });
      }
    }
    return Array.from(results.values());
  }

  function safeBlobPath(kind, key) {
    if ((kind !== 'thumb' && kind !== 'original') || !SAFE_KEY_RE.test(key) || key.startsWith('.')) {
      return null;
    }
    const target = path.resolve(blobsDir, kind, key);
    const parent = path.resolve(blobsDir, kind);
    if (!target.startsWith(parent + path.sep)) return null;
    return target;
  }

  function presignMedia({ sha256, mimeType }) {
    if (!sha256 || !/^[a-fA-F0-9]{64}$/.test(sha256)) {
      throw new Error('Invalid sha256 digest');
    }
    const lowerSha = sha256.toLowerCase();
    const ext =
      mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    const thumbKey = `thumb_${lowerSha}.png`;
    const originalKey = `orig_${lowerSha}.${ext}`;

    const thumbPath = safeBlobPath('thumb', thumbKey);
    const origPath = safeBlobPath('original', originalKey);
    const existing = db.mediaBySha256[lowerSha];
    const deduplicated = Boolean(
      existing &&
        thumbPath &&
        origPath &&
        fs.existsSync(thumbPath) &&
        fs.existsSync(origPath)
    );

    return {
      deduplicated,
      thumbKey,
      originalKey,
      thumbUploadPath: `/api/v1/media/blob/thumb/${thumbKey}`,
      originalUploadPath: `/api/v1/media/blob/original/${originalKey}`
    };
  }

  function writeBlob({ kind, key, buffer, sha256 }) {
    const target = safeBlobPath(kind, key);
    if (!target) {
      throw new Error('Invalid media blob key');
    }
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const tmpPath = `${target}.${process.pid}.${Date.now()}.tmp`;
    fs.writeFileSync(tmpPath, buffer);
    fs.renameSync(tmpPath, target);

    if (kind === 'original' && sha256 && /^[a-fA-F0-9]{64}$/.test(sha256)) {
      const lower = sha256.toLowerCase();
      db.mediaBySha256[lower] = {
        originalKey: key,
        sizeBytes: buffer.length,
        uploadedAt: String(Date.now())
      };
      save();
    }
  }

  function readBlob({ kind, key }) {
    const target = safeBlobPath(kind, key);
    if (!target || !fs.existsSync(target)) return null;
    return fs.readFileSync(target);
  }

  function appendEvent(entityKind, entityId, operation, workspaceId) {
    db.cursor += 1;
    db.events.push({
      seq: db.cursor,
      workspaceId,
      entityKind,
      entityId,
      operation,
      at: String(Date.now())
    });
    return db.cursor;
  }

  function pushEntries({ workspaceId = 'default', actorId, entries = [] }) {
    const acked = [];
    const conflicts = [];
    const mergedCards = [];

    for (const entry of entries) {
      const kind = entry.entityKind;
      const entityId = entry.entityId;
      const op = entry.operation;
      const payload = entry.payload || {};

      if (kind === 'card') {
        const existing = db.cards[entityId] || null;
        if (op === 'delete') {
          const { card } = mergeCardOnServer(
            existing,
            { ...payload, id: entityId, deletedAt: payload.deletedAt || String(Date.now()) },
            actorId
          );
          card.workspaceId = workspaceId;
          db.cards[entityId] = card;
          appendEvent('card', entityId, 'delete', workspaceId);
          acked.push({ entityKind: 'card', entityId, revision: card.revision });
          mergedCards.push(card);
        } else {
          const { card, conflict } = mergeCardOnServer(
            existing,
            { ...payload, id: entityId },
            actorId
          );
          card.workspaceId = workspaceId;
          db.cards[entityId] = card;
          appendEvent('card', entityId, 'upsert', workspaceId);
          acked.push({ entityKind: 'card', entityId, revision: card.revision });
          mergedCards.push(card);
          if (conflict) conflicts.push(conflict);
        }
      } else if (kind === 'attachment') {
        // Attachment metadata is already nested in Card snapshots, and binary blobs are uploaded via presign.
        acked.push({ entityKind: 'attachment', entityId });
      } else if (kind === 'quickNote') {
        if (op === 'delete') {
          db.quickNotes[entityId] = {
            id: entityId,
            deletedAt: payload.deletedAt || String(Date.now()),
            updatedAt: String(Date.now()),
            workspaceId
          };
          appendEvent('quickNote', entityId, 'delete', workspaceId);
        } else {
          db.quickNotes[entityId] = {
            ...payload,
            id: entityId,
            deletedAt: null,
            workspaceId
          };
          appendEvent('quickNote', entityId, 'upsert', workspaceId);
        }
        acked.push({ entityKind: 'quickNote', entityId });
      } else if (kind === 'board') {
        acked.push({ entityKind: 'board', entityId });
      }
    }

    save();
    return {
      nextCursor: String(db.cursor),
      acked,
      mergedCards,
      conflicts
    };
  }

  function pullSince({ workspaceId = 'default', cursor = null }) {
    const sinceSeq = cursor ? Number(cursor) || 0 : 0;
    const latestSeqByEntity = new Map();

    for (const ev of db.events) {
      if (ev.workspaceId !== workspaceId || ev.seq <= sinceSeq) continue;
      latestSeqByEntity.set(`${ev.entityKind}:${ev.entityId}`, ev);
    }

    const cards = [];
    const removedCardIds = [];
    const quickNotes = [];
    const removedQuickNoteIds = [];

    for (const ev of latestSeqByEntity.values()) {
      if (ev.entityKind === 'card') {
        const card = db.cards[ev.entityId];
        if (!card) continue;
        if (card.deletedAt) {
          removedCardIds.push(card.id);
        } else {
          cards.push(card);
        }
      } else if (ev.entityKind === 'quickNote') {
        const note = db.quickNotes[ev.entityId];
        if (!note) continue;
        if (note.deletedAt) {
          removedQuickNoteIds.push(note.id);
        } else {
          quickNotes.push(note);
        }
      }
    }

    return {
      nextCursor: String(db.cursor),
      cards,
      removedCardIds,
      quickNotes,
      removedQuickNoteIds
    };
  }

  return {
    ensureWorkspaceAccess,
    setWorkspaceRole,
    listWorkspacesForUser,
    presignMedia,
    writeBlob,
    readBlob,
    pushEntries,
    pullSince
  };
}
