import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, getPrivateWorkspaceOwner, httpError, sanitizeWorkspaceId } from './fs_utils.mjs';
import { mergeCardOnServer } from './merge.mjs';
import {
  assertCanDeleteCardComment,
  assertInviteUsable,
  canManageWorkspaceInvites,
  computeInviteExpiryMs,
  extractShaFromBlobKey,
  generateInviteCode,
  generateSharedWorkspaceId,
  normalizeCardCommentRecord,
  normalizeInviteMaxUses,
  normalizeInviteRole,
  normalizeWorkspaceTitle,
  readBlobFromDisk,
  resolveJoinedRole,
  safeBlobPath,
  writeBlobFileAtomic
} from './storage_shared.mjs';

function scopedEntityKey(workspaceId, entityId) {
  return `${workspaceId}:${entityId}`;
}

function readScopedEntity(map, workspaceId, entityId) {
  const key = scopedEntityKey(workspaceId, entityId);
  if (Object.prototype.hasOwnProperty.call(map, key)) {
    return map[key];
  }
  const legacy = map[entityId];
  if (legacy && (legacy.workspaceId || 'default') === workspaceId) {
    return legacy;
  }
  return null;
}

function writeScopedEntity(map, workspaceId, entityId, record) {
  const key = scopedEntityKey(workspaceId, entityId);
  map[key] = record;
  const legacy = map[entityId];
  if (legacy && (legacy.workspaceId || 'default') === workspaceId) {
    delete map[entityId];
  }
}

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
    cardComments: {},
    mediaBySha256: {},
    workspaceInvites: {},
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
      if (privateOwner || safeWsId === 'default') {
        const initialRole = privateOwner ? 'owner' : 'member';
        db.workspaces[safeWsId] = {
          id: safeWsId,
          title: privateOwner ? `${privateOwner} 私人空间` : '默认协同工作区',
          members: { [userId]: initialRole }
        };
        save();
        return initialRole;
      }
      throw httpError(403, `工作区 "${safeWsId}" 不存在或未获邀请加入`);
    }
    const ws = db.workspaces[safeWsId];
    if (!ws.members[userId]) {
      if (privateOwner === userId) {
        ws.members[userId] = 'owner';
        save();
        return 'owner';
      }
      if (safeWsId === 'default') {
        ws.members[userId] = 'member';
        save();
        return 'member';
      }
      throw httpError(403, `您尚无权访问工作区 "${safeWsId}"，请通过邀请码加入`);
    }
    return ws.members[userId];
  }

  function createSharedWorkspace({ userId, title }) {
    reloadIfChanged();
    const cleanTitle = normalizeWorkspaceTitle(title);
    const workspaceId = generateSharedWorkspaceId();
    db.workspaces[workspaceId] = {
      id: workspaceId,
      title: cleanTitle,
      members: { [userId]: 'owner' }
    };
    save();
    return {
      workspaceId,
      title: cleanTitle,
      role: 'owner',
      isPrivate: false
    };
  }

  function createWorkspaceInvite({
    userId,
    workspaceId,
    role = 'member',
    maxUses = 1,
    expiresInHours = 72
  }) {
    reloadIfChanged();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    if (getPrivateWorkspaceOwner(safeWsId)) {
      throw httpError(400, '私人空间不可生成共享邀请码，请先新建共享工作区');
    }
    const callerRole = ensureWorkspaceAccess(userId, safeWsId);
    if (!canManageWorkspaceInvites(callerRole)) {
      throw httpError(403, '仅工作区创建者或管理员可生成邀请码');
    }
    if (!db.workspaceInvites) db.workspaceInvites = {};
    const cleanRole = normalizeInviteRole(role);
    const cleanMaxUses = normalizeInviteMaxUses(maxUses);
    const expiresAt = computeInviteExpiryMs(expiresInHours);
    const inviteCode = generateInviteCode();
    const invite = {
      inviteCode,
      workspaceId: safeWsId,
      role: cleanRole,
      createdBy: userId,
      maxUses: cleanMaxUses,
      usedCount: 0,
      expiresAt,
      revokedAt: null,
      createdAt: String(Date.now())
    };
    db.workspaceInvites[inviteCode] = invite;
    save();
    return { ...invite };
  }

  function listWorkspaceInvites({ userId, workspaceId }) {
    reloadIfChanged();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    if (getPrivateWorkspaceOwner(safeWsId)) return [];
    const callerRole = ensureWorkspaceAccess(userId, safeWsId);
    if (!canManageWorkspaceInvites(callerRole)) {
      throw httpError(403, '仅工作区创建者或管理员可查看邀请码');
    }
    return Object.values(db.workspaceInvites || {})
      .filter(item => item.workspaceId === safeWsId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0));
  }

  function revokeWorkspaceInvite({ userId, workspaceId, inviteCode }) {
    reloadIfChanged();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    const cleanCode = String(inviteCode || '').trim();
    if (!cleanCode) throw httpError(400, '缺少邀请码');
    const callerRole = ensureWorkspaceAccess(userId, safeWsId);
    if (!canManageWorkspaceInvites(callerRole)) {
      throw httpError(403, '仅工作区创建者或管理员可撤回邀请码');
    }
    const invite = db.workspaceInvites?.[cleanCode];
    if (!invite || invite.workspaceId !== safeWsId) {
      throw httpError(404, '未找到对应邀请码');
    }
    if (!invite.revokedAt) {
      invite.revokedAt = String(Date.now());
      save();
    }
    return { ...invite };
  }

  function listWorkspaceMembers({ userId, workspaceId }) {
    reloadIfChanged();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    ensureWorkspaceAccess(userId, safeWsId);
    const membersObj = db.workspaces[safeWsId]?.members || {};
    return Object.entries(membersObj)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([uid, memberRole]) => ({ userId: uid, role: memberRole }));
  }

  function joinWorkspaceByInvite({ userId, inviteCode }) {
    reloadIfChanged();
    const cleanCode = String(inviteCode || '').trim();
    if (!cleanCode) throw httpError(400, '请输入邀请码');
    const invite = db.workspaceInvites?.[cleanCode];
    assertInviteUsable(invite);
    const ws = db.workspaces[invite.workspaceId];
    if (!ws) throw httpError(404, '邀请对应的工作区已不存在');
    invite.usedCount = Number(invite.usedCount || 0) + 1;
    const nextRole = resolveJoinedRole(ws.members?.[userId], invite.role);
    ws.members[userId] = nextRole;
    save();
    return {
      workspaceId: invite.workspaceId,
      title: ws.title || invite.workspaceId,
      role: nextRole,
      isPrivate: false
    };
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

  function grantMediaWorkspace(sha256, workspaceId = 'default', patch = {}) {
    const lower = String(sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(lower)) return false;
    const prev = db.mediaBySha256[lower];
    const currentWorkspaces = prev
      ? Array.isArray(prev.workspaces)
        ? prev.workspaces
        : ['default']
      : [];
    const nextWorkspaces = currentWorkspaces.includes(workspaceId)
      ? currentWorkspaces
      : [...currentWorkspaces, workspaceId];
    const changed =
      !prev ||
      nextWorkspaces.length !== currentWorkspaces.length ||
      Object.keys(patch).some(k => prev[k] !== patch[k]);
    db.mediaBySha256[lower] = {
      ...(prev || {}),
      ...patch,
      workspaces: nextWorkspaces
    };
    return changed;
  }

  function presignMedia({ sha256, mimeType, workspaceId = 'default' }) {
    reloadIfChanged();
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
    const existing = db.mediaBySha256[lowerSha];
    const deduplicated = Boolean(
      existing &&
        thumbPath &&
        origPath &&
        fs.existsSync(thumbPath) &&
        fs.existsSync(origPath)
    );
    if (deduplicated && grantMediaWorkspace(lowerSha, workspaceId)) {
      save();
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
    reloadIfChanged();
    const keySha = writeBlobFileAtomic(blobsDir, kind, key, buffer);
    const headerSha = sha256 && /^[a-fA-F0-9]{64}$/.test(sha256) ? sha256.toLowerCase() : null;
    const effectiveSha = headerSha || keySha;
    if (effectiveSha) {
      const patch =
        kind === 'original'
          ? { originalKey: key, sizeBytes: buffer.length, uploadedAt: String(Date.now()) }
          : { thumbKey: key };
      if (grantMediaWorkspace(effectiveSha, workspaceId, patch)) {
        save();
      }
    }
  }

  function canReadBlob({ key, workspaceId = 'default' }) {
    reloadIfChanged();
    const sha = extractShaFromBlobKey(key);
    if (!sha) return false;
    const meta = db.mediaBySha256[sha];
    if (!meta) return false;
    const allowed = Array.isArray(meta.workspaces) ? meta.workspaces : ['default'];
    return allowed.includes(workspaceId);
  }

  function readBlob({ kind, key }) {
    return readBlobFromDisk(blobsDir, kind, key);
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

  function pushEntries({
    workspaceId = 'default',
    actorId,
    authorName = '',
    role = 'member',
    entries = []
  }) {
    const acked = [];
    const conflicts = [];
    const mergedCards = [];

    for (const entry of entries) {
      const kind = entry.entityKind;
      const entityId = entry.entityId;
      const op = entry.operation;
      const payload = entry.payload || {};

      if (kind === 'card') {
        const existing = readScopedEntity(db.cards, workspaceId, entityId);
        if (op === 'delete') {
          const { card } = mergeCardOnServer(
            existing,
            { ...payload, id: entityId, deletedAt: payload.deletedAt || String(Date.now()) },
            actorId
          );
          card.workspaceId = workspaceId;
          writeScopedEntity(db.cards, workspaceId, entityId, card);
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
          writeScopedEntity(db.cards, workspaceId, entityId, card);
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
          writeScopedEntity(db.quickNotes, workspaceId, entityId, {
            id: entityId,
            deletedAt: payload.deletedAt || String(Date.now()),
            updatedAt: String(Date.now()),
            workspaceId
          });
          appendEvent('quickNote', entityId, 'delete', workspaceId);
        } else {
          writeScopedEntity(db.quickNotes, workspaceId, entityId, {
            ...payload,
            id: entityId,
            deletedAt: null,
            workspaceId
          });
          appendEvent('quickNote', entityId, 'upsert', workspaceId);
        }
        acked.push({ entityKind: 'quickNote', entityId });
      } else if (kind === 'cardComment') {
        if (!db.cardComments) db.cardComments = {};
        const existing = readScopedEntity(db.cardComments, workspaceId, entityId);
        if (op === 'delete') {
          assertCanDeleteCardComment(existing, actorId, role);
        }
        const comment = normalizeCardCommentRecord({
          id: entityId,
          workspaceId,
          actorId,
          authorName,
          payload,
          existing,
          operation: op
        });
        writeScopedEntity(db.cardComments, workspaceId, entityId, comment);
        appendEvent('cardComment', entityId, op === 'delete' ? 'delete' : 'upsert', workspaceId);
        acked.push({ entityKind: 'cardComment', entityId });
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
    const cardComments = [];
    const removedCardCommentIds = [];

    for (const ev of latestSeqByEntity.values()) {
      if (ev.entityKind === 'card') {
        const card = readScopedEntity(db.cards, workspaceId, ev.entityId);
        if (!card) continue;
        if (card.deletedAt) {
          removedCardIds.push(card.id);
        } else {
          cards.push(card);
        }
      } else if (ev.entityKind === 'quickNote') {
        const note = readScopedEntity(db.quickNotes, workspaceId, ev.entityId);
        if (!note) continue;
        if (note.deletedAt) {
          removedQuickNoteIds.push(note.id);
        } else {
          quickNotes.push(note);
        }
      } else if (ev.entityKind === 'cardComment') {
        const comment = readScopedEntity(db.cardComments || {}, workspaceId, ev.entityId);
        if (!comment) continue;
        if (comment.deletedAt) {
          removedCardCommentIds.push(comment.id);
        } else {
          cardComments.push(comment);
        }
      }
    }

    return {
      nextCursor: String(db.cursor),
      cards,
      removedCardIds,
      quickNotes,
      removedQuickNoteIds,
      cardComments,
      removedCardCommentIds
    };
  }

  return {
    driver: 'json',
    ensureWorkspaceAccess,
    setWorkspaceRole,
    listWorkspacesForUser,
    listWorkspaceMembers,
    createSharedWorkspace,
    createWorkspaceInvite,
    listWorkspaceInvites,
    revokeWorkspaceInvite,
    joinWorkspaceByInvite,
    presignMedia,
    writeBlob,
    canReadBlob,
    readBlob,
    pushEntries,
    pullSince,
    close() {}
  };
}
