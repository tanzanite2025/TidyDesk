use super::http_transport::HttpSyncClient;
use super::outbox::{OutboxEntityKind, OutboxEntry, OutboxOperation};
use crate::todos::compute_sha256_hex;
use serde_json::{json, Value};
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::time::{Duration, SystemTime, UNIX_EPOCH};

struct LiveSyncServer {
    child: Child,
    data_dir: PathBuf,
    endpoint: String,
}

impl Drop for LiveSyncServer {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        let _ = fs::remove_dir_all(&self.data_dir);
    }
}

impl LiveSyncServer {
    fn spawn() -> Self {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let data_dir = std::env::temp_dir().join(format!(
            "tidydesk-rust-node-e2e-{}-{}",
            std::process::id(),
            nanos
        ));
        fs::create_dir_all(&data_dir).expect("failed to create temporary server data dir");

        let server_script = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent()
            .expect("CARGO_MANIFEST_DIR should have parent workspace root")
            .join("server")
            .join("src")
            .join("index.mjs");
        assert!(
            server_script.exists(),
            "sync server script missing at {}",
            server_script.display()
        );

        let mut child = Command::new("node")
            .arg(&server_script)
            .env("HOST", "127.0.0.1")
            .env("PORT", "0")
            .env("TIDYDESK_DATA_DIR", &data_dir)
            .env(
                "TIDYDESK_SYNC_TOKENS",
                r#"{"alice":"tok-alice-secret","bob":"tok-bob-secret"}"#,
            )
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("failed to spawn node sync server process for live E2E test");

        let stdout = child.stdout.take().expect("node stdout pipe missing");
        let stderr = child.stderr.take().expect("node stderr pipe missing");

        let (port_tx, port_rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stdout);
            for line in reader.lines().map_while(Result::ok) {
                if let Some(rest) = line.strip_prefix("[TIDYDESK-SYNC] Listening on ") {
                    let _ = port_tx.send(rest.trim().to_string());
                }
            }
        });

        let (err_tx, err_rx) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let reader = BufReader::new(stderr);
            let collected: Vec<String> = reader.lines().map_while(Result::ok).collect();
            let _ = err_tx.send(collected.join("\n"));
        });

        let endpoint = match port_rx.recv_timeout(Duration::from_secs(10)) {
            Ok(ep) => ep,
            Err(err) => {
                let _ = child.kill();
                let _ = child.wait();
                let stderr_msg = err_rx
                    .recv_timeout(Duration::from_secs(1))
                    .unwrap_or_default();
                let _ = fs::remove_dir_all(&data_dir);
                panic!(
                    "live sync server failed to report listening endpoint ({err}). stderr:\n{stderr_msg}"
                );
            }
        };

        Self {
            child,
            data_dir,
            endpoint,
        }
    }
}

#[test]
fn rust_http_sync_client_roundtrips_with_live_node_server() {
    let server = LiveSyncServer::spawn();
    let alice = HttpSyncClient::new(&server.endpoint, "alice", "tok-alice-secret")
        .expect("alice HttpSyncClient should build");
    let bob = HttpSyncClient::new(&server.endpoint, "bob", "tok-bob-secret")
        .expect("bob HttpSyncClient should build");
    let invalid_auth = HttpSyncClient::new(&server.endpoint, "alice", "wrong-token")
        .expect("invalid HttpSyncClient should build");

    tauri::async_runtime::block_on(async move {
        // 1. Auth token check fails loudly on mismatch and succeeds for authorized peers.
        assert!(
            invalid_auth.pull_changes(None).await.is_err(),
            "wrong Bearer token must fail loudly"
        );
        let initial_pull = bob
            .pull_changes(None)
            .await
            .expect("bob initial pull should succeed");
        assert!(initial_pull.cards.is_empty());

        // 2. Presign + media upload + SHA-256 deduplication across live HTTP server.
        let orig_bytes = b"\x89PNG\r\n\x1a\nE2E_ORIG_IMAGE_PAYLOAD".to_vec();
        let thumb_bytes = b"\x89PNG\r\n\x1a\nE2E_THUMB_IMAGE".to_vec();
        let sha256 = compute_sha256_hex(&orig_bytes).expect("sha256 should succeed");

        let presign1 = alice
            .presign_media(&sha256, "image/png")
            .await
            .expect("first presign should succeed");
        assert!(!presign1.deduplicated);

        alice
            .upload_blob(&presign1.thumb_upload_path, thumb_bytes.clone(), &sha256)
            .await
            .expect("thumb upload should succeed");
        alice
            .upload_blob(&presign1.original_upload_path, orig_bytes.clone(), &sha256)
            .await
            .expect("original upload should succeed");

        let presign2 = alice
            .presign_media(&sha256, "image/png")
            .await
            .expect("second presign for same sha256 should deduplicate");
        assert!(presign2.deduplicated);

        // 3. Push card + attachment + quick note from alice.
        let att_id = "att-e2e-1";
        let card_id = "card-e2e-1";
        let alice_card = json!({
            "id": card_id,
            "boardId": "board-default",
            "columnId": "todo",
            "title": "Dual-end live E2E card",
            "content": "Initial markdown body",
            "tags": ["sync"],
            "archived": false,
            "subtasks": [
                {
                    "id": "sub-a",
                    "title": "Created by Alice",
                    "completed": false,
                    "position": "0000",
                    "attachments": [],
                    "createdAt": "1000",
                    "updatedAt": "1000"
                }
            ],
            "attachments": [
                {
                    "id": att_id,
                    "kind": "image",
                    "originalName": "shot.png",
                    "fileName": "att-e2e-1.png",
                    "thumbFileName": "att-e2e-1.thumb.png",
                    "sha256": sha256,
                    "remoteThumbKey": presign1.thumb_key,
                    "remoteOriginalKey": presign1.original_key,
                    "width": 800,
                    "height": 600,
                    "orientation": "landscape",
                    "createdAt": "1000",
                    "updatedAt": "1000"
                }
            ],
            "coverAttachmentId": att_id,
            "position": "000100",
            "revision": 0,
            "baseRevision": 0,
            "createdAt": "1000",
            "updatedAt": "1000"
        });

        let push_alice_1 = alice
            .push_changes(&[
                OutboxEntry {
                    entity_kind: OutboxEntityKind::Card,
                    entity_id: card_id.to_string(),
                    operation: OutboxOperation::Upsert,
                    payload: alice_card,
                    actor_id: "alice".to_string(),
                    updated_at: "1000".to_string(),
                },
                OutboxEntry {
                    entity_kind: OutboxEntityKind::QuickNote,
                    entity_id: "note-e2e-1".to_string(),
                    operation: OutboxOperation::Upsert,
                    payload: json!({
                        "id": "note-e2e-1",
                        "title": "Alice quick note",
                        "content": "Live sync test note",
                        "updatedAt": "1000"
                    }),
                    actor_id: "alice".to_string(),
                    updated_at: "1000".to_string(),
                },
            ])
            .await
            .expect("alice push_changes should succeed");
        assert_eq!(push_alice_1.acked.len(), 2);
        assert_eq!(push_alice_1.merged_cards.len(), 1);
        assert_eq!(push_alice_1.merged_cards[0]["revision"], json!(1));

        // 4. Bob pulls cards, quick notes, and downloads thumb + original media bytes verbatim.
        let pull_bob = bob
            .pull_changes(None)
            .await
            .expect("bob pull should receive alice push");
        assert_eq!(pull_bob.cards.len(), 1);
        assert_eq!(pull_bob.quick_notes.len(), 1);
        let remote_card = &pull_bob.cards[0];
        assert_eq!(remote_card["title"], json!("Dual-end live E2E card"));
        assert_eq!(remote_card["revision"], json!(1));

        let dl_thumb = bob
            .download_blob("thumb", &presign1.thumb_key)
            .await
            .expect("bob should download thumb blob");
        let dl_orig = bob
            .download_blob("original", &presign1.original_key)
            .await
            .expect("bob should download original blob");
        assert_eq!(dl_thumb, thumb_bytes);
        assert_eq!(dl_orig, orig_bytes);

        // 5. Concurrent edit conflict resolution:
        // Bob moves card to "doing" & adds sub-b at revision 1; Alice still at baseRevision 1 adds sub-c.
        let mut bob_card = remote_card.clone();
        bob_card["columnId"] = json!("doing");
        bob_card["updatedAt"] = json!("2000");
        bob_card["baseRevision"] = json!(1);
        bob_card["subtasks"].as_array_mut().unwrap().push(json!({
            "id": "sub-b",
            "title": "Added by Bob",
            "completed": true,
            "position": "0001",
            "attachments": [],
            "createdAt": "2000",
            "updatedAt": "2000"
        }));
        let push_bob = bob
            .push_changes(&[OutboxEntry {
                entity_kind: OutboxEntityKind::Card,
                entity_id: card_id.to_string(),
                operation: OutboxOperation::Upsert,
                payload: bob_card,
                actor_id: "bob".to_string(),
                updated_at: "2000".to_string(),
            }])
            .await
            .expect("bob concurrent push should succeed");
        assert_eq!(push_bob.merged_cards[0]["revision"], json!(2));

        let mut alice_stale_edit = remote_card.clone();
        alice_stale_edit["updatedAt"] = json!("2500");
        alice_stale_edit["baseRevision"] = json!(1); // Stale vs server revision 2!
        alice_stale_edit["subtasks"]
            .as_array_mut()
            .unwrap()
            .push(json!({
                "id": "sub-c",
                "title": "Added offline by Alice",
                "completed": false,
                "position": "0002",
                "attachments": [],
                "createdAt": "2500",
                "updatedAt": "2500"
            }));
        let push_alice_2 = alice
            .push_changes(&[OutboxEntry {
                entity_kind: OutboxEntityKind::Card,
                entity_id: card_id.to_string(),
                operation: OutboxOperation::Upsert,
                payload: alice_stale_edit,
                actor_id: "alice".to_string(),
                updated_at: "2500".to_string(),
            }])
            .await
            .expect("alice stale push should merge member-level rather than dropping changes");

        let merged = &push_alice_2.merged_cards[0];
        let subtask_ids: Vec<&str> = merged["subtasks"]
            .as_array()
            .expect("merged subtasks array")
            .iter()
            .filter_map(|s: &Value| s["id"].as_str())
            .collect();
        assert!(
            subtask_ids.contains(&"sub-a"),
            "sub-a lost: {subtask_ids:?}"
        );
        assert!(
            subtask_ids.contains(&"sub-b"),
            "sub-b lost: {subtask_ids:?}"
        );
        assert!(
            subtask_ids.contains(&"sub-c"),
            "sub-c lost: {subtask_ids:?}"
        );

        // 6. Incremental delta pull with previous cursor sees deletion cleanly.
        let delete_res = bob
            .push_changes(&[OutboxEntry {
                entity_kind: OutboxEntityKind::QuickNote,
                entity_id: "note-e2e-1".to_string(),
                operation: OutboxOperation::Delete,
                payload: json!({ "id": "note-e2e-1", "updatedAt": "3000" }),
                actor_id: "bob".to_string(),
                updated_at: "3000".to_string(),
            }])
            .await
            .expect("delete quick note should succeed");
        assert_eq!(delete_res.acked.len(), 1);

        let delta_alice = alice
            .pull_changes(Some(&pull_bob.next_cursor))
            .await
            .expect("delta pull should succeed");
        assert!(
            delta_alice
                .removed_quick_note_ids
                .contains(&"note-e2e-1".to_string()),
            "removed quick note id missing in delta pull: {:?}",
            delta_alice.removed_quick_note_ids
        );
    });
}
