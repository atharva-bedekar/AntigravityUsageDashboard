use std::fs;
use std::path::Path;

use chrono::Utc;
use rusqlite::{params, Connection};

use crate::models::{DailyBucket, ScanResult};

const SCHEMA: &str = r#"
CREATE TABLE IF NOT EXISTS runs (
    run_id      INTEGER PRIMARY KEY AUTOINCREMENT,
    taken_at    TEXT NOT NULL,
    root        TEXT,
    sessions    INTEGER,
    calls       INTEGER,
    tokens      INTEGER
);
CREATE TABLE IF NOT EXISTS session_facts (
    session_id      TEXT PRIMARY KEY,
    label           TEXT,
    kind            TEXT,
    source          TEXT,
    calls           INTEGER,
    fresh_in        INTEGER,
    cached          INTEGER,
    output          INTEGER,
    total           INTEGER,
    first_utc       TEXT,
    last_utc        TEXT,
    first_seen_at   TEXT,
    last_updated_at TEXT
);
CREATE TABLE IF NOT EXISTS daily_facts (
    date            TEXT PRIMARY KEY,
    calls           INTEGER,
    sessions        INTEGER,
    fresh_in        INTEGER,
    cached          INTEGER,
    output          INTEGER,
    total           INTEGER,
    last_updated_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_daily_date ON daily_facts(date);
"#;

pub fn open_db(db_path: &Path) -> Result<Connection, String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create snapshots directory: {e}"))?;
    }
    let conn = Connection::open(db_path)
        .map_err(|e| format!("Failed to open snapshots.db: {e}"))?;
    conn.execute_batch(SCHEMA)
        .map_err(|e| format!("Failed to initialize snapshots schema: {e}"))?;
    Ok(conn)
}

/// Idempotently upsert session_facts and daily_facts and append one row to runs.
/// Returns the total number of recorded runs.
pub fn ingest_snapshot(
    db_path: &Path,
    scan: &ScanResult,
    daily: &[DailyBucket],
) -> Result<u64, String> {
    let mut conn = open_db(db_path)?;
    let now = Utc::now().to_rfc3339();
    let tx = conn
        .transaction()
        .map_err(|e| format!("Failed to start snapshot transaction: {e}"))?;

    {
        let mut s_stmt = tx
            .prepare(
                "INSERT INTO session_facts
                 (session_id, label, kind, source, calls, fresh_in, cached, output, total, first_utc, last_utc, first_seen_at, last_updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
                 ON CONFLICT(session_id) DO UPDATE SET
                   label=excluded.label,
                   kind=excluded.kind,
                   source=excluded.source,
                   calls=excluded.calls,
                   fresh_in=excluded.fresh_in,
                   cached=excluded.cached,
                   output=excluded.output,
                   total=excluded.total,
                   first_utc=excluded.first_utc,
                   last_utc=excluded.last_utc,
                   last_updated_at=excluded.last_updated_at",
            )
            .map_err(|e| format!("Prepare session_facts failed: {e}"))?;

        for s in &scan.sessions {
            let kind_str = match s.kind {
                crate::models::SessionKind::Main => "main",
                crate::models::SessionKind::Subagent => "subagent",
                crate::models::SessionKind::Unknown => "unknown",
            };
            s_stmt
                .execute(params![
                    s.session_id,
                    s.title,
                    kind_str,
                    s.source.key(),
                    s.calls as i64,
                    s.fresh_in as i64,
                    s.cached as i64,
                    s.output as i64,
                    s.total as i64,
                    s.first_utc,
                    s.last_utc,
                    now,
                    now
                ])
                .map_err(|e| format!("Upsert session_facts failed: {e}"))?;
        }
    }

    {
        let mut d_stmt = tx
            .prepare(
                "INSERT INTO daily_facts
                 (date, calls, sessions, fresh_in, cached, output, total, last_updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
                 ON CONFLICT(date) DO UPDATE SET
                   calls=excluded.calls,
                   sessions=excluded.sessions,
                   fresh_in=excluded.fresh_in,
                   cached=excluded.cached,
                   output=excluded.output,
                   total=excluded.total,
                   last_updated_at=excluded.last_updated_at",
            )
            .map_err(|e| format!("Prepare daily_facts failed: {e}"))?;

        for d in daily {
            d_stmt
                .execute(params![
                    d.date,
                    d.calls as i64,
                    d.sessions as i64,
                    d.fresh_in as i64,
                    d.cached as i64,
                    d.output as i64,
                    d.total as i64,
                    now
                ])
                .map_err(|e| format!("Upsert daily_facts failed: {e}"))?;
        }
    }

    let total_calls: i64 = scan.sessions.iter().map(|s| s.calls as i64).sum();
    let total_tokens: i64 = scan.sessions.iter().map(|s| s.total as i64).sum();
    tx.execute(
        "INSERT INTO runs (taken_at, root, sessions, calls, tokens) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![
            now,
            "multi-source",
            scan.sessions.len() as i64,
            total_calls,
            total_tokens
        ],
    )
    .map_err(|e| format!("Insert runs failed: {e}"))?;

    tx.commit()
        .map_err(|e| format!("Commit snapshot failed: {e}"))?;

    Ok(run_count(db_path))
}

pub fn run_count(db_path: &Path) -> u64 {
    if !db_path.exists() {
        return 0;
    }
    let Ok(conn) = Connection::open(db_path) else {
        return 0;
    };
    conn.query_row("SELECT COUNT(*) FROM runs", [], |row| row.get::<_, i64>(0))
        .map(|n| n.max(0) as u64)
        .unwrap_or(0)
}

pub fn clear_snapshots(db_path: &Path) -> Result<u64, String> {
    if !db_path.exists() {
        return Ok(0);
    }
    let conn = open_db(db_path)?;
    conn.execute_batch("DELETE FROM session_facts; DELETE FROM daily_facts; DELETE FROM runs;")
        .map_err(|e| format!("Failed to clear snapshots: {e}"))?;
    Ok(0)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::{
        ConsistencyReport, ScanDiagnostics, SessionKind, SessionRecord, SourceKind,
    };
    use std::time::{SystemTime, UNIX_EPOCH};

    #[test]
    fn ingest_is_idempotent_on_session_and_daily_facts() {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let db = std::env::temp_dir().join(format!("agy_snap_test_{nanos}.db"));

        let scan = ScanResult {
            sessions: vec![SessionRecord {
                session_id: "abc-123".to_string(),
                short_id: "abc-123".to_string(),
                source: SourceKind::Cli,
                kind: SessionKind::Main,
                title: "Test".to_string(),
                is_untitled: false,
                label_source: "CLI history".to_string(),
                project: "Proj".to_string(),
                workspace: "D:\\Proj".to_string(),
                parent_id: None,
                agent_type: None,
                role: None,
                first_utc: None,
                last_utc: None,
                first_local_date: Some("2026-11-15".to_string()),
                last_local_date: Some("2026-11-15".to_string()),
                duration_secs: 60,
                calls: 2,
                step_count: 2,
                fresh_in: 100,
                cached: 900,
                output: 50,
                total: 1050,
                thinking_steps: 0,
                error_steps: 0,
                tool_call_count: 0,
                tool_names: vec![],
                transcript_path: "t.jsonl".to_string(),
                metadata_source: "history.jsonl".to_string(),
                steps: vec![],
                command_execs: vec![],
                spawn_step_index: None,
                written_plan_paths: vec![],
                referenced_plan_paths: vec![],
                message_turns: std::collections::HashMap::new(),
            }],
            diagnostics: ScanDiagnostics {
                scanned_at: "".into(),
                scanned_at_local_hm: "".into(),
                duration_ms: 1,
                sources: vec![],
                total_transcripts: 1,
                total_with_tokens: 1,
                total_without_tokens: 0,
                total_parse_errors: 0,
                total_pb_only: 0,
                total_corrupted_tool_names_dropped: 0,
                total_capped_step_gaps: 0,
                consistency: ConsistencyReport {
                    ok: true,
                    session_row_mismatches: 0,
                    daily_row_mismatches: 0,
                    session_total: 1050,
                    daily_total: 1050,
                    discrepancy: 0,
                    message: "ok".into(),
                },
                snapshot_runs: 0,
                warnings: vec![],
            },
        };

        let daily = vec![DailyBucket {
            date: "2026-11-15".into(),
            calls: 2,
            sessions: 1,
            app_sessions: 0,
            cli_sessions: 1,
            fresh_in: 100,
            cached: 900,
            output: 50,
            total: 1050,
            app_fresh_in: 0,
            app_cached: 0,
            app_output: 0,
            app_total: 0,
            cli_fresh_in: 100,
            cli_cached: 900,
            cli_output: 50,
            cli_total: 1050,
            cost_usd: 0.01,
            cost_currency: 0.88,
            is_date_estimate: false,
        }];

        let r1 = ingest_snapshot(&db, &scan, &daily).unwrap();
        let r2 = ingest_snapshot(&db, &scan, &daily).unwrap();
        assert_eq!(r1, 1);
        assert_eq!(r2, 2);

        let conn = open_db(&db).unwrap();
        let s_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM session_facts", [], |r| r.get(0))
            .unwrap();
        let d_count: i64 = conn
            .query_row("SELECT COUNT(*) FROM daily_facts", [], |r| r.get(0))
            .unwrap();
        assert_eq!(s_count, 1);
        assert_eq!(d_count, 1);

        drop(conn);
        let _ = fs::remove_file(&db);
    }
}
