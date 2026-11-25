#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { openSyncSqliteDatabase } from './sqlite_db.mjs';
import { createServerStorage } from './storage_factory.mjs';
import { extractLegacyScopedRecords, readBlobFromDisk } from './storage_shared.mjs';

function readSourceDataset(dataDir, fromDriver) {
  const rootDir = path.resolve(dataDir);
  if (fromDriver === 'json') {
    const syncPath = path.join(rootDir, 'sync-db.json');
    const authPath = path.join(rootDir, 'users-auth.json');
    const syncDb = fs.existsSync(syncPath)
      ? JSON.parse(fs.readFileSync(syncPath, 'utf8'))
      : { cursor: 0, workspaces: {}, cards: {}, quickNotes: {}, mediaBySha256: {}, events: [] };
    const authDb = fs.existsSync(authPath)
      ? JSON.parse(fs.readFileSync(authPath, 'utf8'))
      : { users: {}, tokens: {} };

    const cards = extractLegacyScopedRecords(syncDb.cards).map(({ workspaceId, entityId, record }) => ({
      workspaceId,
      id: entityId,
      record: { ...record, id: entityId, workspaceId }
    }));
    const quickNotes = extractLegacyScopedRecords(syncDb.quickNotes).map(
      ({ workspaceId, entityId, record }) => ({
        workspaceId,
        id: entityId,
        record: { ...record, id: entityId, workspaceId }
      })
    );
    const workspaces = Object.entries(syncDb.workspaces || {}).map(([id, ws]) => ({
      id,
      title: String(ws?.title || id),
      members: Object.entries(ws?.members || {}).map(([userId, role]) => ({ userId, role }))
    }));
    const media = Object.entries(syncDb.mediaBySha256 || {}).map(([sha, meta]) => ({
      sha256: sha.toLowerCase(),
      originalKey: meta?.originalKey || null,
      thumbKey: meta?.thumbKey || null,
      sizeBytes: meta?.sizeBytes ?? null,
      uploadedAt: meta?.uploadedAt || null,
      workspaces: Array.isArray(meta?.workspaces) ? meta.workspaces : ['default']
    }));
    const events = (syncDb.events || []).map(ev => ({
      seq: Number(ev.seq),
      workspaceId: String(ev.workspaceId || 'default'),
      entityKind: String(ev.entityKind),
      entityId: String(ev.entityId),
      operation: String(ev.operation),
      createdAt: String(ev.at || '0')
    }));
    const users = Object.values(authDb.users || {});
    const tokens = Object.values(authDb.tokens || {});
    return {
      cursor: Number(syncDb.cursor || 0),
      workspaces,
      cards,
      quickNotes,
      media,
      events,
      users,
      tokens,
      blobsDir: path.join(rootDir, 'blobs')
    };
  }

  if (fromDriver === 'sqlite') {
    const dbPath = path.join(rootDir, 'tidydesk-sync.db');
    if (!fs.existsSync(dbPath)) {
      throw new Error(`[CRITICAL] 未找到 SQLite 源数据库文件: ${dbPath}`);
    }
    const handle = openSyncSqliteDatabase(rootDir);
    try {
      const { db } = handle;
      const cursor = Number(db.prepare("SELECT value FROM sync_meta WHERE key = 'cursor'").get()?.value || 0);
      const wsRows = db.prepare('SELECT id, title FROM workspaces').all();
      const memberRows = db.prepare('SELECT workspace_id, user_id, role FROM workspace_members').all();
      const membersByWs = new Map();
      for (const m of memberRows) {
        if (!membersByWs.has(m.workspace_id)) membersByWs.set(m.workspace_id, []);
        membersByWs.get(m.workspace_id).push({ userId: m.user_id, role: m.role });
      }
      const workspaces = wsRows.map(w => ({
        id: w.id,
        title: w.title,
        members: membersByWs.get(w.id) || []
      }));
      const cards = db
        .prepare('SELECT workspace_id, id, payload_json FROM cards')
        .all()
        .map(r => ({
          workspaceId: r.workspace_id,
          id: r.id,
          record: JSON.parse(r.payload_json)
        }));
      const quickNotes = db
        .prepare('SELECT workspace_id, id, payload_json FROM quick_notes')
        .all()
        .map(r => ({
          workspaceId: r.workspace_id,
          id: r.id,
          record: JSON.parse(r.payload_json)
        }));
      const media = db
        .prepare('SELECT sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json FROM media_meta')
        .all()
        .map(r => ({
          sha256: r.sha256,
          originalKey: r.original_key,
          thumbKey: r.thumb_key,
          sizeBytes: r.size_bytes,
          uploadedAt: r.uploaded_at,
          workspaces: JSON.parse(r.workspaces_json)
        }));
      const events = db
        .prepare('SELECT seq, workspace_id, entity_kind, entity_id, operation, created_at FROM sync_events ORDER BY seq ASC')
        .all()
        .map(r => ({
          seq: Number(r.seq),
          workspaceId: r.workspace_id,
          entityKind: r.entity_kind,
          entityId: r.entity_id,
          operation: r.operation,
          createdAt: String(r.created_at)
        }));
      const users = db
        .prepare('SELECT user_id, display_name, password_salt, password_hash, disabled, created_at, updated_at FROM users')
        .all()
        .map(r => ({
          userId: r.user_id,
          displayName: r.display_name,
          passwordSalt: r.password_salt,
          passwordHash: r.password_hash,
          disabled: Boolean(r.disabled),
          createdAt: r.created_at,
          updatedAt: r.updated_at
        }));
      const tokens = db
        .prepare('SELECT token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at FROM tokens')
        .all()
        .map(r => ({
          tokenId: r.token_id,
          userId: r.user_id,
          tokenHash: r.token_hash,
          label: r.label,
          createdAt: r.created_at,
          lastUsedAt: r.last_used_at,
          revokedAt: r.revoked_at
        }));
      return {
        cursor,
        workspaces,
        cards,
        quickNotes,
        media,
        events,
        users,
        tokens,
        blobsDir: path.join(rootDir, 'blobs')
      };
    } finally {
      handle.close();
    }
  }

  throw new Error(`[CRITICAL] 不支持的迁移源驱动 "${fromDriver}"，仅支持 sqlite 或 json`);
}

async function importDatasetIntoPostgres(src, targetStorage) {
  await targetStorage.ensureSchema();
  const { pg, blobStore } = targetStorage;

  await pg.withTransaction(async tx => {
    const validUsers = new Set();
    for (const user of src.users) {
      validUsers.add(user.userId);
      await tx.query(
        `INSERT INTO users (user_id, display_name, password_salt, password_hash, disabled, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (user_id) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           password_salt = EXCLUDED.password_salt,
           password_hash = EXCLUDED.password_hash,
           disabled = EXCLUDED.disabled,
           updated_at = EXCLUDED.updated_at`,
        [
          user.userId,
          user.displayName || user.userId,
          user.passwordSalt,
          user.passwordHash,
          Boolean(user.disabled),
          String(user.createdAt || '0'),
          String(user.updatedAt || user.createdAt || '0')
        ]
      );
    }

    for (const tok of src.tokens) {
      if (!validUsers.has(tok.userId)) continue;
      await tx.query(
        `INSERT INTO tokens (token_id, user_id, token_hash, label, created_at, last_used_at, revoked_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         ON CONFLICT (token_id) DO UPDATE SET
           token_hash = EXCLUDED.token_hash,
           label = EXCLUDED.label,
           last_used_at = EXCLUDED.last_used_at,
           revoked_at = EXCLUDED.revoked_at`,
        [
          tok.tokenId,
          tok.userId,
          tok.tokenHash,
          String(tok.label || 'device'),
          String(tok.createdAt || '0'),
          String(tok.lastUsedAt || tok.createdAt || '0'),
          tok.revokedAt ? String(tok.revokedAt) : null
        ]
      );
    }

    for (const ws of src.workspaces) {
      await tx.query(
        `INSERT INTO workspaces (id, title) VALUES ($1, $2)
         ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title`,
        [ws.id, ws.title]
      );
      for (const m of ws.members) {
        await tx.query(
          `INSERT INTO workspace_members (workspace_id, user_id, role)
           VALUES ($1, $2, $3)
           ON CONFLICT (workspace_id, user_id) DO UPDATE SET role = EXCLUDED.role`,
          [ws.id, m.userId, m.role]
        );
      }
    }

    for (const c of src.cards) {
      await tx.query(
        `INSERT INTO cards (workspace_id, id, updated_at, deleted_at, payload_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (workspace_id, id) DO UPDATE SET
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           payload_json = EXCLUDED.payload_json`,
        [
          c.workspaceId,
          c.id,
          String(c.record.updatedAt || ''),
          c.record.deletedAt ? String(c.record.deletedAt) : null,
          JSON.stringify(c.record)
        ]
      );
    }

    for (const n of src.quickNotes) {
      await tx.query(
        `INSERT INTO quick_notes (workspace_id, id, updated_at, deleted_at, payload_json)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (workspace_id, id) DO UPDATE SET
           updated_at = EXCLUDED.updated_at,
           deleted_at = EXCLUDED.deleted_at,
           payload_json = EXCLUDED.payload_json`,
        [
          n.workspaceId,
          n.id,
          String(n.record.updatedAt || ''),
          n.record.deletedAt ? String(n.record.deletedAt) : null,
          JSON.stringify(n.record)
        ]
      );
    }

    for (const m of src.media) {
      await tx.query(
        `INSERT INTO media_meta (sha256, original_key, thumb_key, size_bytes, uploaded_at, workspaces_json)
         VALUES ($1, $2, $3, $4, $5, $6::jsonb)
         ON CONFLICT (sha256) DO UPDATE SET
           original_key = EXCLUDED.original_key,
           thumb_key = EXCLUDED.thumb_key,
           size_bytes = EXCLUDED.size_bytes,
           uploaded_at = EXCLUDED.uploaded_at,
           workspaces_json = EXCLUDED.workspaces_json`,
        [
          m.sha256,
          m.originalKey,
          m.thumbKey,
          m.sizeBytes,
          m.uploadedAt,
          JSON.stringify(m.workspaces)
        ]
      );
    }

    let maxSeq = src.cursor;
    for (const ev of src.events) {
      if (ev.seq > maxSeq) maxSeq = ev.seq;
      await tx.query(
        `INSERT INTO sync_events (seq, workspace_id, entity_kind, entity_id, operation, created_at)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (seq) DO NOTHING`,
        [ev.seq, ev.workspaceId, ev.entityKind, ev.entityId, ev.operation, ev.createdAt]
      );
    }

    await tx.query(
      `INSERT INTO sync_meta (key, value) VALUES ('cursor', $1)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [String(maxSeq)]
    );
    if (maxSeq > 0) {
      await tx.query("SELECT setval(pg_get_serial_sequence('sync_events', 'seq'), $1, true)", [
        maxSeq
      ]);
    }
  });

  // Upload physical blobs when migrating to external MinIO/object store (or verify disk copy)
  let uploadedBlobs = 0;
  for (const kind of ['thumb', 'original']) {
    const kindDir = path.join(src.blobsDir, kind);
    if (!fs.existsSync(kindDir)) continue;
    for (const key of fs.readdirSync(kindDir)) {
      const buf = readBlobFromDisk(src.blobsDir, kind, key);
      if (!buf) continue;
      const contentType = key.endsWith('.jpg')
        ? 'image/jpeg'
        : key.endsWith('.webp')
          ? 'image/webp'
          : 'image/png';
      await blobStore.writeBlob(kind, key, buf, contentType);
      uploadedBlobs += 1;
    }
  }
  return { uploadedBlobs };
}

export async function reconcileSourceAndPostgres(src, targetStorage) {
  await targetStorage.ensureSchema();
  const { pg, blobStore } = targetStorage;
  const mismatches = [];

  const targetCursor = Number(
    (await pg.query("SELECT value FROM sync_meta WHERE key = 'cursor'")).rows[0]?.value || 0
  );
  const expectedCursor = Math.max(src.cursor, ...src.events.map(e => e.seq));
  if (targetCursor !== expectedCursor) {
    mismatches.push(`cursor 不一致: 源=${expectedCursor}, 目标=${targetCursor}`);
  }

  const targetWorkspaces = (await pg.query('SELECT id FROM workspaces')).rows;
  const targetWsSet = new Set(targetWorkspaces.map(w => w.id));
  const targetMembers = (
    await pg.query('SELECT workspace_id, user_id, role FROM workspace_members')
  ).rows;
  const targetMemberMap = new Map(
    targetMembers.map(m => [`${m.workspace_id}:${m.user_id}`, m.role])
  );
  for (const ws of src.workspaces) {
    if (!targetWsSet.has(ws.id)) {
      mismatches.push(`缺失工作区: ${ws.id}`);
      continue;
    }
    for (const m of ws.members) {
      const actualRole = targetMemberMap.get(`${ws.id}:${m.userId}`);
      if (actualRole !== m.role) {
        mismatches.push(`工作区成员角色不一致: ${ws.id}/${m.userId} (源=${m.role}, 目标=${actualRole})`);
      }
    }
  }

  const targetUsers = (await pg.query('SELECT user_id, password_hash, disabled FROM users')).rows;
  const targetUserMap = new Map(targetUsers.map(u => [u.user_id, u]));
  for (const u of src.users) {
    const tu = targetUserMap.get(u.userId);
    if (!tu) {
      mismatches.push(`缺失用户 ${u.userId}`);
    } else if (tu.password_hash !== u.passwordHash || Boolean(tu.disabled) !== Boolean(u.disabled)) {
      mismatches.push(`用户状态/密码哈希不一致: ${u.userId}`);
    }
  }

  const srcUserSet = new Set(src.users.map(u => u.userId));
  const validSrcTokens = src.tokens.filter(t => srcUserSet.has(t.userId));
  const targetTokens = (await pg.query('SELECT token_id, token_hash, revoked_at FROM tokens')).rows;
  const targetTokMap = new Map(targetTokens.map(t => [t.token_id, t]));
  for (const t of validSrcTokens) {
    const tt = targetTokMap.get(t.tokenId);
    if (!tt || tt.token_hash !== t.tokenHash || (tt.revoked_at || null) !== (t.revokedAt || null)) {
      mismatches.push(`Token 不一致或缺失: ${t.tokenId}`);
    }
  }

  const targetCards = (
    await pg.query('SELECT workspace_id, id, payload_json FROM cards')
  ).rows;
  const targetCardMap = new Map(
    targetCards.map(r => [
      `${r.workspace_id}:${r.id}`,
      typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json
    ])
  );
  if (targetCards.length !== src.cards.length) {
    mismatches.push(`卡片总数不一致: 源=${src.cards.length}, 目标=${targetCards.length}`);
  }
  for (const c of src.cards) {
    const tc = targetCardMap.get(`${c.workspaceId}:${c.id}`);
    if (!tc) {
      mismatches.push(`缺失卡片: ${c.workspaceId}:${c.id}`);
    } else if (
      Number(tc.revision || 0) !== Number(c.record.revision || 0) ||
      String(tc.updatedAt || '') !== String(c.record.updatedAt || '') ||
      (tc.deletedAt || null) !== (c.record.deletedAt || null)
    ) {
      mismatches.push(`卡片 revision/updatedAt/deletedAt 不一致: ${c.workspaceId}:${c.id}`);
    }
  }

  const targetNotes = (
    await pg.query('SELECT workspace_id, id, payload_json FROM quick_notes')
  ).rows;
  const targetNoteMap = new Map(
    targetNotes.map(r => [
      `${r.workspace_id}:${r.id}`,
      typeof r.payload_json === 'string' ? JSON.parse(r.payload_json) : r.payload_json
    ])
  );
  if (targetNotes.length !== src.quickNotes.length) {
    mismatches.push(`速记总数不一致: 源=${src.quickNotes.length}, 目标=${targetNotes.length}`);
  }
  for (const n of src.quickNotes) {
    const tn = targetNoteMap.get(`${n.workspaceId}:${n.id}`);
    if (!tn || String(tn.updatedAt || '') !== String(n.record.updatedAt || '')) {
      mismatches.push(`速记不一致或缺失: ${n.workspaceId}:${n.id}`);
    }
  }

  const targetMedia = (
    await pg.query('SELECT sha256, original_key, thumb_key FROM media_meta')
  ).rows;
  if (targetMedia.length !== src.media.length) {
    mismatches.push(`媒体元数据总数不一致: 源=${src.media.length}, 目标=${targetMedia.length}`);
  }
  for (const m of src.media) {
    if (m.thumbKey && m.originalKey) {
      const ok = await blobStore.hasBlobPair(m.thumbKey, m.originalKey);
      if (!ok) {
        mismatches.push(`目标对象存储缺失媒体文件对: ${m.sha256}`);
      }
    }
  }

  const targetEventCount = Number(
    (await pg.query('SELECT COUNT(*) AS n FROM sync_events')).rows[0]?.n || 0
  );
  if (targetEventCount !== src.events.length) {
    mismatches.push(`同步事件数不一致: 源=${src.events.length}, 目标=${targetEventCount}`);
  }

  if (mismatches.length > 0) {
    throw new Error(`[CRITICAL] 数据迁移对账失败:\n- ${mismatches.join('\n- ')}`);
  }

  return {
    verified: true,
    cursor: targetCursor,
    users: src.users.length,
    tokens: validSrcTokens.length,
    workspaces: src.workspaces.length,
    cards: src.cards.length,
    quickNotes: src.quickNotes.length,
    media: src.media.length,
    events: src.events.length
  };
}

export async function migrateAndReconcile({
  dataDir,
  fromDriver = 'sqlite',
  pgUrl = undefined,
  pgClient = null,
  minioConfig = undefined,
  blobStore = null,
  verifyOnly = false
}) {
  const src = readSourceDataset(dataDir, fromDriver);
  const targetStorage = createServerStorage(dataDir, {
    driver: 'postgres',
    pgUrl,
    pgClient,
    minioConfig,
    blobStore
  });
  try {
    let importResult = { uploadedBlobs: 0 };
    if (!verifyOnly) {
      importResult = await importDatasetIntoPostgres(src, targetStorage);
    }
    const report = await reconcileSourceAndPostgres(src, targetStorage);
    return { ...report, uploadedBlobs: importResult.uploadedBlobs };
  } finally {
    await targetStorage.close();
  }
}

async function runCli() {
  const args = process.argv.slice(2);
  let fromDriver = 'sqlite';
  let dataDir = process.env.TIDYDESK_DATA_DIR || path.resolve(process.cwd(), 'server', 'data');
  let pgUrl = process.env.TIDYDESK_PG_URL;
  let verifyOnly = false;

  for (let i = 0; i < args.length; i += 1) {
    const a = args[i];
    if (a === '--help' || a === '-h') {
      console.log(`TidyDesk Sync Migration & Reconciliation CLI

用法:
  node server/src/migrate.mjs --from sqlite|json --data-dir ./server/data --to-pg <postgresUrl> [--verify-only]

环境变量:
  TIDYDESK_PG_URL, TIDYDESK_MINIO_ENDPOINT, TIDYDESK_MINIO_BUCKET, TIDYDESK_MINIO_ACCESS_KEY, TIDYDESK_MINIO_SECRET_KEY`);
      return;
    }
    if (a === '--from' && args[i + 1]) {
      fromDriver = args[++i];
    } else if (a === '--data-dir' && args[i + 1]) {
      dataDir = args[++i];
    } else if (a === '--to-pg' && args[i + 1]) {
      pgUrl = args[++i];
    } else if (a === '--verify-only') {
      verifyOnly = true;
    }
  }

  const report = await migrateAndReconcile({ dataDir, fromDriver, pgUrl, verifyOnly });
  console.log('[TIDYDESK-MIGRATE] PostgreSQL + Blob 迁移与逐条对账通过:', JSON.stringify(report));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli().catch(err => {
    console.error(`[ERROR] ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  });
}
