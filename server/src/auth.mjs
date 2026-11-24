import crypto from 'node:crypto';
import { USER_ID_RE } from './fs_utils.mjs';

/**
 * Resolve token validator and workspace RBAC policy for incoming requests.
 * Combines optional env allowlist tokens with the persistent scrypt/token registry.
 * Login/auth only validates credentials without coupling business data pulls.
 */
export function createAuthService({
  tokensMap = null,
  allowAnyDevToken = true,
  userRegistry = null
} = {}) {
  const registeredTokens = new Map(Object.entries(tokensMap || {}));

  function authenticateRequest(req, bodyUserId = null) {
    const authHeader = String(req.headers.authorization || '').trim();
    const match = authHeader.match(/^Bearer\s+(.+)$/i);
    if (!match || !match[1].trim()) {
      return { ok: false, status: 401, error: 'Missing Bearer token' };
    }
    const token = match[1].trim();
    const headerUserId = String(req.headers['x-tidydesk-user'] || '').trim();
    const userId = headerUserId || (typeof bodyUserId === 'string' ? bodyUserId.trim() : '');
    if (!userId || !USER_ID_RE.test(userId) || userId.toLowerCase() === 'local') {
      return { ok: false, status: 401, error: 'Invalid or missing X-TidyDesk-User header' };
    }

    if (userRegistry?.isUserDisabled(userId)) {
      return { ok: false, status: 403, error: '该账号已被管理员禁用' };
    }

    if (registeredTokens.has(userId)) {
      const expected = registeredTokens.get(userId);
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      if (a.length === b.length && crypto.timingSafeEqual(a, b)) {
        const publicUser = userRegistry?.getUserPublic(userId);
        return {
          ok: true,
          userId,
          displayName: publicUser?.displayName || userId,
          token,
          authSource: 'env'
        };
      }
    }

    if (userRegistry) {
      const regRes = userRegistry.verifyBearerToken(userId, token);
      if (regRes.ok) {
        return {
          ok: true,
          userId: regRes.userId,
          displayName: regRes.displayName,
          token,
          tokenId: regRes.tokenId,
          authSource: 'registry'
        };
      }
      if (registeredTokens.size > 0 || userRegistry.hasRegisteredUsers()) {
        return {
          ok: false,
          status: regRes.status || 401,
          error: regRes.error || 'Token mismatch or revoked'
        };
      }
    } else if (registeredTokens.size > 0) {
      return { ok: false, status: 401, error: 'Unknown user or token mismatch' };
    }

    if (!allowAnyDevToken) {
      return { ok: false, status: 401, error: 'Server token registry is required in production' };
    }

    // In zero-config local dev mode, pin the first non-empty token per user for consistent checks.
    if (!registeredTokens.has(userId)) {
      registeredTokens.set(userId, token);
    } else if (registeredTokens.get(userId) !== token) {
      return { ok: false, status: 401, error: 'Token mismatch for user session' };
    }
    return { ok: true, userId, displayName: userId, token, authSource: 'dev' };
  }

  return { authenticateRequest };
}

export function canWriteWorkspace(role) {
  return role === 'owner' || role === 'admin' || role === 'member';
}
