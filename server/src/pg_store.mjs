import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getPrivateWorkspaceOwner, httpError, sanitizeWorkspaceId } from './fs_utils.mjs';
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
  resolveJoinedRole,
  validateBlobKey
} from './storage_shared.mjs';

const DEFAULT_SCHEMA_SQL_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'sql',
  'schema.sql'
);

export function loadPostgresSchemaSql(schemaPath = DEFAULT_SCHEMA_SQL_PATH) {
  if (!fs.existsSync(schemaPath)) {
    throw new Error(`[CRITICAL] PostgreSQL Schema 文件缺失: ${schemaPath}`);
  }
  return fs.readFileSync(schemaPath, 'utf8');
}

export function createPostgresSyncStore({ pg, blobStore, ensureSchema, ownsPg = false }) {
  async function ensureWorkspaceAccess(userId, workspaceId = 'default') {
    await ensureSchema();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    const privateOwner = getPrivateWorkspaceOwner(safeWsId);
    if (privateOwner && privateOwner !== userId) {
      const err = new Error(`私人工作区 "${safeWsId}" 仅限创建者本人访问`);
      err.status = 403;
      throw err;
    }

    return pg.withTransaction(async tx => {
      const wsRes = await tx.query('SELECT id, title FROM workspaces WHERE id = $1', [safeWsId]);
      if (wsRes.rows.length === 0) {
        if (privateOwner || safeWsId === 'default') {
          const title = privateOwner ? `${privateOwner} 私人空间` : '默认协同工作区';
          const initialRole = privateOwner ? 'owner' : 'member';
          await tx.query('INSERT INTO workspaces (id, title) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
            safeWsId,
            title
          ]);
          await tx.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role)
             VALUES ($1, $2, $3)
             ON CONFLICT (workspace_id, user_id) DO NOTHING`,
            [safeWsId, userId, initialRole]
          );
          return initialRole;
        }
        throw httpError(403, `工作区 "${safeWsId}" 不存在或未获邀请加入`);
      }
      const memberRes = await tx.query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [safeWsId, userId]
      );
      if (memberRes.rows.length === 0) {
        if (privateOwner === userId) {
          await tx.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role)
             VALUES ($1, $2, 'owner')
             ON CONFLICT (workspace_id, user_id) DO NOTHING`,
            [safeWsId, userId]
          );
          return 'owner';
        }
        if (safeWsId === 'default') {
          await tx.query(
            `INSERT INTO workspace_members (workspace_id, user_id, role)
             VALUES ($1, $2, 'member')
             ON CONFLICT (workspace_id, user_id) DO NOTHING`,
            [safeWsId, userId]
          );
          return 'member';
        }
        throw httpError(403, `您尚无权访问工作区 "${safeWsId}"，请通过邀请码加入`);
      }
      return memberRes.rows[0].role;
    });
  }

  function toPgInviteDto(row) {
    return {
      inviteCode: row.invite_code,
      workspaceId: row.workspace_id,
      role: row.role,
      createdBy: row.created_by,
      maxUses: Number(row.max_uses),
      usedCount: Number(row.used_count),
      expiresAt: row.expires_at,
      revokedAt: row.revoked_at,
      createdAt: row.created_at
    };
  }

  async function createSharedWorkspace({ userId, title }) {
    await ensureSchema();
    const cleanTitle = normalizeWorkspaceTitle(title);
    const workspaceId = generateSharedWorkspaceId();
    await pg.withTransaction(async tx => {
      await tx.query('INSERT INTO workspaces (id, title) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING', [
        workspaceId,
        cleanTitle
      ]);
      await tx.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, 'owner')
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = 'owner'`,
        [workspaceId, userId]
      );
    });
    return {
      workspaceId,
      title: cleanTitle,
      role: 'owner',
      isPrivate: false
    };
  }

  async function createWorkspaceInvite({
    userId,
    workspaceId,
    role = 'member',
    maxUses = 1,
    expiresInHours = 72
  }) {
    await ensureSchema();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    if (getPrivateWorkspaceOwner(safeWsId)) {
      throw httpError(400, '私人空间不可生成共享邀请码，请先新建共享工作区');
    }
    const callerRole = await ensureWorkspaceAccess(userId, safeWsId);
    if (!canManageWorkspaceInvites(callerRole)) {
      throw httpError(403, '仅工作区创建者或管理员可生成邀请码');
    }
    const cleanRole = normalizeInviteRole(role);
    const cleanMaxUses = normalizeInviteMaxUses(maxUses);
    const expiresAt = computeInviteExpiryMs(expiresInHours);
    const inviteCode = generateInviteCode();
    const now = String(Date.now());
    return pg.withTransaction(async tx => {
      const inserted = await tx.query(
        `INSERT INTO workspace_invites
         (invite_code, workspace_id, role, created_by, max_uses, used_count, expires_at, revoked_at, created_at)
         VALUES ($1, $2, $3, $4, $5, 0, $6, NULL, $7)
         RETURNING invite_code, workspace_id, role, created_by, max_uses, used_count, expires_at, revoked_at, created_at`,
        [inviteCode, safeWsId, cleanRole, userId, cleanMaxUses, expiresAt, now]
      );
      return toPgInviteDto(inserted.rows[0]);
    });
  }

  async function listWorkspaceInvites({ userId, workspaceId }) {
    await ensureSchema();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    if (getPrivateWorkspaceOwner(safeWsId)) {
      return [];
    }
    const callerRole = await ensureWorkspaceAccess(userId, safeWsId);
    if (!canManageWorkspaceInvites(callerRole)) {
      throw httpError(403, '仅工作区创建者或管理员可查看邀请码');
    }
    const rows = (
      await pg.query(
        `SELECT invite_code, workspace_id, role, created_by, max_uses, used_count, expires_at, revoked_at, created_at
         FROM workspace_invites
         WHERE workspace_id = $1
         ORDER BY CAST(created_at AS BIGINT) DESC`,
        [safeWsId]
      )
    ).rows;
    return rows.map(toPgInviteDto);
  }

  async function revokeWorkspaceInvite({ userId, workspaceId, inviteCode }) {
    await ensureSchema();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    const cleanCode = String(inviteCode || '').trim();
    if (!cleanCode) {
      throw httpError(400, '缺少邀请码');
    }
    const callerRole = await ensureWorkspaceAccess(userId, safeWsId);
    if (!canManageWorkspaceInvites(callerRole)) {
      throw httpError(403, '仅工作区创建者或管理员可撤回邀请码');
    }
    return pg.withTransaction(async tx => {
      const existing = await tx.query(
        `SELECT invite_code, workspace_id, role, created_by, max_uses, used_count, expires_at, revoked_at, created_at
         FROM workspace_invites
         WHERE invite_code = $1 FOR UPDATE`,
        [cleanCode]
      );
      if (existing.rows.length === 0 || existing.rows[0].workspace_id !== safeWsId) {
        throw httpError(404, '未找到对应邀请码');
      }
      if (!existing.rows[0].revoked_at) {
        const updated = await tx.query(
          `UPDATE workspace_invites SET revoked_at = $1
           WHERE invite_code = $2 AND workspace_id = $3
           RETURNING invite_code, workspace_id, role, created_by, max_uses, used_count, expires_at, revoked_at, created_at`,
          [String(Date.now()), cleanCode, safeWsId]
        );
        return toPgInviteDto(updated.rows[0]);
      }
      return toPgInviteDto(existing.rows[0]);
    });
  }

  async function listWorkspaceMembers({ userId, workspaceId }) {
    await ensureSchema();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    await ensureWorkspaceAccess(userId, safeWsId);
    const rows = (
      await pg.query(
        'SELECT user_id, role FROM workspace_members WHERE workspace_id = $1 ORDER BY user_id ASC',
        [safeWsId]
      )
    ).rows;
    return rows.map(r => ({ userId: r.user_id, role: r.role }));
  }

  async function joinWorkspaceByInvite({ userId, inviteCode }) {
    await ensureSchema();
    const cleanCode = String(inviteCode || '').trim();
    if (!cleanCode) {
      throw httpError(400, '请输入邀请码');
    }
    return pg.withTransaction(async tx => {
      const resInv = await tx.query(
        `SELECT invite_code, workspace_id, role, created_by, max_uses, used_count, expires_at, revoked_at, created_at
         FROM workspace_invites
         WHERE invite_code = $1 FOR UPDATE`,
        [cleanCode]
      );
      const dto = resInv.rows.length > 0 ? toPgInviteDto(resInv.rows[0]) : null;
      assertInviteUsable(dto);
      const wsRes = await tx.query('SELECT id, title FROM workspaces WHERE id = $1', [
        dto.workspaceId
      ]);
      if (wsRes.rows.length === 0) {
        throw httpError(404, '邀请对应的工作区已不存在');
      }
      await tx.query(
        'UPDATE workspace_invites SET used_count = used_count + 1 WHERE invite_code = $1',
        [cleanCode]
      );
      const memRes = await tx.query(
        'SELECT role FROM workspace_members WHERE workspace_id = $1 AND user_id = $2',
        [dto.workspaceId, userId]
      );
      const nextRole = resolveJoinedRole(memRes.rows[0]?.role, dto.role);
      await tx.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [dto.workspaceId, userId, nextRole]
      );
      return {
        workspaceId: dto.workspaceId,
        title: wsRes.rows[0].title || dto.workspaceId,
        role: nextRole,
        isPrivate: false
      };
    });
  }

  async function setWorkspaceRole(workspaceId, userId, role) {
    await ensureSchema();
    const safeWsId = sanitizeWorkspaceId(workspaceId, 'default');
    await pg.withTransaction(async tx => {
      await tx.query(
        'INSERT INTO workspaces (id, title) VALUES ($1, $2) ON CONFLICT (id) DO NOTHING',
        [safeWsId, safeWsId]
      );
      await tx.query(
        `INSERT INTO workspace_members (workspace_id, user_id, role)
         VALUES ($1, $2, $3)
         ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
        [safeWsId, userId, role]
      );
    });
  }

  async function listWorkspacesForUser(userId) {
    await ensureSchema();
    return pg.withTransaction(async tx => {
      const allWs = (await tx.query('SELECT id, title FROM workspaces')).rows;
      const memberRows = (
        await tx.query('SELECT workspace_id, role FROM workspace_members WHERE user_id = $1', [userId])
      ).rows;
      const roleMap = new Map(memberRows.map(r => [r.workspace_id, r.role]));
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

  async function grantMediaWorkspace(tx, sha256, workspaceId = 'default', patch = {}) {
    const lower = String(sha256 || '').toLowerCase();
    if (!/^[a-f0-9]{64}$/.test(lower)) return false;

    const prevRes = await tx.query(
      'SELECT sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json FROM media_meta WHERE sha256 = $1 FOR UPDATE',
      [lower]
    );
    const prev = prevRes.rows[0] || null;
    const prevWorkspaces = prev
      ? typeof prev.workspaces_json === 'string'
        ? JSON.parse(prev.workspaces_json)
        : prev.workspaces_json
      : [];
    const currentWorkspaces = Array.isArray(prevWorkspaces) ? prevWorkspaces : [];
    const nextWorkspaces = currentWorkspaces.includes(workspaceId)
      ? currentWorkspaces
      : [...currentWorkspaces, workspaceId];

    const originalKey =
      patch.originalKey !== undefined ? patch.originalKey : prev?.original_key || null;
    const thumbKey = patch.thumbKey !== undefined ? patch.thumbKey : prev?.thumb_key || null;
    const sizeBytes =
      patch.sizeBytes !== undefined
        ? Number(patch.sizeBytes)
        : prev?.size_bytes !== undefined && prev?.size_bytes !== null
          ? Number(prev.size_bytes)
          : null;
    const uploadedAt =
      patch.uploadedAt !== undefined ? String(patch.uploadedAt) : prev?.uploaded_at || null;

    await tx.query(
      `INSERT INTO media_meta (sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)
       ON CONFLICT (sha256) DO UPDATE SET
         original_key = EXCLUDED.original_key,
         thumb_key = EXCLUDED.thumb_key,
         size_bytes = EXCLUDED.size_bytes,
         uploaded_at = EXCLUDED.uploaded_at,
         workspaces_json = EXCLUDED.workspaces_json`,
      [lower, originalKey, thumbKey, sizeBytes, uploadedAt, JSON.stringify(nextWorkspaces)]
    );
    return true;
  }

  async function presignMedia({ sha256, mimeType, workspaceId = 'default' }) {
    await ensureSchema();
    if (!sha256 || !/^[a-fA-F0-9]{64}$/.test(sha256)) {
      throw new Error('Invalid sha256 digest');
    }
    const lowerSha = sha256.toLowerCase();
    const ext =
      mimeType === 'image/jpeg' ? 'jpg' : mimeType === 'image/webp' ? 'webp' : 'png';
    const thumbKey = `thumb_${lowerSha}.png`;
    const originalKey = `orig_${lowerSha}.${ext}`;

    const existing = (await pg.query('SELECT sha256 FROM media_meta WHERE sha256 = $1', [lowerSha]))
      .rows[0];
    const hasBlobs = existing ? await blobStore.hasBlobPair(thumbKey, originalKey) : false;
    const deduplicated = Boolean(existing && hasBlobs);
    if (deduplicated) {
      await pg.withTransaction(tx => grantMediaWorkspace(tx, lowerSha, workspaceId));
    }

    return {
      deduplicated,
      thumbKey,
      originalKey,
      thumbUploadPath: `/api/v1/media/blob/thumb/${thumbKey}`,
      originalUploadPath: `/api/v1/media/blob/original/${originalKey}`
    };
  }

  async function writeBlob({ kind, key, buffer, sha256, workspaceId = 'default' }) {
    await ensureSchema();
    validateBlobKey(kind, key);
    const contentType = key.endsWith('.jpg')
      ? 'image/jpeg'
      : key.endsWith('.webp')
        ? 'image/webp'
        : 'image/png';
    await blobStore.writeBlob(kind, key, buffer, contentType);
    const keySha = extractShaFromBlobKey(key);
    const headerSha = sha256 && /^[a-fA-F0-9]{64}$/.test(sha256) ? sha256.toLowerCase() : null;
    const effectiveSha = headerSha || keySha;
    if (effectiveSha) {
      const patch =
        kind === 'original'
          ? { originalKey: key, sizeBytes: buffer.length, uploadedAt: String(Date.now()) }
          : { thumbKey: key };
      await pg.withTransaction(tx => grantMediaWorkspace(tx, effectiveSha, workspaceId, patch));
    }
  }

  async function canReadBlob({ key, workspaceId = 'default' }) {
    await ensureSchema();
    const sha = extractShaFromBlobKey(key);
    if (!sha) return false;
    const meta = (
      await pg.query('SELECT workspaces_json FROM media_meta WHERE sha256 = $1', [sha])
    ).rows[0];
    if (!meta) return false;
    const allowed =
      typeof meta.workspaces_json === 'string'
        ? JSON.parse(meta.workspaces_json)
        : meta.workspaces_json;
    return Array.isArray(allowed) ? allowed.includes(workspaceId) : false;
  }

  async function readBlob({ kind, key }) {
    validateBlobKey(kind, key);
    return blobStore.readBlob(kind, key);
  }

  async function pushEntries({
    workspaceId = 'default',
    actorId,
    authorName = '',
    role = 'member',
    entries = []
  }) {
    await ensureSchema();
    return pg.withTransaction(async tx => {
      const acked = [];
      const conflicts = [];
      const mergedCards = [];

      const cursorRes = await tx.query(
        "SELECT value FROM sync_meta WHERE key = 'cursor' FOR UPDATE"
      );
      let latestCursor = Number(cursorRes.rows[0]?.value || 0);

      const appendEvent = async (entityKind, entityId, operation) => {
        const evRes = await tx.query(
          `INSERT INTO sync_events (workspace_id, entity_kind, entity_id, operation, created_at)
           VALUES ($1, $2, $3, $4, $5)
           RETURNING seq`,
          [workspaceId, entityKind, entityId, operation, String(Date.now())]
        );
        const seqNum = Number(evRes.rows[0]?.seq || 0);
        if (seqNum > latestCursor) latestCursor = seqNum;
        return seqNum;
      };

      for (const entry of entries) {
        const kind = entry.entityKind;
        const entityId = entry.entityId;
        const op = entry.operation;
        const payload = entry.payload || {};

        if (kind === 'card') {
          const existingRow = (
            await tx.query(
              'SELECT payload_json FROM cards WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
              [workspaceId, entityId]
            )
          ).rows[0];
          const existing = existingRow
            ? typeof existingRow.payload_json === 'string'
              ? JSON.parse(existingRow.payload_json)
              : existingRow.payload_json
            : null;

          if (op === 'delete') {
            const { card } = mergeCardOnServer(
              existing,
              { ...payload, id: entityId, deletedAt: payload.deletedAt || String(Date.now()) },
              actorId
            );
            card.workspaceId = workspaceId;
            await tx.query(
              `INSERT INTO cards (workspace_id, id, updated_at, deleted_at, payload_json)
               VALUES ($1, $2, $3, $4, $5::jsonb)
               ON CONFLICT (workspace_id, id) DO UPDATE SET
                 updated_at = EXCLUDED.updated_at,
                 deleted_at = EXCLUDED.deleted_at,
                 payload_json = EXCLUDED.payload_json`,
              [
                workspaceId,
                entityId,
                String(card.updatedAt || ''),
                card.deletedAt ? String(card.deletedAt) : null,
                JSON.stringify(card)
              ]
            );
            await appendEvent('card', entityId, 'delete');
            acked.push({ entityKind: 'card', entityId, revision: card.revision });
            mergedCards.push(card);
          } else {
            const { card, conflict } = mergeCardOnServer(
              existing,
              { ...payload, id: entityId },
              actorId
            );
            card.workspaceId = workspaceId;
            await tx.query(
              `INSERT INTO cards (workspace_id, id, updated_at, deleted_at, payload_json)
               VALUES ($1, $2, $3, $4, $5::jsonb)
               ON CONFLICT (workspace_id, id) DO UPDATE SET
                 updated_at = EXCLUDED.updated_at,
                 deleted_at = EXCLUDED.deleted_at,
                 payload_json = EXCLUDED.payload_json`,
              [
                workspaceId,
                entityId,
                String(card.updatedAt || ''),
                card.deletedAt ? String(card.deletedAt) : null,
                JSON.stringify(card)
              ]
            );
            await appendEvent('card', entityId, 'upsert');
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
            await tx.query(
              `INSERT INTO quick_notes (workspace_id, id, updated_at, deleted_at, payload_json)
               VALUES ($1, $2, $3, $4, $5::jsonb)
               ON CONFLICT (workspace_id, id) DO UPDATE SET
                 updated_at = EXCLUDED.updated_at,
                 deleted_at = EXCLUDED.deleted_at,
                 payload_json = EXCLUDED.payload_json`,
              [
                workspaceId,
                entityId,
                tombstone.updatedAt,
                String(tombstone.deletedAt),
                JSON.stringify(tombstone)
              ]
            );
            await appendEvent('quickNote', entityId, 'delete');
          } else {
            const noteRecord = {
              ...payload,
              id: entityId,
              deletedAt: null,
              workspaceId
            };
            await tx.query(
              `INSERT INTO quick_notes (workspace_id, id, updated_at, deleted_at, payload_json)
               VALUES ($1, $2, $3, NULL, $4::jsonb)
               ON CONFLICT (workspace_id, id) DO UPDATE SET
                 updated_at = EXCLUDED.updated_at,
                 deleted_at = NULL,
                 payload_json = EXCLUDED.payload_json`,
              [workspaceId, entityId, String(noteRecord.updatedAt || ''), JSON.stringify(noteRecord)]
            );
            await appendEvent('quickNote', entityId, 'upsert');
          }
          acked.push({ entityKind: 'quickNote', entityId });
        } else if (kind === 'cardComment') {
          const existingRow = (
            await tx.query(
              'SELECT payload_json FROM card_comments WHERE workspace_id = $1 AND id = $2 FOR UPDATE',
              [workspaceId, entityId]
            )
          ).rows[0];
          const existing = existingRow
            ? typeof existingRow.payload_json === 'string'
              ? JSON.parse(existingRow.payload_json)
              : existingRow.payload_json
            : null;
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
          await tx.query(
            `INSERT INTO card_comments (workspace_id, id, card_id, updated_at, deleted_at, payload_json)
             VALUES ($1, $2, $3, $4, $5, $6::jsonb)
             ON CONFLICT (workspace_id, id) DO UPDATE SET
               card_id = EXCLUDED.card_id,
               updated_at = EXCLUDED.updated_at,
               deleted_at = EXCLUDED.deleted_at,
               payload_json = EXCLUDED.payload_json`,
            [
              workspaceId,
              entityId,
              comment.cardId,
              comment.updatedAt,
              comment.deletedAt,
              JSON.stringify(comment)
            ]
          );
          await appendEvent('cardComment', entityId, op === 'delete' ? 'delete' : 'upsert');
          acked.push({ entityKind: 'cardComment', entityId });
        } else if (kind === 'board') {
          acked.push({ entityKind: 'board', entityId });
        }
      }

      await tx.query(
        `INSERT INTO sync_meta (key, value) VALUES ('cursor', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [String(latestCursor)]
      );

      return {
        nextCursor: String(latestCursor),
        acked,
        mergedCards,
        conflicts
      };
    });
  }

  async function pullSince({ workspaceId = 'default', cursor = null }) {
    await ensureSchema();
    const sinceSeq = cursor ? Number(cursor) || 0 : 0;
    return pg.withTransaction(async tx => {
      await tx.exec('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
      const cursorRow = (await tx.query("SELECT value FROM sync_meta WHERE key = 'cursor'")).rows[0];
      const maxEvRow = (await tx.query('SELECT MAX(seq) AS max_seq FROM sync_events')).rows[0];
      const globalCursor = String(
        Math.max(Number(cursorRow?.value || 0), Number(maxEvRow?.max_seq || 0))
      );

      const evRows = (
        await tx.query(
          `SELECT entity_kind, entity_id, MAX(seq) AS max_seq
           FROM sync_events
           WHERE workspace_id = $1 AND seq > $2
           GROUP BY entity_kind, entity_id
           ORDER BY max_seq ASC`,
          [workspaceId, sinceSeq]
        )
      ).rows;

      const cards = [];
      const removedCardIds = [];
      const quickNotes = [];
      const removedQuickNoteIds = [];
      const cardComments = [];
      const removedCardCommentIds = [];

      for (const ev of evRows) {
        if (ev.entity_kind === 'card') {
          const row = (
            await tx.query('SELECT payload_json FROM cards WHERE workspace_id = $1 AND id = $2', [
              workspaceId,
              ev.entity_id
            ])
          ).rows[0];
          if (!row) continue;
          const card =
            typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
          if (card.deletedAt) {
            removedCardIds.push(card.id);
          } else {
            cards.push(card);
          }
        } else if (ev.entity_kind === 'quickNote') {
          const row = (
            await tx.query(
              'SELECT payload_json FROM quick_notes WHERE workspace_id = $1 AND id = $2',
              [workspaceId, ev.entity_id]
            )
          ).rows[0];
          if (!row) continue;
          const note =
            typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
          if (note.deletedAt) {
            removedQuickNoteIds.push(note.id);
          } else {
            quickNotes.push(note);
          }
        } else if (ev.entity_kind === 'cardComment') {
          const row = (
            await tx.query(
              'SELECT payload_json FROM card_comments WHERE workspace_id = $1 AND id = $2',
              [workspaceId, ev.entity_id]
            )
          ).rows[0];
          if (!row) continue;
          const comment =
            typeof row.payload_json === 'string' ? JSON.parse(row.payload_json) : row.payload_json;
          if (comment.deletedAt) {
            removedCardCommentIds.push(comment.id);
          } else {
            cardComments.push(comment);
          }
        }
      }

      return {
        nextCursor: globalCursor,
        cards,
        removedCardIds,
        quickNotes,
        removedQuickNoteIds,
        cardComments,
        removedCardCommentIds
      };
    });
  }

  return {
    driver: 'postgres',
    blobMode: blobStore.mode,
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
    async close() {
      if (ownsPg) {
        await pg.close();
      }
    }
  };
}
