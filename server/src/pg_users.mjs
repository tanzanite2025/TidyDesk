import crypto from 'node:crypto';
import { httpError, sanitizeUserId } from './fs_utils.mjs';
import { hashPassword, sha256Hex, timingSafeHexEqual } from './storage_shared.mjs';

/**
 * PostgreSQL-backed user & device-token registry storing scrypt password hashes and SHA-256 token digests.
 */
export function createPostgresUserRegistry({ pg, ensureSchema, ownsPg = false }) {
  function toPublicUser(row) {
    return {
      userId: row.user_id,
      displayName: row.display_name || row.user_id,
      disabled: Boolean(row.disabled),
      createdAt: String(row.created_at),
      updatedAt: String(row.updated_at)
    };
  }

  async function hasRegisteredUsers() {
    await ensureSchema();
    const res = await pg.query('SELECT COUNT(*) AS n FROM users');
    return Number(res.rows[0]?.n || 0) > 0;
  }

  async function isUserDisabled(userId) {
    await ensureSchema();
    const res = await pg.query('SELECT disabled FROM users WHERE user_id = $1', [userId]);
    return Boolean(res.rows[0]?.disabled);
  }

  async function getUserPublic(userId) {
    await ensureSchema();
    const res = await pg.query(
      'SELECT user_id, display_name, disabled, created_at, updated_at FROM users WHERE user_id = $1',
      [userId]
    );
    return res.rows[0] ? toPublicUser(res.rows[0]) : null;
  }

  async function createUser({ userId, password, displayName = '' }) {
    await ensureSchema();
    const safeId = sanitizeUserId(userId);
    if (typeof password !== 'string' || password.length < 4) {
      throw httpError(400, '密码长度至少需要 4 个字符');
    }
    return pg.withTransaction(async tx => {
      const existing = (await tx.query('SELECT user_id FROM users WHERE user_id = $1', [safeId])).rows;
      if (existing.length > 0) {
        throw httpError(409, `账号 "${safeId}" 已存在`);
      }
      const now = String(Date.now());
      const passwordSalt = crypto.randomBytes(16).toString('hex');
      const passwordHash = hashPassword(password, passwordSalt);
      const resolvedDisplay = String(displayName || '').trim() || safeId;
      await tx.query(
        `INSERT INTO users (user_id, display_name, password_salt, password_hash, disabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, FALSE, $5, $6)`,
        [safeId, resolvedDisplay, passwordSalt, passwordHash, now, now]
      );
      return {
        userId: safeId,
        displayName: resolvedDisplay,
        disabled: false,
        createdAt: now,
        updatedAt: now
      };
    });
  }

  async function setPassword({ userId, newPassword, revokeAll = false }) {
    await ensureSchema();
    const safeId = sanitizeUserId(userId);
    if (typeof newPassword !== 'string' || newPassword.length < 4) {
      throw httpError(400, '新密码长度至少需要 4 个字符');
    }
    return pg.withTransaction(async tx => {
      const row = (
        await tx.query(
          'SELECT user_id, display_name, disabled, created_at FROM users WHERE user_id = $1 FOR UPDATE',
          [safeId]
        )
      ).rows[0];
      if (!row) {
        throw httpError(404, `账号 "${safeId}" 不存在`);
      }
      const now = String(Date.now());
      const salt = crypto.randomBytes(16).toString('hex');
      const nextHash = hashPassword(newPassword, salt);
      await tx.query(
        'UPDATE users SET password_salt = $1, password_hash = $2, updated_at = $3 WHERE user_id = $4',
        [salt, nextHash, now, safeId]
      );
      if (revokeAll) {
        await tx.query(
          'UPDATE tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
          [now, safeId]
        );
      }
      return toPublicUser({ ...row, updated_at: now });
    });
  }

  async function verifyPassword(userId, password) {
    await ensureSchema();
    let safeId;
    try {
      safeId = sanitizeUserId(userId);
    } catch (err) {
      return { ok: false, status: 400, error: err instanceof Error ? err.message : String(err) };
    }
    const user = (
      await pg.query(
        'SELECT user_id, display_name, password_salt, password_hash, disabled FROM users WHERE user_id = $1',
        [safeId]
      )
    ).rows[0];
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

  async function setUserDisabled(userId, disabled) {
    await ensureSchema();
    const safeId = sanitizeUserId(userId);
    return pg.withTransaction(async tx => {
      const row = (
        await tx.query(
          'SELECT user_id, display_name, created_at FROM users WHERE user_id = $1 FOR UPDATE',
          [safeId]
        )
      ).rows[0];
      if (!row) {
        throw new Error(`账号 "${safeId}" 不存在`);
      }
      const now = String(Date.now());
      await tx.query('UPDATE users SET disabled = $1, updated_at = $2 WHERE user_id = $3', [
        Boolean(disabled),
        now,
        safeId
      ]);
      if (disabled) {
        await tx.query(
          'UPDATE tokens SET revoked_at = $1 WHERE user_id = $2 AND revoked_at IS NULL',
          [now, safeId]
        );
      }
      return toPublicUser({ ...row, disabled: Boolean(disabled), updated_at: now });
    });
  }

  async function issueToken({ userId, label = 'device' }) {
    await ensureSchema();
    const safeId = sanitizeUserId(userId);
    return pg.withTransaction(async tx => {
      const user = (
        await tx.query('SELECT user_id, display_name, disabled FROM users WHERE user_id = $1', [
          safeId
        ])
      ).rows[0];
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
      await tx.query(
        `INSERT INTO tokens (token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, NULL)`,
        [tokenId, safeId, sha256Hex(rawToken), cleanLabel, now, now]
      );
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

  async function verifyBearerToken(userId, rawToken) {
    await ensureSchema();
    const user = (
      await pg.query('SELECT user_id, display_name, disabled FROM users WHERE user_id = $1', [
        userId
      ])
    ).rows[0];
    if (user?.disabled) {
      return { ok: false, status: 403, error: '该账号已被禁用' };
    }
    const digest = sha256Hex(rawToken);
    const rec = (
      await pg.query(
        'SELECT token_id, user_id, token_hash, label, last_used_at FROM tokens WHERE token_hash = $1 AND revoked_at IS NULL',
        [digest]
      )
    ).rows[0];
    if (!rec || !timingSafeHexEqual(digest, rec.token_hash)) {
      return { ok: false, status: 401, error: 'Token 无效或已被吊销' };
    }
    if (rec.user_id !== userId) {
      return { ok: false, status: 401, error: 'Token 与当前账号 ID 不匹配' };
    }
    const nowNum = Date.now();
    const prevNum = Number(rec.last_used_at || 0);
    if (!Number.isFinite(prevNum) || nowNum - prevNum > 60_000) {
      await pg.query('UPDATE tokens SET last_used_at = $1 WHERE token_id = $2', [
        String(nowNum),
        rec.token_id
      ]);
    }
    return {
      ok: true,
      userId: rec.user_id,
      displayName: user?.display_name || rec.user_id,
      tokenId: rec.token_id,
      label: rec.label
    };
  }

  async function revokeTokenById({ userId = null, tokenId, isAdmin = false }) {
    await ensureSchema();
    return pg.withTransaction(async tx => {
      const rec = (
        await tx.query(
          'SELECT token_id, user_id, revoked_at FROM tokens WHERE token_id = $1 FOR UPDATE',
          [tokenId]
        )
      ).rows[0];
      if (!rec) {
        throw httpError(404, `设备会话 "${tokenId}" 不存在`);
      }
      if (!isAdmin && rec.user_id !== userId) {
        throw httpError(403, '无权吊销其他用户的设备会话');
      }
      let revokedAt = rec.revoked_at;
      if (!revokedAt) {
        revokedAt = String(Date.now());
        await tx.query('UPDATE tokens SET revoked_at = $1 WHERE token_id = $2', [
          revokedAt,
          tokenId
        ]);
      }
      return {
        tokenId: rec.token_id,
        userId: rec.user_id,
        revokedAt
      };
    });
  }

  async function revokeTokenByValue(userId, rawToken) {
    await ensureSchema();
    const digest = sha256Hex(rawToken);
    return pg.withTransaction(async tx => {
      const rec = (
        await tx.query(
          'SELECT token_id, user_id, token_hash FROM tokens WHERE token_hash = $1 AND revoked_at IS NULL FOR UPDATE',
          [digest]
        )
      ).rows[0];
      if (rec && rec.user_id === userId && timingSafeHexEqual(digest, rec.token_hash)) {
        await tx.query('UPDATE tokens SET revoked_at = $1 WHERE token_id = $2', [
          String(Date.now()),
          rec.token_id
        ]);
        return { ok: true, revoked: true, tokenId: rec.token_id };
      }
      return { ok: true, revoked: false, tokenId: null };
    });
  }

  async function listSessionsForUser(userId, currentRawToken = null) {
    await ensureSchema();
    const currentDigest = currentRawToken ? sha256Hex(currentRawToken) : null;
    const rows = (
      await pg.query(
        `SELECT token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at
         FROM tokens
         WHERE user_id = $1
         ORDER BY CAST(created_at AS BIGINT) DESC`,
        [userId]
      )
    ).rows;
    return rows.map(rec => ({
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

  async function listUsersAndSessions() {
    await ensureSchema();
    const users = (
      await pg.query(
        'SELECT user_id, display_name, disabled, created_at, updated_at FROM users ORDER BY created_at ASC'
      )
    ).rows;
    const result = [];
    for (const user of users) {
      result.push({
        ...toPublicUser(user),
        sessions: await listSessionsForUser(user.user_id)
      });
    }
    return result;
  }

  return {
    driver: 'postgres',
    authPath: 'postgresql',
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
    async close() {
      if (ownsPg) {
        await pg.close();
      }
    }
  };
}
