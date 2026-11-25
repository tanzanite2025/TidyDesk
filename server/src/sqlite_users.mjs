import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { httpError, sanitizeUserId } from './fs_utils.mjs';
import { openSyncSqliteDatabase, withImmediateTransaction, withReadTransaction } from './sqlite_db.mjs';
import {
  archiveLegacyJsonFile,
  hashPassword,
  sha256Hex,
  timingSafeHexEqual
} from './storage_shared.mjs';

function migrateLegacyAuthJsonIfNeeded(dataDir, db) {
  const alreadyMigrated = db
    .prepare("SELECT value FROM sync_meta WHERE key = 'migrated_json_auth'")
    .get();
  if (alreadyMigrated) return;

  const legacyPath = path.join(path.resolve(dataDir), 'users-auth.json');
  if (!fs.existsSync(legacyPath)) {
    db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('migrated_json_auth', 'none')").run();
    return;
  }

  const parsed = JSON.parse(fs.readFileSync(legacyPath, 'utf8'));
  withImmediateTransaction(db, () => {
    const existingUsers = db.prepare('SELECT COUNT(*) AS n FROM users').get().n;
    if (existingUsers === 0) {
      const insertUser = db.prepare(
        `INSERT OR REPLACE INTO users
         (user_id, display_name, password_salt, password_hash, disabled, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      const importedUsers = new Set();
      for (const user of Object.values(parsed?.users || {})) {
        if (!user?.userId || !user.passwordSalt || !user.passwordHash) continue;
        insertUser.run(
          user.userId,
          user.displayName || user.userId,
          user.passwordSalt,
          user.passwordHash,
          user.disabled ? 1 : 0,
          String(user.createdAt || '0'),
          String(user.updatedAt || user.createdAt || '0')
        );
        importedUsers.add(user.userId);
      }

      const insertToken = db.prepare(
        `INSERT OR REPLACE INTO tokens
         (token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      );
      for (const rec of Object.values(parsed?.tokens || {})) {
        if (!rec?.tokenId || !rec.userId || !rec.tokenHash) continue;
        if (!importedUsers.has(rec.userId)) {
          console.warn(
            `[TIDYDESK-SYNC] Skipping orphan legacy token ${rec.tokenId} for missing user ${rec.userId}`
          );
          continue;
        }
        insertToken.run(
          rec.tokenId,
          rec.userId,
          rec.tokenHash,
          String(rec.label || 'device'),
          String(rec.createdAt || '0'),
          String(rec.lastUsedAt || rec.createdAt || '0'),
          rec.revokedAt ? String(rec.revokedAt) : null
        );
      }
    }
    db.prepare("INSERT OR REPLACE INTO sync_meta (key, value) VALUES ('migrated_json_auth', ?)").run(
      String(Date.now())
    );
  });

  archiveLegacyJsonFile(legacyPath);
}

/**
 * SQLite-backed user & device-token registry storing scrypt hashes and SHA-256 token digests.
 * Concurrent CLI edits become immediately visible across processes via WAL mode.
 */
export function createSqliteUserRegistry(dataDir, { dbHandle = null } = {}) {
  const rootDir = path.resolve(dataDir);
  const ownsHandle = !dbHandle;
  const handle = dbHandle || openSyncSqliteDatabase(rootDir);
  const { db } = handle;
  migrateLegacyAuthJsonIfNeeded(rootDir, db);

  const stmtCountUsers = db.prepare('SELECT COUNT(*) AS n FROM users');
  const stmtGetUser = db.prepare(
    'SELECT user_id, display_name, password_salt, password_hash, disabled, created_at, updated_at FROM users WHERE user_id = ?'
  );
  const stmtInsertUser = db.prepare(
    `INSERT INTO users
     (user_id, display_name, password_salt, password_hash, disabled, created_at, updated_at)
     VALUES (?, ?, ?, ?, 0, ?, ?)`
  );
  const stmtUpdatePassword = db.prepare(
    'UPDATE users SET password_salt = ?, password_hash = ?, updated_at = ? WHERE user_id = ?'
  );
  const stmtUpdateDisabled = db.prepare(
    'UPDATE users SET disabled = ?, updated_at = ? WHERE user_id = ?'
  );
  const stmtRevokeAllUserTokens = db.prepare(
    'UPDATE tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL'
  );
  const stmtInsertToken = db.prepare(
    `INSERT INTO tokens
     (token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at)
     VALUES (?, ?, ?, ?, ?, ?, NULL)`
  );
  const stmtFindActiveTokenByHash = db.prepare(
    'SELECT token_id, user_id, token_hash, label, last_used_at FROM tokens WHERE token_hash = ? AND revoked_at IS NULL'
  );
  const stmtTouchTokenLastUsed = db.prepare('UPDATE tokens SET last_used_at = ? WHERE token_id = ?');
  const stmtGetTokenById = db.prepare(
    'SELECT token_id, user_id, revoked_at FROM tokens WHERE token_id = ?'
  );
  const stmtRevokeTokenById = db.prepare('UPDATE tokens SET revoked_at = ? WHERE token_id = ?');
  const stmtListUserTokens = db.prepare(
    `SELECT token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at
     FROM tokens
     WHERE user_id = ?
     ORDER BY CAST(created_at AS INTEGER) DESC`
  );
  const stmtListAllUsers = db.prepare(
    'SELECT user_id, display_name, disabled, created_at, updated_at FROM users ORDER BY created_at ASC'
  );

  function toPublicUser(row) {
    return {
      userId: row.user_id,
      displayName: row.display_name || row.user_id,
      disabled: Boolean(row.disabled),
      createdAt: row.created_at,
      updatedAt: row.updated_at
    };
  }

  function hasRegisteredUsers() {
    return stmtCountUsers.get().n > 0;
  }

  function isUserDisabled(userId) {
    const row = stmtGetUser.get(userId);
    return Boolean(row?.disabled);
  }

  function getUserPublic(userId) {
    const row = stmtGetUser.get(userId);
    return row ? toPublicUser(row) : null;
  }

  function createUser({ userId, password, displayName = '' }) {
    const safeId = sanitizeUserId(userId);
    if (typeof password !== 'string' || password.length < 4) {
      throw httpError(400, '密码长度至少需要 4 个字符');
    }
    return withImmediateTransaction(db, () => {
      if (stmtGetUser.get(safeId)) {
        throw httpError(409, `账号 "${safeId}" 已存在`);
      }
      const now = String(Date.now());
      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, passwordSalt);
      const resolvedDisplay = String(displayName || '').trim() || safeId;
      stmtInsertUser.run(safeId, resolvedDisplay, passwordSalt, passwordHash, now, now);
      return getUserPublic(safeId);
    });
  }

  function setPassword({ userId, newPassword, revokeAll = false }) {
    const safeId = sanitizeUserId(userId);
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      throw httpError(400, '新密码长度至少需要 4 个字符');
    }
    return withImmediateTransaction(db, () => {
      if (!stmtGetUser.get(safeId)) {
        throw httpError(404, `账号 "${safeId}" 不存在`);
      }
      const now = String(Date.now());
      const salt = crypto.randomBytes(16).toString('hex');
      const nextHash = hashPassword(newPassword, salt);
      stmtUpdatePassword.run(salt, nextHash, now, safeId);
      if (revokeAll) {
        stmtRevokeAllUserTokens.run(now, safeId);
      }
      return getUserPublic(safeId);
    });
  }

  function verifyPassword(userId, password) {
    let safeId;
    try {
      safeId = sanitizeUserId(userId);
    } catch (err) {
      return { ok: false, status: 400, error: err instanceof Error ? err.message : String(err) };
    }
    const user = stmtGetUser.get(safeId);
    if (!user) {
      return { ok: false, status: 401, error: '账号或密码错误' };
    }
    if (user.disabled) {
      return { ok: false, status: 403, error: '该账号已被管理员禁用' };
    }
    if (typeof password !== 'string' || !password) {
      return { ok: false, status: 401, error: '账号或密码错误' };
    }
    const actualHex = hashPassword(password, user.password_salt);
    if (!timingSafeHexEqual(actualHex, user.password_hash)) {
      return { ok: false, status: 401, error: '账号或密码错误' };
    }
    return {
      ok: true,
      user: {
        userId: user.user_id,
        displayName: user.display_name || user.user_id
      }
    };
  }

  function setUserDisabled(userId, disabled) {
    const safeId = sanitizeUserId(userId);
    return withImmediateTransaction(db, () => {
      if (!stmtGetUser.get(safeId)) {
        throw new Error(`账号 "${safeId}" 不存在`);
      }
      const now = String(Date.now());
      stmtUpdateDisabled.run(disabled ? 1 : 0, now, safeId);
      if (disabled) {
        stmtRevokeAllUserTokens.run(now, safeId);
      }
      return getUserPublic(safeId);
    });
  }

  function issueToken({ userId, label = 'device' }) {
    const safeId = sanitizeUserId(userId);
    return withImmediateTransaction(db, () => {
      const user = stmtGetUser.get(safeId);
      if (!user) {
        throw new Error(`账号 "${safeId}" 不存在`);
      }
      if (user.disabled) {
        throw new Error(`账号 "${safeId}" 已被禁用，无法签发凭据`);
      }
      const now = String(Date.now());
      const rawToken = `tdk_${crypto.randomBytes(24).toString('hex')}`;
      const tokenId = `tok_${crypto.randomBytes(6).toString('hex')}`;
      const cleanLabel = String(label || 'device').trim().slice(0, 64) || 'device';
      stmtInsertToken.run(tokenId, safeId, sha256Hex(rawToken), cleanLabel, now, now);
      return {
        tokenId,
        token: rawToken,
        userId: safeId,
        displayName: user.display_name || safeId,
        label: cleanLabel,
        createdAt: now
      };
    });
  }

  function verifyBearerToken(userId, rawToken) {
    const user = stmtGetUser.get(userId);
    if (user?.disabled) {
      return { ok: false, status: 403, error: '该账号已被禁用' };
    }
    const digest = sha256Hex(rawToken);
    const rec = stmtFindActiveTokenByHash.get(digest);
    if (!rec || !timingSafeHexEqual(digest, rec.token_hash)) {
      return { ok: false, status: 401, error: 'Token 无效或已被吊销' };
    }
    if (rec.user_id !== userId) {
      return { ok: false, status: 401, error: 'Token 与当前账号 ID 不匹配' };
    }
    const nowNum = Date.now();
    const prevNum = Number(rec.last_used_at || 0);
    if (!Number.isFinite(prevNum) || nowNum - prevNum > 60_000) {
      stmtTouchTokenLastUsed.run(String(nowNum), rec.token_id);
    }
    return {
      ok: true,
      userId: rec.user_id,
      displayName: user?.display_name || rec.user_id,
      tokenId: rec.token_id,
      label: rec.label
    };
  }

  function revokeTokenById({ userId = null, tokenId, isAdmin = false }) {
    return withImmediateTransaction(db, () => {
      const rec = stmtGetTokenById.get(tokenId);
      if (!rec) {
        throw httpError(404, `设备会话 "${tokenId}" 不存在`);
      }
      if (!isAdmin && rec.user_id !== userId) {
        throw httpError(403, '无权吊销其他用户的设备会话');
      }
      let revokedAt = rec.revoked_at;
      if (!revokedAt) {
        revokedAt = String(Date.now());
        stmtRevokeTokenById.run(revokedAt, tokenId);
      }
      return {
        tokenId: rec.token_id,
        userId: rec.user_id,
        revokedAt
      };
    });
  }

  function revokeTokenByValue(userId, rawToken) {
    const digest = sha256Hex(rawToken);
    return withImmediateTransaction(db, () => {
      const rec = stmtFindActiveTokenByHash.get(digest);
      if (rec && rec.user_id === userId && timingSafeHexEqual(digest, rec.token_hash)) {
        stmtRevokeTokenById.run(String(Date.now()), rec.token_id);
        return { ok: true, revoked: true, tokenId: rec.token_id };
      }
      return { ok: true, revoked: false, tokenId: null };
    });
  }

  function listSessionsForUser(userId, currentRawToken = null) {
    const currentDigest = currentRawToken ? sha256Hex(currentRawToken) : null;
    return stmtListUserTokens.all(userId).map(rec => ({
      tokenId: rec.token_id,
      label: rec.label,
      createdAt: rec.created_at,
      lastUsedAt: rec.last_used_at,
      revokedAt: rec.revoked_at,
      isCurrent: Boolean(
        currentDigest && !rec.revoked_at && timingSafeHexEqual(currentDigest, rec.token_hash)
      )
    }));
  }

  function listUsersAndSessions() {
    return withReadTransaction(db, () =>
      stmtListAllUsers.all().map(user => ({
        ...toPublicUser(user),
        sessions: listSessionsForUser(user.user_id)
      }))
    );
  }

  return {
    authPath: handle.dbPath,
    driver: 'sqlite',
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
    listUsersAndSessions,
    close() {
      if (ownsHandle) {
        handle.close();
      }
    }
  };
}
