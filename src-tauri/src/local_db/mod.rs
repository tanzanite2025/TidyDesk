use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

const LOCAL_DB_FILENAME: &str = "tidydesk-local.db";
const WORKSPACE_DB_FILENAME: &str = "tidydesk-workspace.db";
const SCHEMA_VERSION_1: i64 = 1;
const SCHEMA_VERSION_2: i64 = 2;
const SCHEMA_VERSION_3: i64 = 3;

const SCHEMA_V1_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS schema_migrations (
  version INTEGER PRIMARY KEY,
  name TEXT NOT NULL,
  applied_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS db_meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sync_outbox (
  entity_kind TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  operation TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY (entity_kind, entity_id)
);

CREATE INDEX IF NOT EXISTS idx_sync_outbox_seq
  ON sync_outbox(seq ASC);

CREATE TABLE IF NOT EXISTS quick_notes (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  pinned INTEGER NOT NULL DEFAULT 0,
  favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sticky_notes (
  note_id TEXT PRIMARY KEY,
  x INTEGER NOT NULL,
  y INTEGER NOT NULL,
  width INTEGER NOT NULL,
  height INTEGER NOT NULL,
  always_on_top INTEGER NOT NULL DEFAULT 0,
  color TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  sort_order INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS todo_boards (
  id TEXT PRIMARY KEY,
  active INTEGER NOT NULL DEFAULT 0,
  payload_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS todo_cards (
  id TEXT PRIMARY KEY,
  board_id TEXT NOT NULL,
  column_id TEXT NOT NULL,
  position TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT,
  metadata_json TEXT NOT NULL,
  content_md TEXT NOT NULL DEFAULT ''
);

CREATE INDEX IF NOT EXISTS idx_todo_cards_board_col_pos
  ON todo_cards(board_id, column_id, position);
"#;

const SCHEMA_V2_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS card_comments (
  id TEXT PRIMARY KEY,
  card_id TEXT NOT NULL,
  parent_id TEXT,
  author_id TEXT NOT NULL,
  author_name TEXT NOT NULL,
  body TEXT NOT NULL,
  mentions_json TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  deleted_at TEXT
);

CREATE INDEX IF NOT EXISTS idx_card_comments_card_created
  ON card_comments(card_id, created_at ASC);
"#;

const SCHEMA_V3_SQL: &str = r#"
CREATE TABLE IF NOT EXISTS card_comment_reads (
  card_id TEXT PRIMARY KEY,
  last_read_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
"#;

pub fn local_workspace_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    app.path()
        .app_data_dir()
        .map(|dir| dir.join(LOCAL_DB_FILENAME))
        .map_err(|err| format!("failed to resolve app data directory: {err}"))
}

pub fn workspace_db_path(app: &AppHandle) -> Result<PathBuf, String> {
    let session = crate::accounts::session::load_session(app)?;
    match crate::accounts::session::effective_storage_scope(&session) {
        Some((uid, ws)) => workspace_db_path_for(app, &uid, &ws),
        None => local_workspace_db_path(app),
    }
}

pub fn workspace_db_path_for(
    app: &AppHandle,
    user_id: &str,
    workspace_id: &str,
) -> Result<PathBuf, String> {
    let dir = crate::accounts::session::workspace_data_dir(app, user_id, workspace_id)?;
    Ok(dir.join(WORKSPACE_DB_FILENAME))
}

/// Open a WAL-mode SQLite connection at `db_path` and apply idempotent schema migrations.
pub fn open_workspace_db_at(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|err| format!("创建本地数据库目录失败 {}: {err}", parent.display()))?;
    }

    let mut conn = Connection::open(db_path)
        .map_err(|err| format!("打开本地 SQLite 数据库失败 {}: {err}", db_path.display()))?;
    conn.pragma_update(None, "journal_mode", "WAL")
        .map_err(|err| format!("开启 SQLite WAL 模式失败: {err}"))?;
    conn.pragma_update(None, "synchronous", "NORMAL")
        .map_err(|err| format!("设置 SQLite synchronous 失败: {err}"))?;
    conn.pragma_update(None, "foreign_keys", "ON")
        .map_err(|err| format!("开启 SQLite foreign_keys 失败: {err}"))?;
    conn.busy_timeout(std::time::Duration::from_millis(5000))
        .map_err(|err| format!("设置 SQLite busy_timeout 失败: {err}"))?;

    let tx = conn
        .transaction()
        .map_err(|err| format!("开启数据库迁移事务失败: {err}"))?;
    tx.execute_batch(SCHEMA_V1_SQL)
        .map_err(|err| format!("初始化本地 SQLite Schema v1 失败: {err}"))?;
    tx.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![
            SCHEMA_VERSION_1,
            "initial_workspace_schema",
            crate::timestamp_string()
        ],
    )
    .map_err(|err| format!("记录 Schema Migration v1 失败: {err}"))?;
    tx.execute_batch(SCHEMA_V2_SQL)
        .map_err(|err| format!("初始化本地 SQLite Schema v2 失败: {err}"))?;
    tx.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![
            SCHEMA_VERSION_2,
            "card_comments_schema",
            crate::timestamp_string()
        ],
    )
    .map_err(|err| format!("记录 Schema Migration v2 失败: {err}"))?;
    tx.execute_batch(SCHEMA_V3_SQL)
        .map_err(|err| format!("初始化本地 SQLite Schema v3 失败: {err}"))?;
    tx.execute(
        "INSERT OR IGNORE INTO schema_migrations (version, name, applied_at) VALUES (?1, ?2, ?3)",
        rusqlite::params![
            SCHEMA_VERSION_3,
            "card_comment_reads_schema",
            crate::timestamp_string()
        ],
    )
    .map_err(|err| format!("记录 Schema Migration v3 失败: {err}"))?;
    tx.commit()
        .map_err(|err| format!("提交数据库迁移事务失败: {err}"))?;

    Ok(conn)
}

pub fn open_workspace_db(app: &AppHandle) -> Result<Connection, String> {
    let path = workspace_db_path(app)?;
    open_workspace_db_at(&path)
}

pub fn get_meta_flag(conn: &Connection, key: &str) -> Result<Option<String>, String> {
    let mut stmt = conn
        .prepare("SELECT value FROM db_meta WHERE key = ?1")
        .map_err(|err| format!("查询 db_meta 失败: {err}"))?;
    match stmt.query_row([key], |row| row.get::<_, String>(0)) {
        Ok(val) => Ok(Some(val)),
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(err) => Err(format!("读取 db_meta[{key}] 失败: {err}")),
    }
}

pub fn set_meta_flag(conn: &Connection, key: &str, value: &str) -> Result<(), String> {
    conn.execute(
        "INSERT OR REPLACE INTO db_meta (key, value) VALUES (?1, ?2)",
        [key, value],
    )
    .map_err(|err| format!("写入 db_meta[{key}] 失败: {err}"))?;
    Ok(())
}

/// Checkpoint WAL pages cleanly back into the main `.db` file before taking a filesystem snapshot.
pub fn checkpoint_workspace_db_if_exists(db_path: &Path) -> Result<(), String> {
    if !db_path.exists() {
        return Ok(());
    }
    let conn = open_workspace_db_at(db_path)?;
    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")
        .map_err(|err| {
            format!(
                "执行 SQLite WAL checkpoint 失败 {}: {err}",
                db_path.display()
            )
        })?;
    Ok(())
}

/// Remove `-wal` and `-shm` sidecars around a replaced `.db` file after snapshot restore.
pub fn remove_sqlite_sidecar_files(db_path: &Path) -> Result<(), String> {
    for suffix in ["-wal", "-shm"] {
        let sidecar = PathBuf::from(format!("{}{suffix}", db_path.to_string_lossy()));
        if sidecar.exists() {
            fs::remove_file(&sidecar).map_err(|err| {
                format!(
                    "清理旧 SQLite WAL 附属文件失败 {}: {err}",
                    sidecar.display()
                )
            })?;
        }
    }
    Ok(())
}

fn archive_legacy_entry_once(path: &Path, expect_dir: bool) -> Result<Option<PathBuf>, String> {
    let matches_kind = if expect_dir {
        path.is_dir()
    } else {
        path.is_file()
    };
    if !matches_kind {
        return Ok(None);
    }
    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .ok_or_else(|| format!("无效旧数据路径: {}", path.display()))?;
    let mut backup = path.with_file_name(format!("{file_name}.pre-sqlite.bak"));
    if backup.exists() {
        backup = path.with_file_name(format!(
            "{file_name}.{}.pre-sqlite.bak",
            crate::timestamp_string()
        ));
    }
    fs::rename(path, &backup).map_err(|err| format!("归档旧数据失败 {}: {err}", path.display()))?;
    Ok(Some(backup))
}

/// Rename a migrated legacy JSON file to `<file>.pre-sqlite.bak` without deleting user history.
pub fn archive_legacy_file_once(path: &Path) -> Result<Option<PathBuf>, String> {
    archive_legacy_entry_once(path, false)
}

/// Rename a migrated legacy directory (e.g. `todos/cards`) to `<dir>.pre-sqlite.bak`.
pub fn archive_legacy_dir_once(path: &Path) -> Result<Option<PathBuf>, String> {
    archive_legacy_entry_once(path, true)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicU64, Ordering};

    static DB_TEST_SEQ: AtomicU64 = AtomicU64::new(1);

    fn temp_db_path(label: &str) -> PathBuf {
        let seq = DB_TEST_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "tidydesk-localdb-test-{label}-{}-{seq}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&dir);
        dir.join("tidydesk-local.db")
    }

    #[test]
    fn open_workspace_db_enables_wal_and_is_idempotent() {
        let db_path = temp_db_path("wal");
        {
            let conn = open_workspace_db_at(&db_path).unwrap();
            let mode: String = conn
                .query_row("PRAGMA journal_mode;", [], |r| r.get(0))
                .unwrap();
            assert_eq!(mode.to_lowercase(), "wal");

            let migrated: i64 = conn
                .query_row(
                    "SELECT COUNT(*) FROM schema_migrations WHERE version = 1",
                    [],
                    |r| r.get(0),
                )
                .unwrap();
            assert_eq!(migrated, 1);

            set_meta_flag(&conn, "test_key", "ok").unwrap();
            assert_eq!(
                get_meta_flag(&conn, "test_key").unwrap().as_deref(),
                Some("ok")
            );
        }

        // Re-opening preserves schema_migrations and meta idempotently
        {
            let conn2 = open_workspace_db_at(&db_path).unwrap();
            assert_eq!(
                get_meta_flag(&conn2, "test_key").unwrap().as_deref(),
                Some("ok")
            );
            checkpoint_workspace_db_if_exists(&db_path).unwrap();
        }
        let _ = fs::remove_dir_all(db_path.parent().unwrap());
    }

    #[test]
    fn archive_legacy_file_preserves_unique_pre_sqlite_backup() {
        let db_path = temp_db_path("archive");
        let dir = db_path.parent().unwrap();
        fs::create_dir_all(dir).unwrap();
        let legacy = dir.join("quick-notes.json");
        fs::write(&legacy, r#"{"notes":[1]}"#).unwrap();

        let bak1 = archive_legacy_file_once(&legacy).unwrap().unwrap();
        assert!(!legacy.exists());
        assert_eq!(fs::read_to_string(&bak1).unwrap(), r#"{"notes":[1]}"#);

        fs::write(&legacy, r#"{"notes":[2]}"#).unwrap();
        let bak2 = archive_legacy_file_once(&legacy).unwrap().unwrap();
        assert_ne!(bak1, bak2);
        assert_eq!(fs::read_to_string(&bak1).unwrap(), r#"{"notes":[1]}"#);
        assert_eq!(fs::read_to_string(&bak2).unwrap(), r#"{"notes":[2]}"#);

        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn open_workspace_db_migrates_v1_to_v2_and_preserves_existing_data() {
        let db_path = temp_db_path("migrate-v2");
        let dir = db_path.parent().unwrap();
        fs::create_dir_all(dir).unwrap();

        {
            let v1_conn = Connection::open(&db_path).unwrap();
            v1_conn.execute_batch(SCHEMA_V1_SQL).unwrap();
            v1_conn
                .execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'initial_workspace_schema', '100')",
                    [],
                )
                .unwrap();
            v1_conn
                .execute(
                    "INSERT INTO quick_notes (id, title, content, pinned, favorite, created_at, updated_at)
                     VALUES ('note-legacy', '旧随手记', '重要本地内容', 0, 0, '100', '100')",
                    [],
                )
                .unwrap();
            v1_conn
                .execute(
                    "INSERT INTO todo_cards (id, board_id, column_id, position, updated_at, deleted_at, metadata_json, content_md)
                     VALUES ('card-legacy', 'default-board', 'todo', 'a0', '100', NULL, '{}', '重要待办内容')",
                    [],
                )
                .unwrap();
        }

        let v2_conn = open_workspace_db_at(&db_path).unwrap();
        let v2_recorded: i64 = v2_conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 2",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v2_recorded, 1);

        let preserved_note: String = v2_conn
            .query_row(
                "SELECT content FROM quick_notes WHERE id = 'note-legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(preserved_note, "重要本地内容");

        let preserved_card: String = v2_conn
            .query_row(
                "SELECT content_md FROM todo_cards WHERE id = 'card-legacy'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(preserved_card, "重要待办内容");

        let comment_count: i64 = v2_conn
            .query_row("SELECT COUNT(*) FROM card_comments", [], |r| r.get(0))
            .unwrap();
        assert_eq!(comment_count, 0);

        drop(v2_conn);
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn open_workspace_db_migrates_v2_to_v3_and_preserves_comments() {
        let db_path = temp_db_path("migrate-v3");
        let dir = db_path.parent().unwrap();
        fs::create_dir_all(dir).unwrap();

        {
            let v2_conn = Connection::open(&db_path).unwrap();
            v2_conn.execute_batch(SCHEMA_V1_SQL).unwrap();
            v2_conn.execute_batch(SCHEMA_V2_SQL).unwrap();
            v2_conn
                .execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (1, 'initial_workspace_schema', '100')",
                    [],
                )
                .unwrap();
            v2_conn
                .execute(
                    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (2, 'card_comments_schema', '100')",
                    [],
                )
                .unwrap();
            v2_conn
                .execute(
                    "INSERT INTO card_comments (id, card_id, parent_id, author_id, author_name, body, mentions_json, created_at, updated_at, deleted_at)
                     VALUES ('cmt-old', 'card-1', NULL, 'bob', 'Bob', '保留评论', '[]', '100', '100', NULL)",
                    [],
                )
                .unwrap();
        }

        let v3_conn = open_workspace_db_at(&db_path).unwrap();
        let v3_recorded: i64 = v3_conn
            .query_row(
                "SELECT COUNT(*) FROM schema_migrations WHERE version = 3",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(v3_recorded, 1);

        let preserved_comment: String = v3_conn
            .query_row(
                "SELECT body FROM card_comments WHERE id = 'cmt-old'",
                [],
                |r| r.get(0),
            )
            .unwrap();
        assert_eq!(preserved_comment, "保留评论");

        let reads_count: i64 = v3_conn
            .query_row("SELECT COUNT(*) FROM card_comment_reads", [], |r| r.get(0))
            .unwrap();
        assert_eq!(reads_count, 0);

        drop(v3_conn);
        let _ = fs::remove_dir_all(dir);
    }
}
