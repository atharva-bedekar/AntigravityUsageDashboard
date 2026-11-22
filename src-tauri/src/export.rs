use std::fs;
use std::path::PathBuf;

use chrono::Local;

use crate::config::workspace_root;
use crate::models::{DashboardPayload, ExportResult, ScanDiagnostics};

fn csv_escape(field: &str) -> String {
    if field.contains(',') || field.contains('"') || field.contains('\n') || field.contains('\r') {
        format!("\"{}\"", field.replace('"', "\"\""))
    } else {
        field.to_string()
    }
}

pub fn format_compact_tokens(n: u64) -> String {
    let f = n as f64;
    if f >= 1_000_000_000.0 {
        format!("{:.2}B", f / 1_000_000_000.0)
    } else if f >= 1_000_000.0 {
        format!("{:.2}M", f / 1_000_000.0)
    } else if f >= 1_000.0 {
        format!("{:.1}K", f / 1_000.0)
    } else {
        format!("{n}")
    }
}

pub fn format_currency(amount: f64, currency: &str) -> String {
    if currency == "INR" {
        if amount >= 100.0 {
            format!("₹{:.0}", amount.round())
        } else {
            format!("₹{amount:.2}")
        }
    } else {
        format!("${amount:.2}")
    }
}

/// Generate the plain-English summary sentence for the current filtered dashboard view.
pub fn generate_plain_english_summary(payload: &DashboardPayload) -> String {
    let first = payload.min_date.as_deref().unwrap_or("N/A");
    let last = payload.max_date.as_deref().unwrap_or("N/A");
    let total_tok = format_compact_tokens(payload.totals.total);
    let fresh_tok = format_compact_tokens(payload.totals.fresh_in);
    let cached_tok = format_compact_tokens(payload.totals.cached);
    let output_tok = format_compact_tokens(payload.totals.output);
    let cache_pct = (payload.totals.cached_share * 100.0).round() as u64;
    let cost_str = format_currency(payload.cost.total_currency, &payload.cost.currency);

    format!(
        "From {first} to {last} you used {total_tok} tokens ({fresh_tok} new input, {cached_tok} cached input, {output_tok} output). {cache_pct}% were cached re-reads. At {} prices that's about ≈ {cost_str}.",
        payload.active_model.name,
    )
}

/// Export the filtered sessions list to CSV in `data/exports/` (or a specified path).
pub fn export_sessions_csv(
    payload: &DashboardPayload,
    target_path: Option<&str>,
) -> Result<ExportResult, String> {
    let path = match target_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let stamp = Local::now().format("%Y%m%d_%H%M%S");
            workspace_root()
                .join("data")
                .join("exports")
                .join(format!("antigravity_sessions_{stamp}.csv"))
        }
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create export directory: {e}"))?;
    }

    let mut out = String::from(
        "session_id,source,kind,title,project,workspace,started_utc,duration_secs,calls,fresh_in,cached,output,total,cache_hit_rate,cost_usd,cost_currency,currency\n",
    );

    for s in &payload.sessions {
        let kind_str = match s.kind {
            crate::models::SessionKind::Main => "main",
            crate::models::SessionKind::Subagent => "subagent",
            crate::models::SessionKind::Unknown => "unknown",
        };
        let row = [
            csv_escape(&s.session_id),
            csv_escape(&s.source.key()),
            csv_escape(kind_str),
            csv_escape(&s.title),
            csv_escape(&s.project),
            csv_escape(&s.workspace),
            csv_escape(s.first_utc.as_deref().unwrap_or("")),
            s.duration_secs.to_string(),
            s.calls.to_string(),
            s.fresh_in.to_string(),
            s.cached.to_string(),
            s.output.to_string(),
            s.total.to_string(),
            format!("{:.4}", s.cache_hit_rate),
            format!("{:.6}", s.cost_usd),
            format!("{:.4}", s.cost_currency),
            csv_escape(&payload.cost.currency),
        ]
        .join(",");
        out.push_str(&row);
        out.push('\n');
    }

    fs::write(&path, out).map_err(|e| format!("Failed to write CSV export: {e}"))?;

    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        row_count: payload.sessions.len(),
    })
}

pub fn export_diagnostics_json(
    diagnostics: &ScanDiagnostics,
    target_path: Option<&str>,
) -> Result<ExportResult, String> {
    let path = match target_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => PathBuf::from(p),
        None => {
            let stamp = Local::now().format("%Y%m%d_%H%M%S");
            workspace_root()
                .join("data")
                .join("exports")
                .join(format!("antigravity_diagnostics_{stamp}.json"))
        }
    };

    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create export directory: {e}"))?;
    }

    let json = serde_json::to_string_pretty(diagnostics)
        .map_err(|e| format!("Failed to serialize diagnostics: {e}"))?;
    fs::write(&path, format!("{json}\n"))
        .map_err(|e| format!("Failed to write diagnostics JSON: {e}"))?;

    Ok(ExportResult {
        path: path.to_string_lossy().into_owned(),
        row_count: diagnostics.sources.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::config::default_config;
    use crate::metrics::build_dashboard;
    use crate::models::{
        ConsistencyReport, FilterState, ScanResult, SessionKind, SessionRecord, SourceKind,
        StepRecord,
    };
    use crate::pricing::{default_catalog, Catalog};

    fn make_session(
        session_id: &str,
        source: SourceKind,
        date: &str,
        fresh_in: u64,
        cached: u64,
        output: u64,
    ) -> SessionRecord {
        let total = fresh_in + cached + output;
        let source_str = source.key();
        SessionRecord {
            session_id: session_id.to_string(),
            short_id: session_id.chars().take(8).collect(),
            source,
            kind: SessionKind::Main,
            title: "Test Session".to_string(),
            is_untitled: false,
            label_source: "title".to_string(),
            project: "test-proj".to_string(),
            workspace: "/tmp/test-proj".to_string(),
            parent_id: None,
            agent_type: None,
            role: None,
            first_utc: Some(format!("{date}T10:00:00Z")),
            last_utc: Some(format!("{date}T10:05:00Z")),
            first_local_date: Some(date.to_string()),
            last_local_date: Some(date.to_string()),
            duration_secs: 300,
            calls: 1,
            step_count: 1,
            fresh_in,
            cached,
            output,
            total,
            thinking_steps: 0,
            error_steps: 0,
            tool_call_count: 0,
            tool_names: Vec::new(),
            transcript_path: String::new(),
            metadata_source: "transcript".to_string(),
            steps: vec![StepRecord {
                step_index: 0,
                created_at: Some(format!("{date}T10:00:00Z")),
                local_date: Some(date.to_string()),
                local_time: Some("10:00".to_string()),
                step_type: "plannerResponse".to_string(),
                source: source_str,
                status: "done".to_string(),
                fresh_in,
                cached,
                output,
                total,
                has_tokens: true,
                thinking_preview: None,
                thinking_full: None,
                content_preview: None,
                tool_calls: Vec::new(),
                is_error: false,
                permission_denied: false,
                model_switch: None,
                observed_model: "gemini-3.8-flash".to_string(),
                command_duration_secs: None,
                command_exit_code: None,
            }],
            command_execs: Vec::new(),
            spawn_step_index: None,
            written_plan_paths: Vec::new(),
            referenced_plan_paths: Vec::new(),
            message_turns: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn plain_english_summary_omits_sessions_and_source_counts() {
        let cfg = default_config();
        let catalog = Catalog::new(default_catalog());
        let scan = ScanResult {
            sessions: vec![
                make_session("cli-1", SourceKind::Cli, "2026-11-01", 100_000, 800_000, 100_000),
                make_session("app-1", SourceKind::App, "2026-11-10", 100_000, 800_000, 100_000),
            ],
            diagnostics: ScanDiagnostics {
                scanned_at: String::new(),
                scanned_at_local_hm: String::new(),
                duration_ms: 0,
                sources: Vec::new(),
                total_transcripts: 2,
                total_with_tokens: 2,
                total_without_tokens: 0,
                total_parse_errors: 0,
                total_pb_only: 0,
                total_corrupted_tool_names_dropped: 0,
                total_capped_step_gaps: 0,
                consistency: ConsistencyReport {
                    ok: true,
                    session_row_mismatches: 0,
                    daily_row_mismatches: 0,
                    session_total: 2_000_000,
                    daily_total: 2_000_000,
                    discrepancy: 0,
                    message: String::new(),
                },
                snapshot_runs: 0,
                warnings: Vec::new(),
            },
        };
        let filter = FilterState {
            date_preset: "all".to_string(),
            custom_start: None,
            custom_end: None,
            source_filter: "all".to_string(),
            project_filter: None,
            model_id: "gemini-3.8-flash".to_string(),
            currency: "USD".to_string(),
        };

        let payload = build_dashboard(&scan, &cfg, &catalog, &filter);
        let summary = generate_plain_english_summary(&payload);

        assert!(summary.contains("From 2026-11-01 to 2026-11-10 you used 2.00M tokens"));
        assert!(summary.contains("(200.0K new input, 1.60M cached input, 200.0K output)"));
        assert!(summary.contains("80% were cached re-reads."));
        assert!(summary.contains(&payload.active_model.name));
        assert!(!summary.contains("sessions"));
        assert!(!summary.contains("CLI"));
        assert!(!summary.contains("App"));
    }
}
