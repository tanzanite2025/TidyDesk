import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createAuthService, canWriteWorkspace } from './auth.mjs';
import { sanitizeWorkspaceId } from './fs_utils.mjs';
import { createSyncStore } from './store.mjs';
import { createUserRegistry } from './users.mjs';

const SERVER_PACKAGE_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const MAX_JSON_BYTES = 16 * 1024 * 1024;
const MAX_BLOB_BYTES = 25 * 1024 * 1024;

const MIME_BY_EXT = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.mjs': 'application/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon'
};

function resolveDefaultWebDistDir() {
  const candidates = [
    process.env.TIDYDESK_WEB_DIST_DIR,
    path.join(SERVER_PACKAGE_DIR, 'dist'),
    path.resolve(process.cwd(), 'dist'),
    path.resolve(SERVER_PACKAGE_DIR, '..', 'dist')
  ].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (fs.existsSync(path.join(resolved, 'index.html'))) {
      return resolved;
    }
  }
  return path.resolve(process.cwd(), 'dist');
}

function resolveDefaultDataDir() {
  if (process.env.TIDYDESK_DATA_DIR) {
    return path.resolve(process.env.TIDYDESK_DATA_DIR);
  }
  if (fs.existsSync(path.join(process.cwd(), 'server', 'src'))) {
    return path.resolve(process.cwd(), 'server', 'data');
  }
  return path.join(SERVER_PACKAGE_DIR, 'data');
}

function applyCorsHeaders(res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader(
    'Access-Control-Allow-Headers',
    'Authorization, Content-Type, X-TidyDesk-User, x-tidydesk-sha256'
  );
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, OPTIONS');
}

function sendJson(res, status, payload) {
  applyCorsHeaders(res);
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body)
  });
  res.end(body);
}

function readBuffer(req, maxBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    req.on('data', chunk => {
      total += chunk.length;
      if (total > maxBytes) {
        reject(new Error(`Payload exceeds ${maxBytes} bytes`));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function readJsonBody(req) {
  const buf = await readBuffer(req, MAX_JSON_BYTES);
  if (buf.length === 0) return {};
  return JSON.parse(buf.toString('utf8'));
}

function tryServeStaticWeb(webDistDir, pathname, res) {
  if (!webDistDir || !fs.existsSync(webDistDir)) return false;
  const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
  if (!rel || rel.includes('..') || rel.includes('\\')) return false;
  const rootResolved = path.resolve(webDistDir);
  let target = path.resolve(rootResolved, rel);
  if (!target.startsWith(rootResolved + path.sep) && target !== rootResolved) {
    return false;
  }
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    // Fallback to index.html for SPA routes when no extension is requested
    if (path.extname(rel)) return false;
    target = path.join(rootResolved, 'index.html');
    if (!fs.existsSync(target)) return false;
  }
  const ext = path.extname(target).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || 'application/octet-stream';
  const buf = fs.readFileSync(target);
  applyCorsHeaders(res);
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': buf.length,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600'
  });
  res.end(buf);
  return true;
}

export function createSyncServer({
  dataDir = resolveDefaultDataDir(),
  webDistDir = resolveDefaultWebDistDir(),
  tokensMap = null,
  allowAnyDevToken = process.env.NODE_ENV !== 'production'
} = {}) {
  const userRegistry = createUserRegistry(dataDir);
  const auth = createAuthService({ tokensMap, allowAnyDevToken, userRegistry });
  const store = createSyncStore(dataDir);
  const sseSubscribers = new Map();

  function addSubscriber(workspaceId, res) {
    let set = sseSubscribers.get(workspaceId);
    if (!set) {
      set = new Set();
      sseSubscribers.set(workspaceId, set);
    }
    set.add(res);
    return () => {
      set.delete(res);
      if (set.size === 0) {
        sseSubscribers.delete(workspaceId);
      }
    };
  }

  function broadcastSyncChanged(workspaceId, payload) {
    const set = sseSubscribers.get(workspaceId);
    if (!set || set.size === 0) return;
    const frame = `event: sync-changed\ndata: ${JSON.stringify(payload)}\n\n`;
    for (const res of set) {
      if (!res.destroyed) {
        res.write(frame);
      }
    }
  }

  const heartbeatTimer = setInterval(() => {
    for (const set of sseSubscribers.values()) {
      for (const res of set) {
        if (!res.destroyed) {
          res.write(': keep-alive\n\n');
        }
      }
    }
  }, 25_000);
  heartbeatTimer.unref?.();

  const server = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', 'http://localhost');
      const pathname = url.pathname;
      const method = (req.method || 'GET').toUpperCase();

      if (method === 'OPTIONS') {
        applyCorsHeaders(res);
        res.writeHead(204);
        res.end();
        return;
      }

      if (method === 'GET' && pathname === '/health') {
        sendJson(res, 200, { ok: true, service: 'tidydesk-sync-server', version: 1 });
        return;
      }

      if (method === 'GET' && !pathname.startsWith('/api/')) {
        if (tryServeStaticWeb(webDistDir, pathname, res)) {
          return;
        }
      }

      if (method === 'POST' && pathname === '/api/v1/auth/login') {
        const body = await readJsonBody(req);
        const resAuth = userRegistry.verifyPassword(body.userId, body.password);
        if (!resAuth.ok) {
          sendJson(res, resAuth.status || 401, { error: resAuth.error });
          return;
        }
        const rawLabel =
          typeof body.deviceLabel === 'string' && body.deviceLabel.trim()
            ? body.deviceLabel.trim()
            : 'device';
        const issued = userRegistry.issueToken({
          userId: resAuth.user.userId,
          label: rawLabel
        });
        sendJson(res, 200, {
          ok: true,
          userId: issued.userId,
          displayName: issued.displayName,
          token: issued.token,
          tokenId: issued.tokenId,
          label: issued.label
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/verify') {
        const body = await readJsonBody(req);
        const authRes = auth.authenticateRequest(req, body.userId);
        if (!authRes.ok) {
          sendJson(res, authRes.status, { error: authRes.error });
          return;
        }
        const safeWsId = sanitizeWorkspaceId(body.workspaceId, 'default');
        const role = store.ensureWorkspaceAccess(authRes.userId, safeWsId);
        sendJson(res, 200, {
          ok: true,
          userId: authRes.userId,
          displayName: authRes.displayName || authRes.userId,
          workspaceId: safeWsId,
          role
        });
        return;
      }

      const authRes = auth.authenticateRequest(req);
      if (!authRes.ok) {
        sendJson(res, authRes.status, { error: authRes.error });
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/logout') {
        const revoked = userRegistry.revokeTokenByValue(authRes.userId, authRes.token);
        sendJson(res, 200, revoked);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/password') {
        const body = await readJsonBody(req);
        const pwdCheck = userRegistry.verifyPassword(authRes.userId, body.oldPassword);
        if (!pwdCheck.ok) {
          sendJson(res, pwdCheck.status || 401, { error: pwdCheck.error || '原密码校验失败' });
          return;
        }
        userRegistry.setPassword({
          userId: authRes.userId,
          newPassword: body.newPassword,
          revokeAll: Boolean(body.revokeAll)
        });
        sendJson(res, 200, { ok: true });
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/auth/sessions') {
        sendJson(res, 200, {
          sessions: userRegistry.listSessionsForUser(authRes.userId, authRes.token)
        });
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/auth/sessions/revoke') {
        const body = await readJsonBody(req);
        const tokenId = String(body.tokenId || '').trim();
        if (!tokenId) {
          sendJson(res, 400, { error: '缺少待吊销的 tokenId' });
          return;
        }
        const revoked = userRegistry.revokeTokenById({
          userId: authRes.userId,
          tokenId,
          isAdmin: false
        });
        sendJson(res, 200, { ok: true, ...revoked });
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/workspaces') {
        sendJson(res, 200, {
          workspaces: store.listWorkspacesForUser(authRes.userId)
        });
        return;
      }

      const workspaceId = sanitizeWorkspaceId(url.searchParams.get('workspaceId'), 'default');
      const role = store.ensureWorkspaceAccess(authRes.userId, workspaceId);

      if (method === 'GET' && pathname === '/api/v1/sync/events') {
        applyCorsHeaders(res);
        res.writeHead(200, {
          'Content-Type': 'text/event-stream; charset=utf-8',
          'Cache-Control': 'no-cache, no-transform',
          Connection: 'keep-alive'
        });
        const snapshot = store.pullSince({ workspaceId, cursor: null });
        res.write(
          `event: ready\ndata: ${JSON.stringify({
            workspaceId,
            cursor: snapshot.nextCursor
          })}\n\n`
        );
        const detach = addSubscriber(workspaceId, res);
        req.on('close', detach);
        res.on('close', detach);
        return;
      }

      if (method === 'POST' && pathname === '/api/v1/media/presign') {
        if (!canWriteWorkspace(role)) {
          sendJson(res, 403, { error: 'Workspace viewer cannot upload media' });
          return;
        }
        const body = await readJsonBody(req);
        const presigned = store.presignMedia({ ...body, workspaceId });
        sendJson(res, 200, presigned);
        return;
      }

      const blobMatch = pathname.match(/^\/api\/v1\/media\/blob\/(thumb|original)\/([^/]+)$/);
      if (blobMatch) {
        const [, kind, key] = blobMatch;
        if (method === 'PUT') {
          if (!canWriteWorkspace(role)) {
            sendJson(res, 403, { error: 'Workspace viewer cannot upload media' });
            return;
          }
          const buf = await readBuffer(req, MAX_BLOB_BYTES);
          const sha256 = String(req.headers['x-tidydesk-sha256'] || '');
          store.writeBlob({ kind, key, buffer: buf, sha256, workspaceId });
          sendJson(res, 200, { ok: true, kind, key, sizeBytes: buf.length });
          return;
        }
        if (method === 'GET') {
          const buf = store.readBlob({ kind, key });
          if (!buf) {
            sendJson(res, 404, { error: 'Media blob not found' });
            return;
          }
          if (!store.canReadBlob({ key, workspaceId })) {
            sendJson(res, 403, { error: 'Media blob is not accessible in this workspace' });
            return;
          }
          const contentType = key.endsWith('.jpg')
            ? 'image/jpeg'
            : key.endsWith('.webp')
              ? 'image/webp'
              : 'image/png';
          applyCorsHeaders(res);
          res.writeHead(200, {
            'Content-Type': contentType,
            'Content-Length': buf.length,
            'Cache-Control': 'private, max-age=31536000, immutable'
          });
          res.end(buf);
          return;
        }
      }

      if (method === 'POST' && pathname === '/api/v1/sync/push') {
        const body = await readJsonBody(req);
        const targetWorkspaceId = sanitizeWorkspaceId(body.workspaceId, workspaceId);
        const targetRole = store.ensureWorkspaceAccess(authRes.userId, targetWorkspaceId);
        if (!canWriteWorkspace(targetRole)) {
          sendJson(res, 403, { error: 'Workspace viewer cannot push changes' });
          return;
        }
        const entries = Array.isArray(body.entries) ? body.entries : [];
        const result = store.pushEntries({
          workspaceId: targetWorkspaceId,
          actorId: authRes.userId,
          entries
        });
        if (result.acked.length > 0) {
          broadcastSyncChanged(targetWorkspaceId, {
            workspaceId: targetWorkspaceId,
            cursor: result.nextCursor,
            actorId: authRes.userId,
            entityKinds: Array.from(new Set(entries.map(e => e.entityKind).filter(Boolean)))
          });
        }
        sendJson(res, 200, result);
        return;
      }

      if (method === 'GET' && pathname === '/api/v1/sync/pull') {
        const cursor = url.searchParams.get('cursor');
        const pulled = store.pullSince({ workspaceId, cursor });
        sendJson(res, 200, pulled);
        return;
      }

      sendJson(res, 404, { error: `Unknown route: ${method} ${pathname}` });
    } catch (err) {
      const status =
        err && typeof err === 'object' && 'status' in err && typeof err.status === 'number'
          ? err.status
          : 500;
      sendJson(res, status, { error: err instanceof Error ? err.message : String(err) });
    }
  });

  server.on('close', () => {
    clearInterval(heartbeatTimer);
    for (const set of sseSubscribers.values()) {
      for (const res of set) {
        if (!res.destroyed) res.end();
      }
      set.clear();
    }
    sseSubscribers.clear();
  });

  return { server, store, users: userRegistry };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const port =
    process.env.PORT !== undefined && process.env.PORT !== '' ? Number(process.env.PORT) : 8787;
  const host = process.env.HOST || '0.0.0.0';
  const tokensMap = process.env.TIDYDESK_SYNC_TOKENS
    ? JSON.parse(process.env.TIDYDESK_SYNC_TOKENS)
    : null;
  const { server } = createSyncServer({
    dataDir: resolveDefaultDataDir(),
    tokensMap
  });
  server.listen(port, host, () => {
    const addr = server.address();
    const actualPort = typeof addr === 'object' && addr ? addr.port : port;
    console.log(`[TIDYDESK-SYNC] Listening on http://${host}:${actualPort}`);
    console.log(`[TIDYDESK-SYNC] Mobile H5 URL: http://127.0.0.1:${actualPort}/?mode=mobile`);
  });
}
