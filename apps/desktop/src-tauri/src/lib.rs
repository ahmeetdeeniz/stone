use chrono::Utc;
use keyring::Entry;
use notify::{RecommendedWatcher, RecursiveMode, Watcher};
use reqwest::Client;
use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    collections::HashMap,
    fs,
    path::{Path, PathBuf},
    process::Command,
    sync::Mutex,
    time::UNIX_EPOCH,
};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

pub mod git;
pub mod github;

const MAX_MARKDOWN_BYTES: u64 = 10 * 1024 * 1024;
const KEYCHAIN_SERVICE: &str = "com.imtempra.stone";
const KEYCHAIN_ACCOUNT: &str = "firebase-refresh-token";

pub struct Database {
    pub connection: Connection,
    device_id: String,
}
struct Watchers(Mutex<HashMap<String, RecommendedWatcher>>);
struct AuthState(Mutex<Option<AuthSession>>);
struct RestoreCancellation(Mutex<std::collections::HashSet<String>>);

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopDocument {
    pub id: String,
    pub title: String,
    pub markdown: String,
    pub path: Option<String>,
    pub revision: i64,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct DesktopTask {
    #[serde(default = "task_schema_version")]
    pub schema_version: i64,
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub state: String,
    pub completed_at: Option<String>,
    pub due_date: Option<String>,
    pub due_time: Option<String>,
    pub timezone: String,
    pub priority: String,
    pub sort_order: f64,
    pub tags: Vec<String>,
    pub project_id: Option<String>,
    pub parent_task_id: Option<String>,
    pub estimated_minutes: Option<i64>,
    pub recurrence: Option<serde_json::Value>,
    #[serde(default)]
    pub source_document_id: Option<String>,
    #[serde(default)]
    pub source_block_id: Option<String>,
    #[serde(default)]
    pub recurrence_series_id: Option<String>,
    #[serde(default)]
    pub occurrence_date: Option<String>,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
    pub deleted_at: Option<String>,
}

fn task_schema_version() -> i64 {
    1
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct FileFingerprint {
    pub sha256: String,
    pub modified_ms: i64,
    pub size: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AuthSession {
    pub uid: String,
    pub email: String,
    pub id_token: String,
    pub refresh_token: String,
    pub expires_at: i64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PublicAuthSession {
    uid: String,
    email: String,
    id_token: String,
    expires_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct DocumentInput {
    id: String,
    title: String,
    markdown: String,
    path: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct FileChanged {
    path: String,
    fingerprint: FileFingerprint,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirebaseSignInResponse {
    local_id: String,
    email: String,
    id_token: String,
    refresh_token: String,
    expires_in: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct FirebaseRefreshResponse {
    user_id: String,
    id_token: String,
    refresh_token: String,
    expires_in: String,
}

#[derive(Debug, Deserialize)]
struct FirebaseLookupResponse {
    users: Vec<FirebaseUser>,
}

#[derive(Debug, Deserialize)]
struct FirebaseUser {
    email: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SyncSummary {
    pushed: u32,
    pulled: u32,
    conflicts: u32,
    offline: bool,
}

#[derive(Debug, Deserialize)]
struct FirebaseErrorEnvelope {
    error: FirebaseError,
}
#[derive(Debug, Deserialize)]
struct FirebaseError {
    message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLinkInput {
    pub project_id: String,
    pub repository: github::GitHubRepository,
    pub local_path: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct GitHubLink {
    pub project_id: String,
    pub repository: github::GitHubRepository,
    pub local_path: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreRepositoryInput {
    pub full_name: String,
    pub size_kb: u64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreItemResult {
    pub full_name: String,
    pub status: String,
    pub path: Option<String>,
    pub error: Option<String>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RestoreSummary {
    pub run_id: String,
    pub cancelled: bool,
    pub results: Vec<RestoreItemResult>,
}

pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_data = app
                .path()
                .app_data_dir()
                .map_err(|error| error.to_string())?;
            let database = Database::open(app_data.join("stone.sqlite3"))
                .map_err(|error| error.to_string())?;
            app.manage(Mutex::new(database));
            app.manage(Watchers(Mutex::new(HashMap::new())));
            app.manage(AuthState(Mutex::new(None)));
            app.manage(RestoreCancellation(Mutex::new(
                std::collections::HashSet::new(),
            )));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            list_documents,
            list_tasks,
            list_calendar_items,
            list_calendar_items_for_export,
            list_focus_sessions,
            save_focus_session,
            save_focus_goal,
            get_focus_goal,
            pick_calendar_file,
            save_calendar_file,
            save_calendar_item,
            delete_calendar_item,
            save_task,
            delete_task,
            get_document,
            save_document,
            open_markdown_file,
            pick_markdown_file,
            pick_folder,
            index_folder,
            load_linked_file,
            save_linked_file,
            watch_folder,
            keychain_get,
            keychain_set,
            keychain_delete,
            open_external,
            auth_sign_in,
            auth_restore,
            auth_password_reset,
            auth_sign_out,
            sync_now,
            github_device_start,
            github_device_poll,
            github_status,
            github_disconnect,
            github_list_repositories,
            github_link_repository,
            github_list_links,
            git_system_version,
            git_status,
            git_review,
            git_pull,
            git_stage_commit_push,
            git_clone,
            restore_disk_check,
            restore_repositories,
            cancel_restore,
            open_external_path,
            open_github_url
        ])
        .run(tauri::generate_context!())
        .expect("error while running Stone");
}

impl Database {
    /// `pub` so the opt-in live-integration test suite (`tests/github_live.rs`) can open the
    /// exact production schema against a disposable database file; not used by any UI path.
    pub fn open(path: PathBuf) -> rusqlite::Result<Self> {
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent)
                .map_err(|_| rusqlite::Error::InvalidPath(parent.to_path_buf()))?;
        }
        let connection = Connection::open(path)?;
        connection.execute_batch("PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;")?;
        connection.execute_batch("CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL);")?;
        let current: i64 = connection.pragma_query_value(None, "user_version", |row| row.get(0))?;
        if current < 1 {
            connection.execute_batch("CREATE TABLE IF NOT EXISTS devices (id TEXT PRIMARY KEY, platform TEXT NOT NULL, name TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS documents (id TEXT PRIMARY KEY, kind TEXT NOT NULL, title TEXT NOT NULL, markdown TEXT NOT NULL, path TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, created_at TEXT NOT NULL, deleted_at TEXT, updated_by_device_id TEXT NOT NULL); CREATE TABLE IF NOT EXISTS document_revisions (id TEXT PRIMARY KEY, document_id TEXT NOT NULL, revision INTEGER NOT NULL, markdown TEXT NOT NULL, created_at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS outbox (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, operation TEXT NOT NULL, base_revision INTEGER NOT NULL, revision INTEGER NOT NULL, payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', attempt_count INTEGER NOT NULL DEFAULT 0, last_error TEXT); CREATE INDEX IF NOT EXISTS documents_updated_at ON documents(updated_at DESC); CREATE TABLE IF NOT EXISTS linked_files (path TEXT PRIMARY KEY, document_id TEXT NOT NULL, sha256 TEXT NOT NULL, modified_ms INTEGER NOT NULL, size INTEGER NOT NULL, linked_folder TEXT); CREATE TABLE IF NOT EXISTS conflicts (id TEXT PRIMARY KEY, entity_id TEXT NOT NULL, local_payload TEXT NOT NULL, remote_payload TEXT NOT NULL, created_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'open');")?;
            connection.pragma_update(None, "user_version", 1_i64)?;
            connection.execute(
                "INSERT OR IGNORE INTO migrations(version, applied_at) VALUES(1, ?1)",
                [Utc::now().to_rfc3339()],
            )?;
        }
        if current < 2 {
            connection.execute_batch("CREATE TABLE IF NOT EXISTS github_links (project_id TEXT PRIMARY KEY, repository_id INTEGER NOT NULL, full_name TEXT NOT NULL, name TEXT NOT NULL, private INTEGER NOT NULL, html_url TEXT NOT NULL, clone_url TEXT NOT NULL, ssh_url TEXT NOT NULL, size_kb INTEGER NOT NULL, default_branch TEXT NOT NULL, visibility TEXT, local_path TEXT, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS github_links_repository_id ON github_links(repository_id);")?;
            connection.pragma_update(None, "user_version", 2_i64)?;
            connection.execute(
                "INSERT OR IGNORE INTO migrations(version, applied_at) VALUES(2, ?1)",
                [Utc::now().to_rfc3339()],
            )?;
        }
        if current < 3 {
            connection.execute_batch("CREATE TABLE IF NOT EXISTS tasks (id TEXT PRIMARY KEY, payload TEXT NOT NULL, state TEXT NOT NULL, due_date TEXT, project_id TEXT, parent_task_id TEXT, sort_order REAL NOT NULL DEFAULT 0, revision INTEGER NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT); CREATE INDEX IF NOT EXISTS desktop_tasks_due_idx ON tasks(state, deleted_at, due_date); CREATE INDEX IF NOT EXISTS desktop_tasks_project_idx ON tasks(project_id, state, deleted_at); CREATE INDEX IF NOT EXISTS desktop_tasks_parent_idx ON tasks(parent_task_id, sort_order);")?;
            connection.pragma_update(None, "user_version", 3_i64)?;
            connection.execute(
                "INSERT OR IGNORE INTO migrations(version, applied_at) VALUES(3, ?1)",
                [Utc::now().to_rfc3339()],
            )?;
        }
        if current < 4 {
            connection.execute_batch("CREATE TABLE IF NOT EXISTS calendar_items (id TEXT PRIMARY KEY, payload TEXT NOT NULL, kind TEXT NOT NULL, start_date TEXT NOT NULL, end_date TEXT NOT NULL, task_id TEXT, project_id TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT); CREATE INDEX IF NOT EXISTS desktop_calendar_range_idx ON calendar_items(deleted_at, start_date, end_date); CREATE INDEX IF NOT EXISTS desktop_calendar_task_idx ON calendar_items(task_id, deleted_at, start_date);")?;
            connection.pragma_update(None, "user_version", 4_i64)?;
            connection.execute(
                "INSERT OR IGNORE INTO migrations(version, applied_at) VALUES(4, ?1)",
                [Utc::now().to_rfc3339()],
            )?;
        }
        if current < 5 {
            connection.execute_batch("CREATE TABLE IF NOT EXISTS focus_sessions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, payload TEXT NOT NULL, status TEXT NOT NULL, phase TEXT NOT NULL, started_at TEXT NOT NULL, ended_at TEXT, task_id TEXT, project_id TEXT, calendar_item_id TEXT, revision INTEGER NOT NULL, updated_at TEXT NOT NULL, deleted_at TEXT); CREATE TABLE IF NOT EXISTS focus_goals (owner_id TEXT PRIMARY KEY, payload TEXT NOT NULL, revision INTEGER NOT NULL, updated_at TEXT NOT NULL); CREATE INDEX IF NOT EXISTS desktop_focus_active_idx ON focus_sessions(owner_id,status,deleted_at,updated_at DESC); CREATE INDEX IF NOT EXISTS desktop_focus_range_idx ON focus_sessions(owner_id,deleted_at,started_at,ended_at); CREATE INDEX IF NOT EXISTS desktop_focus_task_idx ON focus_sessions(owner_id,task_id,deleted_at,started_at); CREATE INDEX IF NOT EXISTS desktop_focus_project_idx ON focus_sessions(owner_id,project_id,deleted_at,started_at);")?;
            connection.pragma_update(None, "user_version", 5_i64)?;
            connection.execute(
                "INSERT OR IGNORE INTO migrations(version, applied_at) VALUES(5, ?1)",
                [Utc::now().to_rfc3339()],
            )?;
        }
        let device_id = connection.query_row("SELECT id FROM devices LIMIT 1", [], |row| row.get(0)).optional()?.unwrap_or_else(|| {
            let id = Uuid::new_v4().to_string();
            let _ = connection.execute("INSERT INTO devices(id, platform, name, created_at) VALUES(?1, 'windows', 'Stone Desktop', ?2)", params![id, Utc::now().to_rfc3339()]);
            id
        });
        Ok(Self {
            connection,
            device_id,
        })
    }
}

fn now() -> String {
    Utc::now().to_rfc3339()
}

fn validate_task(task: &DesktopTask) -> Result<(), String> {
    if task.title.trim().is_empty() || task.title.chars().count() > 512 {
        return Err("Görev başlığı zorunludur ve 512 karakteri aşamaz.".to_owned());
    }
    if !matches!(task.state.as_str(), "open" | "completed" | "cancelled") {
        return Err("Görev durumu geçersiz.".to_owned());
    }
    if !matches!(task.priority.as_str(), "none" | "low" | "medium" | "high") {
        return Err("Görev önceliği geçersiz.".to_owned());
    }
    if task.state == "completed" && task.completed_at.is_none() {
        return Err("Tamamlanan görev completion zamanı taşımalıdır.".to_owned());
    }
    Ok(())
}

fn task_sync_payload(task: &DesktopTask) -> serde_json::Value {
    serde_json::to_value(task).unwrap_or_else(|_| serde_json::json!({}))
}
fn validate_markdown_path(path: &Path) -> Result<(), String> {
    let extension = path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if extension != "md" && extension != "markdown" {
        return Err("Stone yalnızca .md ve .markdown dosyalarını açabilir.".to_owned());
    }
    Ok(())
}
fn canonical_file(path: &str) -> Result<PathBuf, String> {
    let path = PathBuf::from(path);
    validate_markdown_path(&path)?;
    let canonical = fs::canonicalize(&path).map_err(|error| format!("Dosya açılamadı: {error}"))?;
    let metadata = fs::metadata(&canonical).map_err(|error| error.to_string())?;
    if !metadata.is_file() {
        return Err("Seçilen yol bir dosya değil.".to_owned());
    }
    if metadata.len() > MAX_MARKDOWN_BYTES {
        return Err("Markdown dosyası 10 MiB sınırını aşıyor.".to_owned());
    }
    Ok(canonical)
}
fn fingerprint(path: &Path, bytes: &[u8]) -> Result<FileFingerprint, String> {
    let metadata = fs::metadata(path).map_err(|error| error.to_string())?;
    let modified_ms = metadata
        .modified()
        .ok()
        .and_then(|time| time.duration_since(UNIX_EPOCH).ok())
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0);
    Ok(FileFingerprint {
        sha256: format!("{:x}", Sha256::digest(bytes)),
        modified_ms,
        size: bytes.len() as u64,
    })
}
fn read_markdown(path: &Path) -> Result<(String, FileFingerprint), String> {
    let bytes = fs::read(path).map_err(|error| format!("Dosya okunamadı: {error}"))?;
    if bytes.len() as u64 > MAX_MARKDOWN_BYTES {
        return Err("Markdown dosyası 10 MiB sınırını aşıyor.".to_owned());
    }
    let content = String::from_utf8(bytes.clone())
        .map_err(|_| "Markdown dosyası UTF-8 olmalı.".to_owned())?;
    Ok((content, fingerprint(path, &bytes)?))
}
fn title_for(content: &str, fallback: &str) -> String {
    content
        .lines()
        .find_map(|line| line.strip_prefix("# "))
        .map(str::trim)
        .filter(|title| !title.is_empty())
        .unwrap_or(fallback)
        .to_owned()
}
fn document_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<DesktopDocument> {
    Ok(DesktopDocument {
        id: row.get(0)?,
        title: row.get(1)?,
        markdown: row.get(2)?,
        path: row.get(3)?,
        revision: row.get(4)?,
        updated_at: row.get(5)?,
    })
}

#[tauri::command]
fn list_documents(state: State<'_, Mutex<Database>>) -> Result<Vec<DesktopDocument>, String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let mut statement = db.connection.prepare("SELECT id, title, markdown, path, revision, updated_at FROM documents WHERE deleted_at IS NULL ORDER BY updated_at DESC") .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], document_from_row)
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_tasks(state: State<'_, Mutex<Database>>) -> Result<Vec<DesktopTask>, String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let mut statement = db
        .connection
        .prepare("SELECT payload FROM tasks WHERE deleted_at IS NULL ORDER BY due_date IS NULL, due_date, sort_order, updated_at DESC")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let payload: String = row.get(0)?;
            serde_json::from_str::<DesktopTask>(&payload).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    payload.len(),
                    rusqlite::types::Type::Text,
                    Box::new(error),
                )
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn list_calendar_items(
    start_date: String,
    end_date: String,
    state: State<'_, Mutex<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    if start_date.len() != 10 || end_date.len() != 10 || end_date < start_date {
        return Err("Invalid calendar window.".into());
    }
    let database = state.lock().map_err(|_| "Database lock failed.")?;
    let mut statement = database.connection.prepare(
        "SELECT payload FROM calendar_items WHERE deleted_at IS NULL AND ((end_date >= ?1 AND start_date <= ?2) OR (start_date <= ?2 AND json_extract(payload, '$.recurrence') IS NOT NULL)) ORDER BY start_date, id LIMIT 2000",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![start_date, end_date], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&payload).map_err(|error| error.to_string())
    })
    .collect()
}

#[tauri::command]
fn list_calendar_items_for_export(
    state: State<'_, Mutex<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    let database = state.lock().map_err(|_| "Database lock failed.")?;
    let mut statement = database
        .connection
        .prepare(
            "SELECT payload FROM calendar_items WHERE deleted_at IS NULL ORDER BY start_date, id LIMIT 10000",
        )
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&payload).map_err(|error| error.to_string())
    })
    .collect()
}

#[tauri::command]
fn list_focus_sessions(
    owner_id: String,
    start_at: String,
    end_at: String,
    state: State<'_, Mutex<Database>>,
) -> Result<Vec<serde_json::Value>, String> {
    if owner_id.trim().is_empty() || end_at <= start_at {
        return Err("Invalid focus query.".into());
    }
    let database = state.lock().map_err(|_| "Database lock failed.")?;
    let mut statement = database.connection.prepare(
        "SELECT payload FROM focus_sessions WHERE owner_id=?1 AND deleted_at IS NULL AND started_at < ?3 AND COALESCE(ended_at,updated_at) >= ?2 ORDER BY started_at DESC,id LIMIT 10000",
    ).map_err(|error| error.to_string())?;
    let rows = statement
        .query_map(params![owner_id, start_at, end_at], |row| {
            row.get::<_, String>(0)
        })
        .map_err(|error| error.to_string())?;
    rows.map(|row| {
        let payload = row.map_err(|error| error.to_string())?;
        serde_json::from_str(&payload).map_err(|error| error.to_string())
    })
    .collect()
}

#[tauri::command]
fn get_focus_goal(
    owner_id: String,
    state: State<'_, Mutex<Database>>,
) -> Result<Option<serde_json::Value>, String> {
    let database = state.lock().map_err(|_| "Database lock failed.")?;
    let payload = database
        .connection
        .query_row(
            "SELECT payload FROM focus_goals WHERE owner_id=?1",
            [&owner_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    payload
        .map(|value| serde_json::from_str(&value).map_err(|error| error.to_string()))
        .transpose()
}

#[tauri::command]
fn save_focus_session(
    mut session: serde_json::Value,
    state: State<'_, Mutex<Database>>,
) -> Result<serde_json::Value, String> {
    let id = json_text(&session, "id")?;
    let owner_id = json_text(&session, "ownerId")?;
    let status = json_text(&session, "status")?;
    let phase = json_text(&session, "phase")?;
    let mode = json_text(&session, "mode")?;
    let started_at = json_text(&session, "startedAt")?;
    if !matches!(
        status.as_str(),
        "running" | "paused" | "completed" | "cancelled"
    ) || !matches!(phase.as_str(), "focus" | "short_break" | "long_break")
        || !matches!(mode.as_str(), "stopwatch" | "countdown" | "pomodoro")
    {
        return Err("Invalid focus session.".into());
    }
    let mut database = state.lock().map_err(|_| "Database lock failed.")?;
    let previous = database
        .connection
        .query_row(
            "SELECT revision FROM focus_sessions WHERE id=?1 AND owner_id=?2",
            params![id, owner_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let proposed_revision = session
        .get("revision")
        .and_then(|value| value.as_i64())
        .ok_or("Focus session revision is required.")?;
    if proposed_revision != previous.unwrap_or(0) + 1 {
        return Err("Focus session revision conflict.".into());
    }
    if previous.is_none() && matches!(status.as_str(), "running" | "paused") {
        let active: i64 = database.connection.query_row(
            "SELECT COUNT(*) FROM focus_sessions WHERE owner_id=?1 AND deleted_at IS NULL AND status IN ('running','paused')",
            [&owner_id],
            |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        if active > 0 {
            return Err("An active focus session already exists.".into());
        }
    }
    let revision = previous.unwrap_or(0) + 1;
    let timestamp = Utc::now().to_rfc3339();
    session["revision"] = serde_json::json!(revision);
    session["updatedAt"] = serde_json::json!(timestamp);
    session["updatedByDeviceId"] = serde_json::json!(database.device_id.clone());
    let payload = session.to_string();
    let transaction = database
        .connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO focus_sessions(id,owner_id,payload,status,phase,started_at,ended_at,task_id,project_id,calendar_item_id,revision,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=excluded.status,phase=excluded.phase,started_at=excluded.started_at,ended_at=excluded.ended_at,task_id=excluded.task_id,project_id=excluded.project_id,calendar_item_id=excluded.calendar_item_id,revision=excluded.revision,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at",
        params![id,owner_id,payload,status,phase,started_at,session.get("endedAt").and_then(|v|v.as_str()),session.get("taskId").and_then(|v|v.as_str()),session.get("projectId").and_then(|v|v.as_str()),session.get("calendarItemId").and_then(|v|v.as_str()),revision,timestamp,session.get("deletedAt").and_then(|v|v.as_str())],
    ).map_err(|error| error.to_string())?;
    let operation = if session
        .get("deletedAt")
        .and_then(|value| value.as_str())
        .is_some()
    {
        "delete"
    } else {
        "upsert"
    };
    transaction.execute(
        "INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,base_revision,revision,payload,created_at,status) VALUES(?1,?2,'focus',?3,?4,?5,?6,?7,?8,'pending')",
        params![Uuid::new_v4().to_string(),owner_id,id,operation,previous.unwrap_or(0),revision,payload,timestamp],
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(session)
}

#[tauri::command]
fn save_focus_goal(
    mut goal: serde_json::Value,
    state: State<'_, Mutex<Database>>,
) -> Result<serde_json::Value, String> {
    let owner_id = json_text(&goal, "ownerId")?;
    let daily = goal
        .get("dailyMinutes")
        .and_then(|value| value.as_i64())
        .ok_or("Daily goal is required.")?;
    let weekly = goal
        .get("weeklyMinutes")
        .and_then(|value| value.as_i64())
        .ok_or("Weekly goal is required.")?;
    if !(0..=1440).contains(&daily) || !(0..=10080).contains(&weekly) {
        return Err("Invalid focus goal.".into());
    }
    let mut database = state.lock().map_err(|_| "Database lock failed.")?;
    let previous = database
        .connection
        .query_row(
            "SELECT revision FROM focus_goals WHERE owner_id=?1",
            [&owner_id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let revision = previous.unwrap_or(0) + 1;
    let timestamp = Utc::now().to_rfc3339();
    goal["revision"] = serde_json::json!(revision);
    goal["updatedAt"] = serde_json::json!(timestamp);
    goal["updatedByDeviceId"] = serde_json::json!(database.device_id.clone());
    let payload = goal.to_string();
    let transaction = database
        .connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO focus_goals(owner_id,payload,revision,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at",
        params![owner_id,payload,revision,timestamp],
    ).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,base_revision,revision,payload,created_at,status) VALUES(?1,?2,'focus_goal',?2,'upsert',?3,?4,?5,?6,'pending')",
        params![Uuid::new_v4().to_string(),owner_id,previous.unwrap_or(0),revision,payload,timestamp],
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(goal)
}

#[tauri::command]
async fn pick_calendar_file() -> Result<Option<String>, String> {
    let Some(path) = rfd::AsyncFileDialog::new()
        .add_filter("iCalendar", &["ics"])
        .pick_file()
        .await
        .map(|file| file.path().to_path_buf())
    else {
        return Ok(None);
    };
    let metadata = fs::metadata(&path).map_err(|error| error.to_string())?;
    if metadata.len() > 2_000_000 {
        return Err("Calendar file is too large.".into());
    }
    fs::read_to_string(path)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn save_calendar_file(content: String) -> Result<bool, String> {
    if content.len() > 5_000_000 {
        return Err("Calendar export is too large.".into());
    }
    let Some(path) = rfd::AsyncFileDialog::new()
        .add_filter("iCalendar", &["ics"])
        .set_file_name("stone-calendar.ics")
        .save_file()
        .await
        .map(|file| file.path().to_path_buf())
    else {
        return Ok(false);
    };
    fs::write(path, content.as_bytes())
        .map(|_| true)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_calendar_item(
    mut item: serde_json::Value,
    state: State<'_, Mutex<Database>>,
) -> Result<serde_json::Value, String> {
    let id = json_text(&item, "id")?;
    let kind = json_text(&item, "kind")?;
    let title = json_text(&item, "title")?;
    let start_date = json_text(&item, "startDate")?;
    let end_date = json_text(&item, "endDate")?;
    if title.trim().is_empty()
        || !matches!(kind.as_str(), "event" | "task_block")
        || end_date < start_date
    {
        return Err("Invalid calendar item.".into());
    }
    if kind == "task_block"
        && item
            .get("taskId")
            .and_then(|value| value.as_str())
            .is_none()
    {
        return Err("A task block must reference a task.".into());
    }
    let mut database = state.lock().map_err(|_| "Database lock failed.")?;
    let previous = database
        .connection
        .query_row(
            "SELECT revision FROM calendar_items WHERE id=?1",
            [&id],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let revision = previous.unwrap_or(0) + 1;
    let timestamp = Utc::now().to_rfc3339();
    item["revision"] = serde_json::json!(revision);
    item["updatedAt"] = serde_json::json!(timestamp);
    item["updatedByDeviceId"] = serde_json::json!(database.device_id.clone());
    let payload = item.to_string();
    let deleted_at = item.get("deletedAt").and_then(|value| value.as_str());
    let operation = if deleted_at.is_some() {
        "delete"
    } else {
        "upsert"
    };
    let transaction = database
        .connection
        .transaction()
        .map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO calendar_items(id,payload,kind,start_date,end_date,task_id,project_id,revision,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,kind=excluded.kind,start_date=excluded.start_date,end_date=excluded.end_date,task_id=excluded.task_id,project_id=excluded.project_id,revision=excluded.revision,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at",
        params![id,payload,kind,start_date,end_date,item.get("taskId").and_then(|v|v.as_str()),item.get("projectId").and_then(|v|v.as_str()),revision,timestamp,deleted_at],
    ).map_err(|error| error.to_string())?;
    transaction.execute(
        "INSERT INTO outbox(id,owner_id,entity_type,entity_id,operation,base_revision,revision,payload,created_at,status) VALUES(?1,'','calendar',?2,?3,?4,?5,?6,?7,'pending')",
        params![Uuid::new_v4().to_string(),id,operation,previous.unwrap_or(0),revision,payload,timestamp],
    ).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(item)
}

#[tauri::command]
fn delete_calendar_item(
    id: String,
    state: State<'_, Mutex<Database>>,
) -> Result<serde_json::Value, String> {
    let database = state.lock().map_err(|_| "Database lock failed.")?;
    let payload: String = database
        .connection
        .query_row(
            "SELECT payload FROM calendar_items WHERE id=?1 AND deleted_at IS NULL",
            [&id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or("Calendar item not found.")?;
    drop(database);
    let mut item: serde_json::Value =
        serde_json::from_str(&payload).map_err(|error| error.to_string())?;
    let now = Utc::now().to_rfc3339();
    item["deletedAt"] = serde_json::json!(now);
    item["cancelledAt"] = serde_json::json!(now);
    save_calendar_item(item, state)
}

fn json_text(value: &serde_json::Value, field: &str) -> Result<String, String> {
    value
        .get(field)
        .and_then(|entry| entry.as_str())
        .map(str::to_owned)
        .ok_or_else(|| format!("{field} is required."))
}

#[tauri::command]
fn save_task(
    mut task: DesktopTask,
    state: State<'_, Mutex<Database>>,
) -> Result<DesktopTask, String> {
    validate_task(&task)?;
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let transaction = db
        .connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let previous: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM tasks WHERE id = ?1",
            [&task.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let revision = previous.unwrap_or(0) + 1;
    let timestamp = now();
    task.revision = revision;
    task.updated_at = timestamp.clone();
    if previous.is_none() {
        task.created_at = timestamp.clone();
    }
    let payload = serde_json::to_string(&task).map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO tasks(id, payload, state, due_date, project_id, parent_task_id, sort_order, revision, created_at, updated_at, deleted_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, state=excluded.state, due_date=excluded.due_date, project_id=excluded.project_id, parent_task_id=excluded.parent_task_id, sort_order=excluded.sort_order, revision=excluded.revision, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at", params![task.id, payload, task.state, task.due_date, task.project_id, task.parent_task_id, task.sort_order, revision, task.created_at, timestamp, task.deleted_at]).map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO outbox(id, owner_id, entity_type, entity_id, operation, base_revision, revision, payload, created_at, status) VALUES(?1, '', 'task', ?2, 'upsert', ?3, ?4, ?5, ?6, 'pending')", params![Uuid::new_v4().to_string(), task.id, previous.unwrap_or(0), revision, task_sync_payload(&task).to_string(), timestamp]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(task)
}

#[tauri::command]
fn delete_task(id: String, state: State<'_, Mutex<Database>>) -> Result<DesktopTask, String> {
    let current = {
        let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
        let payload: String = db
            .connection
            .query_row(
                "SELECT payload FROM tasks WHERE id = ?1 AND deleted_at IS NULL",
                [&id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?
            .ok_or_else(|| "Görev bulunamadı.".to_owned())?;
        serde_json::from_str::<DesktopTask>(&payload).map_err(|error| error.to_string())?
    };
    save_task(
        DesktopTask {
            deleted_at: Some(now()),
            ..current
        },
        state,
    )
}

#[tauri::command]
fn get_document(
    id: String,
    state: State<'_, Mutex<Database>>,
) -> Result<Option<DesktopDocument>, String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection.query_row("SELECT id, title, markdown, path, revision, updated_at FROM documents WHERE id = ?1 AND deleted_at IS NULL", [id], document_from_row).optional().map_err(|error| error.to_string())
}

#[tauri::command]
fn save_document(
    document: DocumentInput,
    state: State<'_, Mutex<Database>>,
) -> Result<DesktopDocument, String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let transaction = db
        .connection
        .unchecked_transaction()
        .map_err(|error| error.to_string())?;
    let previous: Option<i64> = transaction
        .query_row(
            "SELECT revision FROM documents WHERE id = ?1",
            [&document.id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let revision = previous.unwrap_or(0) + 1;
    let timestamp = now();
    transaction.execute("INSERT INTO documents(id, kind, title, markdown, path, revision, updated_at, created_at, deleted_at, updated_by_device_id) VALUES(?1, 'note', ?2, ?3, ?4, ?5, ?6, ?6, NULL, ?7) ON CONFLICT(id) DO UPDATE SET title=excluded.title, markdown=excluded.markdown, path=excluded.path, revision=excluded.revision, updated_at=excluded.updated_at, updated_by_device_id=excluded.updated_by_device_id", params![document.id, document.title, document.markdown, document.path, revision, timestamp, db.device_id]).map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO document_revisions(id, document_id, revision, markdown, created_at) VALUES(?1, ?2, ?3, ?4, ?5)", params![Uuid::new_v4().to_string(), document.id, revision, document.markdown, timestamp]).map_err(|error| error.to_string())?;
    let payload = serde_json::to_string(&document).map_err(|error| error.to_string())?;
    transaction.execute("INSERT INTO outbox(id, owner_id, entity_type, entity_id, operation, base_revision, revision, payload, created_at, status) VALUES(?1, '', 'document', ?2, 'upsert', ?3, ?4, ?5, ?6, 'pending')", params![Uuid::new_v4().to_string(), document.id, previous.unwrap_or(0), revision, payload, timestamp]).map_err(|error| error.to_string())?;
    transaction.commit().map_err(|error| error.to_string())?;
    Ok(DesktopDocument {
        id: document.id,
        title: document.title,
        markdown: document.markdown,
        path: document.path,
        revision,
        updated_at: timestamp,
    })
}

#[tauri::command]
fn open_markdown_file(
    path: String,
    state: State<'_, Mutex<Database>>,
) -> Result<DesktopDocument, String> {
    let canonical = canonical_file(&path)?;
    let (content, file_fingerprint) = read_markdown(&canonical)?;
    let document = DocumentInput {
        id: Uuid::new_v5(&Uuid::NAMESPACE_URL, canonical.to_string_lossy().as_bytes()).to_string(),
        title: title_for(
            &content,
            canonical
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or("Not"),
        ),
        markdown: content,
        path: Some(canonical.to_string_lossy().into_owned()),
    };
    let result = save_document(document, state.clone())?;
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection.execute("INSERT INTO linked_files(path, document_id, sha256, modified_ms, size, linked_folder) VALUES(?1, ?2, ?3, ?4, ?5, NULL) ON CONFLICT(path) DO UPDATE SET document_id=excluded.document_id, sha256=excluded.sha256, modified_ms=excluded.modified_ms, size=excluded.size", params![result.path, result.id, file_fingerprint.sha256, file_fingerprint.modified_ms, file_fingerprint.size as i64]).map_err(|error| error.to_string())?;
    Ok(result)
}

#[tauri::command]
async fn pick_markdown_file(
    state: State<'_, Mutex<Database>>,
) -> Result<Option<DesktopDocument>, String> {
    let Some(path) = rfd::AsyncFileDialog::new()
        .add_filter("Markdown", &["md", "markdown"])
        .pick_file()
        .await
        .map(|file| file.path().to_path_buf())
    else {
        return Ok(None);
    };
    open_markdown_file(path.to_string_lossy().into_owned(), state).map(Some)
}

#[tauri::command]
async fn pick_folder() -> Result<Option<String>, String> {
    Ok(rfd::AsyncFileDialog::new()
        .pick_folder()
        .await
        .map(|file| file.path().to_string_lossy().into_owned()))
}

fn collect_markdown_files(folder: &Path, files: &mut Vec<PathBuf>) -> Result<(), String> {
    for entry in fs::read_dir(folder).map_err(|error| error.to_string())? {
        let path = entry.map_err(|error| error.to_string())?.path();
        if path.is_dir() {
            collect_markdown_files(&path, files)?;
        } else if path.is_file()
            && path
                .extension()
                .and_then(|extension| extension.to_str())
                .map(|extension| {
                    extension.eq_ignore_ascii_case("md")
                        || extension.eq_ignore_ascii_case("markdown")
                })
                .unwrap_or(false)
        {
            files.push(path);
        }
    }
    Ok(())
}

#[tauri::command]
fn index_folder(
    path: String,
    state: State<'_, Mutex<Database>>,
) -> Result<Vec<DesktopDocument>, String> {
    let folder = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if !folder.is_dir() {
        return Err("Klasör bulunamadı.".to_owned());
    }
    let mut files = Vec::new();
    collect_markdown_files(&folder, &mut files)?;
    files.sort();
    files
        .into_iter()
        .map(|file| open_markdown_file(file.to_string_lossy().into_owned(), state.clone()))
        .collect()
}

#[tauri::command]
fn load_linked_file(path: String) -> Result<serde_json::Value, String> {
    let canonical = canonical_file(&path)?;
    let (markdown, file_fingerprint) = read_markdown(&canonical)?;
    Ok(
        serde_json::json!({"path": canonical, "markdown": markdown, "fingerprint": file_fingerprint}),
    )
}

#[tauri::command]
fn save_linked_file(
    path: String,
    markdown: String,
    expected_sha256: String,
) -> Result<serde_json::Value, String> {
    let canonical = canonical_file(&path)?;
    let (current, current_fingerprint) = read_markdown(&canonical)?;
    if current_fingerprint.sha256 != expected_sha256 {
        return Err(format!(
            "ExternalEditConflict: {} dışarıda değişti.",
            canonical.display()
        ));
    }
    let _ = current;
    fs::write(&canonical, markdown.as_bytes())
        .map_err(|error| format!("Dosya kaydedilemedi: {error}"))?;
    let (_, updated_fingerprint) = read_markdown(&canonical)?;
    Ok(serde_json::json!({"fingerprint": updated_fingerprint}))
}

#[tauri::command]
fn watch_folder(path: String, app: AppHandle, watchers: State<'_, Watchers>) -> Result<(), String> {
    let folder = fs::canonicalize(&path).map_err(|error| error.to_string())?;
    if !folder.is_dir() {
        return Err("Klasör bulunamadı.".to_owned());
    }
    let key = folder.to_string_lossy().into_owned();
    let app_handle = app.clone();
    let mut watcher = notify::recommended_watcher(move |result: notify::Result<notify::Event>| {
        if let Ok(event) = result {
            for changed in event.paths {
                if changed.is_file()
                    && changed
                        .extension()
                        .and_then(|extension| extension.to_str())
                        .map(|extension| {
                            extension.eq_ignore_ascii_case("md")
                                || extension.eq_ignore_ascii_case("markdown")
                        })
                        .unwrap_or(false)
                {
                    if let Ok((_, file_fingerprint)) = read_markdown(&changed) {
                        let _ = app_handle.emit(
                            "stone://file-changed",
                            FileChanged {
                                path: changed.to_string_lossy().into_owned(),
                                fingerprint: file_fingerprint,
                            },
                        );
                    }
                }
            }
        }
    })
    .map_err(|error| error.to_string())?;
    watcher
        .watch(&folder, RecursiveMode::Recursive)
        .map_err(|error| error.to_string())?;
    watchers
        .0
        .lock()
        .map_err(|_| "Dosya izleyici kilidi alınamadı.")?
        .insert(key, watcher);
    Ok(())
}

fn keychain() -> Result<Entry, String> {
    Entry::new(KEYCHAIN_SERVICE, KEYCHAIN_ACCOUNT).map_err(|error| error.to_string())
}
#[tauri::command]
fn keychain_get() -> Result<Option<String>, String> {
    match keychain()?.get_password() {
        Ok(value) => Ok(Some(value)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
}
#[tauri::command]
fn keychain_set(refresh_token: String) -> Result<(), String> {
    keychain()?
        .set_password(&refresh_token)
        .map_err(|error| error.to_string())
}
#[tauri::command]
fn keychain_delete() -> Result<(), String> {
    match keychain()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

#[tauri::command]
fn open_external(target: String, path: String) -> Result<(), String> {
    let canonical = canonical_file(&path)?;
    spawn_external(&target, &canonical)
}

/// Editor CLIs are installed as `.cmd` shims on Windows (`code.cmd`, npm's `codex.cmd`), which
/// `Command::new` does not resolve from a bare name; Rust escapes arguments for batch files.
fn external_programs(target: &str) -> Result<&'static [&'static str], String> {
    match (target, cfg!(windows)) {
        ("vscode", true) => Ok(&["code.cmd", "code"]),
        ("vscode", false) => Ok(&["code"]),
        ("codex", true) => Ok(&["codex.cmd", "codex"]),
        ("codex", false) => Ok(&["codex"]),
        _ => Err("Bilinmeyen dış uygulama.".to_owned()),
    }
}

/// `fs::canonicalize` returns `\\?\C:\...` verbatim paths on Windows, which editors do not
/// treat as normal workspace paths.
fn display_path(path: &Path) -> PathBuf {
    let text = path.to_string_lossy();
    match text.strip_prefix(r"\\?\") {
        Some(stripped) if !stripped.starts_with("UNC\\") => PathBuf::from(stripped),
        _ => path.to_path_buf(),
    }
}

fn spawn_external(target: &str, path: &Path) -> Result<(), String> {
    let programs = external_programs(target)?;
    let path = display_path(path);
    let mut last_error = None;
    for program in programs {
        match Command::new(program).arg(&path).spawn() {
            Ok(_) => return Ok(()),
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => last_error = Some(error),
            Err(error) => return Err(format!("{program} başlatılamadı: {error}")),
        }
    }
    let error = last_error
        .map(|error| error.to_string())
        .unwrap_or_default();
    Err(format!("{} başlatılamadı: {error}", programs[0]))
}

fn public_session(session: &AuthSession) -> PublicAuthSession {
    PublicAuthSession {
        uid: session.uid.clone(),
        email: session.email.clone(),
        id_token: session.id_token.clone(),
        expires_at: session.expires_at,
    }
}
fn firebase_error(response: reqwest::Response) -> impl std::future::Future<Output = String> {
    async move {
        let status = response.status();
        let body = response
            .json::<FirebaseErrorEnvelope>()
            .await
            .ok()
            .map(|envelope| envelope.error.message)
            .unwrap_or_else(|| status.to_string());
        format!("Firebase: {body}")
    }
}
async fn firebase_post(
    client: &Client,
    url: String,
    body: serde_json::Value,
) -> Result<reqwest::Response, String> {
    let response = client
        .post(url)
        .json(&body)
        .send()
        .await
        .map_err(|error| format!("Firebase bağlantısı başarısız: {error}"))?;
    if !response.status().is_success() {
        return Err(firebase_error(response).await);
    }
    Ok(response)
}

#[tauri::command]
async fn auth_sign_in(
    api_key: String,
    email: String,
    password: String,
    state: State<'_, AuthState>,
) -> Result<PublicAuthSession, String> {
    if api_key.is_empty() {
        return Err("Firebase API anahtarı yapılandırılmamış.".to_owned());
    }
    let response = firebase_post(
        &Client::new(),
        format!(
            "https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key={api_key}"
        ),
        serde_json::json!({"email": email, "password": password, "returnSecureToken": true}),
    )
    .await?
    .json::<FirebaseSignInResponse>()
    .await
    .map_err(|error| error.to_string())?;
    let expires_in = response.expires_in.parse::<i64>().unwrap_or(3600);
    let session_value = AuthSession {
        uid: response.local_id,
        email: response.email,
        id_token: response.id_token,
        refresh_token: response.refresh_token,
        expires_at: chrono::Utc::now().timestamp() + expires_in,
    };
    keychain()?
        .set_password(&session_value.refresh_token)
        .map_err(|error| error.to_string())?;
    let public = public_session(&session_value);
    *state.0.lock().map_err(|_| "Oturum kilidi alınamadı.")? = Some(session_value);
    Ok(public)
}

#[tauri::command]
async fn auth_restore(
    api_key: String,
    state: State<'_, AuthState>,
) -> Result<Option<PublicAuthSession>, String> {
    if api_key.is_empty() {
        return Ok(None);
    }
    let refresh_token = match keychain_get()? {
        Some(token) => token,
        None => return Ok(None),
    };
    let response = firebase_post(
        &Client::new(),
        format!("https://securetoken.googleapis.com/v1/token?key={api_key}"),
        serde_json::json!({"grant_type": "refresh_token", "refresh_token": refresh_token}),
    )
    .await?
    .json::<FirebaseRefreshResponse>()
    .await
    .map_err(|error| error.to_string())?;
    let expires_in = response.expires_in.parse::<i64>().unwrap_or(3600);
    let email = firebase_lookup_email(&api_key, &response.id_token)
        .await
        .ok()
        .flatten()
        .unwrap_or_default();
    let session_value = AuthSession {
        uid: response.user_id,
        email,
        id_token: response.id_token,
        refresh_token: response.refresh_token,
        expires_at: chrono::Utc::now().timestamp() + expires_in,
    };
    keychain()?
        .set_password(&session_value.refresh_token)
        .map_err(|error| error.to_string())?;
    let public = public_session(&session_value);
    *state.0.lock().map_err(|_| "Oturum kilidi alınamadı.")? = Some(session_value);
    Ok(Some(public))
}

#[tauri::command]
async fn auth_password_reset(api_key: String, email: String) -> Result<(), String> {
    if api_key.is_empty() {
        return Err("Firebase API anahtarı yapılandırılmamış.".to_owned());
    }
    firebase_post(
        &Client::new(),
        format!("https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key={api_key}"),
        serde_json::json!({"requestType": "PASSWORD_RESET", "email": email}),
    )
    .await
    .map(|_| ())
}
#[tauri::command]
fn auth_sign_out(state: State<'_, AuthState>) -> Result<(), String> {
    keychain_delete()?;
    *state.0.lock().map_err(|_| "Oturum kilidi alınamadı.")? = None;
    Ok(())
}

async fn firebase_lookup_email(api_key: &str, id_token: &str) -> Result<Option<String>, String> {
    let response = firebase_post(
        &Client::new(),
        format!("https://identitytoolkit.googleapis.com/v1/accounts:lookup?key={api_key}"),
        serde_json::json!({"idToken": id_token}),
    )
    .await?
    .json::<FirebaseLookupResponse>()
    .await
    .map_err(|error| error.to_string())?;
    Ok(response
        .users
        .into_iter()
        .next()
        .and_then(|user| user.email))
}

#[derive(Debug)]
struct PendingOutbox {
    id: String,
    entity_type: String,
    entity_id: String,
    operation: String,
    base_revision: i64,
    revision: i64,
    payload: serde_json::Value,
    created_at: String,
}

fn pending_outbox(state: &Mutex<Database>, owner_id: &str) -> Result<Vec<PendingOutbox>, String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection
        .execute(
            "UPDATE outbox SET owner_id = ?1 WHERE owner_id = '' AND status = 'pending'",
            [owner_id],
        )
        .map_err(|error| error.to_string())?;
    let mut statement = db
        .connection
        .prepare("SELECT id, entity_type, entity_id, base_revision, revision, payload, operation, created_at FROM outbox WHERE owner_id = ?1 AND status = 'pending' ORDER BY created_at LIMIT 200")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([owner_id], |row| {
            let payload: String = row.get(5)?;
            Ok(PendingOutbox {
                id: row.get(0)?,
                entity_type: row.get(1)?,
                entity_id: row.get(2)?,
                base_revision: row.get(3)?,
                revision: row.get(4)?,
                payload: serde_json::from_str(&payload).unwrap_or_else(|_| serde_json::json!({})),
                operation: row.get(6)?,
                created_at: row.get(7)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

fn firestore_revision(value: &serde_json::Value) -> i64 {
    value
        .get("fields")
        .and_then(|fields| fields.get("revision"))
        .and_then(|revision| revision.get("integerValue"))
        .and_then(|revision| revision.as_str())
        .and_then(|revision| revision.parse::<i64>().ok())
        .unwrap_or(0)
}

fn firestore_value(value: &serde_json::Value) -> serde_json::Value {
    match value {
        serde_json::Value::Null => serde_json::json!({"nullValue": null}),
        serde_json::Value::Bool(value) => serde_json::json!({"booleanValue": value}),
        serde_json::Value::Number(value) if value.is_i64() || value.is_u64() => {
            serde_json::json!({"integerValue": value.to_string()})
        }
        serde_json::Value::Number(value) => serde_json::json!({"doubleValue": value}),
        serde_json::Value::String(value) => serde_json::json!({"stringValue": value}),
        serde_json::Value::Array(values) => serde_json::json!({
            "arrayValue": {"values": values.iter().map(firestore_value).collect::<Vec<_>>()}
        }),
        serde_json::Value::Object(values) => serde_json::json!({
            "mapValue": {"fields": values.iter().map(|(key, value)| (key.clone(), firestore_value(value))).collect::<serde_json::Map<_, _>>()}
        }),
    }
}

fn firestore_fields(
    payload: &serde_json::Value,
    revision: i64,
    owner_id: &str,
    device_id: &str,
) -> serde_json::Value {
    let mut fields = serde_json::Map::new();
    if let Some(payload_fields) = payload.as_object() {
        for (key, value) in payload_fields {
            fields.insert(key.clone(), firestore_value(value));
        }
    }
    fields.insert(
        "ownerId".to_owned(),
        serde_json::json!({"stringValue": owner_id}),
    );
    fields.insert(
        "revision".to_owned(),
        serde_json::json!({"integerValue": revision.to_string()}),
    );
    fields.insert(
        "updatedAt".to_owned(),
        serde_json::json!({"stringValue": now()}),
    );
    fields.insert(
        "updatedByDeviceId".to_owned(),
        serde_json::json!({"stringValue": device_id}),
    );
    let event_id = format!(
        "desktop:{device_id}:{}:{revision}",
        payload
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
    );
    fields.insert(
        "idempotencyKey".to_owned(),
        serde_json::json!({"stringValue": event_id}),
    );
    fields.insert(
        "lastEventId".to_owned(),
        serde_json::json!({"stringValue": event_id}),
    );
    serde_json::Value::Object(fields)
}

fn firestore_text(value: &serde_json::Value, key: &str) -> Option<String> {
    value
        .get("fields")
        .and_then(|fields| fields.get(key))
        .and_then(|field| field.get("stringValue"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
}

fn decode_firestore_value(value: &serde_json::Value) -> serde_json::Value {
    if value.get("nullValue").is_some() {
        return serde_json::Value::Null;
    }
    if let Some(value) = value.get("stringValue") {
        return value.clone();
    }
    if let Some(value) = value.get("booleanValue") {
        return value.clone();
    }
    if let Some(value) = value.get("integerValue").and_then(|value| value.as_str()) {
        return value
            .parse::<i64>()
            .map(serde_json::Value::from)
            .unwrap_or(serde_json::Value::Null);
    }
    if let Some(value) = value.get("doubleValue") {
        return value.clone();
    }
    if let Some(values) = value
        .get("arrayValue")
        .and_then(|value| value.get("values"))
        .and_then(|value| value.as_array())
    {
        return serde_json::Value::Array(values.iter().map(decode_firestore_value).collect());
    }
    if let Some(fields) = value
        .get("mapValue")
        .and_then(|value| value.get("fields"))
        .and_then(|value| value.as_object())
    {
        return serde_json::Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), decode_firestore_value(value)))
                .collect(),
        );
    }
    serde_json::Value::Null
}

fn remote_task(value: &serde_json::Value) -> Option<DesktopTask> {
    let fields = value.get("fields")?.as_object()?;
    let decoded = serde_json::Value::Object(
        fields
            .iter()
            .map(|(key, value)| (key.clone(), decode_firestore_value(value)))
            .collect(),
    );
    serde_json::from_value(decoded).ok()
}

fn apply_remote_tasks(
    database: &Mutex<Database>,
    remote_tasks: &[serde_json::Value],
) -> Result<u32, String> {
    let db = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let mut pulled = 0;
    for remote in remote_tasks {
        let Some(task) = remote_task(remote) else {
            continue;
        };
        let has_pending: bool = db
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type = 'task' AND entity_id = ?1 AND status = 'pending')",
                [&task.id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        let local_revision: Option<i64> = db
            .connection
            .query_row(
                "SELECT revision FROM tasks WHERE id = ?1",
                [&task.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if has_pending || local_revision.is_some_and(|revision| revision >= task.revision) {
            continue;
        }
        validate_task(&task)?;
        let payload = serde_json::to_string(&task).map_err(|error| error.to_string())?;
        db.connection.execute("INSERT INTO tasks(id, payload, state, due_date, project_id, parent_task_id, sort_order, revision, created_at, updated_at, deleted_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload, state=excluded.state, due_date=excluded.due_date, project_id=excluded.project_id, parent_task_id=excluded.parent_task_id, sort_order=excluded.sort_order, revision=excluded.revision, updated_at=excluded.updated_at, deleted_at=excluded.deleted_at", params![task.id, payload, task.state, task.due_date, task.project_id, task.parent_task_id, task.sort_order, task.revision, task.created_at, task.updated_at, task.deleted_at]).map_err(|error| error.to_string())?;
        pulled += 1;
    }
    Ok(pulled)
}

fn apply_remote_calendar(
    database: &Mutex<Database>,
    remote_items: &[serde_json::Value],
) -> Result<u32, String> {
    let db = database.lock().map_err(|_| "Database lock failed.")?;
    let mut pulled = 0;
    for remote in remote_items {
        let Some(fields) = remote.get("fields").and_then(|value| value.as_object()) else {
            continue;
        };
        let payload = serde_json::Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), decode_firestore_value(value)))
                .collect(),
        );
        let id = json_text(&payload, "id")?;
        let revision = payload
            .get("revision")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let pending: bool = db.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type='calendar' AND entity_id=?1 AND status='pending')",
            [&id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        let local: Option<i64> = db
            .connection
            .query_row(
                "SELECT revision FROM calendar_items WHERE id=?1",
                [&id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if pending || local.is_some_and(|value| value >= revision) {
            continue;
        }
        let kind = json_text(&payload, "kind")?;
        let start_date = json_text(&payload, "startDate")?;
        let end_date = json_text(&payload, "endDate")?;
        let updated_at = json_text(&payload, "updatedAt")?;
        db.connection.execute(
            "INSERT INTO calendar_items(id,payload,kind,start_date,end_date,task_id,project_id,revision,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,kind=excluded.kind,start_date=excluded.start_date,end_date=excluded.end_date,task_id=excluded.task_id,project_id=excluded.project_id,revision=excluded.revision,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at",
            params![id,payload.to_string(),kind,start_date,end_date,payload.get("taskId").and_then(|v|v.as_str()),payload.get("projectId").and_then(|v|v.as_str()),revision,updated_at,payload.get("deletedAt").and_then(|v|v.as_str())],
        ).map_err(|error| error.to_string())?;
        pulled += 1;
    }
    Ok(pulled)
}

fn apply_remote_focus(
    database: &Mutex<Database>,
    remote_items: &[serde_json::Value],
) -> Result<u32, String> {
    let db = database.lock().map_err(|_| "Database lock failed.")?;
    let mut pulled = 0;
    for remote in remote_items {
        let Some(fields) = remote.get("fields").and_then(|value| value.as_object()) else {
            continue;
        };
        let payload = serde_json::Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), decode_firestore_value(value)))
                .collect(),
        );
        let id = json_text(&payload, "id")?;
        let owner_id = json_text(&payload, "ownerId")?;
        let revision = payload
            .get("revision")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let pending: bool = db.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type='focus' AND entity_id=?1 AND status='pending')",
            [&id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        let local: Option<i64> = db
            .connection
            .query_row(
                "SELECT revision FROM focus_sessions WHERE id=?1 AND owner_id=?2",
                params![id, owner_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if pending || local.is_some_and(|value| value >= revision) {
            continue;
        }
        let status = json_text(&payload, "status")?;
        let phase = json_text(&payload, "phase")?;
        let started_at = json_text(&payload, "startedAt")?;
        let updated_at = json_text(&payload, "updatedAt")?;
        db.connection.execute(
            "INSERT INTO focus_sessions(id,owner_id,payload,status,phase,started_at,ended_at,task_id,project_id,calendar_item_id,revision,updated_at,deleted_at) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload,status=excluded.status,phase=excluded.phase,started_at=excluded.started_at,ended_at=excluded.ended_at,task_id=excluded.task_id,project_id=excluded.project_id,calendar_item_id=excluded.calendar_item_id,revision=excluded.revision,updated_at=excluded.updated_at,deleted_at=excluded.deleted_at",
            params![id,owner_id,payload.to_string(),status,phase,started_at,payload.get("endedAt").and_then(|v|v.as_str()),payload.get("taskId").and_then(|v|v.as_str()),payload.get("projectId").and_then(|v|v.as_str()),payload.get("calendarItemId").and_then(|v|v.as_str()),revision,updated_at,payload.get("deletedAt").and_then(|v|v.as_str())],
        ).map_err(|error| error.to_string())?;
        pulled += 1;
    }
    Ok(pulled)
}

fn apply_remote_focus_goals(
    database: &Mutex<Database>,
    remote_items: &[serde_json::Value],
) -> Result<u32, String> {
    let db = database.lock().map_err(|_| "Database lock failed.")?;
    let mut pulled = 0;
    for remote in remote_items {
        let Some(fields) = remote.get("fields").and_then(|value| value.as_object()) else {
            continue;
        };
        let payload = serde_json::Value::Object(
            fields
                .iter()
                .map(|(key, value)| (key.clone(), decode_firestore_value(value)))
                .collect(),
        );
        let owner_id = json_text(&payload, "ownerId")?;
        let revision = payload
            .get("revision")
            .and_then(|value| value.as_i64())
            .unwrap_or(0);
        let pending: bool = db.connection.query_row(
            "SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_type='focus_goal' AND entity_id=?1 AND status='pending')",
            [&owner_id], |row| row.get(0),
        ).map_err(|error| error.to_string())?;
        let local: Option<i64> = db
            .connection
            .query_row(
                "SELECT revision FROM focus_goals WHERE owner_id=?1",
                [&owner_id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        if pending || local.is_some_and(|value| value >= revision) {
            continue;
        }
        let updated_at = json_text(&payload, "updatedAt")?;
        db.connection.execute(
            "INSERT INTO focus_goals(owner_id,payload,revision,updated_at) VALUES(?1,?2,?3,?4) ON CONFLICT(owner_id) DO UPDATE SET payload=excluded.payload,revision=excluded.revision,updated_at=excluded.updated_at",
            params![owner_id,payload.to_string(),revision,updated_at],
        ).map_err(|error| error.to_string())?;
        pulled += 1;
    }
    Ok(pulled)
}

fn firestore_timestamp(value: &serde_json::Value) -> String {
    value
        .get("fields")
        .and_then(|fields| fields.get("updatedAt"))
        .and_then(|field| field.get("timestampValue"))
        .and_then(|value| value.as_str())
        .map(str::to_owned)
        .unwrap_or_else(now)
}

fn remote_document(value: &serde_json::Value) -> Option<DocumentInput> {
    let name = value.get("name")?.as_str()?.rsplit('/').next()?.to_owned();
    Some(DocumentInput {
        id: firestore_text(value, "id").unwrap_or(name),
        title: firestore_text(value, "title").unwrap_or_else(|| "Adsız not".to_owned()),
        markdown: firestore_text(value, "markdown").unwrap_or_default(),
        path: firestore_text(value, "path"),
    })
}

fn apply_remote_documents(
    database: &Mutex<Database>,
    remote_documents: &[serde_json::Value],
) -> Result<u32, String> {
    let db = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let mut pulled = 0;
    for remote in remote_documents {
        let Some(document) = remote_document(remote) else {
            continue;
        };
        let remote_revision = firestore_revision(remote);
        let local_revision: Option<i64> = db
            .connection
            .query_row(
                "SELECT revision FROM documents WHERE id = ?1",
                [&document.id],
                |row| row.get(0),
            )
            .optional()
            .map_err(|error| error.to_string())?;
        let has_pending: bool = db
            .connection
            .query_row(
                "SELECT EXISTS(SELECT 1 FROM outbox WHERE entity_id = ?1 AND status = 'pending')",
                [&document.id],
                |row| row.get(0),
            )
            .map_err(|error| error.to_string())?;
        if has_pending
            || local_revision
                .map(|revision| revision >= remote_revision)
                .unwrap_or(false)
        {
            continue;
        }
        let timestamp = firestore_timestamp(remote);
        db.connection
            .execute("INSERT INTO documents(id, kind, title, markdown, path, revision, updated_at, created_at, deleted_at, updated_by_device_id) VALUES(?1, 'note', ?2, ?3, ?4, ?5, ?6, ?6, NULL, 'remote') ON CONFLICT(id) DO UPDATE SET title=excluded.title, markdown=excluded.markdown, path=excluded.path, revision=excluded.revision, updated_at=excluded.updated_at, updated_by_device_id='remote'", params![document.id, document.title, document.markdown, document.path, remote_revision, timestamp])
            .map_err(|error| error.to_string())?;
        db.connection
            .execute("INSERT INTO document_revisions(id, document_id, revision, markdown, created_at) VALUES(?1, ?2, ?3, ?4, ?5)", params![Uuid::new_v4().to_string(), document.id, remote_revision, document.markdown, timestamp])
            .map_err(|error| error.to_string())?;
        pulled += 1;
    }
    Ok(pulled)
}

#[tauri::command]
async fn sync_now(
    api_key: String,
    project_id: String,
    database: State<'_, Mutex<Database>>,
    auth: State<'_, AuthState>,
) -> Result<SyncSummary, String> {
    if api_key.is_empty() || project_id.is_empty() {
        return Err("Firebase senkronizasyon yapılandırması eksik.".to_owned());
    }
    let client = Client::new();
    let session = match fresh_session(&client, &api_key, &auth).await {
        Ok(session) => session,
        Err(SessionError::Offline) => return Ok(SyncSummary::offline(0, 0)),
        Err(SessionError::Failed(message)) => return Err(message),
    };
    let pending = pending_outbox(&database, &session.uid)?;
    let device_id = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?
        .device_id
        .clone();
    let documents_root = format!(
        "projects/{project_id}/databases/(default)/documents/users/{}",
        session.uid
    );
    let mut pushed = 0;
    let mut conflicts = 0;
    for event in pending {
        let collection = match event.entity_type.as_str() {
            "document" => "documents",
            "task" => "tasks",
            "calendar" => "calendar",
            "focus" => "focusSessions",
            "focus_goal" => "focusGoals",
            _ => return Err("Desteklenmeyen desktop sync entity.".to_owned()),
        };
        let entity_name = format!("{documents_root}/{collection}/{}", event.entity_id);
        let remote = match get_firestore_document(&client, &entity_name, &session.id_token).await {
            Ok(remote) => remote,
            Err(FetchError::Offline) => return Ok(SyncSummary::offline(pushed, conflicts)),
            Err(FetchError::Failed(message)) => return Err(message),
        };
        let mut event = event;
        if event.entity_type == "document" {
            complete_document_payload(&database, &mut event.payload)?;
        }
        let fields = firestore_fields(&event.payload, event.revision, &session.uid, &device_id);
        let event_id = fields
            .get("idempotencyKey")
            .and_then(|value| value.get("stringValue"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_owned();
        if remote
            .as_ref()
            .and_then(|remote| firestore_text(remote, "idempotencyKey"))
            .is_some_and(|key| key == event_id)
        {
            // A previous run committed this event but did not record the acknowledgement.
            acknowledge_outbox(&database, &event.id)?;
            pushed += 1;
            continue;
        }
        let tombstone_name = format!(
            "{documents_root}/deletionTombstones/{}",
            tombstone_document_id(&event.entity_type, &event.entity_id)
        );
        let tombstone =
            match get_firestore_document(&client, &tombstone_name, &session.id_token).await {
                Ok(tombstone) => tombstone,
                Err(FetchError::Offline) => return Ok(SyncSummary::offline(pushed, conflicts)),
                Err(FetchError::Failed(message)) => return Err(message),
            };
        let remote_revision = remote.as_ref().map(firestore_revision).unwrap_or(0);
        if tombstone.is_some() || remote_revision != event.base_revision {
            record_conflict(&database, &event, tombstone.or(remote))?;
            conflicts += 1;
            continue;
        }
        let precondition = match remote
            .as_ref()
            .and_then(|remote| remote.get("updateTime"))
            .and_then(|value| value.as_str())
        {
            Some(update_time) => serde_json::json!({ "updateTime": update_time }),
            None => serde_json::json!({ "exists": false }),
        };
        let sync_event = sync_event_fields(&event, &session.uid, &event_id, &fields);
        // The entity write and its syncEvents entry commit atomically, matching the mobile
        // client, so other devices pulling the event log see desktop edits.
        let commit = serde_json::json!({
            "writes": [
                {
                    "update": { "name": entity_name, "fields": fields },
                    "currentDocument": precondition,
                },
                {
                    "update": {
                        "name": format!("{documents_root}/syncEvents/{event_id}"),
                        "fields": sync_event,
                    },
                    "updateTransforms": [
                        { "fieldPath": "serverUpdatedAt", "setToServerValue": "REQUEST_TIME" }
                    ],
                    "currentDocument": { "exists": false },
                },
            ]
        });
        let response = match client
            .post(format!(
                "{FIRESTORE_API}/projects/{project_id}/databases/(default)/documents:commit"
            ))
            .bearer_auth(&session.id_token)
            .json(&commit)
            .send()
            .await
        {
            Ok(response) => response,
            Err(_) => return Ok(SyncSummary::offline(pushed, conflicts)),
        };
        if !response.status().is_success() {
            let status = response.status();
            let body = response.json::<serde_json::Value>().await.ok();
            let code = body
                .as_ref()
                .and_then(|body| body.pointer("/error/status"))
                .and_then(|value| value.as_str())
                .unwrap_or_default();
            if is_precondition_failure(code) {
                // Another device wrote this entity between our read and commit. Leave the event
                // pending; the next sync re-reads the remote revision and records a conflict.
                continue;
            }
            let message = body
                .as_ref()
                .and_then(|body| body.pointer("/error/message"))
                .and_then(|value| value.as_str())
                .map(str::to_owned)
                .unwrap_or_else(|| status.to_string());
            if is_rejected_write(code) {
                // This event can never be accepted as-is; park it like the mobile engine does
                // instead of stopping every later event and the pull.
                block_outbox(&database, &event.id, &format!("Firebase: {message}"))?;
                continue;
            }
            return Err(format!("Firebase: {message}"));
        }
        acknowledge_outbox(&database, &event.id)?;
        pushed += 1;
    }

    let pulls: [(&str, RemoteApplier); 5] = [
        ("documents", apply_remote_documents),
        ("tasks", apply_remote_tasks),
        ("calendar", apply_remote_calendar),
        ("focusSessions", apply_remote_focus),
        ("focusGoals", apply_remote_focus_goals),
    ];
    let mut pulled = 0;
    for (collection, apply) in pulls {
        let documents = match list_firestore_collection(
            &client,
            &format!("{documents_root}/{collection}"),
            &session.id_token,
        )
        .await
        {
            Ok(documents) => documents,
            Err(FetchError::Offline) => return Ok(SyncSummary::offline(pushed, conflicts)),
            Err(FetchError::Failed(message)) => return Err(message),
        };
        pulled += apply(&database, &documents)?;
    }
    Ok(SyncSummary {
        pushed,
        pulled,
        conflicts,
        offline: false,
    })
}

const FIRESTORE_API: &str = "https://firestore.googleapis.com/v1";
/// Refresh the Firebase ID token this long before it expires.
const SESSION_REFRESH_MARGIN_SECONDS: i64 = 120;

type RemoteApplier = fn(&Mutex<Database>, &[serde_json::Value]) -> Result<u32, String>;

impl SyncSummary {
    fn offline(pushed: u32, conflicts: u32) -> Self {
        Self {
            pushed,
            pulled: 0,
            conflicts,
            offline: true,
        }
    }
}

enum FetchError {
    Offline,
    Failed(String),
}

enum SessionError {
    Offline,
    Failed(String),
}

/// Returns the signed-in session, exchanging the refresh token when the ID token (valid for one
/// hour) is about to expire so long-running desktop sessions keep syncing.
async fn fresh_session(
    client: &Client,
    api_key: &str,
    auth: &AuthState,
) -> Result<AuthSession, SessionError> {
    let session = auth
        .0
        .lock()
        .map_err(|_| SessionError::Failed("Oturum kilidi alınamadı.".to_owned()))?
        .clone()
        .ok_or_else(|| {
            SessionError::Failed("Senkronizasyon için giriş yapmalısınız.".to_owned())
        })?;
    if !session_needs_refresh(session.expires_at, Utc::now().timestamp()) {
        return Ok(session);
    }
    let response = client
        .post(format!(
            "https://securetoken.googleapis.com/v1/token?key={api_key}"
        ))
        .json(&serde_json::json!({
            "grant_type": "refresh_token",
            "refresh_token": session.refresh_token,
        }))
        .send()
        .await
        .map_err(|_| SessionError::Offline)?;
    if !response.status().is_success() {
        return Err(SessionError::Failed(firebase_error(response).await));
    }
    let refreshed = response
        .json::<FirebaseRefreshResponse>()
        .await
        .map_err(|error| SessionError::Failed(error.to_string()))?;
    let expires_in = refreshed.expires_in.parse::<i64>().unwrap_or(3600);
    let next = AuthSession {
        uid: refreshed.user_id,
        email: session.email,
        id_token: refreshed.id_token,
        refresh_token: refreshed.refresh_token,
        expires_at: Utc::now().timestamp() + expires_in,
    };
    keychain()
        .and_then(|entry| {
            entry
                .set_password(&next.refresh_token)
                .map_err(|error| error.to_string())
        })
        .map_err(SessionError::Failed)?;
    *auth
        .0
        .lock()
        .map_err(|_| SessionError::Failed("Oturum kilidi alınamadı.".to_owned()))? =
        Some(next.clone());
    Ok(next)
}

fn session_needs_refresh(expires_at: i64, now: i64) -> bool {
    expires_at - now <= SESSION_REFRESH_MARGIN_SECONDS
}

async fn get_firestore_document(
    client: &Client,
    name: &str,
    id_token: &str,
) -> Result<Option<serde_json::Value>, FetchError> {
    let response = client
        .get(format!("{FIRESTORE_API}/{name}"))
        .bearer_auth(id_token)
        .send()
        .await
        .map_err(|_| FetchError::Offline)?;
    if response.status() == reqwest::StatusCode::NOT_FOUND {
        return Ok(None);
    }
    if !response.status().is_success() {
        return Err(FetchError::Failed(firebase_error(response).await));
    }
    response
        .json::<serde_json::Value>()
        .await
        .map(Some)
        .map_err(|error| FetchError::Failed(error.to_string()))
}

/// Lists every document in a collection, following `nextPageToken` so collections larger than
/// one page are not silently truncated.
async fn list_firestore_collection(
    client: &Client,
    collection_name: &str,
    id_token: &str,
) -> Result<Vec<serde_json::Value>, FetchError> {
    let mut documents = Vec::new();
    let mut page_token: Option<String> = None;
    loop {
        let mut request = client
            .get(format!("{FIRESTORE_API}/{collection_name}"))
            .query(&[("pageSize", "300")])
            .bearer_auth(id_token);
        if let Some(token) = &page_token {
            request = request.query(&[("pageToken", token)]);
        }
        let response = request.send().await.map_err(|_| FetchError::Offline)?;
        if response.status() == reqwest::StatusCode::NOT_FOUND {
            return Ok(documents);
        }
        if !response.status().is_success() {
            return Err(FetchError::Failed(firebase_error(response).await));
        }
        let body = response
            .json::<serde_json::Value>()
            .await
            .map_err(|error| FetchError::Failed(error.to_string()))?;
        if let Some(page) = body.get("documents").and_then(|value| value.as_array()) {
            documents.extend(page.iter().cloned());
        }
        match body.get("nextPageToken").and_then(|value| value.as_str()) {
            Some(token) if !token.is_empty() => page_token = Some(token.to_owned()),
            _ => return Ok(documents),
        }
    }
}

/// Mirrors `tombstoneDocumentId` in the mobile Firestore remote.
fn tombstone_document_id(entity_type: &str, entity_id: &str) -> String {
    let mut encoded = String::with_capacity(entity_id.len());
    for byte in entity_id.bytes() {
        match byte {
            b'A'..=b'Z'
            | b'a'..=b'z'
            | b'0'..=b'9'
            | b'-'
            | b'_'
            | b'.'
            | b'!'
            | b'~'
            | b'*'
            | b'\''
            | b'('
            | b')' => encoded.push(byte as char),
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    format!("{entity_type}:{encoded}")
}

/// Builds the `syncEvents` document the mobile client pulls (see `validSyncEvent` in
/// firestore.rules); `serverUpdatedAt` is set by a REQUEST_TIME transform.
fn sync_event_fields(
    event: &PendingOutbox,
    owner_id: &str,
    event_id: &str,
    entity_fields: &serde_json::Value,
) -> serde_json::Value {
    serde_json::json!({
        "eventId": { "stringValue": event_id },
        "ownerId": { "stringValue": owner_id },
        "entityType": { "stringValue": event.entity_type },
        "entityId": { "stringValue": event.entity_id },
        "operation": { "stringValue": event.operation },
        "revision": { "integerValue": event.revision.to_string() },
        "payloadVersion": { "integerValue": "1" },
        "payload": { "mapValue": { "fields": entity_fields } },
        "createdAt": { "stringValue": event.created_at },
        "idempotencyKey": { "stringValue": event_id },
    })
}

/// gRPC status names Firestore returns when a commit's `currentDocument` precondition fails.
fn is_precondition_failure(code: &str) -> bool {
    matches!(
        code,
        "FAILED_PRECONDITION" | "ALREADY_EXISTS" | "NOT_FOUND" | "ABORTED"
    )
}

/// Desktop outbox rows store a `DesktopDocument`, which lacks fields `validDocument` in
/// firestore.rules requires (and mobile stores in NOT NULL columns); fill them from the local row.
fn complete_document_payload(
    database: &Mutex<Database>,
    payload: &mut serde_json::Value,
) -> Result<(), String> {
    let Some(object) = payload.as_object_mut() else {
        return Ok(());
    };
    let id = object
        .get("id")
        .and_then(|value| value.as_str())
        .unwrap_or_default()
        .to_owned();
    let row: Option<(String, String, Option<String>)> = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?
        .connection
        .query_row(
            "SELECT kind, created_at, deleted_at FROM documents WHERE id = ?1",
            [&id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .optional()
        .map_err(|error| error.to_string())?;
    let updated_at = object
        .get("updatedAt")
        .cloned()
        .unwrap_or_else(|| serde_json::Value::String(now()));
    let (kind, created_at, deleted_at) = row.unwrap_or_else(|| {
        (
            "note".to_owned(),
            updated_at.as_str().unwrap_or_default().to_owned(),
            None,
        )
    });
    object
        .entry("kind")
        .or_insert(serde_json::Value::String(kind));
    object
        .entry("createdAt")
        .or_insert(serde_json::Value::String(created_at));
    object
        .entry("deletedAt")
        .or_insert(deleted_at.map_or(serde_json::Value::Null, serde_json::Value::String));
    object.entry("projectId").or_insert(serde_json::Value::Null);
    object
        .entry("isPinned")
        .or_insert(serde_json::Value::Bool(false));
    object.entry("path").or_insert(serde_json::Value::Null);
    object.entry("updatedAt").or_insert(updated_at);
    Ok(())
}

/// Statuses for a write that retrying unchanged will not fix (rules rejection, bad payload).
fn is_rejected_write(code: &str) -> bool {
    matches!(code, "PERMISSION_DENIED" | "INVALID_ARGUMENT")
}

fn block_outbox(database: &Mutex<Database>, event_id: &str, message: &str) -> Result<(), String> {
    let db = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection
        .execute(
            "UPDATE outbox SET status = 'blocked', last_error = ?2 WHERE id = ?1",
            params![event_id, message],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn acknowledge_outbox(database: &Mutex<Database>, event_id: &str) -> Result<(), String> {
    let db = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection
        .execute(
            "UPDATE outbox SET status = 'acknowledged', last_error = NULL WHERE id = ?1",
            [event_id],
        )
        .map(|_| ())
        .map_err(|error| error.to_string())
}

fn record_conflict(
    database: &Mutex<Database>,
    event: &PendingOutbox,
    remote: Option<serde_json::Value>,
) -> Result<(), String> {
    let db = database
        .lock()
        .map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection.execute("INSERT INTO conflicts(id, entity_id, local_payload, remote_payload, created_at, status) VALUES(?1, ?2, ?3, ?4, ?5, 'open')", params![Uuid::new_v4().to_string(), event.entity_id, event.payload.to_string(), remote.unwrap_or_else(|| serde_json::json!({})).to_string(), now()]).map_err(|error| error.to_string())?;
    db.connection.execute("UPDATE outbox SET status = 'blocked', last_error = 'Revision conflict requires user resolution.' WHERE id = ?1", [&event.id]).map_err(|error| error.to_string())?;
    Ok(())
}

fn github_token() -> Result<String, String> {
    github::token()?.ok_or_else(|| "GitHub hesabı bağlı değil.".to_owned())
}

#[tauri::command]
async fn github_device_start(client_id: String) -> Result<github::GitHubDeviceStart, String> {
    github::device_start(client_id).await
}

#[tauri::command]
async fn github_device_poll(
    client_id: String,
    device_code: String,
) -> Result<github::GitHubDevicePoll, String> {
    github::device_poll(client_id, device_code).await
}

#[tauri::command]
async fn github_status() -> Result<Option<github::GitHubAccount>, String> {
    github::status().await
}

#[tauri::command]
fn github_disconnect() -> Result<(), String> {
    github::disconnect()
}

#[tauri::command]
async fn github_list_repositories(page: u32) -> Result<github::GitHubRepositoryPage, String> {
    github::repositories(page).await
}

pub fn validate_github_repository(repository: &github::GitHubRepository) -> Result<(), String> {
    let mut parts = repository.full_name.split('/');
    let owner = parts.next().unwrap_or_default();
    let name = parts.next().unwrap_or_default();
    if owner.is_empty()
        || name.is_empty()
        || parts.next().is_some()
        || owner.contains('\\')
        || owner.contains(':')
        || name.contains('\\')
        || name.contains(':')
    {
        return Err("GitHub repository adı güvenli değil.".to_owned());
    }
    let expected_html = format!("https://github.com/{}", repository.full_name);
    let expected_clone = format!("https://github.com/{}.git", repository.full_name);
    if repository.html_url != expected_html || repository.clone_url != expected_clone {
        return Err("GitHub repository URL'i doğrulanamadı.".to_owned());
    }
    Ok(())
}

/// Holds the full validate-fetch-persist logic. `pub` and taking a plain `&Mutex<Database>`
/// (rather than a Tauri-managed `State`) so the opt-in live-integration test suite
/// (`tests/github_live.rs`) can call the exact production linking path against a disposable
/// database and a real GitHub repository. The `#[tauri::command]` below is a thin wrapper.
pub async fn link_repository(
    input: GitHubLinkInput,
    state: &Mutex<Database>,
) -> Result<GitHubLink, String> {
    validate_github_repository(&input.repository)?;
    if input.project_id.trim().is_empty() {
        return Err("Stone proje kimliği boş olamaz.".to_owned());
    }
    let repository = github::repository(&input.repository.full_name).await?;
    validate_github_repository(&repository)?;
    if repository.id != input.repository.id
        || repository.html_url != input.repository.html_url
        || repository.clone_url != input.repository.clone_url
    {
        return Err("GitHub repository bilgisi sunucuda doğrulanamadı.".to_owned());
    }
    let timestamp = now();
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection
        .execute("INSERT INTO github_links(project_id, repository_id, full_name, name, private, html_url, clone_url, ssh_url, size_kb, default_branch, visibility, local_path, updated_at) VALUES(?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13) ON CONFLICT(project_id) DO UPDATE SET repository_id=excluded.repository_id, full_name=excluded.full_name, name=excluded.name, private=excluded.private, html_url=excluded.html_url, clone_url=excluded.clone_url, ssh_url=excluded.ssh_url, size_kb=excluded.size_kb, default_branch=excluded.default_branch, visibility=excluded.visibility, local_path=excluded.local_path, updated_at=excluded.updated_at", params![input.project_id, repository.id as i64, repository.full_name, repository.name, repository.private, repository.html_url, repository.clone_url, repository.ssh_url, repository.size_kb as i64, repository.default_branch, repository.visibility, input.local_path, timestamp])
        .map_err(|error| error.to_string())?;
    Ok(GitHubLink {
        project_id: input.project_id,
        repository,
        local_path: input.local_path,
        updated_at: timestamp,
    })
}

#[tauri::command]
async fn github_link_repository(
    input: GitHubLinkInput,
    state: State<'_, Mutex<Database>>,
) -> Result<GitHubLink, String> {
    link_repository(input, &state).await
}

/// `pub` for the same reason as [`link_repository`]: lets the live-integration test suite
/// read back persisted links (e.g. after a simulated restart) using the real query.
pub fn list_links(state: &Mutex<Database>) -> Result<Vec<GitHubLink>, String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    let mut statement = db.connection.prepare("SELECT project_id, repository_id, full_name, name, private, html_url, clone_url, ssh_url, size_kb, default_branch, visibility, local_path, updated_at FROM github_links ORDER BY updated_at DESC").map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            let visibility: Option<String> = row.get(10)?;
            Ok(GitHubLink {
                project_id: row.get(0)?,
                repository: github::GitHubRepository {
                    id: row.get::<_, i64>(1)? as u64,
                    name: row.get(3)?,
                    full_name: row.get(2)?,
                    private: row.get(4)?,
                    html_url: row.get(5)?,
                    clone_url: row.get(6)?,
                    ssh_url: row.get(7)?,
                    size_kb: row.get::<_, i64>(8)? as u64,
                    default_branch: row.get(9)?,
                    visibility,
                    updated_at: row.get(12)?,
                    permissions: None,
                },
                local_path: row.get(11)?,
                updated_at: row.get(12)?,
            })
        })
        .map_err(|error| error.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn github_list_links(state: State<'_, Mutex<Database>>) -> Result<Vec<GitHubLink>, String> {
    list_links(&state)
}

#[tauri::command]
fn git_system_version() -> Result<String, String> {
    git::system_version()
}

#[tauri::command]
fn git_status(path: String) -> Result<git::GitStatus, String> {
    git::status(path)
}

#[tauri::command]
fn git_review(path: String) -> Result<git::GitReview, String> {
    git::review(path)
}

#[tauri::command]
fn git_pull(path: String) -> Result<git::GitOperationResult, String> {
    let token = github_token()?;
    git::pull(path, &token)
}

#[tauri::command]
fn git_stage_commit_push(
    path: String,
    paths: Vec<String>,
    message: String,
) -> Result<git::GitOperationResult, String> {
    let token = github_token()?;
    git::stage_commit_push(path, paths, message, &token)
}

#[tauri::command]
fn git_clone(
    root: String,
    full_name: String,
    size_kb: u64,
) -> Result<git::GitOperationResult, String> {
    let token = github_token()?;
    git::clone_repository(&root, &full_name, size_kb, &token, &|| false)
}

pub fn persist_restore_path(
    state: &Mutex<Database>,
    full_name: &str,
    path: &Path,
) -> Result<(), String> {
    let db = state.lock().map_err(|_| "Veritabanı kilidi alınamadı.")?;
    db.connection
        .execute(
            "UPDATE github_links SET local_path = ?1, updated_at = ?2 WHERE full_name = ?3",
            params![path.to_string_lossy(), now(), full_name],
        )
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[tauri::command]
fn restore_disk_check(
    root: String,
    repositories: Vec<RestoreRepositoryInput>,
) -> Result<u64, String> {
    let required = repositories.into_iter().fold(0u64, |total, repository| {
        total.saturating_add(
            repository
                .size_kb
                .saturating_mul(1024)
                .saturating_mul(2)
                .max(50 * 1024 * 1024),
        )
    });
    git::check_space(&root, required)
}

#[tauri::command]
fn restore_repositories(
    run_id: String,
    root: String,
    repositories: Vec<RestoreRepositoryInput>,
    database: State<'_, Mutex<Database>>,
    cancellation: State<'_, RestoreCancellation>,
) -> Result<RestoreSummary, String> {
    if run_id.trim().is_empty() || repositories.is_empty() {
        return Err("Restore çalışması ve en az bir repository gerekli.".to_owned());
    }
    let token = github_token()?;
    cancellation
        .0
        .lock()
        .map_err(|_| "Restore kilidi alınamadı.")?
        .remove(&run_id);
    let required = repositories.iter().fold(0u64, |total, repository| {
        total.saturating_add(
            repository
                .size_kb
                .saturating_mul(1024)
                .saturating_mul(2)
                .max(50 * 1024 * 1024),
        )
    });
    git::check_space(&root, required)?;
    let mut results = Vec::new();
    for repository in repositories {
        let check_cancelled = || {
            cancellation
                .0
                .lock()
                .map(|values| values.contains(&run_id))
                .unwrap_or(true)
        };
        if check_cancelled() {
            results.push(RestoreItemResult {
                full_name: repository.full_name,
                status: "cancelled".to_owned(),
                path: None,
                error: None,
                warnings: Vec::new(),
            });
            continue;
        }
        let path = match git::destination_name(&repository.full_name) {
            Ok(name) => PathBuf::from(&root).join(name),
            Err(error) => {
                results.push(RestoreItemResult {
                    full_name: repository.full_name,
                    status: "failed".to_owned(),
                    path: None,
                    error: Some(error),
                    warnings: Vec::new(),
                });
                continue;
            }
        };
        match git::clone_repository(
            &root,
            &repository.full_name,
            repository.size_kb,
            &token,
            &check_cancelled,
        ) {
            Ok(result) => {
                let mut warnings = result.warnings;
                if let Err(error) = persist_restore_path(&database, &repository.full_name, &path) {
                    warnings.push(format!(
                        "Clone tamamlandı ancak Stone link yolu kaydedilemedi: {error}"
                    ));
                }
                results.push(RestoreItemResult {
                    full_name: repository.full_name,
                    status: "cloned".to_owned(),
                    path: Some(path.to_string_lossy().into_owned()),
                    error: None,
                    warnings,
                });
            }
            Err(_error) if check_cancelled() => results.push(RestoreItemResult {
                full_name: repository.full_name,
                status: "cancelled".to_owned(),
                path: None,
                error: None,
                warnings: Vec::new(),
            }),
            Err(error) => results.push(RestoreItemResult {
                full_name: repository.full_name,
                status: "failed".to_owned(),
                path: None,
                error: Some(error),
                warnings: Vec::new(),
            }),
        }
    }
    let cancelled = cancellation
        .0
        .lock()
        .map(|values| values.contains(&run_id))
        .unwrap_or(false);
    cancellation
        .0
        .lock()
        .map_err(|_| "Restore kilidi alınamadı.")?
        .remove(&run_id);
    Ok(RestoreSummary {
        run_id,
        cancelled,
        results,
    })
}

#[tauri::command]
fn cancel_restore(
    run_id: String,
    cancellation: State<'_, RestoreCancellation>,
) -> Result<(), String> {
    cancellation
        .0
        .lock()
        .map_err(|_| "Restore kilidi alınamadı.")?
        .insert(run_id);
    Ok(())
}

#[tauri::command]
fn open_external_path(target: String, path: String) -> Result<(), String> {
    let canonical =
        fs::canonicalize(&path).map_err(|error| format!("Klasör/dosya açılamadı: {error}"))?;
    spawn_external(&target, &canonical)
}

#[tauri::command]
fn open_github_url(url: String) -> Result<(), String> {
    if !url.starts_with("https://github.com/") || url.contains(['\r', '\n', '"']) {
        return Err("Yalnızca github.com HTTPS adresleri açılabilir.".to_owned());
    }
    #[cfg(windows)]
    {
        Command::new("explorer.exe")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
    #[cfg(not(windows))]
    {
        Command::new("xdg-open")
            .arg(url)
            .spawn()
            .map(|_| ())
            .map_err(|error| error.to_string())
    }
}

#[cfg(test)]
mod sync_tests {
    use super::*;

    fn pending(entity_type: &str) -> PendingOutbox {
        PendingOutbox {
            id: "outbox-1".to_owned(),
            entity_type: entity_type.to_owned(),
            entity_id: "task-1".to_owned(),
            operation: "upsert".to_owned(),
            base_revision: 1,
            revision: 2,
            payload: serde_json::json!({ "id": "task-1", "title": "Ship" }),
            created_at: "2026-01-01T00:00:00Z".to_owned(),
        }
    }

    #[test]
    fn refreshes_the_id_token_shortly_before_expiry() {
        assert!(!session_needs_refresh(10_000, 10_000 - 3_600));
        assert!(session_needs_refresh(10_000, 10_000 - 60));
        assert!(session_needs_refresh(10_000, 10_001));
    }

    #[test]
    fn tombstone_ids_match_the_mobile_encoding() {
        assert_eq!(tombstone_document_id("task", "task-1"), "task:task-1");
        assert_eq!(
            tombstone_document_id("document", "a b/ç"),
            "document:a%20b%2F%C3%A7"
        );
    }

    #[test]
    fn sync_events_only_use_fields_allowed_by_the_rules() {
        let event = pending("task");
        let entity = firestore_fields(&event.payload, event.revision, "owner", "device");
        let fields = sync_event_fields(&event, "owner", "desktop:device:task-1:2", &entity);
        let mut keys: Vec<_> = fields.as_object().unwrap().keys().cloned().collect();
        keys.sort();
        assert_eq!(
            keys,
            [
                "createdAt",
                "entityId",
                "entityType",
                "eventId",
                "idempotencyKey",
                "operation",
                "ownerId",
                "payload",
                "payloadVersion",
                "revision"
            ]
        );
        assert_eq!(fields["payload"]["mapValue"]["fields"], entity);
        assert_eq!(fields["revision"]["integerValue"], "2");
        assert_eq!(
            entity["idempotencyKey"]["stringValue"],
            "desktop:device:task-1:2"
        );
    }

    #[test]
    fn completes_desktop_document_payloads_for_the_rules() {
        let path = std::env::temp_dir().join(format!("stone-sync-test-{}.sqlite3", Uuid::new_v4()));
        let database = Mutex::new(Database::open(path.clone()).unwrap());
        database
            .lock()
            .unwrap()
            .connection
            .execute(
                "INSERT INTO documents(id, kind, title, markdown, path, revision, updated_at, created_at, deleted_at, updated_by_device_id) VALUES('doc-1', 'note', 'T', 'M', NULL, 1, '2026-02-01T00:00:00Z', '2026-01-01T00:00:00Z', NULL, 'device')",
                [],
            )
            .unwrap();
        let mut payload = serde_json::json!({
            "id": "doc-1",
            "title": "T",
            "markdown": "M",
            "path": null,
            "revision": 1,
            "updatedAt": "2026-02-01T00:00:00Z"
        });
        complete_document_payload(&database, &mut payload).unwrap();
        assert_eq!(payload["kind"], "note");
        assert_eq!(payload["createdAt"], "2026-01-01T00:00:00Z");
        assert_eq!(payload["isPinned"], false);
        assert!(payload["projectId"].is_null());
        assert!(payload["deletedAt"].is_null());
        drop(database);
        let _ = fs::remove_file(path);
    }

    #[test]
    fn treats_only_precondition_statuses_as_retryable_conflicts() {
        assert!(is_precondition_failure("FAILED_PRECONDITION"));
        assert!(is_precondition_failure("ALREADY_EXISTS"));
        assert!(!is_precondition_failure("PERMISSION_DENIED"));
        assert!(!is_precondition_failure("INVALID_ARGUMENT"));
        assert!(is_rejected_write("PERMISSION_DENIED"));
        assert!(!is_rejected_write("UNAUTHENTICATED"));
        assert!(!is_rejected_write("UNAVAILABLE"));
    }

    #[test]
    fn strips_windows_verbatim_prefixes_for_editors() {
        assert_eq!(
            display_path(Path::new(r"\\?\C:\work\note.md")),
            PathBuf::from(r"C:\work\note.md")
        );
        assert_eq!(
            display_path(Path::new(r"\\?\UNC\server\share")),
            PathBuf::from(r"\\?\UNC\server\share")
        );
        assert_eq!(
            display_path(Path::new("/home/me/note.md")),
            PathBuf::from("/home/me/note.md")
        );
    }
}
