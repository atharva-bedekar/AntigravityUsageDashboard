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
        "From {first} to {last} you used {total_tok} tokens ({fresh_tok} new input, {cached_tok} cached input, {output_tok} output) in {} sessions ({} CLI, {} App). {cache_pct}% were cached re-reads. At {} prices that's about ≈ {cost_str}.",
        payload.totals.sessions,
        payload.cli_totals.sessions,
        payload.app_totals.sessions,
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
