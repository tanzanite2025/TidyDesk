import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { atomicWriteJson, httpError, sanitizeUserId } from './fs_utils.mjs';

function createInitialAuthDb() {
  return {
    version: 1,
    users: {},
    tokens: {}
  };
}

function sha256Hex(raw) {
  return crypto.createHash('sha256').update(String(raw)).digest('hex');
}

function hashPassword(password, saltHex) {
  return crypto.scryptSync(password, saltHex, 64).toString('hex');
}

function timingSafeHexEqual(aHex, bHex) {
  if (!aHex || !bHex || aHex.length !== bHex.length) return false;
  const a = Buffer.from(aHex, 'hex');
  const b = Buffer.from(bHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/**
 * Lightweight user & session-token registry stored in users-auth.json.
 * Stores scrypt password hashes and SHA-256 token digests, reloading cleanly on external CLI edits.
 */
export function createUserRegistry(dataDir) {
  const authPath = path.join(path.resolve(dataDir), 'users-auth.json');
  let db = createInitialAuthDb();
  let lastStamp = '';

  function readStamp() {
    try {
      const st = fs.statSync(authPath);
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
      db = createInitialAuthDb();
      lastStamp = stamp;
      return;
    }
    const raw = fs.readFileSync(authPath, 'utf8');
    const parsed = JSON.parse(raw);
    db = {
      version: 1,
      users: parsed?.users && typeof parsed.users === 'object' ? parsed.users : {},
      tokens: parsed?.tokens && typeof parsed.tokens === 'object' ? parsed.tokens : {}
    };
    lastStamp = stamp;
  }

  function save() {
    atomicWriteJson(authPath, db);
    lastStamp = readStamp();
  }

  reloadIfChanged();

  function hasRegisteredUsers() {
    reloadIfChanged();
    return Object.keys(db.users).length > 0;
  }

  function isUserDisabled(userId) {
    reloadIfChanged();
    return Boolean(db.users[userId]?.disabled);
  }

  function getUserPublic(userId) {
    reloadIfChanged();
    const user = db.users[userId];
    if (!user) return null;
    return {
      userId: user.userId,
      displayName: user.displayName || user.userId,
      disabled: Boolean(user.disabled),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt
    };
  }

  function createUser({ userId, password, displayName = '' }) {
    reloadIfChanged();
    const safeId = sanitizeUserId(userId);
    if (typeof password !== 'string' || password.length < 4) {
      throw httpError(400, '密码长度至少需要 4 个字符');
    }
    if (db.users[safeId]) {
      throw httpError(409, `账号 "${safeId}" 已存在`);
    }
    const now = String(Date.now());
    const passwordSalt = crypto.randomBytes(16).toString('hex');
    const passwordHash = hashPassword(password, passwordSalt);
    db.users[safeId] = {
      userId: safeId,
      displayName: String(displayName || '').trim() || safeId,
      passwordSalt,
      passwordHash,
      disabled: false,
      createdAt: now,
      updatedAt: now
    };
    save();
    return getUserPublic(safeId);
  }

  function setPassword({ userId, newPassword, revokeAll = false }) {
    reloadIfChanged();
    const safeId = sanitizeUserId(userId);
    const user = db.users[safeId];
    if (!user) {
      throw httpError(404, `账号 "${safeId}" 不存在`);
    }
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      throw httpError(400, '新密码长度至少需要 4 个字符');
    }
    const now = String(Date.now());
    const salt = crypto.randomBytes(16).toString('hex');
    user.passwordSalt = salt;
    user.passwordHash = hashPassword(newPassword, salt);
    user.updatedAt = now;
    if (revokeAll) {
      for (const rec of Object.values(db.tokens)) {
        if (rec.userId === safeId && !rec.revokedAt) {
          rec.revokedAt = now;
        }
      }
    }
    save();
    return getUserPublic(safeId);
  }

  function verifyPassword(userId, password) {
    reloadIfChanged();
    let safeId;
    try {
      safeId = sanitizeUserId(userId);
    } catch (err) {
      return { ok: false, status: 400, error: err instanceof Error ? err.message : String(err) };
    }
    const user = db.users[safeId];
    if (!user) {
      return { ok: false, status: 401, error: '账号或密码错误' };
    }
    if (user.disabled) {
      return { ok: false, status: 403, error: '该账号已被管理员禁用' };
    }
    if (typeof password !== 'string' || !password) {
      return { ok: false, status: 401, error: '账号或密码错误' };
    }
    const actualHex = hashPassword(password, user.passwordSalt);
    if (!timingSafeHexEqual(actualHex, user.passwordHash)) {
      return { ok: false, status: 401, error: '账号或密码错误' };
    }
    return {
      ok: true,
      user: {
        userId: user.userId,
        displayName: user.displayName || user.userId
      }
    };
  }

  function setUserDisabled(userId, disabled) {
    reloadIfChanged();
    const safeId = sanitizeUserId(userId);
    const user = db.users[safeId];
    if (!user) {
      throw new Error(`账号 "${safeId}" 不存在`);
    }
    const now = String(Date.now());
    user.disabled = Boolean(disabled);
    user.updatedAt = now;
    if (user.disabled) {
      for (const rec of Object.values(db.tokens)) {
        if (rec.userId === safeId && !rec.revokedAt) {
          rec.revokedAt = now;
        }
      }
    }
    save();
    return getUserPublic(safeId);
  }

  function issueToken({ userId, label = 'device' }) {
    reloadIfChanged();
    const safeId = sanitizeUserId(userId);
    const user = db.users[safeId];
    if (!user) {
      throw new Error(`账号 "${safeId}" 不存在`);
    }
    if (user.disabled) {
      throw new Error(`账号 "${safeId}" 已被禁用，无法签发凭据`);
    }
    const now = String(Date.now());
    const rawToken = `tdk_${crypto.randomBytes(24).toString('hex')}`;
    const tokenId = `tok_${crypto.randomBytes(6).toString('hex')}`;
    db.tokens[tokenId] = {
      tokenId,
      userId: safeId,
      tokenHash: sha256Hex(rawToken),
      label: String(label || 'device').trim().slice(0, 64) || 'device',
      createdAt: now,
      lastUsedAt: now,
      revokedAt: null
    };
    save();
    return {
      tokenId,
      token: rawToken,
      userId: safeId,
      displayName: user.displayName || safeId,
      label: db.tokens[tokenId].label,
      createdAt: now
    };
  }

  function verifyBearerToken(userId, rawToken) {
    reloadIfChanged();
    const user = db.users[userId];
    if (user?.disabled) {
      return { ok: false, status: 403, error: '该账号已被禁用' };
    }
    const digest = sha256Hex(rawToken);
    for (const rec of Object.values(db.tokens)) {
      if (rec.revokedAt) continue;
      if (timingSafeHexEqual(digest, rec.tokenHash)) {
        if (rec.userId !== userId) {
          return { ok: false, status: 401, error: 'Token 与当前账号 ID 不匹配' };
        }
        const nowNum = Date.now();
        const prevNum = Number(rec.lastUsedAt || 0);
        if (!Number.isFinite(prevNum) || nowNum - prevNum > 60_000) {
          rec.lastUsedAt = String(nowNum);
          save();
        }
        return {
          ok: true,
          userId: rec.userId,
          displayName: user?.displayName || rec.userId,
          tokenId: rec.tokenId,
          label: rec.label
        };
      }
    }
    return { ok: false, status: 401, error: 'Token 无效或已被吊销' };
  }

  function revokeTokenById({ userId = null, tokenId, isAdmin = false }) {
    reloadIfChanged();
    const rec = db.tokens[tokenId];
    if (!rec) {
      throw httpError(404, `设备会话 "${tokenId}" 不存在`);
    }
    if (!isAdmin && rec.userId !== userId) {
      throw httpError(403, '无权吊销其他用户的设备会话');
    }
    if (!rec.revokedAt) {
      rec.revokedAt = String(Date.now());
      save();
    }
    return {
      tokenId: rec.tokenId,
      userId: rec.userId,
      revokedAt: rec.revokedAt
    };
  }

  function revokeTokenByValue(userId, rawToken) {
    reloadIfChanged();
    const digest = sha256Hex(rawToken);
    for (const rec of Object.values(db.tokens)) {
      if (rec.userId === userId && !rec.revokedAt && timingSafeHexEqual(digest, rec.tokenHash)) {
        rec.revokedAt = String(Date.now());
        save();
        return { ok: true, revoked: true, tokenId: rec.tokenId };
      }
    }
    return { ok: true, revoked: false, tokenId: null };
  }

  function listSessionsForUser(userId, currentRawToken = null) {
    reloadIfChanged();
    const currentDigest = currentRawToken ? sha256Hex(currentRawToken) : null;
    return Object.values(db.tokens)
      .filter(rec => rec.userId === userId)
      .sort((a, b) => Number(b.createdAt || 0) - Number(a.createdAt || 0))
      .map(rec => ({
        tokenId: rec.tokenId,
        label: rec.label,
        createdAt: rec.createdAt,
        lastUsedAt: rec.lastUsedAt,
        revokedAt: rec.revokedAt,
        isCurrent: Boolean(currentDigest && !rec.revokedAt && timingSafeHexEqual(currentDigest, rec.tokenHash))
      }));
  }

  function listUsersAndSessions() {
    reloadIfChanged();
    return Object.values(db.users).map(user => ({
      userId: user.userId,
      displayName: user.displayName || user.userId,
      disabled: Boolean(user.disabled),
      createdAt: user.createdAt,
      updatedAt: user.updatedAt,
      sessions: listSessionsForUser(user.userId)
    }));
  }

  return {
    authPath,
    hasRegisteredUsers,
    isUserDisabled,
    getUserPublic,
    createUser,
    setPassword,
    verifyPassword,
    setUserDisabled,
    issueToken,
    verifyBearerToken,
    revokeTokenById,
    revokeTokenByValue,
    listSessionsForUser,
    listUsersAndSessions
  };
}
