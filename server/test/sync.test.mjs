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

test('server isolates colliding card/quickNote entityIds and media blobs per workspace', async () => {
  // 1. Push identical card & quickNote entityIds to default vs private:bob
  const defaultPush = await api('/api/v1/sync/push', {
    userId: 'alice',
    token: 'tok_alice_123',
    method: 'POST',
    body: {
      workspaceId: 'default',
      entries: [
        {
          entityKind: 'card',
          entityId: 'shared-collision-card',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'todo',
            title: '共享区卡片',
            content: 'default content',
            position: '000G',
            baseRevision: 0,
            updatedAt: '5000',
            subtasks: [],
            attachments: []
          }
        },
        {
          entityKind: 'quickNote',
          entityId: 'shared-collision-note',
          operation: 'upsert',
          payload: {
            title: '共享区快记',
            content: 'default note',
            pinned: false,
            favorite: false,
            createdAt: '5000',
            updatedAt: '5000'
          }
        }
      ]
    }
  });
  assert.equal(defaultPush.status, 200);

  const bobPrivatePush = await api('/api/v1/sync/push', {
    userId: 'bob',
    token: 'tok_bob_456',
    method: 'POST',
    body: {
      workspaceId: 'private:bob',
      entries: [
        {
          entityKind: 'card',
          entityId: 'shared-collision-card',
          operation: 'upsert',
          payload: {
            boardId: 'default-board',
            columnId: 'doing',
            title: 'Bob 私人卡片',
            content: 'private bob content',
            position: '000G',
            baseRevision: 0,
            updatedAt: '6000',
            subtasks: [],
            attachments: []
          }
        },
        {
          entityKind: 'quickNote',
          entityId: 'shared-collision-note',
          operation: 'upsert',
          payload: {
            title: 'Bob 私人快记',
            content: 'private bob note',
            pinned: true,
            favorite: false,
            createdAt: '6000',
            updatedAt: '6000'
          }
        }
      ]
    }
  });
  assert.equal(bobPrivatePush.status, 200);

  const pullDefault = await api('/api/v1/sync/pull?workspaceId=default', {
    userId: 'alice',
    token: 'tok_alice_123'
  });
  const defaultCard = pullDefault.data.cards.find(c => c.id === 'shared-collision-card');
  const defaultNote = pullDefault.data.quickNotes.find(n => n.id === 'shared-collision-note');
  assert.equal(defaultCard?.title, '共享区卡片');
  assert.equal(defaultNote?.title, '共享区快记');

  const pullPrivateBob = await api('/api/v1/sync/pull?workspaceId=private:bob', {
    userId: 'bob',
    token: 'tok_bob_456'
  });
  const privCard = pullPrivateBob.data.cards.find(c => c.id === 'shared-collision-card');
  const privNote = pullPrivateBob.data.quickNotes.find(n => n.id === 'shared-collision-note');
  assert.equal(privCard?.title, 'Bob 私人卡片');
  assert.equal(privNote?.title, 'Bob 私人快记');

  // 2. Private-workspace media blob cannot be read from default workspace
  const secretBytes = Buffer.from('bob-private-secret-image-payload');
  const secretSha = crypto.createHash('sha256').update(secretBytes).digest('hex');
  const privPresign = await api('/api/v1/media/presign?workspaceId=private:bob', {
    userId: 'bob',
    token: 'tok_bob_456',
    method: 'POST',
    body: { sha256: secretSha, mimeType: 'image/png' }
  });
  assert.equal(privPresign.status, 200);
  const putPriv = await api(`${privPresign.data.originalUploadPath}?workspaceId=private:bob`, {
    userId: 'bob',
    token: 'tok_bob_456',
    method: 'PUT',
    raw: secretBytes,
    headers: { 'x-tidydesk-sha256': secretSha }
  });
  assert.equal(putPriv.status, 200);

  const crossWsRead = await api(`${privPresign.data.originalUploadPath}?workspaceId=default`, {
    userId: 'alice',
    token: 'tok_alice_123'
  });
  assert.equal(crossWsRead.status, 403);

  const ownerWsRead = await api(`${privPresign.data.originalUploadPath}?workspaceId=private:bob`, {
    userId: 'bob',
    token: 'tok_bob_456'
  });
  assert.equal(ownerWsRead.status, 200);
  assert.equal(ownerWsRead.data.toString(), secretBytes.toString());
});

test('sync server serves mobile PWA manifest and SPA html when webDistDir is configured', async () => {
  const webRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-web-dist-'));
  const dataRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-web-data-'));
  fs.mkdirSync(path.join(webRoot, 'assets'), { recursive: true });
  fs.writeFileSync(path.join(webRoot, 'index.html'), '<!doctype html><html><body>TidyDesk Mobile</body></html>');
  fs.writeFileSync(path.join(webRoot, 'assets', 'app-abc123.js'), 'console.log("ok");');
  fs.writeFileSync(
    path.join(webRoot, 'manifest.webmanifest'),
    JSON.stringify({ name: 'TidyDesk', start_url: '/?mode=mobile', display: 'standalone' })
  );

  const { server: webSrv } = createSyncServer({
    dataDir: dataRoot,
    webDistDir: webRoot
  });
  await new Promise(resolve => webSrv.listen(0, '127.0.0.1', resolve));
  try {
    const port = webSrv.address().port;
    const healthRes = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(healthRes.status, 200);
    const healthJson = await healthRes.json();
    assert.equal(healthJson.ok, true);
    assert.equal(healthJson.version, 1);
    assert.ok(typeof healthJson.appVersion === 'string' && healthJson.appVersion.length > 0);

    const htmlRes = await fetch(`http://127.0.0.1:${port}/?mode=mobile`);
    assert.equal(htmlRes.status, 200);
    assert.match(htmlRes.headers.get('content-type') || '', /text\/html/);
    assert.equal(htmlRes.headers.get('cache-control'), 'no-cache');
    assert.match(await htmlRes.text(), /TidyDesk Mobile/);

    const manifestRes = await fetch(`http://127.0.0.1:${port}/manifest.webmanifest`);
    assert.equal(manifestRes.status, 200);
    assert.match(manifestRes.headers.get('content-type') || '', /application\/manifest\+json/);
    assert.equal(manifestRes.headers.get('cache-control'), 'no-cache');
    const parsedManifest = await manifestRes.json();
    assert.equal(parsedManifest.start_url, '/?mode=mobile');

    const assetRes = await fetch(`http://127.0.0.1:${port}/assets/app-abc123.js`);
    assert.equal(assetRes.status, 200);
    assert.equal(assetRes.headers.get('cache-control'), 'public, max-age=31536000, immutable');
  } finally {
    await new Promise(resolve => webSrv.close(resolve));
    fs.rmSync(webRoot, { recursive: true, force: true });
    fs.rmSync(dataRoot, { recursive: true, force: true });
  }
});

test('sync store baseline preserves monotonic cursors, tombstones, and data across server restarts', async () => {
  const persistDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-persist-baseline-'));
  const srvA = createSyncServer({
    dataDir: persistDir,
    tokensMap: { alice: 'tok_alice_persist' },
    allowAnyDevToken: false
  });
  await new Promise(resolve => srvA.server.listen(0, '127.0.0.1', resolve));
  const urlA = `http://127.0.0.1:${srvA.server.address().port}`;
  let afterUpsertCursor = '0';
  let afterDeleteCursor = '0';

  try {
    const pushUpsert = await fetch(`${urlA}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok_alice_persist',
        'X-TidyDesk-User': 'alice',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workspaceId: 'default',
        entries: [
          {
            entityKind: 'card',
            entityId: 'card-persist-1',
            operation: 'upsert',
            payload: { title: '持久卡片', boardId: 'default-board', columnId: 'todo', position: 'a0' }
          },
          {
            entityKind: 'quickNote',
            entityId: 'note-persist-1',
            operation: 'upsert',
            payload: { title: '持久速记', content: '保留 across restart', pinned: false, favorite: true }
          }
        ]
      })
    });
    assert.equal(pushUpsert.status, 200);
    const upsertBody = await pushUpsert.json();
    afterUpsertCursor = upsertBody.nextCursor;
    assert.ok(Number(afterUpsertCursor) >= 2);

    const pushDelete = await fetch(`${urlA}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok_alice_persist',
        'X-TidyDesk-User': 'alice',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workspaceId: 'default',
        entries: [
          {
            entityKind: 'quickNote',
            entityId: 'note-persist-1',
            operation: 'delete',
            payload: { id: 'note-persist-1' }
          }
        ]
      })
    });
    assert.equal(pushDelete.status, 200);
    const deleteBody = await pushDelete.json();
    afterDeleteCursor = deleteBody.nextCursor;
    assert.ok(Number(afterDeleteCursor) > Number(afterUpsertCursor));
  } finally {
    await new Promise(resolve => srvA.server.close(resolve));
  }

  // Restart a brand-new server instance against the same dataDir and verify identical state/cursors
  const srvB = createSyncServer({
    dataDir: persistDir,
    tokensMap: { alice: 'tok_alice_persist' },
    allowAnyDevToken: false
  });
  await new Promise(resolve => srvB.server.listen(0, '127.0.0.1', resolve));
  const urlB = `http://127.0.0.1:${srvB.server.address().port}`;
  try {
    const fullPull = await fetch(`${urlB}/api/v1/sync/pull?workspaceId=default&cursor=0`, {
      headers: { Authorization: 'Bearer tok_alice_persist', 'X-TidyDesk-User': 'alice' }
    });
    assert.equal(fullPull.status, 200);
    const fullBody = await fullPull.json();
    assert.equal(fullBody.nextCursor, afterDeleteCursor);
    assert.equal(fullBody.cards.filter(c => c.id === 'card-persist-1').length, 1);
    assert.ok(fullBody.removedQuickNoteIds.includes('note-persist-1'));

    const incPull = await fetch(
      `${urlB}/api/v1/sync/pull?workspaceId=default&cursor=${afterUpsertCursor}`,
      { headers: { Authorization: 'Bearer tok_alice_persist', 'X-TidyDesk-User': 'alice' } }
    );
    assert.equal(incPull.status, 200);
    const incBody = await incPull.json();
    assert.equal(incBody.nextCursor, afterDeleteCursor);
    assert.deepEqual(incBody.removedQuickNoteIds, ['note-persist-1']);
  } finally {
    await new Promise(resolve => srvB.server.close(resolve));
    fs.rmSync(persistDir, { recursive: true, force: true });
  }
});

test('sqlite cold-migrates legacy json sync/auth data atomically and preserves tokens, cursors, and .bak files', async () => {
  const migDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-mig-'));
  const cliPath = path.resolve(process.cwd(), 'server', 'src', 'cli.mjs');

  execFileSync(
    process.execPath,
    [cliPath, 'useradd', 'maya', '--password', 'maya-pass-999', '--name', 'Maya', '--driver', 'json'],
    { env: { ...process.env, TIDYDESK_DATA_DIR: migDir }, encoding: 'utf8' }
  );

  const jsonSrv = createSyncServer({
    dataDir: migDir,
    storeDriver: 'json',
    allowAnyDevToken: false
  });
  await new Promise(resolve => jsonSrv.server.listen(0, '127.0.0.1', resolve));
  const jsonUrl = `http://127.0.0.1:${jsonSrv.server.address().port}`;
  let issuedToken = '';
  let legacyCursor = '0';

  try {
    const healthJsonRes = await fetch(`${jsonUrl}/health`);
    assert.equal((await healthJsonRes.json()).storeDriver, 'json');

    const loginRes = await fetch(`${jsonUrl}/api/v1/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userId: 'maya', password: 'maya-pass-999', deviceLabel: 'LegacyPhone' })
    });
    assert.equal(loginRes.status, 200);
    issuedToken = (await loginRes.json()).token;

    const pushRes = await fetch(`${jsonUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issuedToken}`,
        'X-TidyDesk-User': 'maya',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workspaceId: 'private:maya',
        entries: [
          {
            entityKind: 'card',
            entityId: 'mig-card-1',
            operation: 'upsert',
            payload: { title: '迁移前待办', boardId: 'default-board', columnId: 'todo', position: 'a0' }
          },
          {
            entityKind: 'quickNote',
            entityId: 'mig-note-1',
            operation: 'upsert',
            payload: { title: '迁移前快记', content: 'legacy note body', pinned: true, favorite: false }
          }
        ]
      })
    });
    assert.equal(pushRes.status, 200);
    legacyCursor = (await pushRes.json()).nextCursor;
  } finally {
    await new Promise(resolve => jsonSrv.server.close(resolve));
  }

  assert.ok(fs.existsSync(path.join(migDir, 'sync-db.json')));
  assert.ok(fs.existsSync(path.join(migDir, 'users-auth.json')));

  // Inject an orphan legacy token for a deleted user to verify cold-migration guards FK safely
  const legacyAuthPath = path.join(migDir, 'users-auth.json');
  const legacyAuth = JSON.parse(fs.readFileSync(legacyAuthPath, 'utf8'));
  legacyAuth.tokens.tok_orphan_dead = {
    tokenId: 'tok_orphan_dead',
    userId: 'deleted_ghost_user',
    tokenHash: 'a'.repeat(64),
    label: 'OldDevice',
    createdAt: '1000',
    lastUsedAt: '1000',
    revokedAt: null
  };
  fs.writeFileSync(legacyAuthPath, JSON.stringify(legacyAuth, null, 2));

  // Boot explicit SQLite server against legacy JSON dataDir -> cold-migrates & creates .pre-sqlite.bak
  const sqliteSrv = createSyncServer({
    dataDir: migDir,
    storeDriver: 'sqlite',
    allowAnyDevToken: false
  });
  await new Promise(resolve => sqliteSrv.server.listen(0, '127.0.0.1', resolve));
  const sqliteUrl = `http://127.0.0.1:${sqliteSrv.server.address().port}`;

  try {
    const healthSql = await (await fetch(`${sqliteUrl}/health`)).json();
    assert.equal(healthSql.storeDriver, 'sqlite');
    assert.ok(fs.existsSync(path.join(migDir, 'tidydesk-sync.db')));
    assert.ok(fs.existsSync(path.join(migDir, 'sync-db.json.pre-sqlite.bak')));
    assert.ok(fs.existsSync(path.join(migDir, 'users-auth.json.pre-sqlite.bak')));

    // Existing issued token remains valid in SQLite without re-login
    const pullRes = await fetch(`${sqliteUrl}/api/v1/sync/pull?workspaceId=private%3Amaya&cursor=0`, {
      headers: { Authorization: `Bearer ${issuedToken}`, 'X-TidyDesk-User': 'maya' }
    });
    assert.equal(pullRes.status, 200);
    const pulled = await pullRes.json();
    assert.equal(pulled.nextCursor, legacyCursor);
    assert.equal(pulled.cards[0]?.id, 'mig-card-1');
    assert.equal(pulled.cards[0]?.title, '迁移前待办');
    assert.equal(pulled.quickNotes[0]?.id, 'mig-note-1');

    // Password verification works too & new writes advance cursor monotonically beyond legacyCursor
    const pushNext = await fetch(`${sqliteUrl}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${issuedToken}`,
        'X-TidyDesk-User': 'maya',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        workspaceId: 'private:maya',
        entries: [
          {
            entityKind: 'quickNote',
            entityId: 'mig-note-2',
            operation: 'upsert',
            payload: { title: 'SQLite 新增', content: 'after migration' }
          }
        ]
      })
    });
    assert.equal(pushNext.status, 200);
    const nextCursor = (await pushNext.json()).nextCursor;
    assert.ok(Number(nextCursor) > Number(legacyCursor));
  } finally {
    await new Promise(resolve => sqliteSrv.server.close(resolve));
    fs.rmSync(migDir, { recursive: true, force: true });
  }
});

test('unsupported store driver fails loudly and json rollback mode passes contract checks', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-driver-check-'));
  assert.throws(
    () => createSyncServer({ dataDir: dir, storeDriver: 'oracle-db' }),
    /不支持的存储驱动/
  );

  const jsonRollback = createSyncServer({
    dataDir: dir,
    storeDriver: 'json',
    tokensMap: { alice: 'tok_rollback' },
    allowAnyDevToken: false
  });
  await new Promise(resolve => jsonRollback.server.listen(0, '127.0.0.1', resolve));
  const url = `http://127.0.0.1:${jsonRollback.server.address().port}`;
  try {
    const health = await (await fetch(`${url}/health`)).json();
    assert.equal(health.storeDriver, 'json');
    const push = await fetch(`${url}/api/v1/sync/push`, {
      method: 'POST',
      headers: {
        Authorization: 'Bearer tok_rollback',
        'X-TidyDesk-User': 'alice',
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        entries: [{ entityKind: 'card', entityId: 'rb-1', operation: 'upsert', payload: { title: '回退正常' } }]
      })
    });
    assert.equal(push.status, 200);
  } finally {
    await new Promise(resolve => jsonRollback.server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
