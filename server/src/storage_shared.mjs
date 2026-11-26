import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { httpError } from './fs_utils.mjs';

export const SAFE_KEY_RE = /^[a-zA-Z0-9._-]{1,128}$/;
export const BLOB_SHA_RE = /^(?:thumb|orig)_([a-fA-F0-9]{64})\.[a-z0-9]+$/;

export function validateBlobKey(kind, key) {
  if ((kind !== 'thumb' && kind !== 'original') || !SAFE_KEY_RE.test(key) || key.startsWith('.')) {
    throw new Error('Invalid media blob key');
  }
}

export function extractLegacyScopedRecords(legacyObj) {
  const map = new Map();
  if (!legacyObj || typeof legacyObj !== 'object') return [];
  for (const [rawKey, record] of Object.entries(legacyObj)) {
    if (!record || typeof record !== 'object') continue;
    const colonIdx = rawKey.indexOf(':');
    let workspaceId = record.workspaceId || 'default';
    let entityId = record.id || rawKey;
    if (colonIdx > 0) {
      const prefix = rawKey.slice(0, colonIdx);
      const rest = rawKey.slice(colonIdx + 1);
      if (rawKey.startsWith('private:')) {
        const secondColon = rawKey.indexOf(':', 'private:'.length);
        if (secondColon > 0) {
          workspaceId = rawKey.slice(0, secondColon);
          entityId = rawKey.slice(secondColon + 1);
        }
      } else if (prefix === workspaceId || !record.workspaceId) {
        workspaceId = prefix;
        entityId = rest;
      }
    }
    const dedupKey = `${workspaceId}:${entityId}`;
    if (!map.has(dedupKey)) {
      map.set(dedupKey, { workspaceId, entityId, record });
    }
  }
  return Array.from(map.values());
}

export function extractShaFromBlobKey(key) {
  const match = String(key || '').match(BLOB_SHA_RE);
  return match ? match[1].toLowerCase() : null;
}

export function safeBlobPath(blobsDir, kind, key) {
  try {
    validateBlobKey(kind, key);
  } catch {
    return null;
  }
  const target = path.resolve(blobsDir, kind, key);
  const parent = path.resolve(blobsDir, kind);
  if (!target.startsWith(parent + path.sep)) return null;
  return target;
}

export function writeBlobFileAtomic(blobsDir, kind, key, buffer) {
  const target = safeBlobPath(blobsDir, kind, key);
  if (!target) {
    throw new Error('Invalid media blob key');
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  const tmpPath = `${target}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmpPath, buffer);
  fs.renameSync(tmpPath, target);
  return extractShaFromBlobKey(key);
}

export function readBlobFromDisk(blobsDir, kind, key) {
  const target = safeBlobPath(blobsDir, kind, key);
  if (!target || !fs.existsSync(target)) return null;
  return fs.readFileSync(target);
}

export function sha256Hex(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

export function hashPassword(password, saltHex) {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

export function timingSafeHexEqual(aHex, bHex) {
  if (!aHex || !bHex || aHex.length !== bHex.length) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function archiveLegacyJsonFile(filePath, suffix = '.pre-sqlite.bak') {
  if (!fs.existsSync(filePath)) return null;
  let backupPath = `${filePath}${suffix}`;
  if (fs.existsSync(backupPath)) {
    backupPath = `${filePath}.${Date.now()}${suffix}`;
  }
  fs.renameSync(filePath, backupPath);
  return backupPath;
}

const ROLE_WEIGHT = { viewer: 1, member: 2, admin: 3, owner: 4 };

export function normalizeWorkspaceTitle(rawTitle) {
  const title = String(rawTitle || '').trim();
  if (!title || title.length > 64) {
    throw httpError(400, '工作区名称长度必须在 1~64 个字符之间');
  }
  return title;
}

export function normalizeInviteRole(rawRole = 'member') {
  const role = String(rawRole || 'member').trim().toLowerCase();
  if (role !== 'admin' && role !== 'member' && role !== 'viewer') {
    throw httpError(400, `无效的邀请角色: ${role}（仅支持 admin / member / viewer）`);
  }
  return role;
}

export function normalizeInviteMaxUses(rawMaxUses) {
  if (rawMaxUses === undefined || rawMaxUses === null || rawMaxUses === '') return 1;
  const parsed = Number(rawMaxUses);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000) {
    throw httpError(400, '邀请码最大使用次数需为 0~1000 之间的整数（0 表示不限次数）');
  }
  return parsed;
}

export function computeInviteExpiryMs(expiresInHours) {
  if (expiresInHours === undefined || expiresInHours === null || expiresInHours === '') {
    return String(Date.now() + 72 * 3600_000);
  }
  const hours = Number(expiresInHours);
  if (!Number.isFinite(hours) || hours < 0 || hours > 24 * 365) {
    throw httpError(400, '邀请码有效期小时数需在 0~8760 之间');
  }
  return hours === 0 ? null : String(Date.now() + Math.round(hours * 3600_000));
}

export function generateSharedWorkspaceId() {
  return `ws_${crypto.randomBytes(6).toString('hex')}`;
}

export function generateInviteCode() {
  return `td_inv_${crypto.randomBytes(9).toString('base64url')}`;
}

export function canManageWorkspaceInvites(role) {
  return role === 'owner' || role === 'admin';
}

export function resolveJoinedRole(existingRole, invitedRole) {
  if (!existingRole) return invitedRole;
  return (ROLE_WEIGHT[existingRole] || 0) >= (ROLE_WEIGHT[invitedRole] || 0)
    ? existingRole
    : invitedRole;
}

export function assertInviteUsable(invite) {
  if (!invite) {
    throw httpError(404, '邀请码不存在或已失效');
  }
  if (invite.revokedAt) {
    throw httpError(410, '该邀请码已被创建者撤回');
  }
  if (invite.expiresAt && Number(invite.expiresAt) > 0 && Number(invite.expiresAt) < Date.now()) {
    throw httpError(410, '该邀请码已过期');
  }
  const maxUses = Number(invite.maxUses || 0);
  const usedCount = Number(invite.usedCount || 0);
  if (maxUses > 0 && usedCount >= maxUses) {
    throw httpError(410, '该邀请码已达到最大使用次数');
  }
}

const MENTION_RE = /(?:^|[\s\p{P}])@([a-zA-Z0-9_-]{1,64})/gu;

export function extractCommentMentions(body) {
  const seen = new Set();
  const text = String(body || '');
  let match;
  MENTION_RE.lastIndex = 0;
  while ((match = MENTION_RE.exec(text)) !== null) {
    if (match[1]) {
      seen.add(match[1]);
    }
  }
  return Array.from(seen);
}

export function normalizeCardCommentRecord({
  id,
  workspaceId,
  actorId,
  authorName = '',
  payload = {},
  existing = null,
  operation = 'upsert'
}) {
  const now = String(Date.now());
  if (operation === 'delete') {
    const deletedAt = String(payload.deletedAt || existing?.deletedAt || now);
    const parentId = existing?.parentId ?? existing?.replyToId ?? null;
    return {
      id: String(id),
      workspaceId,
      cardId: String(payload.cardId || existing?.cardId || ''),
      parentId,
      authorId: String(existing?.authorId || actorId || ''),
      authorName: String(existing?.authorName || authorName || actorId || ''),
      body: '',
      mentions: [],
      createdAt: String(existing?.createdAt || payload.createdAt || now),
      updatedAt: String(payload.updatedAt || now),
      deletedAt
    };
  }

  if (existing) {
    if (existing.deletedAt) {
      throw httpError(409, '该评论已被删除，不可恢复或覆盖');
    }
    if (existing.authorId && existing.authorId !== actorId) {
      throw httpError(403, '仅评论作者本人可编辑该评论');
    }
  }

  const cardId = String(payload.cardId || existing?.cardId || '').trim();
  if (!cardId) {
    throw httpError(400, '评论缺少目标卡片 cardId');
  }
  const rawBody = String(payload.body ?? '');
  const trimmedBody = rawBody.trim();
  if (!trimmedBody || trimmedBody.length > 4000) {
    throw httpError(400, '评论正文长度必须在 1~4000 个字符之间');
  }
  const resolvedAuthorId = existing?.authorId || actorId;
  const resolvedAuthorName = existing?.authorName || authorName || resolvedAuthorId;
  const rawParent = payload.parentId ?? payload.replyToId;
  const parentId = rawParent
    ? String(rawParent).trim()
    : (existing?.parentId ?? existing?.replyToId ?? null);

  return {
    id: String(id),
    workspaceId,
    cardId,
    parentId: parentId || null,
    authorId: resolvedAuthorId,
    authorName: resolvedAuthorName,
    body: rawBody.trimEnd(),
    mentions: extractCommentMentions(trimmedBody),
    createdAt: String(existing?.createdAt || payload.createdAt || now),
    updatedAt: String(payload.updatedAt || now),
    deletedAt: null
  };
}

export function assertCanDeleteCardComment(existing, actorId, callerRole) {
  if (!existing) return;
  if (existing.authorId === actorId) return;
  if (callerRole === 'owner' || callerRole === 'admin') return;
  throw httpError(403, '仅评论作者本人或工作区管理员可删除他人评论');
}
