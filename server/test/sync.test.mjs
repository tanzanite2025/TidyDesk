import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { after, before, test } from 'node:test';
import { createSyncServer } from '../src/index.mjs';

let baseUrl = '';
let srv = null;
let storeHandle = null;
let tmpDir = '';

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-sync-srv-'));
  const created = createSyncServer({
    dataDir: tmpDir,
    tokensMap: {
      alice: 'tok_alice_123',
      bob: 'tok_bob_456',
      viewer_u: 'tok_view_789'
    },
    allowAnyDevToken: false
  });
  srv = created.server;
  storeHandle = created.store;
  await new Promise(resolve => srv.listen(0, '127.0.0.1', resolve));
  const addr = srv.address();
  baseUrl = `http://127.0.0.1:${addr.port}`;
});

after(async () => {
  await new Promise(resolve => srv.close(resolve));
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

async function api(route, { userId, token, method = 'GET', body = null, raw = null, headers = {} }) {
  const res = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(userId ? { 'X-TidyDesk-User': userId } : {}),
      ...(body !== null ? { 'Content-Type': 'application/json' } : {}),
      ...headers
    },
    body: body !== null ? JSON.stringify(body) : raw
  });
  const ct = res.headers.get('content-type') || '';
  const data = ct.includes('application/json')
    ? await res.json()
    : Buffer.from(await res.arrayBuffer());
  return { status: res.status, data };
}

test('auth verify and RBAC viewer restrictions are enforced', async () => {
  const unauth = await api('/api/v1/sync/pull', { userId: 'alice', token: 'wrong' });
  assert.equal(unauth.status, 401);

  storeHandle.setWorkspaceRole('default', 'viewer_u', 'viewer');
  const forbidden = await api('/api/v1/sync/push', {
    userId: 'viewer_u',
    token: 'tok_view_789',
    method: 'POST',
    body: { entries: [] }
  });
  assert.equal(forbidden.status, 403);
});

test('media presign deduplicates identical sha256 and serves blobs', async () => {
  const origBytes = Buffer.from('fake-png-original-binary');
  const thumbBytes = Buffer.from('fake-png-thumb');
  const sha = crypto.createHash('sha256').update(origBytes).digest('hex');

  const pre1 = await api('/api/v1/media/presign', {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'POST',
    body: { sha256: sha, mimeType: 'image/png' }
  });
  assert.equal(pre1.status, 200);
  assert.equal(pre1.data.deduplicated, false);

  await api(pre1.data.thumbUploadPath, {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'PUT',
    raw: thumbBytes
  });
  await api(pre1.data.originalUploadPath, {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'PUT',
    raw: origBytes,
    headers: { 'x-tidydesk-sha256': sha }
  });

  const pre2 = await api('/api/v1/media/presign', {
    userId: 'bob',
    token: 'tok_bob_456',
    method: 'POST',
    body: { sha256: sha, mimeType: 'image/png' }
  });
  assert.equal(pre2.data.deduplicated, true);

  const fetchedOrig = await api(pre2.data.originalUploadPath, {
    userId: 'bob',
    token: 'tok_bob_456'
  });
  assert.equal(fetchedOrig.status, 200);
  assert.equal(fetchedOrig.data.toString(), origBytes.toString());
});

test('push/pull merges concurrent subtask and attachment updates cleanly', async () => {
  const push1 = await api('/api/v1/sync/push', {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'POST',
    body: {
      entries: [
        {
          entityKind: 'card',
          entityId: 'card-merge-1',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'todo',
            title: '设备巡检',
            content: '初始描述',
            position: '000G',
            baseRevision: 0,
            revision: 1,
            updatedAt: '1000',
            subtasks: [
              { id: 'sub-a', title: '步骤A', completed: false, updatedAt: '1000', attachments: [] },
              { id: 'sub-b', title: '步骤B', completed: false, updatedAt: '1000', attachments: [] }
            ],
            attachments: []
          }
        }
      ]
    }
  });
  assert.equal(push1.status, 200);
  assert.equal(push1.data.acked.length, 1);

  // Alice marks sub-a completed concurrently
  await api('/api/v1/sync/push', {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'POST',
    body: {
      entries: [
        {
          entityKind: 'card',
          entityId: 'card-merge-1',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'todo',
            title: '设备巡检',
            content: '桌面端补充说明',
            position: '000G',
            baseRevision: 1,
            revision: 2,
            updatedAt: '2000',
            subtasks: [
              { id: 'sub-a', title: '步骤A', completed: true, updatedAt: '2000', attachments: [] },
              { id: 'sub-b', title: '步骤B', completed: false, updatedAt: '1000', attachments: [] }
            ],
            attachments: []
          }
        }
      ]
    }
  });

  // Bob offline edits sub-b attachment from stale baseRevision 1
  const pushBob = await api('/api/v1/sync/push', {
    userId: 'bob',
    token: 'tok_bob_456',
    method: 'POST',
    body: {
      entries: [
        {
          entityKind: 'card',
          entityId: 'card-merge-1',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'todo',
            title: '设备巡检',
            content: '手机端补充描述',
            position: '000G',
            baseRevision: 1,
            revision: 2,
            updatedAt: '2100',
            subtasks: [
              { id: 'sub-a', title: '步骤A', completed: false, updatedAt: '1000', attachments: [] },
              {
                id: 'sub-b',
                title: '步骤B',
                completed: false,
                updatedAt: '2100',
                attachments: [{ id: 'att-phone', fileName: 'att-phone.png', updatedAt: '2100' }]
              }
            ],
            attachments: []
          }
        }
      ]
    }
  });
  assert.equal(pushBob.status, 200);
  const mergedCard = pushBob.data.mergedCards[0];
  assert.equal(mergedCard.subtasks.find(s => s.id === 'sub-a').completed, true);
  assert.equal(mergedCard.subtasks.find(s => s.id === 'sub-b').attachments[0].id, 'att-phone');
  assert.ok(mergedCard.content.includes('多端并发冲突保留副本'));

  const pullAlice = await api('/api/v1/sync/pull?cursor=0', {
    userId: 'alice',
    token: 'tok_alice_123'
  });
  assert.equal(pullAlice.status, 200);
  assert.equal(pullAlice.data.cards.length, 1);
  assert.equal(pullAlice.data.cards[0].subtasks.length, 2);
});

test('realtime SSE channel broadcasts sync-changed immediately upon push', async () => {
  const controller = new AbortController();
  const streamRes = await fetch(`${baseUrl}/api/v1/sync/events?workspaceId=default`, {
    headers: {
      Authorization: 'Bearer tok_alice_123',
      'X-TidyDesk-User': 'alice'
    },
    signal: controller.signal
  });
  assert.equal(streamRes.status, 200);
  const reader = streamRes.body.getReader();
  const decoder = new TextDecoder();

  let buffer = '';
  const readUntilEvent = async targetEvent => {
    for (let i = 0; i < 20; i += 1) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      if (buffer.includes(`event: ${targetEvent}`)) {
        return buffer;
      }
    }
    return buffer;
  };

  const readyText = await readUntilEvent('ready');
  assert.ok(readyText.includes('event: ready'));

  const pushRes = await api('/api/v1/sync/push', {
    userId: 'bob',
    token: 'tok_bob_456',
    method: 'POST',
    body: {
      entries: [
        {
          entityKind: 'card',
          entityId: 'card-sse-1',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'todo',
            title: '手机拍照任务实时推送测试',
            content: '',
            position: '000G',
            baseRevision: 0,
            revision: 1,
            updatedAt: '3000',
            subtasks: [],
            attachments: []
          }
        }
      ]
    }
  });
  assert.equal(pushRes.status, 200);

  const eventText = await readUntilEvent('sync-changed');
  assert.ok(eventText.includes('event: sync-changed'));
  assert.ok(eventText.includes('"actorId":"bob"'));
  controller.abort();
});

test('password login, hot-reload CLI, device session revocation, and private workspace isolation', async () => {
  // Spawn CLI in a separate process against same tmpDir to test hot-reload without restarting server
  const cliPath = path.resolve(process.cwd(), 'server', 'src', 'cli.mjs');
  execFileSync(
    process.execPath,
    [cliPath, 'useradd', 'carol', '--password', 'carol-pass-123', '--name', 'Carol'],
    {
      env: { ...process.env, TIDYDESK_DATA_DIR: tmpDir },
      encoding: 'utf8'
    }
  );

  // Wrong password rejected loudly
  const badLogin = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { userId: 'carol', password: 'wrong-password' }
  });
  assert.equal(badLogin.status, 401);

  // Valid password issues device tokens with zero business data attached
  const phoneLogin = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { userId: 'carol', password: 'carol-pass-123', deviceLabel: 'Phone-A' }
  });
  assert.equal(phoneLogin.status, 200);
  assert.equal(phoneLogin.data.userId, 'carol');
  assert.equal(phoneLogin.data.displayName, 'Carol');
  assert.ok(phoneLogin.data.token.startsWith('tdk_'));
  assert.equal(phoneLogin.data.cards, undefined);

  const pcLogin = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { userId: 'carol', password: 'carol-pass-123', deviceLabel: 'PC-Win' }
  });
  assert.equal(pcLogin.status, 200);

  // List sessions and revoke Phone-A without affecting PC-Win
  const sessionsRes = await api('/api/v1/auth/sessions', {
    userId: 'carol',
    token: pcLogin.data.token
  });
  assert.equal(sessionsRes.status, 200);
  assert.equal(sessionsRes.data.sessions.length, 2);
  const currentSess = sessionsRes.data.sessions.find(s => s.isCurrent);
  assert.equal(currentSess.tokenId, pcLogin.data.tokenId);

  const revokeRes = await api('/api/v1/auth/sessions/revoke', {
    userId: 'carol',
    token: pcLogin.data.token,
    method: 'POST',
    body: { tokenId: phoneLogin.data.tokenId }
  });
  assert.equal(revokeRes.status, 200);

  const revokedPull = await api('/api/v1/sync/pull', {
    userId: 'carol',
    token: phoneLogin.data.token
  });
  assert.equal(revokedPull.status, 401);

  // Private workspace isolation: alice cannot access private:carol
  const aliceCrossPull = await api('/api/v1/sync/pull?workspaceId=private%3Acarol', {
    userId: 'alice',
    token: 'tok_alice_123'
  });
  assert.equal(aliceCrossPull.status, 403);

  const aliceCrossPush = await api('/api/v1/sync/push', {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'POST',
    body: { workspaceId: 'private:carol', entries: [] }
  });
  assert.equal(aliceCrossPush.status, 403);

  // Carol pushes to her private:carol workspace; default workspace stays separate
  const wsRes = await api('/api/v1/workspaces', {
    userId: 'carol',
    token: pcLogin.data.token
  });
  assert.equal(wsRes.status, 200);
  assert.ok(wsRes.data.workspaces.some(w => w.workspaceId === 'private:carol' && w.isPrivate));

  const carolPrivatePush = await api('/api/v1/sync/push', {
    userId: 'carol',
    token: pcLogin.data.token,
    method: 'POST',
    body: {
      workspaceId: 'private:carol',
      entries: [
        {
          entityKind: 'card',
          entityId: 'card-carol-priv',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'todo',
            title: 'Carol 私人待办',
            content: '仅自己可见',
            position: '000G',
            baseRevision: 0,
            updatedAt: '4000',
            subtasks: [],
            attachments: []
          }
        }
      ]
    }
  });
  assert.equal(carolPrivatePush.status, 200);

  const defaultPull = await api('/api/v1/sync/pull?workspaceId=default', {
    userId: 'bob',
    token: 'tok_bob_456'
  });
  assert.ok(!defaultPull.data.cards.some(c => c.id === 'card-carol-priv'));

  const carolPrivatePull = await api('/api/v1/sync/pull?workspaceId=private:carol', {
    userId: 'carol',
    token: pcLogin.data.token
  });
  assert.equal(carolPrivatePull.data.cards.length, 1);
  assert.equal(carolPrivatePull.data.cards[0].title, 'Carol 私人待办');

  // Too-short newPassword returns 400 and unknown tokenId returns 404 (never 500)
  const shortPwd = await api('/api/v1/auth/password', {
    userId: 'carol',
    token: pcLogin.data.token,
    method: 'POST',
    body: { oldPassword: 'carol-pass-123', newPassword: '12' }
  });
  assert.equal(shortPwd.status, 400);

  const missingRevoke = await api('/api/v1/auth/sessions/revoke', {
    userId: 'carol',
    token: pcLogin.data.token,
    method: 'POST',
    body: { tokenId: 'tok_nonexistent' }
  });
  assert.equal(missingRevoke.status, 404);

  // Password change & CLI disable hot-reload check
  const changePwd = await api('/api/v1/auth/password', {
    userId: 'carol',
    token: pcLogin.data.token,
    method: 'POST',
    body: { oldPassword: 'carol-pass-123', newPassword: 'carol-new-pass-456' }
  });
  assert.equal(changePwd.status, 200);

  const loginNewPwd = await api('/api/v1/auth/login', {
    method: 'POST',
    body: { userId: 'carol', password: 'carol-new-pass-456', deviceLabel: 'Tablet' }
  });
  assert.equal(loginNewPwd.status, 200);

  // Explicit logout revokes current session token
  const logoutRes = await api('/api/v1/auth/logout', {
    userId: 'carol',
    token: loginNewPwd.data.token,
    method: 'POST'
  });
  assert.equal(logoutRes.status, 200);
  assert.equal(logoutRes.data.revoked, true);

  const afterLogoutPull = await api('/api/v1/sync/pull', {
    userId: 'carol',
    token: loginNewPwd.data.token
  });
  assert.equal(afterLogoutPull.status, 401);

  // Disabling via CLI immediately revokes remaining active PC-Win token via hot-reload
  execFileSync(process.execPath, [cliPath, 'disable', 'carol'], {
    env: { ...process.env, TIDYDESK_DATA_DIR: tmpDir },
    encoding: 'utf8'
  });
  const disabledPull = await api('/api/v1/sync/pull', {
    userId: 'carol',
    token: pcLogin.data.token
  });
  assert.equal(disabledPull.status, 403);
});
