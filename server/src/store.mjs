import fs from 'node:fs';
import path from 'node:path';
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

function atomicWriteJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(data, null, 2), 'utf8');
  fs.renameSync(tmpPath, filePath);
}

export function createSyncStore(dataDir) {
  const rootDir = path.resolve(dataDir);
  const dbPath = path.join(rootDir, 'sync-db.json');
  const blobsDir = path.join(rootDir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });

  let db = fs.existsSync(dbPath)
    ? JSON.parse(fs.readFileSync(dbPath, 'utf8'))
    : createInitialDb();

  function save() {
    atomicWriteJson(dbPath, db);
  }

  function ensureWorkspaceAccess(userId, workspaceId = 'default') {
    if (!db.workspaces[workspaceId]) {
      db.workspaces[workspaceId] = {
        id: workspaceId,
        title: workspaceId,
        members: { [userId]: 'owner' }
      };
      save();
      return 'owner';
    }
    const ws = db.workspaces[workspaceId];
    if (!ws.members[userId]) {
      // First visit to shared workspace in MVP defaults to 'member' unless explicitly set (e.g. viewer in tests)
      ws.members[userId] = 'member';
      save();
    }
    return ws.members[userId];
  }

  function setWorkspaceRole(workspaceId, userId, role) {
    if (!db.workspaces[workspaceId]) {
      db.workspaces[workspaceId] = { id: workspaceId, title: workspaceId, members: {} };
    }
    db.workspaces[workspaceId].members[userId] = role;
    save();
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
    presignMedia,
    writeBlob,
    readBlob,
    pushEntries,
    pullSince
  };
}
