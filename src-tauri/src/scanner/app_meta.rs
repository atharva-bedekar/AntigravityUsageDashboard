use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use percent_encoding::percent_decode_str;
use rusqlite::{Connection, OpenFlags};

static TEMP_COUNTER: AtomicU64 = AtomicU64::new(0);

/// Metadata for a single conversation extracted from `conversation_summaries.db`.
#[derive(Debug, Clone, Default)]
pub struct AppSessionMeta {
    pub title: Option<String>,
    pub workspace: String,
    pub project: String,
    pub parent_id: Option<String>,
}

struct TempDbGuard {
    dir: PathBuf,
}

impl Drop for TempDbGuard {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.dir);
    }
}

/// Normalize a workspace URI or path (e.g. `file:///d%3A/Code/Foo`) into a clean Windows/OS path
/// and derive its `project` folder name.
pub fn parse_workspace_uri(raw: &str) -> (String, String) {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return (String::new(), "Unattributed".to_string());
    }

    // Extract first URI/path from JSON array or comma/newline-separated string
    let first = if trimmed.starts_with('[') {
        serde_json::from_str::<Vec<String>>(trimmed)
            .ok()
            .and_then(|v| v.into_iter().find(|s| !s.trim().is_empty()))
            .unwrap_or_default()
    } else {
        trimmed
            .split(|c| c == '\n' || c == '\r' || c == ',')
            .map(str::trim)
            .find(|s| !s.is_empty())
            .unwrap_or("")
            .to_string()
    };

    if first.is_empty() {
        return (String::new(), "Unattributed".to_string());
    }

    let decoded = percent_decode_str(first.trim()).decode_utf8_lossy().into_owned();
    let stripped = if let Some(rest) = decoded.strip_prefix("file:///") {
        rest.to_string()
    } else if let Some(rest) = decoded.strip_prefix("file://") {
        rest.to_string()
    } else {
        decoded
    };

    // Normalize Windows drive-letter paths: `/d:/Code/Foo` or `d:/Code/Foo` -> `D:\Code\Foo`
    let mut normalized = stripped.trim().to_string();
    if normalized.starts_with('/') && normalized.len() >= 3 && normalized.as_bytes()[2] == b':' {
        normalized = normalized[1..].to_string();
    }

    let bytes = normalized.as_bytes();
    if bytes.len() >= 2 && bytes[0].is_ascii_alphabetic() && bytes[1] == b':' {
        let upper = (bytes[0] as char).to_ascii_uppercase();
        normalized = format!("{upper}{}", &normalized[1..]);
        normalized = normalized.replace('/', "\\");
    }

    // Trim trailing slashes (except root like `D:\`)
    while normalized.len() > 3 && (normalized.ends_with('\\') || normalized.ends_with('/')) {
        normalized.pop();
    }

    if normalized.is_empty() {
        return (String::new(), "Unattributed".to_string());
    }

    let project = derive_project_name(&normalized);
    (normalized, project)
}

/// Derive a human-readable project folder name from a workspace path.
pub fn derive_project_name(workspace: &str) -> String {
    let trimmed = workspace.trim();
    if trimmed.is_empty() {
        return "Unattributed".to_string();
    }
    // Split on both `/` and `\` so Windows paths work regardless of host OS in tests
    let name = trimmed
        .rsplit(|c| c == '\\' || c == '/')
        .find(|seg| !seg.is_empty());

    match name {
        Some(n) if !(n.len() == 2 && n.ends_with(':')) => n.to_string(),
        _ => "Unattributed".to_string(),
    }
}

fn open_db_readonly(db_path: &Path) -> Result<(Connection, Option<TempDbGuard>), rusqlite::Error> {
    let wal_path = PathBuf::from(format!("{}-wal", db_path.display()));
    let has_wal = wal_path.exists() && fs::metadata(&wal_path).map_or(false, |m| m.len() > 0);

    // If a WAL file is active, copy .db (+ -wal/-shm) to an isolated temp directory so we never
    // touch or lock the live Antigravity App directory while still seeing WAL-committed rows.
    if !has_wal {
        let uri = format!(
            "file:{}?mode=ro&immutable=1",
            db_path.to_string_lossy().replace('\\', "/")
        );
        if let Ok(conn) = Connection::open_with_flags(
            &uri,
            OpenFlags::SQLITE_OPEN_READ_ONLY
                | OpenFlags::SQLITE_OPEN_URI
                | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        ) {
            return Ok((conn, None));
        }
    }

    // Fallback: copy to temp directory and open there
    let id = TEMP_COUNTER.fetch_add(1, Ordering::Relaxed);
    let temp_dir = std::env::temp_dir().join(format!("agy_usage_ro_{}_{}", std::process::id(), id));
    if fs::create_dir_all(&temp_dir).is_ok() {
        let temp_db = temp_dir.join("conversation_summaries.db");
        if fs::copy(db_path, &temp_db).is_ok() {
            for suffix in ["-wal", "-shm"] {
                let src = PathBuf::from(format!("{}{}", db_path.display(), suffix));
                if src.is_file() {
                    let dst = temp_dir.join(format!("conversation_summaries.db{suffix}"));
                    let _ = fs::copy(&src, &dst);
                }
            }
            let guard = TempDbGuard { dir: temp_dir };
            if let Ok(conn) = Connection::open_with_flags(
                &temp_db,
                OpenFlags::SQLITE_OPEN_READ_WRITE | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                let _ = conn.execute_batch("PRAGMA query_only = ON;");
                return Ok((conn, Some(guard)));
            }
            if let Ok(conn) = Connection::open_with_flags(
                &temp_db,
                OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
            ) {
                return Ok((conn, Some(guard)));
            }
        } else {
            let _ = fs::remove_dir_all(&temp_dir);
        }
    }

    // Final fallback: direct read-only with nolock
    let uri = format!(
        "file:{}?mode=ro&nolock=1",
        db_path.to_string_lossy().replace('\\', "/")
    );
    let conn = Connection::open_with_flags(
        &uri,
        OpenFlags::SQLITE_OPEN_READ_ONLY
            | OpenFlags::SQLITE_OPEN_URI
            | OpenFlags::SQLITE_OPEN_NO_MUTEX,
    )?;
    Ok((conn, None))
}

fn table_columns(conn: &Connection, table: &str) -> Vec<String> {
    let sql = format!("PRAGMA table_info({table})");
    let mut stmt = match conn.prepare(&sql) {
        Ok(s) => s,
        Err(_) => return Vec::new(),
    };
    let rows = stmt.query_map([], |row| row.get::<_, String>(1));
    match rows {
        Ok(iter) => iter.filter_map(Result::ok).collect(),
        Err(_) => Vec::new(),
    }
}

/// Load session metadata from `<app_brain_root>/../conversation_summaries.db` in strict read-only mode.
/// Returns `(map_by_conversation_id, warnings)`.
pub fn load_app_metadata(app_brain_root: &Path) -> (HashMap<String, AppSessionMeta>, Vec<String>) {
    let mut out = HashMap::new();
    let mut warnings = Vec::new();

    let db_path = match app_brain_root.parent() {
        Some(p) => p.join("conversation_summaries.db"),
        None => return (out, warnings),
    };

    if !db_path.is_file() {
        return (out, warnings);
    }

    let (conn, _guard) = match open_db_readonly(&db_path) {
        Ok(pair) => pair,
        Err(e) => {
            warnings.push(format!(
                "Could not open App metadata DB {}: {e}",
                db_path.display()
            ));
            return (out, warnings);
        }
    };

    let cols = table_columns(&conn, "conversation_summaries");
    if !cols.is_empty() {
        let id_col = if cols.iter().any(|c| c == "conversation_id") {
            Some("conversation_id")
        } else if cols.iter().any(|c| c == "id") {
            Some("id")
        } else {
            None
        };

        if let Some(id_c) = id_col {
            let has_title = cols.iter().any(|c| c == "title");
            let has_ws = cols.iter().any(|c| c == "workspace_uris");
            let has_parent = cols.iter().any(|c| c == "parent_conversation_id");

            let select_cols = [
                id_c,
                if has_title { "title" } else { "NULL AS title" },
                if has_ws {
                    "workspace_uris"
                } else {
                    "NULL AS workspace_uris"
                },
                if has_parent {
                    "parent_conversation_id"
                } else {
                    "NULL AS parent_conversation_id"
                },
            ]
            .join(", ");

            let query = format!("SELECT {select_cols} FROM conversation_summaries");
            match conn.prepare(&query) {
                Ok(mut stmt) => {
                    let rows = stmt.query_map([], |row| {
                        let cid: String = row.get(0)?;
                        let title: Option<String> = row.get(1).ok().flatten();
                        let ws_raw: Option<String> = row.get(2).ok().flatten();
                        let parent_raw: Option<String> = row.get(3).ok().flatten();
                        Ok((cid, title, ws_raw, parent_raw))
                    });
                    if let Ok(iter) = rows {
                        for item in iter.flatten() {
                            let (cid, title, ws_raw, parent_raw) = item;
                            let clean_title = title
                                .map(|t| t.trim().to_string())
                                .filter(|t| !t.is_empty());
                            let (workspace, project) = ws_raw
                                .as_deref()
                                .map(parse_workspace_uri)
                                .unwrap_or_else(|| (String::new(), "Unattributed".to_string()));
                            let parent_id = parent_raw
                                .map(|p| p.trim().to_string())
                                .filter(|p| !p.is_empty());

                            out.insert(
                                cid,
                                AppSessionMeta {
                                    title: clean_title,
                                    workspace,
                                    project,
                                    parent_id,
                                },
                            );
                        }
                    }
                }
                Err(e) => warnings.push(format!("Failed querying conversation_summaries: {e}")),
            }
        }
    }

    // Optional `conversation_parents` table
    let has_parents_table: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type='table' AND name='conversation_parents')",
            [],
            |row| row.get(0),
        )
        .unwrap_or(false);

    if has_parents_table {
        let pcols = table_columns(&conn, "conversation_parents");
        let cid_col = pcols
            .iter()
            .find(|c| c.as_str() == "conversation_id" || c.as_str() == "id")
            .cloned();
        let pid_col = pcols
            .iter()
            .find(|c| c.as_str() == "parent_id" || c.as_str() == "parent_conversation_id")
            .cloned();

        if let (Some(cc), Some(pc)) = (cid_col, pid_col) {
            let query = format!("SELECT {cc}, {pc} FROM conversation_parents");
            if let Ok(mut stmt) = conn.prepare(&query) {
                if let Ok(iter) = stmt.query_map([], |row| {
                    let cid: String = row.get(0)?;
                    let pid: Option<String> = row.get(1).ok().flatten();
                    Ok((cid, pid))
                }) {
                    for (cid, pid) in iter.flatten() {
                        if let Some(p) = pid.map(|s| s.trim().to_string()).filter(|s| !s.is_empty()) {
                            let entry = out.entry(cid).or_insert_with(|| AppSessionMeta {
                                title: None,
                                workspace: String::new(),
                                project: "Unattributed".to_string(),
                                parent_id: None,
                            });
                            if entry.parent_id.is_none() {
                                entry.parent_id = Some(p);
                            }
                        }
                    }
                }
            }
        }
    }

    (out, warnings)
}
