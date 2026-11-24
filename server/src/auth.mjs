import crypto from 'node:crypto';

/**
 * Resolve token validator and workspace RBAC policy for incoming requests.
 * Login/auth only validates User ID + Token without coupling business data pulls.
 */
export function createAuthService({ tokensMap = null, allowAnyDevToken = true } = {}) {
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
    if (!userId || !/^[a-zA-Z0-9_-]{1,64}$/.test(userId) || userId.toLowerCase() === 'local') {
      return { ok: false, status: 401, error: 'Invalid or missing X-TidyDesk-User header' };
    }

    if (registeredTokens.size > 0) {
      const expected = registeredTokens.get(userId);
      if (!expected) {
        return { ok: false, status: 401, error: 'Unknown user or revoked token' };
      }
      const a = Buffer.from(expected);
      const b = Buffer.from(token);
      if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
        return { ok: false, status: 401, error: 'Token mismatch' };
      }
      return { ok: true, userId };
    }

    if (!allowAnyDevToken) {
      return { ok: false, status: 401, error: 'Server token registry is required in production' };
    }

    // In local dev mode, pin the first non-empty token per user for consistent verification.
    if (!registeredTokens.has(userId)) {
      registeredTokens.set(userId, token);
    } else if (registeredTokens.get(userId) !== token) {
      return { ok: false, status: 401, error: 'Token mismatch for user session' };
    }
    return { ok: true, userId };
  }

  return { authenticateRequest };
}

export function canWriteWorkspace(role) {
  return role === 'owner' || role === 'admin' || role === 'member';
}
