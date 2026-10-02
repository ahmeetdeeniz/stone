//! Conflict resolution, trash and revision history: the recovery tools the mobile app already
//! has, backed by the same outbox/conflict tables the desktop sync engine writes.

use super::{
    collection_for, decoded_fields, firestore_revision, fresh_session, get_firestore_document, now,
    title_for, tombstone_document_id, AuthState, Database, DesktopDocument, FetchError,
    SessionError, REMOTE_COLLECTIONS,
};
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::Serialize;
use std::sync::Mutex;
use tauri::State;
use uuid::Uuid;

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ConflictView {
    pub id: String,
    pub entity_type: String,
    pub entity_id: String,
    pub title: String,
    pub created_at: String,
    /// What this device has now (for documents: `title`/`markdown` of the local row).
    pub local: serde_json::Value,
    /// The server copy captured when the conflict was found; null when it was deleted.
    pub remote: serde_json::Value,
    pub remote_deleted: bool,
    /// The last version both sides shared, for a three-way merge (documents only).
    pub base_markdown: Option<String>,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct TrashedDocument {
    pub id: String,
    pub title: String,
    pub deleted_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct DocumentRevisionSummary {
    pub id: String,
    pub revision: i64,
    pub created_at: String,
    pub preview: String,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Resolution {
    Local,
    Remote,
    Merged(String),
}

/// The server's current copy of a conflicted entity, fetched right before resolving so a
/// decision is never made against a stale snapshot.
#[derive(Debug, Clone)]
pub struct RemoteState {
    pub document: Option<serde_json::Value>,
    pub tombstone: bool,
}

#[derive(Debug, Serialize, Clone, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResolveOutcome {
    /// Set when the remote copy was permanently deleted and the local version was kept as a
    /// new document.
    pub copied_document_id: Option<String>,
}

fn lock(database: &Mutex<Database>) -> Result<std::sync::MutexGuard<'_, Database>, String> {
    database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.".to_owned())
}

fn sql(error: rusqlite::Error) -> String {
    error.to_string()
}

/// Table, key column and whether the row keeps its JSON in a `payload` column.
fn table_for(entity_type: &str) -> Option<(&'static str, &'static str)> {
    match entity_type {
        "document" => Some(("documents", "id")),
        "task" => Some(("tasks", "id")),
        "calendar" => Some(("calendar_items", "id")),
        "focus" => Some(("focus_sessions", "id")),
        "focus_goal" => Some(("focus_goals", "owner_id")),
        "project" => Some(("projects", "id")),
        _ => None,
    }
}

fn is_tombstone(remote: &serde_json::Value) -> bool {
    remote
        .get("name")
        .and_then(|name| name.as_str())
        .is_some_and(|name| name.contains("/deletionTombstones/"))
}

pub fn list_conflicts_in(connection: &Connection) -> Result<Vec<ConflictView>, String> {
    let mut statement = connection
        .prepare("SELECT id, entity_type, entity_id, local_payload, remote_payload, created_at, base_revision FROM conflicts WHERE status = 'open' ORDER BY created_at DESC LIMIT 500")
        .map_err(sql)?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<i64>>(6)?,
            ))
        })
        .map_err(sql)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(sql)?;
    let mut seen = std::collections::HashSet::new();
    let mut conflicts = Vec::new();
    for (id, entity_type, entity_id, local_payload, remote_payload, created_at, base) in rows {
        // Several pushes of one entity can each record a conflict; the newest one stands for all.
        if !seen.insert((entity_type.clone(), entity_id.clone())) {
            continue;
        }
        let stored_local: serde_json::Value =
            serde_json::from_str(&local_payload).unwrap_or(serde_json::Value::Null);
        let remote_raw: serde_json::Value =
            serde_json::from_str(&remote_payload).unwrap_or(serde_json::Value::Null);
        let remote_deleted = is_tombstone(&remote_raw) || remote_raw.get("fields").is_none();
        let remote = if remote_deleted {
            serde_json::Value::Null
        } else {
            decoded_fields(&remote_raw)
        };
        let local = current_local(connection, &entity_type, &entity_id)?.unwrap_or(stored_local);
        let base_markdown = match (entity_type.as_str(), base) {
            ("document", Some(base)) => connection
                .query_row(
                    "SELECT markdown FROM document_revisions WHERE document_id = ?1 AND revision = ?2 ORDER BY created_at ASC LIMIT 1",
                    params![entity_id, base],
                    |row| row.get(0),
                )
                .optional()
                .map_err(sql)?,
            _ => None,
        };
        let title = [&local, &remote]
            .iter()
            .find_map(|value| {
                value
                    .get("title")
                    .and_then(|title| title.as_str())
                    .filter(|title| !title.trim().is_empty())
                    .map(str::to_owned)
            })
            .unwrap_or_else(|| entity_id.clone());
        conflicts.push(ConflictView {
            id,
            entity_type,
            entity_id,
            title,
            created_at,
            local,
            remote,
            remote_deleted,
            base_markdown,
        });
    }
    Ok(conflicts)
}

/// The entity as this device currently stores it, in the shape it is pushed.
fn current_local(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
) -> Result<Option<serde_json::Value>, String> {
    if entity_type == "document" {
        return connection
            .query_row(
                "SELECT title, markdown, path, deleted_at FROM documents WHERE id = ?1",
                [entity_id],
                |row| {
                    Ok(serde_json::json!({
                        "id": entity_id,
                        "title": row.get::<_, String>(0)?,
                        "markdown": row.get::<_, String>(1)?,
                        "path": row.get::<_, Option<String>>(2)?,
                        "deletedAt": row.get::<_, Option<String>>(3)?,
                    }))
                },
            )
            .optional()
            .map_err(sql);
    }
    let Some((table, key)) = table_for(entity_type) else {
        return Ok(None);
    };
    let payload: Option<String> = connection
        .query_row(
            &format!("SELECT payload FROM {table} WHERE {key} = ?1"),
            [entity_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?;
    Ok(payload.and_then(|payload| serde_json::from_str(&payload).ok()))
}

fn open_conflict(connection: &Connection, id: &str) -> Result<(String, String, String), String> {
    connection
        .query_row(
            "SELECT entity_type, entity_id, local_payload FROM conflicts WHERE id = ?1 AND status = 'open'",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "Çakışma bulunamadı ya da zaten çözüldü.".to_owned())
}

fn close_conflicts(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
    status: &str,
) -> Result<(), String> {
    // The unsent and blocked events carried the losing side; they must not be pushed later.
    connection
        .execute(
            "DELETE FROM outbox WHERE entity_type = ?1 AND entity_id = ?2 AND status IN ('pending', 'blocked')",
            params![entity_type, entity_id],
        )
        .map_err(sql)?;
    connection
        .execute(
            "UPDATE conflicts SET status = ?3 WHERE entity_type = ?1 AND entity_id = ?2 AND status = 'open'",
            params![entity_type, entity_id, status],
        )
        .map_err(sql)?;
    Ok(())
}

fn enqueue(
    connection: &Connection,
    entity_type: &str,
    entity_id: &str,
    base_revision: i64,
    revision: i64,
    payload: &serde_json::Value,
) -> Result<(), String> {
    let operation = if payload
        .get("deletedAt")
        .is_some_and(|value| !value.is_null())
    {
        "delete"
    } else {
        "upsert"
    };
    connection
        .execute(
            "INSERT INTO outbox(id, owner_id, entity_type, entity_id, operation, base_revision, revision, payload, created_at, status) VALUES(?1, '', ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'pending')",
            params![
                Uuid::new_v4().to_string(),
                entity_type,
                entity_id,
                operation,
                base_revision,
                revision,
                payload.to_string(),
                now()
            ],
        )
        .map(|_| ())
        .map_err(sql)
}

/// Applies a decision locally. Keeping the local (or merged) side re-queues it on top of the
/// server's current revision; keeping the server side drops the local edits and adopts it.
pub fn apply_resolution(
    database: &Mutex<Database>,
    conflict_id: &str,
    resolution: Resolution,
    remote: RemoteState,
) -> Result<ResolveOutcome, String> {
    let (entity_type, entity_id, stored_local) =
        open_conflict(&lock(database)?.connection, conflict_id)?;
    let (table, key) =
        table_for(&entity_type).ok_or_else(|| "Desteklenmeyen kayıt türü.".to_owned())?;
    if matches!(resolution, Resolution::Merged(_)) && entity_type != "document" {
        return Err("Birleştirme yalnızca notlar için kullanılabilir.".to_owned());
    }
    let remote_document = remote
        .document
        .filter(|document| !remote.tombstone && document.get("fields").is_some());

    if resolution == Resolution::Remote {
        {
            let db = lock(database)?;
            let transaction = db.connection.unchecked_transaction().map_err(sql)?;
            close_conflicts(&transaction, &entity_type, &entity_id, "resolved_remote")?;
            match &remote_document {
                // Gone on the server: drop the local copy too.
                None => {
                    transaction
                        .execute(
                            &format!("DELETE FROM {table} WHERE {key} = ?1"),
                            [&entity_id],
                        )
                        .map_err(sql)?;
                    if entity_type == "document" {
                        transaction
                            .execute(
                                "DELETE FROM document_revisions WHERE document_id = ?1",
                                [&entity_id],
                            )
                            .map_err(sql)?;
                    }
                }
                // Let the regular remote applier take the server copy whatever the local
                // revision number says.
                Some(_) => {
                    transaction
                        .execute(
                            &format!("UPDATE {table} SET revision = 0 WHERE {key} = ?1"),
                            [&entity_id],
                        )
                        .map_err(sql)?;
                }
            }
            transaction.commit().map_err(sql)?;
        }
        if let Some(document) = remote_document {
            let collection = collection_for(&entity_type).unwrap_or_default();
            if let Some((_, apply)) = REMOTE_COLLECTIONS
                .iter()
                .find(|(name, _)| *name == collection)
            {
                apply(database, std::slice::from_ref(&document))?;
            }
        }
        return Ok(ResolveOutcome {
            copied_document_id: None,
        });
    }

    let db = lock(database)?;
    let device_id = db.device_id.clone();
    let transaction = db.connection.unchecked_transaction().map_err(sql)?;
    let stored_local: serde_json::Value =
        serde_json::from_str(&stored_local).unwrap_or(serde_json::Value::Null);
    let mut local = current_local(&transaction, &entity_type, &entity_id)?.unwrap_or(stored_local);
    if let Resolution::Merged(markdown) = &resolution {
        let fallback = local
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Adsız not")
            .to_owned();
        local["markdown"] = serde_json::json!(markdown);
        local["title"] = serde_json::json!(title_for(markdown, &fallback));
    }
    let timestamp = now();

    if remote.tombstone {
        // A purged id can never be written again, so the kept version lives on as a copy.
        if entity_type != "document" {
            return Err("Bu kayıt başka bir cihazda kalıcı olarak silindi; yalnızca silmeyi kabul edebilirsiniz.".to_owned());
        }
        let copy_id = Uuid::new_v4().to_string();
        let title = local
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Adsız not")
            .to_owned();
        let markdown = local
            .get("markdown")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned();
        transaction
            .execute(
                "INSERT INTO documents(id, kind, title, markdown, path, revision, updated_at, created_at, deleted_at, updated_by_device_id, remote_fields) SELECT ?1, COALESCE((SELECT kind FROM documents WHERE id = ?2), 'note'), ?3, ?4, NULL, 1, ?5, ?5, NULL, ?6, (SELECT remote_fields FROM documents WHERE id = ?2)",
                params![copy_id, entity_id, title, markdown, timestamp, device_id],
            )
            .map_err(sql)?;
        transaction
            .execute(
                "INSERT INTO document_revisions(id, document_id, revision, markdown, created_at) VALUES(?1, ?2, 1, ?3, ?4)",
                params![Uuid::new_v4().to_string(), copy_id, markdown, timestamp],
            )
            .map_err(sql)?;
        close_conflicts(&transaction, &entity_type, &entity_id, "resolved_local")?;
        transaction
            .execute("DELETE FROM documents WHERE id = ?1", [&entity_id])
            .map_err(sql)?;
        transaction
            .execute(
                "DELETE FROM document_revisions WHERE document_id = ?1",
                [&entity_id],
            )
            .map_err(sql)?;
        enqueue(
            &transaction,
            "document",
            &copy_id,
            0,
            1,
            &serde_json::json!({ "id": copy_id, "title": title, "markdown": markdown, "path": null }),
        )?;
        transaction.commit().map_err(sql)?;
        return Ok(ResolveOutcome {
            copied_document_id: Some(copy_id),
        });
    }

    let base_revision = remote_document
        .as_ref()
        .map(firestore_revision)
        .unwrap_or(0);
    let revision = base_revision + 1;
    close_conflicts(&transaction, &entity_type, &entity_id, "resolved_local")?;
    if entity_type == "document" {
        let title = local
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or("Adsız not");
        let markdown = local
            .get("markdown")
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let path = local.get("path").and_then(|value| value.as_str());
        let deleted_at = local.get("deletedAt").and_then(|value| value.as_str());
        transaction
            .execute(
                "INSERT INTO documents(id, kind, title, markdown, path, revision, updated_at, created_at, deleted_at, updated_by_device_id) VALUES(?1, 'note', ?2, ?3, ?4, ?5, ?6, ?6, ?7, ?8) ON CONFLICT(id) DO UPDATE SET title=excluded.title, markdown=excluded.markdown, revision=excluded.revision, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at, updated_by_device_id=excluded.updated_by_device_id",
                params![entity_id, title, markdown, path, revision, timestamp, deleted_at, device_id],
            )
            .map_err(sql)?;
        transaction
            .execute(
                "INSERT INTO document_revisions(id, document_id, revision, markdown, created_at) VALUES(?1, ?2, ?3, ?4, ?5)",
                params![Uuid::new_v4().to_string(), entity_id, revision, markdown, timestamp],
            )
            .map_err(sql)?;
        enqueue(
            &transaction,
            "document",
            &entity_id,
            base_revision,
            revision,
            &serde_json::json!({ "id": entity_id, "title": title, "markdown": markdown, "path": path, "deletedAt": deleted_at }),
        )?;
    } else {
        if !local.is_object() {
            return Err("Yerel kayıt bulunamadı.".to_owned());
        }
        local["revision"] = serde_json::json!(revision);
        let updated = transaction
            .execute(
                &format!("UPDATE {table} SET payload = ?2, revision = ?3 WHERE {key} = ?1"),
                params![entity_id, local.to_string(), revision],
            )
            .map_err(sql)?;
        if updated == 0 {
            return Err("Yerel kayıt bulunamadı.".to_owned());
        }
        enqueue(
            &transaction,
            &entity_type,
            &entity_id,
            base_revision,
            revision,
            &local,
        )?;
    }
    transaction.commit().map_err(sql)?;
    Ok(ResolveOutcome {
        copied_document_id: None,
    })
}

#[tauri::command]
pub fn list_conflicts(state: State<'_, Mutex<Database>>) -> Result<Vec<ConflictView>, String> {
    list_conflicts_in(&lock(&state)?.connection)
}

#[tauri::command]
pub async fn resolve_conflict(
    id: String,
    resolution: String,
    merged_markdown: Option<String>,
    api_key: String,
    project_id: String,
    database: State<'_, Mutex<Database>>,
    auth: State<'_, AuthState>,
) -> Result<ResolveOutcome, String> {
    let resolution = match (resolution.as_str(), merged_markdown) {
        ("local", _) => Resolution::Local,
        ("remote", _) => Resolution::Remote,
        ("merged", Some(markdown)) => Resolution::Merged(markdown),
        _ => return Err("Geçersiz çözüm seçimi.".to_owned()),
    };
    let (entity_type, entity_id, _) = open_conflict(&lock(&database)?.connection, &id)?;
    let collection =
        collection_for(&entity_type).ok_or_else(|| "Desteklenmeyen kayıt türü.".to_owned())?;
    let offline = || "Çakışmayı çözmek için internet bağlantısı gerekiyor.".to_owned();
    let client = Client::new();
    let session = match fresh_session(&client, &api_key, &auth).await {
        Ok(session) => session,
        Err(SessionError::Offline) => return Err(offline()),
        Err(SessionError::Failed(message)) => return Err(message),
    };
    let root = format!(
        "projects/{project_id}/databases/(default)/documents/users/{}",
        session.uid
    );
    let fetch = |name: String| {
        let client = client.clone();
        let token = session.id_token.clone();
        async move { get_firestore_document(&client, &name, &token).await }
    };
    let document = match fetch(format!("{root}/{collection}/{entity_id}")).await {
        Ok(document) => document,
        Err(FetchError::Offline) => return Err(offline()),
        Err(FetchError::Failed(message)) => return Err(message),
    };
    let tombstone = match fetch(format!(
        "{root}/deletionTombstones/{}",
        tombstone_document_id(&entity_type, &entity_id)
    ))
    .await
    {
        Ok(tombstone) => tombstone.is_some(),
        Err(FetchError::Offline) => return Err(offline()),
        Err(FetchError::Failed(message)) => return Err(message),
    };
    apply_resolution(
        &database,
        &id,
        resolution,
        RemoteState {
            document,
            tombstone,
        },
    )
}

/// Moves a document to the trash (a synced soft delete, restorable on every device).
pub fn trash_document_in(database: &Database, id: &str) -> Result<(), String> {
    set_document_deleted(database, id, Some(now()))
}

pub fn restore_document_in(database: &Database, id: &str) -> Result<DesktopDocument, String> {
    set_document_deleted(database, id, None)?;
    database
        .connection
        .query_row(
            "SELECT id, title, markdown, path, revision, updated_at FROM documents WHERE id = ?1",
            [id],
            super::document_from_row,
        )
        .map_err(sql)
}

fn set_document_deleted(
    database: &Database,
    id: &str,
    deleted_at: Option<String>,
) -> Result<(), String> {
    let transaction = database.connection.unchecked_transaction().map_err(sql)?;
    let (title, markdown, path, previous): (String, String, Option<String>, i64) = transaction
        .query_row(
            "SELECT title, markdown, path, revision FROM documents WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
        )
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "Not bulunamadı.".to_owned())?;
    let revision = previous + 1;
    transaction
        .execute(
            "UPDATE documents SET deleted_at = ?2, revision = ?3, updated_at = ?4, updated_by_device_id = ?5 WHERE id = ?1",
            params![id, deleted_at, revision, now(), database.device_id],
        )
        .map_err(sql)?;
    enqueue(
        &transaction,
        "document",
        id,
        previous,
        revision,
        &serde_json::json!({ "id": id, "title": title, "markdown": markdown, "path": path, "deletedAt": deleted_at }),
    )?;
    transaction.commit().map_err(sql)
}

#[tauri::command]
pub fn delete_document(id: String, state: State<'_, Mutex<Database>>) -> Result<(), String> {
    trash_document_in(&*lock(&state)?, &id)
}

#[tauri::command]
pub fn restore_document(
    id: String,
    state: State<'_, Mutex<Database>>,
) -> Result<DesktopDocument, String> {
    restore_document_in(&*lock(&state)?, &id)
}

#[tauri::command]
pub fn list_trash(state: State<'_, Mutex<Database>>) -> Result<Vec<TrashedDocument>, String> {
    let db = lock(&state)?;
    let mut statement = db
        .connection
        .prepare("SELECT id, title, deleted_at FROM documents WHERE deleted_at IS NOT NULL ORDER BY deleted_at DESC LIMIT 500")
        .map_err(sql)?;
    let rows = statement
        .query_map([], |row| {
            Ok(TrashedDocument {
                id: row.get(0)?,
                title: row.get(1)?,
                deleted_at: row.get(2)?,
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql)
}

pub fn list_revisions_in(
    connection: &Connection,
    document_id: &str,
) -> Result<Vec<DocumentRevisionSummary>, String> {
    let mut statement = connection
        .prepare("SELECT id, revision, created_at, substr(markdown, 1, 400) FROM document_revisions WHERE document_id = ?1 ORDER BY created_at DESC, revision DESC LIMIT 100")
        .map_err(sql)?;
    let rows = statement
        .query_map([document_id], |row| {
            let markdown: String = row.get(3)?;
            Ok(DocumentRevisionSummary {
                id: row.get(0)?,
                revision: row.get(1)?,
                created_at: row.get(2)?,
                preview: preview(&markdown),
            })
        })
        .map_err(sql)?;
    rows.collect::<Result<Vec<_>, _>>().map_err(sql)
}

/// First meaningful line of a version, for the history list.
fn preview(markdown: &str) -> String {
    let mut lines = markdown.lines().peekable();
    if lines.peek().is_some_and(|line| line.trim() == "---") {
        lines.next();
        for line in lines.by_ref() {
            if line.trim() == "---" {
                break;
            }
        }
    }
    lines
        .map(|line| line.trim_start_matches('#').trim())
        .find(|line| !line.is_empty())
        .unwrap_or_default()
        .chars()
        .take(120)
        .collect()
}

#[tauri::command]
pub fn list_document_revisions(
    document_id: String,
    state: State<'_, Mutex<Database>>,
) -> Result<Vec<DocumentRevisionSummary>, String> {
    list_revisions_in(&lock(&state)?.connection, &document_id)
}

#[tauri::command]
pub fn get_document_revision(
    id: String,
    state: State<'_, Mutex<Database>>,
) -> Result<String, String> {
    lock(&state)?
        .connection
        .query_row(
            "SELECT markdown FROM document_revisions WHERE id = ?1",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(sql)?
        .ok_or_else(|| "Sürüm bulunamadı.".to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::path::PathBuf;

    fn database() -> (Mutex<Database>, PathBuf) {
        let path = std::env::temp_dir().join(format!("stone-recovery-{}.db", Uuid::new_v4()));
        (Mutex::new(Database::open(path.clone()).unwrap()), path)
    }

    fn insert_document(db: &Database, id: &str, markdown: &str, revision: i64) {
        db.connection
            .execute(
                "INSERT INTO documents(id, kind, title, markdown, path, revision, updated_at, created_at, deleted_at, updated_by_device_id) VALUES(?1, 'note', 'Local', ?2, NULL, ?3, 'now', 'now', NULL, 'device')",
                params![id, markdown, revision],
            )
            .unwrap();
    }

    fn insert_conflict(
        db: &Database,
        entity_type: &str,
        entity_id: &str,
        remote: serde_json::Value,
    ) {
        db.connection
            .execute(
                "INSERT INTO outbox(id, owner_id, entity_type, entity_id, operation, base_revision, revision, payload, created_at, status) VALUES(?1, 'u', ?2, ?3, 'upsert', 1, 2, '{}', 'now', 'blocked')",
                params![Uuid::new_v4().to_string(), entity_type, entity_id],
            )
            .unwrap();
        db.connection
            .execute(
                "INSERT INTO conflicts(id, entity_id, local_payload, remote_payload, created_at, status, entity_type, base_revision) VALUES('c1', ?1, '{}', ?2, 'now', 'open', ?3, 1)",
                params![entity_id, remote.to_string(), entity_type],
            )
            .unwrap();
    }

    fn remote_document(id: &str, markdown: &str, revision: i64) -> serde_json::Value {
        serde_json::json!({
            "name": format!("projects/p/databases/(default)/documents/users/u/documents/{id}"),
            "fields": {
                "id": { "stringValue": id },
                "title": { "stringValue": "Remote" },
                "markdown": { "stringValue": markdown },
                "kind": { "stringValue": "project" },
                "projectId": { "stringValue": "project-1" },
                "revision": { "integerValue": revision.to_string() },
            }
        })
    }

    fn outbox(db: &Database) -> Vec<(String, i64, i64, String)> {
        let mut statement = db
            .connection
            .prepare("SELECT entity_id, base_revision, revision, payload FROM outbox WHERE status = 'pending' ORDER BY created_at")
            .unwrap();
        statement
            .query_map([], |row| {
                Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap()
    }

    #[test]
    fn lists_document_conflicts_with_local_remote_and_base() {
        let (database, path) = database();
        {
            let db = database.lock().unwrap();
            insert_document(&db, "doc-1", "# Local\n\nmine", 2);
            db.connection
                .execute("INSERT INTO document_revisions(id, document_id, revision, markdown, created_at) VALUES('r1', 'doc-1', 1, '# Base', 'then')", [])
                .unwrap();
            insert_conflict(
                &db,
                "document",
                "doc-1",
                remote_document("doc-1", "# Remote", 3),
            );
            let conflicts = list_conflicts_in(&db.connection).unwrap();
            assert_eq!(conflicts.len(), 1);
            assert_eq!(conflicts[0].local["markdown"], "# Local\n\nmine");
            assert_eq!(conflicts[0].remote["markdown"], "# Remote");
            assert_eq!(conflicts[0].base_markdown.as_deref(), Some("# Base"));
            assert!(!conflicts[0].remote_deleted);
        }
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn keeping_local_requeues_on_top_of_the_current_remote_revision() {
        let (database, path) = database();
        {
            let db = database.lock().unwrap();
            insert_document(&db, "doc-1", "# Local", 2);
            insert_conflict(
                &db,
                "document",
                "doc-1",
                remote_document("doc-1", "# Remote", 3),
            );
        }
        let remote = RemoteState {
            document: Some(remote_document("doc-1", "# Newer remote", 5)),
            tombstone: false,
        };
        apply_resolution(
            &database,
            "c1",
            Resolution::Merged("# Merged\n".to_owned()),
            remote,
        )
        .unwrap();
        let db = database.lock().unwrap();
        let queued = outbox(&db);
        assert_eq!(queued.len(), 1, "blocked event replaced by one fresh event");
        assert_eq!((queued[0].1, queued[0].2), (5, 6));
        assert!(queued[0].3.contains("# Merged"));
        let (revision, title): (i64, String) = db
            .connection
            .query_row(
                "SELECT revision, title FROM documents WHERE id = 'doc-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!((revision, title.as_str()), (6, "Merged"));
        assert!(list_conflicts_in(&db.connection).unwrap().is_empty());
        drop(db);
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn keeping_remote_adopts_the_server_copy_and_drops_local_edits() {
        let (database, path) = database();
        {
            let db = database.lock().unwrap();
            insert_document(&db, "doc-1", "# Local", 7);
            insert_conflict(
                &db,
                "document",
                "doc-1",
                remote_document("doc-1", "# Remote", 3),
            );
        }
        let remote = RemoteState {
            document: Some(remote_document("doc-1", "# Remote now", 4)),
            tombstone: false,
        };
        apply_resolution(&database, "c1", Resolution::Remote, remote).unwrap();
        let db = database.lock().unwrap();
        assert!(outbox(&db).is_empty());
        let (markdown, revision, kind): (String, i64, String) = db
            .connection
            .query_row(
                "SELECT markdown, revision, kind FROM documents WHERE id = 'doc-1'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(
            (markdown.as_str(), revision, kind.as_str()),
            ("# Remote now", 4, "project")
        );
        drop(db);
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn keeping_local_after_a_remote_purge_saves_a_copy() {
        let (database, path) = database();
        {
            let db = database.lock().unwrap();
            insert_document(&db, "doc-1", "# Keep me", 2);
            insert_conflict(
                &db,
                "document",
                "doc-1",
                serde_json::json!({ "name": "x/deletionTombstones/document_doc-1", "fields": {} }),
            );
        }
        let outcome = apply_resolution(
            &database,
            "c1",
            Resolution::Local,
            RemoteState {
                document: None,
                tombstone: true,
            },
        )
        .unwrap();
        let copy = outcome.copied_document_id.expect("copy id");
        let db = database.lock().unwrap();
        let queued = outbox(&db);
        assert_eq!(queued.len(), 1);
        assert_eq!(
            (queued[0].0.as_str(), queued[0].1, queued[0].2),
            (copy.as_str(), 0, 1)
        );
        let original: Option<String> = db
            .connection
            .query_row("SELECT id FROM documents WHERE id = 'doc-1'", [], |row| {
                row.get(0)
            })
            .optional()
            .unwrap();
        assert!(original.is_none());
        drop(db);
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn non_documents_cannot_be_merged_or_resurrected() {
        let (database, path) = database();
        {
            let db = database.lock().unwrap();
            insert_conflict(&db, "task", "task-1", serde_json::json!({}));
        }
        let gone = || RemoteState {
            document: None,
            tombstone: true,
        };
        assert!(apply_resolution(&database, "c1", Resolution::Merged("x".into()), gone()).is_err());
        assert!(apply_resolution(&database, "c1", Resolution::Local, gone()).is_err());
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn trash_and_restore_are_synced_revisions() {
        let (database, path) = database();
        let db = database.lock().unwrap();
        insert_document(&db, "doc-1", "# Note", 1);
        trash_document_in(&db, "doc-1").unwrap();
        let trashed: Option<String> = db
            .connection
            .query_row(
                "SELECT deleted_at FROM documents WHERE id = 'doc-1'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert!(trashed.is_some());
        let restored = restore_document_in(&db, "doc-1").unwrap();
        assert_eq!(restored.revision, 3);
        let queued = outbox(&db);
        assert_eq!(
            queued
                .iter()
                .map(|event| (event.1, event.2))
                .collect::<Vec<_>>(),
            vec![(1, 2), (2, 3)]
        );
        assert!(queued[0].3.contains("\"deletedAt\":\""));
        assert!(queued[1].3.contains("\"deletedAt\":null"));
        drop(db);
        drop(database);
        let _ = std::fs::remove_file(path);
    }

    #[test]
    fn revision_previews_skip_frontmatter_and_heading_marks() {
        assert_eq!(
            preview("---\nstone:\n  type: project\n---\n# Title\nbody"),
            "Title"
        );
        assert_eq!(preview("\n## Notes\n"), "Notes");
        assert_eq!(preview(""), "");
    }
}
