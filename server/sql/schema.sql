-- TidyDesk Cloud Sync Production PostgreSQL Schema (Phase 2)

CREATE TABLE IF NOT EXISTS sync_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

INSERT INTO sync_meta (key, value) VALUES ('schema_version', '2') ON CONFLICT (key) DO NOTHING;
INSERT INTO sync_meta (key, value) VALUES ('cursor', '0') ON CONFLICT (key) DO NOTHING;

CREATE TABLE IF NOT EXISTS users (
  user_id TEXT PRIMARY KEY,
  display_name TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  disabled BOOLEAN NOT NULL DEFAULT FALSE,
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

CREATE INDEX IF NOT EXISTS idx_tokens_user_created ON tokens(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS workspaces (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

INSERT INTO workspaces (id, title) VALUES ('default', '默认协同工作区') ON CONFLICT (id) DO NOTHING;

CREATE TABLE IF NOT EXISTS workspace_members (
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('owner', 'admin', 'member', 'viewer')),
  PRIMARY KEY (workspace_id, user_id)
);

CREATE TABLE IF NOT EXISTS workspace_invites (
  invite_code TEXT PRIMARY KEY,
  workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('admin', 'member', 'viewer')),
  created_by TEXT NOT NULL,
  max_uses INTEGER NOT NULL DEFAULT 1,
  used_count INTEGER NOT NULL DEFAULT 0,
  expires_at TEXT,
  revoked_at TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_workspace_invites_ws ON workspace_invites(workspace_id, created_at DESC);

CREATE TABLE IF NOT EXISTS cards (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload_json JSONB NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS quick_notes (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload_json JSONB NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE TABLE IF NOT EXISTS card_comments (
  workspace_id TEXT NOT NULL,
  id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  payload_json JSONB NOT NULL,
  PRIMARY KEY (workspace_id, id)
);

CREATE INDEX IF NOT EXISTS idx_card_comments_ws_card ON card_comments(workspace_id, card_id);

CREATE TABLE IF NOT EXISTS media_meta (
  sha256 TEXT PRIMARY KEY,
  original_key TEXT,
  thumb_key TEXT,
  size_bytes BIGINT,
  uploaded_at TEXT,
  workspaces_json JSONB NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_events (
  seq BIGSERIAL PRIMARY KEY,
  workspace_id TEXT NOT NULL,
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_sync_events_ws_seq ON sync_events(workspace_id, seq);
CREATE INDEX IF NOT EXISTS idx_media_meta_original_key ON media_meta(original_key);
