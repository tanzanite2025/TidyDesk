import fs from 'node:fs';
import path from 'node:path';
import { getPrivateWorkspaceOwner, sanitizeWorkspaceId } from './fs_utils.mjs';
import { mergeCardOnServer } from './merge.mjs';
import { openSyncSqliteDatabase, withImmediateTransaction, withReadTransaction } from './sqlite_db.mjs';
import {
  archiveLegacyJsonFile,
  extractLegacyScopedRecords,
  extractShaFromBlobKey,
  readBlobFromDisk,
  safeBlobPath,
  writeBlobFileAtomic
} from './storage_shared.mjs';

function migrateLegacySyncJsonIfNeeded(dataDir, db) {
  const alreadyMigrated = db
    .prepare("SELECT value FROM sync_meta WHERE key = 'migrated_json_sync'")
    .get();
  if (alreadyMigrated) return;

  const legacyPath = path.join(path.resolve(dataDir), 'sync-db.json');
  if (!fs.existsSync(legacyPath)) {
    db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('migrated_json_sync', 'none')").run();
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  withImmediateTransaction(db, () => {
    const existingCount = db
      .prepare('SELECT (SELECT COUNT(*) FROM cards) + (SELECT COUNT(*) FROM quick_notes) + (SELECT COUNT(*) FROM sync_events) AS n')
      .get().n;
    const existingCursor = Number(
      db.prepare("SELECT value FROM sync_meta WHERE key = 'cursor'").get()?.value || 0
    );

    if (existingCount === 0 && existingCursor === 0) {
      const legacyCursor = Number(parsed?.cursor || 0);
      db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('cursor', ?)").run(
        String(Number.isFinite(legacyCursor) ? legacyCursor : 0)
      );

      const upsertWs = db.prepare('INSERT OR REPLACE INTO workspaces (id, title) VALUES (?, ?)');
      const upsertMember = db.prepare(
        'INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)'
      );
      for (const [wsId, ws] of Object.entries(parsed?.workspaces || {})) {
        const safeWsId = sanitizeWorkspaceId(wsId, 'default');
        upsertWs.run(safeWsId, String(ws?.title || safeWsId));
        for (const [userId, role] of Object.entries(ws?.members || {})) {
          upsertMember.run(safeWsId, userId, String(role || 'member'));
        }
      }

      const cardEntries = extractLegacyScopedRecords(parsed?.cards);
      const insertCard = db.prepare(
        'INSERT OR REPLACE INTO cards (workspace_id, id, updated_at, deleted_at, payload_json) VALUES (?, ?, ?, ?, ?)'
      );
      for (const { workspaceId, entityId, record } of cardEntries) {
        const normalized = { ...record, id: entityId, workspaceId };
        insertCard.run(
          workspaceId,
          entityId,
          String(normalized.updatedAt || ''),
          normalized.deletedAt ? String(normalized.deletedAt) : null,
          JSON.stringify(normalized)
        );
      }

      const noteEntries = extractLegacyScopedRecords(parsed?.quickNotes);
      const insertNote = db.prepare(
        'INSERT OR REPLACE INTO quick_notes (workspace_id, id, updated_at, deleted_at, payload_json) VALUES (?, ?, ?, ?, ?)'
      );
      for (const { workspaceId, entityId, record } of noteEntries) {
        const normalized = { ...record, id: entityId, workspaceId };
        insertNote.run(
          workspaceId,
          entityId,
          String(normalized.updatedAt || ''),
          normalized.deletedAt ? String(normalized.deletedAt) : null,
          JSON.stringify(normalized)
        );
      }

      const insertMedia = db.prepare(
        `INSERT OR REPLACE INTO media_meta
         (sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const [sha, meta] of Object.entries(parsed?.mediaBySha256 || {})) {
        const workspaces = Array.isArray(meta?.workspaces) ? meta.workspaces : ['default'];
        insertMedia.run(
          sha.toLowerCase(),
          meta?.originalKey ? String(meta.originalKey) : null,
          meta?.thumbKey ? String(meta.thumbKey) : null,
          meta?.sizeBytes !== undefined ? Number(meta.sizeBytes) : null,
          meta?.uploadedAt ? String(meta.uploadedAt) : null,
          JSON.stringify(workspaces)
        );
      }

      const insertEvent = db.prepare(
        `INSERT OR REPLACE INTO sync_events
         (seq, workspace_id, entity_kind, entity_id, operation, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      );
      for (const ev of parsed?.events || []) {
        if (!ev || typeof ev.seq !== 'number') continue;
        insertEvent.run(
          ev.seq,
          String(ev.workspaceId || 'default'),
          String(ev.entityKind || ''),
          String(ev.entityId || ''),
          String(ev.operation || 'upsert'),
          String(ev.at || Date.now())
        );
      }
    }

    db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('migrated_json_sync', ?)").run(
      String(Date.now())
    );
  });

  archiveLegacyJsonFile(legacyPath);
}

export function createSqliteSyncStore(dataDir, { dbHandle = null } = {}) {
  const rootDir = path.resolve(dataDir);
  const blobsDir = path.join(rootDir, 'blobs');
  fs.mkdirSync(blobsDir, { recursive: true });

  const ownsHandle = !dbHandle;
  const handle = dbHandle || openSyncSqliteDatabase(rootDir);
  const { db } = handle;
  migrateLegacySyncJsonIfNeeded(rootDir, db);

  const stmtGetWorkspaceMember = db.prepare(
    'SELECT role FROM workspace_members WHERE workspace_id = ? AND user_id = ?'
  );
  const stmtGetWorkspace = db.prepare('SELECT id, title FROM workspaces WHERE id = ?');
  const stmtInsertWorkspaceIgnore = db.prepare(
    'INSERT OR IGNORE INTO workspaces (id, title) VALUES (?, ?)'
  );
  const stmtUpsertWorkspaceMember = db.prepare(
    'INSERT OR REPLACE INTO workspace_members (workspace_id, user_id, role) VALUES (?, ?, ?)'
  );
  const stmtListWorkspaces = db.prepare('SELECT id, title FROM workspaces');
  const stmtGetMemberRole = db.prepare(
    'SELECT workspace_id, role FROM workspace_members WHERE user_id = ?'
  );
  const stmtGetMedia = db.prepare(
    'SELECT sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json FROM media_meta WHERE sha256 = ?'
  );
  const stmtUpsertMedia = db.prepare(
    `INSERT OR REPLACE INTO media_meta
     (sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const stmtGetCursor = db.prepare("SELECT value FROM sync_meta WHERE key = 'cursor'");
  const stmtSetCursor = db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('cursor', ?)");
  const stmtInsertEvent = db.prepare(
    `INSERT INTO sync_events (seq, workspace_id, entity_kind, entity_id, operation, created_at)
     VALUES (?, ?, ?, ?, ?, ?)`
  );
  const stmtGetCard = db.prepare(
    'SELECT payload_json FROM cards WHERE workspace_id = ? AND id = ?'
  );
  const stmtUpsertCard = db.prepare(
    'INSERT OR REPLACE INTO cards (workspace_id, id, updated_at, deleted_at, payload_json) VALUES (?, ?, ?, ?, ?)'
  );
  const stmtGetQuickNote = db.prepare(
    'SELECT payload_json FROM quick_notes WHERE workspace_id = ? AND id = ?'
  );
  const stmtUpsertQuickNote = db.prepare(
    'INSERT OR REPLACE INTO quick_notes (workspace_id, id, updated_at, deleted_at, payload_json) VALUES (?, ?, ?, ?, ?)'
  );
  const stmtPullEvents = db.prepare(
    `SELECT entity_kind, entity_id, MAX(seq) AS max_seq
     FROM sync_events
     WHERE workspace_id = ? AND seq > ?
     GROUP BY entity_kind, entity_id
     ORDER BY max_seq ASC`
  );

  function ensureWorkspaceAccess(userId, workspaceId = 'default') {
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    const privateOwner = getPrivateWorkspaceOwner(safeWsId);
    if (privateOwner && privateOwner !== userId) {
      const err = new Error(`私人工作区 "${safeWsId}" 仅限创建者本人访问`);
      err.status = 403;
      throw err;
    }

    return withImmediateTransaction(db, () => {
      const ws = stmtGetWorkspace.get(safeWsId);
      if (!ws) {
        const title = privateOwner ? `${privateOwner} 私人空间` : safeWsId;
        stmtInsertWorkspaceIgnore.run(safeWsId, title);
        stmtUpsertWorkspaceMember.run(safeWsId, userId, 'owner');
        return 'owner';
      }
      const member = stmtGetWorkspaceMember.get(safeWsId, userId);
      if (!member) {
        const role = privateOwner === userId ? 'owner' : 'member';
        stmtUpsertWorkspaceMember.run(safeWsId, userId, role);
        return role;
      }
      return member.role;
    });
  }

  function setWorkspaceRole(workspaceId, userId, role) {
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    withImmediateTransaction(db, () => {
      stmtInsertWorkspaceIgnore.run(safeWsId, safeWsId);
      stmtUpsertWorkspaceMember.run(safeWsId, userId, role);
    });
  }

  function listWorkspacesForUser(userId) {
    return withReadTransaction(db, () => {
      const allWs = stmtListWorkspaces.all();
      const roleRows = stmtGetMemberRole.all(userId);
      const roleMap = new Map(roleRows.map(r => [r.workspace_id, r.role]));
      const wsMap = new Map(allWs.map(w => [w.id, w]));

      const results = new Map();
      const defaultWs = wsMap.get('default');
      results.set('default', {
        workspaceId: 'default',
        title: defaultWs?.title || '默认协同工作区',
        role: roleMap.get('default') || 'member',
        isPrivate: false
      });

      const privateId = `private:${userId}`;
      const privateWs = wsMap.get(privateId);
      results.set(privateId, {
        workspaceId: privateId,
        title: privateWs?.title || '个人私有空间',
        role: roleMap.get(privateId) || 'owner',
        isPrivate: true
      });

      for (const [id, ws] of wsMap.entries()) {
        if (results.has(id)) continue;
        const privateOwner = getPrivateWorkspaceOwner(id);
        if (privateOwner && privateOwner !== userId) continue;
        const role = roleMap.get(id);
        if (role) {
          results.set(id, {
            workspaceId: id,
            title: ws.title || id,
            role,
            isPrivate: Boolean(privateOwner)
          });
        }
      }
      return Array.from(results.values());
    });
  }

  function grantMediaWorkspace(sha256, workspaceId = 'default', patch = {}) {
    const lower = String(sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(lower)) return false;

    const prev = stmtGetMedia.get(lower);
    const currentWorkspaces = prev ? JSON.parse(prev.workspaces_json) : [];
    const nextWorkspaces = currentWorkspaces.includes(workspaceId)
      ? currentWorkspaces
      : [...currentWorkspaces, workspaceId];

    const originalKey = patch.originalKey !== undefined ? patch.originalKey : prev?.original_key || null;
    const thumbKey = patch.thumbKey !== undefined ? patch.thumbKey : prev?.thumb_key || null;
    const sizeBytes =
      patch.sizeBytes !== undefined ? Number(patch.sizeBytes) : prev?.size_bytes ?? null;
    const uploadedAt = patch.uploadedAt !== undefined ? String(patch.uploadedAt) : prev?.uploaded_at || null;

    stmtUpsertMedia.run(
      lower,
      originalKey,
      thumbKey,
      sizeBytes,
      uploadedAt,
      JSON.stringify(nextWorkspaces)
    );
    return true;
  }

  function presignMedia({ sha256, mimeType, workspaceId = 'default' }) {
    if (!sha256 || !/^[a-fA-F0-9]{64}$/.test(sha256)) {
      throw new Error('Invalid sha256 digest');
    }
    const lowerSha = sha256.toLowerCase();
    const ext =
      mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    const thumbKey = `thumb_${lowerSha}.png`;
    const originalKey = `orig_${lowerSha}.${ext}`;

    const thumbPath = safeBlobPath(blobsDir, 'thumb', thumbKey);
    const origPath = safeBlobPath(blobsDir, 'original', originalKey);
    const existing = stmtGetMedia.get(lowerSha);
    const deduplicated = Boolean(
      existing &&
        thumbPath &&
        origPath &&
        fs.existsSync(thumbPath) &&
        fs.existsSync(origPath)
    );
    if (deduplicated) {
      withImmediateTransaction(db, () => {
        grantMediaWorkspace(lowerSha, workspaceId);
      });
    }

    return {
      deduplicated,
      thumbKey,
      originalKey,
      thumbUploadPath: `/api/v1/media/blob/thumb/${thumbKey}`,
      originalUploadPath: `/api/v1/media/blob/original/${originalKey}`
    };
  }

  function writeBlob({ kind, key, buffer, sha256, workspaceId = 'default' }) {
    const keySha = writeBlobFileAtomic(blobsDir, kind, key, buffer);
    const headerSha = sha256 && /^[a-fA-F0-9]{64}$/.test(sha256) ? sha256.toLowerCase() : null;
    const effectiveSha = headerSha || keySha;
    if (effectiveSha) {
      const patch =
        kind === 'original'
          ? { originalKey: key, sizeBytes: buffer.length, uploadedAt: String(Date.now()) }
          : { thumbKey: key };
      withImmediateTransaction(db, () => {
        grantMediaWorkspace(effectiveSha, workspaceId, patch);
      });
    }
  }

  function canReadBlob({ key, workspaceId = 'default' }) {
    const sha = extractShaFromBlobKey(key);
    if (!sha) return false;
    const meta = stmtGetMedia.get(sha);
    if (!meta) return false;
    const allowed = JSON.parse(meta.workspaces_json);
    return Array.isArray(allowed) ? allowed.includes(workspaceId) : false;
  }

  function readBlob({ kind, key }) {
    return readBlobFromDisk(blobsDir, kind, key);
  }

  function pushEntries({ workspaceId = 'default', actorId, entries = [] }) {
    return withImmediateTransaction(db, () => {
      let cursor = Number(stmtGetCursor.get()?.value || 0);
      const acked = [];
      const conflicts = [];
      const mergedCards = [];

      const appendEvent = (entityKind, entityId, operation) => {
        cursor += 1;
        stmtInsertEvent.run(cursor, workspaceId, entityKind, entityId, operation, String(Date.now()));
        return cursor;
      };

      for (const entry of entries) {
        const kind = entry.entityKind;
        const entityId = entry.entityId;
        const op = entry.operation;
        const payload = entry.payload || {};

        if (kind === 'card') {
          const existingRow = stmtGetCard.get(workspaceId, entityId);
          const existing = existingRow ? JSON.parse(existingRow.payload_json) : null;
          if (op === 'delete') {
            const { card } = mergeCardOnServer(
              existing,
              { ...payload, id: entityId, deletedAt: payload.deletedAt || String(Date.now()) },
              actorId
            );
            card.workspaceId = workspaceId;
            stmtUpsertCard.run(
              workspaceId,
              entityId,
              String(card.updatedAt || ''),
              card.deletedAt ? String(card.deletedAt) : null,
              JSON.stringify(card)
            );
            appendEvent('card', entityId, 'delete');
            acked.push({ entityKind: 'card', entityId, revision: card.revision });
            mergedCards.push(card);
          } else {
            const { card, conflict } = mergeCardOnServer(
              existing,
              { ...payload, id: entityId },
              actorId
            );
            card.workspaceId = workspaceId;
            stmtUpsertCard.run(
              workspaceId,
              entityId,
              String(card.updatedAt || ''),
              card.deletedAt ? String(card.deletedAt) : null,
              JSON.stringify(card)
            );
            appendEvent('card', entityId, 'upsert');
            acked.push({ entityKind: 'card', entityId, revision: card.revision });
            mergedCards.push(card);
            if (conflict) conflicts.push(conflict);
          }
        } else if (kind === 'attachment') {
          acked.push({ entityKind: 'attachment', entityId });
        } else if (kind === 'quickNote') {
          if (op === 'delete') {
            const tombstone = {
              id: entityId,
              deletedAt: payload.deletedAt || String(Date.now()),
              updatedAt: String(Date.now()),
              workspaceId
            };
            stmtUpsertQuickNote.run(
              workspaceId,
              entityId,
              tombstone.updatedAt,
              String(tombstone.deletedAt),
              JSON.stringify(tombstone)
            );
            appendEvent('quickNote', entityId, 'delete');
          } else {
            const noteRecord = {
              ...payload,
              id: entityId,
              deletedAt: null,
              workspaceId
            };
            stmtUpsertQuickNote.run(
              workspaceId,
              entityId,
              String(noteRecord.updatedAt || ''),
              null,
              JSON.stringify(noteRecord)
            );
            appendEvent('quickNote', entityId, 'upsert');
          }
          acked.push({ entityKind: 'quickNote', entityId });
        } else if (kind === 'board') {
          acked.push({ entityKind: 'board', entityId });
        }
      }

      stmtSetCursor.run(String(cursor));
      return {
        nextCursor: String(cursor),
        acked,
        mergedCards,
        conflicts
      };
    });
  }

  function pullSince({ workspaceId = 'default', cursor = null }) {
    const sinceSeq = cursor ? Number(cursor) || 0 : 0;
    return withReadTransaction(db, () => {
      const globalCursor = String(stmtGetCursor.get()?.value || '0');
      const rows = stmtPullEvents.all(workspaceId, sinceSeq);

      const cards = [];
      const removedCardIds = [];
      const quickNotes = [];
      const removedQuickNoteIds = [];

      for (const ev of rows) {
        if (ev.entity_kind === 'card') {
          const row = stmtGetCard.get(workspaceId, ev.entity_id);
          if (!row) continue;
          const card = JSON.parse(row.payload_json);
          if (card.deletedAt) {
            removedCardIds.push(card.id);
          } else {
            cards.push(card);
          }
        } else if (ev.entity_kind === 'quickNote') {
          const row = stmtGetQuickNote.get(workspaceId, ev.entity_id);
          if (!row) continue;
          const note = JSON.parse(row.payload_json);
          if (note.deletedAt) {
            removedQuickNoteIds.push(note.id);
          } else {
            quickNotes.push(note);
          }
        }
      }

      return {
        nextCursor: globalCursor,
        cards,
        removedCardIds,
        quickNotes,
        removedQuickNoteIds
      };
    });
  }

  return {
    driver: 'sqlite',
    dbPath: handle.dbPath,
    ensureWorkspaceAccess,
    setWorkspaceRole,
    listWorkspacesForUser,
    presignMedia,
    writeBlob,
    canReadBlob,
    readBlob,
    pushEntries,
    pullSince,
    close() {
      if (ownsHandle) {
        handle.close();
      }
    }
  };
}
