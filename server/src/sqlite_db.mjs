import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const SQLITE_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS cards (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS quick_notes (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS media_meta (
  sha256 TEXT PRIMARY KEY,
  original_key TEXT,
  thumb_key TEXT,
  size_bytes INTEGER,
  uploaded_at TEXT,
  workspaces_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  seq INTEGER PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_ws_seq
  ON sync_events(workspace_id, seq);

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tokens (
  token_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(user_id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL UNIQUE,
  label TEXT NOT NULL,
  created_at TEXT NOT NULL,
  last_used_at TEXT NOT NULL,
  revoked_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_tokens_user_created
  ON tokens(user_id, created_at DESC);
`;

export function withImmediateTransaction(db, operation) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve original error
    }
    throw err;
  }
}

export function withReadTransaction(db, operation) {
  db.exec('BEGIN');
  try {
    const result = operation();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    try {
      db.exec('ROLLBACK');
    } catch {
      // Preserve original error
    }
    throw err;
  }
}

export function openSyncSqliteDatabase(dataDir) {
  const rootDir = path.resolve(dataDir);
  fs.mkdirSync(rootDir, { recursive: true });
  const dbPath = path.join(rootDir, 'tidydesk-sync.db');
  const db = new DatabaseSync(dbPath);
  db.exec('PRAGMA journal_mode = WAL;');
  db.exec('PRAGMA synchronous = NORMAL;');
  db.exec('PRAGMA foreign_keys = ON;');
  db.exec('PRAGMA busy_timeout = 5000;');

  withImmediateTransaction(db, () => {
    db.exec(SQLITE_SCHEMA_SQL);
    db.prepare("INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('schema_version', '1')").run();
    db.prepare("INSERT OR IGNORE INTO sync_meta (key, value) VALUES ('cursor', '0')").run();
    db.prepare("INSERT OR IGNORE INTO workspaces (id, title) VALUES ('default', '默认协同工作区')").run();
  });

  let closed = false;
  return {
    db,
    dbPath,
    close() {
      if (closed) return;
      closed = true;
      db.close();
    }
  };
}
