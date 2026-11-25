import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { test } from 'node:test';
import { createSyncServer } from '../src/index.mjs';
import { migrateAndReconcile } from '../src/migrate.mjs';
import { createMinioBlobStore, signS3Request } from '../src/minio_blobs.mjs';
import { createPgPool, parsePostgresUrl } from '../src/pg_client.mjs';
import { createServerStorage } from '../src/storage_factory.mjs';

function createMinioMockServer() {
  const buckets = new Set();
  const objects = new Map();
  const seenAuthHeaders = [];

  const server = http.createServer(async (req, res) => {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const body = Buffer.concat(chunks);
    const url = new URL(req.url || '/', 'http://localhost');
    const clean = url.pathname.replace(/^\/+/, '');
    const slash = clean.indexOf('/');
    const bucket = slash < 0 ? clean : clean.slice(0, slash);
    const key = slash < 0 ? '' : clean.slice(slash + 1);

    if (req.headers.authorization) {
      seenAuthHeaders.push(req.headers.authorization);
    }

    if (!key) {
      if (req.method === 'HEAD') {
        res.writeHead(buckets.has(bucket) ? 200 : 404);
        res.end();
        return;
      }
      if (req.method === 'PUT') {
        buckets.add(bucket);
        res.writeHead(200);
        res.end();
        return;
      }
    }

    const objKey = `${bucket}/${key}`;
    if (!buckets.has(bucket)) {
      res.writeHead(404);
      res.end();
      return;
    }
    if (req.method === 'PUT') {
      objects.set(objKey, { body, contentType: req.headers['content-type'] || 'application/octet-stream' });
      res.writeHead(200);
      res.end();
      return;
    }
    if (req.method === 'HEAD') {
      const hit = objects.get(objKey);
      res.writeHead(hit ? 200 : 404, hit ? { 'Content-Length': String(hit.body.length) } : {});
      res.end();
      return;
    }
    if (req.method === 'GET') {
      const hit = objects.get(objKey);
      if (!hit) {
        res.writeHead(404);
        res.end();
        return;
      }
      res.writeHead(200, {
        'Content-Type': hit.contentType,
        'Content-Length': String(hit.body.length)
      });
      res.end(hit.body);
      return;
    }
    res.writeHead(405);
    res.end();
  });

  return { server, buckets, objects, seenAuthHeaders };
}

/**
 * In-memory PostgreSQL-compatible query adapter backed by SQLite for deterministic Phase 2 CI testing
 * without requiring an external Docker PostgreSQL daemon.
 */
function createSqliteBackedPgAdapter() {
  const db = new DatabaseSync(':memory:');
  db.exec('PRAGMA foreign_keys = ON;');
  let eventSeq = 0;

  function translateSql(sql) {
    return sql
      .replace(/\$(\d+)/g, '?$1')
      .replace(/::jsonb/gi, '')
      .replace(/\bJSONB\b/gi, 'TEXT')
      .replace(/\bBOOLEAN\b/gi, 'INTEGER')
      .replace(/\bBIGINT\b/gi, 'INTEGER')
      .replace(/\bTIMESTAMPTZ\s+NOT\s+NULL\s+DEFAULT\s+NOW\(\)/gi, "TEXT NOT NULL DEFAULT ''")
      .replace(/\bBIGSERIAL\s+PRIMARY\s+KEY\b/gi, 'INTEGER PRIMARY KEY AUTOINCREMENT')
      .replace(/\bTRUE\b/g, '1')
      .replace(/\bFALSE\b/g, '0')
      .replace(/\s+FOR\s+UPDATE/gi, '');
  }

  function convertParams(params) {
    return params.map(v => {
      if (typeof v === 'boolean') return v ? 1 : 0;
      return v;
    });
  }

  async function exec(sql) {
    const trimmed = sql.trim();
    if (/^SET\s+TRANSACTION\b/i.test(trimmed)) return;
    db.exec(translateSql(sql));
  }

  async function query(sql, params = []) {
    const clean = sql.trim();
    const bindParams = convertParams(params);

    if (/^SELECT\s+setval\(/i.test(clean)) {
      const targetSeq = Number(bindParams[0] || 0);
      if (targetSeq > eventSeq) eventSeq = targetSeq;
      return { rows: [{ setval: targetSeq }], rowCount: 1 };
    }

    const translated = translateSql(clean);
    if (/RETURNING\s+seq\b/i.test(clean)) {
      eventSeq += 1;
      const insertSql = translated.replace(/RETURNING\s+seq/i, '');
      const hasSeqCol = insertSql.includes('(seq,');
      if (!hasSeqCol) {
        db.prepare(
          'INSERT INTO sync_events (seq, workspace_id, entity_kind, entity_id, operation, created_at) VALUES (?, ?, ?, ?, ?, ?)'
        ).run(eventSeq, ...bindParams);
      } else {
        db.prepare(insertSql).run(...bindParams);
      }
      return { rows: [{ seq: eventSeq }], rowCount: 1 };
    }

    if (/^(SELECT|WITH|PRAGMA)\b/i.test(translated)) {
      const rows = db.prepare(translated).all(...bindParams);
      const normalized = rows.map(r => {
        const copy = { ...r };
        if ('disabled' in copy) copy.disabled = Boolean(copy.disabled);
        return copy;
      });
      return { rows: normalized, rowCount: normalized.length };
    }

    const info = db.prepare(translated).run(...bindParams);
    return { rows: [], rowCount: Number(info.changes || 0) };
  }

  return {
    exec,
    query,
    async withTransaction(fn) {
      db.exec('BEGIN IMMEDIATE');
      try {
        const res = await fn({ exec, query });
        db.exec('COMMIT');
        return res;
      } catch (err) {
        try {
          db.exec('ROLLBACK');
        } catch {
          // Ignore rollback failure
        }
        throw err;
      }
    },
    async close() {
      db.close();
    }
  };
}

function buildPgBackendMsg(typeChar, payload) {
  const header = Buffer.allocUnsafe(5);
  header.writeUInt8(typeChar.charCodeAt(0), 0);
  header.writeInt32BE(payload.length + 4, 1);
  return Buffer.concat([header, payload]);
}

function buildPgRowDescription(cols) {
  const parts = [Buffer.allocUnsafe(2)];
  parts[0].writeInt16BE(cols.length, 0);
  for (const col of cols) {
    const meta = Buffer.allocUnsafe(18);
    meta.writeInt32BE(0, 0);
    meta.writeInt16BE(0, 4);
    meta.writeInt32BE(col.oid, 6);
    meta.writeInt16BE(-1, 10);
    meta.writeInt32BE(-1, 12);
    meta.writeInt16BE(0, 16);
    parts.push(Buffer.from(`${col.name}\0`, 'utf8'), meta);
  }
  return buildPgBackendMsg('T', Buffer.concat(parts));
}

function buildPgDataRow(values) {
  const parts = [Buffer.allocUnsafe(2)];
  parts[0].writeInt16BE(values.length, 0);
  for (const val of values) {
    if (val === null) {
      const len = Buffer.allocUnsafe(4);
      len.writeInt32BE(-1, 0);
      parts.push(len);
    } else {
      const buf = Buffer.from(String(val), 'utf8');
      const len = Buffer.allocUnsafe(4);
      len.writeInt32BE(buf.length, 0);
      parts.push(len, buf);
    }
  }
  return buildPgBackendMsg('D', Buffer.concat(parts));
}

test('MinIO AWS SigV4 blob store handles bucket creation, PUT, HEAD deduplication, GET, and errors loudly', async () => {
  const mock = createMinioMockServer();
  await new Promise(resolve => mock.server.listen(0, '127.0.0.1', resolve));
  const endpoint = `http://127.0.0.1:${mock.server.address().port}`;

  try {
    const signed = signS3Request({
      method: 'PUT',
      endpoint,
      objectPath: 'tidydesk-blobs/thumb/thumb_abc.png',
      accessKey: 'minio_user',
      secretKey: 'minio_secret',
      contentType: 'image/png',
      body: Buffer.from('hello'),
      now: new Date('2026-11-26T00:00:00.000Z')
    });
    assert.match(signed.headers.Authorization, /^AWS4-HMAC-SHA256 Credential=minio_user\/20261126\/us-east-1\/s3\/aws4_request/);
    assert.ok(signed.headers['x-amz-content-sha256'].length === 64);

    const blobStore = createMinioBlobStore({
      endpoint,
      bucket: 'tidydesk-blobs',
      accessKey: 'minio_user',
      secretKey: 'minio_secret',
      region: 'us-east-1'
    });

    const sha = 'a'.repeat(64);
    const thumbKey = `thumb_${sha}.png`;
    const origKey = `orig_${sha}.png`;
    assert.equal(await blobStore.hasBlobPair(thumbKey, origKey), false);
    assert.ok(mock.buckets.has('tidydesk-blobs'));

    await blobStore.writeBlob('thumb', thumbKey, Buffer.from('thumb-bytes'), 'image/png');
    await blobStore.writeBlob('original', origKey, Buffer.from('orig-bytes'), 'image/png');
    assert.equal(await blobStore.hasBlobPair(thumbKey, origKey), true);

    const readOrig = await blobStore.readBlob('original', origKey);
    assert.equal(readOrig?.toString(), 'orig-bytes');
    assert.equal(await blobStore.readBlob('original', `orig_${'b'.repeat(64)}.png`), null);
    assert.ok(mock.seenAuthHeaders.every(h => h.startsWith('AWS4-HMAC-SHA256')));
  } finally {
    await new Promise(resolve => mock.server.close(resolve));
  }
});

test('Zero-dependency PostgreSQL wire v3 client completes SCRAM-SHA-256 auth and typed queries over TCP', async () => {
  const parsed = parsePostgresUrl('postgres://alice:s%40cret@db.internal:5433/tidydesk?sslmode=require');
  assert.equal(parsed.user, 'alice');
  assert.equal(parsed.password, 's@cret');
  assert.equal(parsed.port, 5433);
  assert.equal(parsed.ssl, true);

  const serverPassword = 'pg-wire-password';
  const serverSalt = Buffer.from('randomsalt123456');
  const iterations = 4096;
  const saltedPwd = crypto.pbkdf2Sync(serverPassword, serverSalt, iterations, 32, 'sha256');
  const clientKey = crypto.createHmac('sha256', saltedPwd).update('Client Key').digest();
  const storedKey = crypto.createHash('sha256').update(clientKey).digest();
  const serverKey = crypto.createHmac('sha256', saltedPwd).update('Server Key').digest();

  const pgTcp = net.createServer(sock => {
    let buf = Buffer.alloc(0);
    let startupDone = false;
    let scramNonce = '';
    let serverFirst = '';
    let clientFirstBare = '';

    sock.on('data', chunk => {
      buf = Buffer.concat([buf, chunk]);
      if (!startupDone) {
        if (buf.length < 4) return;
        const len = buf.readInt32BE(0);
        if (buf.length < len) return;
        buf = buf.subarray(len);
        startupDone = true;
        // AuthenticationSASL: int32(10) + "SCRAM-SHA-256\0\0"
        const sasl = Buffer.concat([Buffer.from([0, 0, 0, 10]), Buffer.from('SCRAM-SHA-256\0\0', 'utf8')]);
        sock.write(buildPgBackendMsg('R', sasl));
        return;
      }

      while (buf.length >= 5) {
        const type = String.fromCharCode(buf.readUInt8(0));
        const len = buf.readInt32BE(1);
        if (buf.length < 1 + len) return;
        const payload = buf.subarray(5, 1 + len);
        buf = buf.subarray(1 + len);

        if (type === 'p') {
          if (!scramNonce) {
            const mechEnd = payload.indexOf(0);
            const dataLen = payload.readInt32BE(mechEnd + 1);
            const clientFirst = payload.subarray(mechEnd + 5, mechEnd + 5 + dataLen).toString('utf8');
            clientFirstBare = clientFirst.replace(/^n,,/, '');
            const cNonce = clientFirstBare.split('r=')[1];
            scramNonce = `${cNonce}srv99`;
            serverFirst = `r=${scramNonce},s=${serverSalt.toString('base64')},i=${iterations}`;
            const cont = Buffer.concat([Buffer.from([0, 0, 0, 11]), Buffer.from(serverFirst, 'utf8')]);
            sock.write(buildPgBackendMsg('R', cont));
          } else {
            const clientFinal = payload.toString('utf8');
            const proofPart = clientFinal.split(',p=')[1];
            const withoutProof = clientFinal.slice(0, clientFinal.indexOf(',p='));
            const authMsg = `${clientFirstBare},${serverFirst},${withoutProof}`;
            const clientSig = crypto.createHmac('sha256', storedKey).update(authMsg).digest();
            const recoveredClientKey = Buffer.from(proofPart, 'base64');
            for (let i = 0; i < recoveredClientKey.length; i += 1) {
              recoveredClientKey[i] ^= clientSig[i];
            }
            const recoveredStored = crypto.createHash('sha256').update(recoveredClientKey).digest();
            assert.equal(recoveredStored.toString('hex'), storedKey.toString('hex'));

            const srvSig = crypto.createHmac('sha256', serverKey).update(authMsg).digest('base64');
            const fin = Buffer.concat([Buffer.from([0, 0, 0, 12]), Buffer.from(`v=${srvSig}`, 'utf8')]);
            const authOk = Buffer.from([0, 0, 0, 0]);
            const ready = Buffer.from('I', 'utf8');
            sock.write(Buffer.concat([buildPgBackendMsg('R', fin), buildPgBackendMsg('R', authOk), buildPgBackendMsg('Z', ready)]));
          }
        } else if (type === 'S') {
          const rowDesc = buildPgRowDescription([
            { name: 'id', oid: 23 },
            { name: 'ok', oid: 16 },
            { name: 'meta', oid: 3802 }
          ]);
          const dataRow = buildPgDataRow(['42', 't', '{"title":"PG Wire OK"}']);
          const cmdDone = buildPgBackendMsg('C', Buffer.from('SELECT 1\0', 'utf8'));
          const ready = buildPgBackendMsg('Z', Buffer.from('I', 'utf8'));
          sock.write(Buffer.concat([rowDesc, dataRow, cmdDone, ready]));
        } else if (type === 'X') {
          sock.end();
        }
      }
    });
  });

  await new Promise(resolve => pgTcp.listen(0, '127.0.0.1', resolve));
  const port = pgTcp.address().port;
  const pool = createPgPool(`postgres://alice:${serverPassword}@127.0.0.1:${port}/tidydesk`);

  try {
    const res = await pool.query('SELECT id, ok, meta FROM demo WHERE id = $1', [42]);
    assert.equal(res.rowCount, 1);
    assert.deepEqual(res.rows[0], { id: 42, ok: true, meta: { title: 'PG Wire OK' } });
  } finally {
    await pool.close();
    await new Promise(resolve => pgTcp.close(resolve));
  }
});

test('Phase 2 Postgres + MinIO server parity and SQLite -> Postgres + MinIO migration reconciliation', async () => {
  const sqliteDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tidydesk-p2-src-'));
  const minioMock = createMinioMockServer();
  await new Promise(resolve => minioMock.server.listen(0, '127.0.0.1', resolve));
  const minioConfig = {
    endpoint: `http://127.0.0.1:${minioMock.server.address().port}`,
    bucket: 'tidydesk-p2-blobs',
    accessKey: 'minio_key',
    secretKey: 'minio_secret',
    region: 'us-east-1'
  };
  const pgClient = createSqliteBackedPgAdapter();

  let legacyToken = '';
  let expectedCursor = '0';
  const origBytes = Buffer.from('phase2-original-png-binary');
  const thumbBytes = Buffer.from('phase2-thumb-png-binary');
  const sha = crypto.createHash('sha256').update(origBytes).digest('hex');

  // 1. Populate source SQLite server first
  const srcSrv = createSyncServer({ dataDir: sqliteDir, allowAnyDevToken: false });
  await new Promise(resolve => srcSrv.server.listen(0, '127.0.0.1', resolve));
  const srcUrl = `http://127.0.0.1:${srcSrv.server.address().port}`;
  try {
    await srcSrv.users.createUser({ userId: 'zoe', password: 'zoe-secret-password', displayName: 'Zoe' });
    const login = await (
      await fetch(`${srcUrl}/api/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: 'zoe', password: 'zoe-secret-password', deviceLabel: 'Desk' })
      })
    ).json();
    legacyToken = login.token;

    const pre = await (
      await fetch(`${srcUrl}/api/v1/media/presign`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe', 'Content-Type': 'application/json' },
        body: JSON.stringify({ sha256: sha, mimeType: 'image/png' })
      })
    ).json();

    await fetch(`${srcUrl}${pre.thumbUploadPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe' },
      body: thumbBytes
    });
    await fetch(`${srcUrl}${pre.originalUploadPath}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe', 'x-tidydesk-sha256': sha },
      body: origBytes
    });

    const pushed = await (
      await fetch(`${srcUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'default',
          entries: [
            { entityKind: 'card', entityId: 'p2-card-1', operation: 'upsert', payload: { title: 'Phase 2 待办', revision: 1 } },
            { entityKind: 'quickNote', entityId: 'p2-note-1', operation: 'upsert', payload: { title: 'Phase 2 速记', content: 'hello pg' } }
          ]
        })
      })
    ).json();
    expectedCursor = pushed.nextCursor;
  } finally {
    await new Promise(resolve => srcSrv.server.close(resolve));
  }

  // 2. Migrate SQLite + Disk Blobs -> Postgres + MinIO and reconcile every record
  const report = await migrateAndReconcile({
    dataDir: sqliteDir,
    fromDriver: 'sqlite',
    pgClient,
    minioConfig
  });
  assert.equal(report.verified, true);
  assert.equal(report.cursor, Number(expectedCursor));
  assert.equal(report.cards, 1);
  assert.equal(report.quickNotes, 1);
  assert.equal(report.media, 1);
  assert.equal(report.uploadedBlobs, 2);

  // 3. Verify corrupted target or RBAC role drift fails reconciliation loudly
  await pgClient.query("DELETE FROM quick_notes WHERE id = 'p2-note-1'");
  await assert.rejects(
    () =>
      migrateAndReconcile({
        dataDir: sqliteDir,
        fromDriver: 'sqlite',
        pgClient,
        minioConfig,
        verifyOnly: true
      }),
    /数据迁移对账失败/
  );
  await migrateAndReconcile({ dataDir: sqliteDir, fromDriver: 'sqlite', pgClient, minioConfig });

  await pgClient.query(
    "UPDATE workspace_members SET role = 'viewer' WHERE workspace_id = 'default' AND user_id = 'zoe'"
  );
  await assert.rejects(
    () =>
      migrateAndReconcile({
        dataDir: sqliteDir,
        fromDriver: 'sqlite',
        pgClient,
        minioConfig,
        verifyOnly: true
      }),
    /工作区成员角色不一致/
  );
  // Re-import cleanly before starting Postgres server
  await migrateAndReconcile({ dataDir: sqliteDir, fromDriver: 'sqlite', pgClient, minioConfig });

  // 4. Boot HTTP Sync Server in Postgres + MinIO mode and verify client parity
  const pgSrv = createSyncServer({
    dataDir: sqliteDir,
    storeDriver: 'postgres',
    pgClient,
    minioConfig,
    allowAnyDevToken: false
  });
  await new Promise(resolve => pgSrv.server.listen(0, '127.0.0.1', resolve));
  const pgUrl = `http://127.0.0.1:${pgSrv.server.address().port}`;
  try {
    const health = await (await fetch(`${pgUrl}/health`)).json();
    assert.equal(health.storeDriver, 'postgres');
    assert.equal(health.blobMode, 'minio');

    const pulled = await (
      await fetch(`${pgUrl}/api/v1/sync/pull?workspaceId=default&cursor=0`, {
        headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe' }
      })
    ).json();
    assert.equal(pulled.nextCursor, expectedCursor);
    assert.equal(pulled.cards[0]?.title, 'Phase 2 待办');
    assert.equal(pulled.quickNotes[0]?.title, 'Phase 2 速记');

    const origRes = await fetch(`${pgUrl}/api/v1/media/blob/original/orig_${sha}.png`, {
      headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe' }
    });
    assert.equal(origRes.status, 200);
    assert.equal(Buffer.from(await origRes.arrayBuffer()).toString(), origBytes.toString());

    const nextPush = await (
      await fetch(`${pgUrl}/api/v1/sync/push`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${legacyToken}`, 'X-TidyDesk-User': 'zoe', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workspaceId: 'default',
          entries: [{ entityKind: 'card', entityId: 'p2-card-2', operation: 'upsert', payload: { title: 'Postgres 新增' } }]
        })
      })
    ).json();
    assert.ok(Number(nextPush.nextCursor) > Number(expectedCursor));
  } finally {
    await new Promise(resolve => pgSrv.server.close(resolve));
    await pgClient.close();
    await new Promise(resolve => minioMock.server.close(resolve));
    fs.rmSync(sqliteDir, { recursive: true, force: true });
  }
});

test('createServerStorage supports postgres driver lookup cleanly and fails loudly when PG url missing', () => {
  assert.throws(
    () => createServerStorage(os.tmpdir(), { driver: 'postgres', pgUrl: '' }),
    /未配置 PostgreSQL 连接字符串/
  );
});
