pub mod app_meta;
pub mod cli_meta;
pub mod subagents;
pub mod transcript;

use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;
use std::time::Instant;

use chrono::Local;
use rayon::prelude::*;

use crate::models::{
    AppConfig, ConsistencyReport, ScanDiagnostics, ScanResult, SessionKind, SessionRecord,
    SourceDiagnostics, SourceKind, SubagentLink,
};

use app_meta::{load_app_metadata, AppSessionMeta};
use cli_meta::{load_cli_history, CliSessionMeta};
use subagents::{inherit_parent_workspaces, load_subagent_links};
use transcript::{find_transcript_file, parse_transcript_file, ParsedTranscript};

struct SourceSpec {
    source: SourceKind,
    label: String,
    root_path: String,
    enabled: bool,
    read_app_sqlite: bool,
}

struct SessionScanItem {
    session_id: String,
    has_transcript: bool,
    parsed: Option<ParsedTranscript>,
    read_error: Option<String>,
}

/// Scan all configured sources (`App`, `Cli`, and any `Custom` roots) in parallel, strictly read-only.
pub fn scan_all_sources(config: &AppConfig) -> ScanResult {
    let started = Instant::now();

    let mut specs = vec![
        SourceSpec {
            source: SourceKind::App,
            label: "Antigravity App".to_string(),
            root_path: config.app_brain_root.clone(),
            enabled: config.app_enabled,
            read_app_sqlite: config.read_app_sqlite,
        },
        SourceSpec {
            source: SourceKind::Cli,
            label: "Antigravity CLI".to_string(),
            root_path: config.cli_brain_root.clone(),
            enabled: config.cli_enabled,
            read_app_sqlite: false,
        },
    ];

    for custom in &config.custom_sources {
        specs.push(SourceSpec {
            source: SourceKind::Custom(custom.name.clone()),
            label: custom.name.clone(),
            root_path: custom.path.clone(),
            enabled: custom.enabled,
            read_app_sqlite: false,
        });
    }

    let mut all_sessions: Vec<SessionRecord> = Vec::new();
    let mut source_diags: Vec<SourceDiagnostics> = Vec::new();
    let mut global_warnings: Vec<String> = Vec::new();

    for spec in specs {
        let (mut sessions, diag) = scan_single_source(&spec);
        global_warnings.extend(diag.warnings.iter().cloned());
        all_sessions.append(&mut sessions);
        source_diags.push(diag);
    }

    // Sort sessions by last_utc descending (most recent first) for deterministic output
    all_sessions.sort_by(|a, b| {
        b.last_utc
            .cmp(&a.last_utc)
            .then_with(|| a.session_id.cmp(&b.session_id))
    });

    let total_transcripts: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.transcript_files_found)
        .sum();
    let total_with_tokens: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.sessions_with_tokens)
        .sum();
    let total_without_tokens: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.sessions_without_tokens)
        .sum();
    let total_parse_errors: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.parse_errors)
        .sum();
    let total_pb_only: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.pb_only_stems.len() as u64)
        .sum();
    let total_corrupted_tool_names_dropped: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.corrupted_tool_names_dropped)
        .sum();
    let total_capped_step_gaps: u64 = source_diags
        .iter()
        .filter(|d| d.enabled)
        .map(|d| d.capped_step_gaps)
        .sum();

    let consistency = verify_scan_consistency(&all_sessions);
    let now = Local::now();

    let diagnostics = ScanDiagnostics {
        scanned_at: now.to_rfc3339(),
        scanned_at_local_hm: now.format("%H:%M").to_string(),
        duration_ms: started.elapsed().as_millis() as u64,
        sources: source_diags,
        total_transcripts,
        total_with_tokens,
        total_without_tokens,
        total_parse_errors,
        total_pb_only,
        total_corrupted_tool_names_dropped,
        total_capped_step_gaps,
        consistency,
        snapshot_runs: 0,
        warnings: global_warnings,
    };

    ScanResult {
        sessions: all_sessions,
        diagnostics,
    }
}

fn scan_single_source(spec: &SourceSpec) -> (Vec<SessionRecord>, SourceDiagnostics) {
    let root = Path::new(&spec.root_path);
    let exists = root.is_dir();

    let metadata_source = match &spec.source {
        SourceKind::App if spec.read_app_sqlite => "conversation_summaries.db (read-only)".to_string(),
        SourceKind::App => "Disabled".to_string(),
        SourceKind::Cli => "history.jsonl".to_string(),
        SourceKind::Custom(_) => "history.jsonl / conversation_summaries.db".to_string(),
    };

    let mut diag = SourceDiagnostics {
        source: spec.source.clone(),
        label: spec.label.clone(),
        root_path: spec.root_path.clone(),
        exists,
        enabled: spec.enabled,
        transcript_files_found: 0,
        sessions_with_tokens: 0,
        sessions_without_tokens: 0,
        pb_only_stems: Vec::new(),
        parse_errors: 0,
        corrupted_tool_names_dropped: 0,
        capped_step_gaps: 0,
        min_date: None,
        max_date: None,
        fresh_in: 0,
        cached: 0,
        output: 0,
        total: 0,
        metadata_source: metadata_source.clone(),
        titles_matched: 0,
        projects_matched: 0,
        warnings: Vec::new(),
    };

    if !spec.enabled || !exists {
        if spec.enabled && !exists {
            diag.warnings
                .push(format!("{} folder not found: {}", spec.label, spec.root_path));
        }
        return (Vec::new(), diag);
    }

    // Load metadata stores in parallel or upfront
    let (app_meta, app_warnings): (HashMap<String, AppSessionMeta>, Vec<String>) =
        if matches!(spec.source, SourceKind::App | SourceKind::Custom(_)) && spec.read_app_sqlite
        {
            load_app_metadata(root)
        } else if matches!(spec.source, SourceKind::Custom(_)) {
            load_app_metadata(root)
        } else {
            (HashMap::new(), Vec::new())
        };
    diag.warnings.extend(app_warnings);

    let (cli_meta, cli_warnings): (HashMap<String, CliSessionMeta>, Vec<String>) =
        if matches!(spec.source, SourceKind::Cli | SourceKind::Custom(_)) {
            load_cli_history(root)
        } else {
            (HashMap::new(), Vec::new())
        };
    diag.warnings.extend(cli_warnings);

    let subagent_links: HashMap<String, SubagentLink> = load_subagent_links(root);

    // Collect session directories
    let mut session_dirs: Vec<(String, std::path::PathBuf)> = Vec::new();
    if let Ok(entries) = fs::read_dir(root) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.is_dir() {
                if let Some(sid) = path.file_name().and_then(|n| n.to_str()) {
                    session_dirs.push((sid.to_string(), path));
                }
            }
        }
    }
    session_dirs.sort_by(|a, b| a.0.cmp(&b.0));

    // Parallel transcript parsing with rayon
    let items: Vec<SessionScanItem> = session_dirs
        .par_iter()
        .map(|(sid, sdir)| {
            let Some(tf) = find_transcript_file(sdir) else {
                return SessionScanItem {
                    session_id: sid.clone(),
                    has_transcript: false,
                    parsed: None,
                    read_error: None,
                };
            };
            match parse_transcript_file(&tf) {
                Ok(parsed) => SessionScanItem {
                    session_id: sid.clone(),
                    has_transcript: true,
                    parsed: Some(parsed),
                    read_error: None,
                },
                Err(e) => SessionScanItem {
                    session_id: sid.clone(),
                    has_transcript: true,
                    parsed: None,
                    read_error: Some(format!("Failed reading {}: {e}", tf.display())),
                },
            }
        })
        .collect();

    let mut readable_ids: HashSet<String> = HashSet::new();
    let mut sessions: Vec<SessionRecord> = Vec::new();

    for item in items {
        if item.has_transcript {
            diag.transcript_files_found += 1;
            readable_ids.insert(item.session_id.clone());
        }
        if let Some(err) = item.read_error {
            diag.parse_errors += 1;
            diag.warnings.push(err);
            diag.sessions_without_tokens += 1;
            continue;
        }

        let Some(parsed) = item.parsed else {
            diag.sessions_without_tokens += 1;
            continue;
        };

        diag.parse_errors += parsed.parse_errors;
        diag.corrupted_tool_names_dropped += parsed.corrupted_tool_names_dropped;
        diag.capped_step_gaps += parsed.capped_step_gaps;

        if parsed.calls == 0 {
            diag.sessions_without_tokens += 1;
            continue;
        }

        diag.sessions_with_tokens += 1;
        diag.fresh_in = diag.fresh_in.saturating_add(parsed.fresh_in);
        diag.cached = diag.cached.saturating_add(parsed.cached);
        diag.output = diag.output.saturating_add(parsed.output);
        diag.total = diag.total.saturating_add(parsed.total);

        if let Some(ref d) = parsed.first_local_date {
            if diag.min_date.as_ref().map_or(true, |m| d < m) {
                diag.min_date = Some(d.clone());
            }
        }
        if let Some(ref d) = parsed.last_local_date {
            if diag.max_date.as_ref().map_or(true, |m| d > m) {
                diag.max_date = Some(d.clone());
            }
        }

        let record = build_session_record(
            item.session_id,
            &spec.source,
            &metadata_source,
            parsed,
            &subagent_links,
            &app_meta,
            &cli_meta,
        );

        sessions.push(record);
    }

    // Inherit parent workspace/project for subagents without a direct workspace
    inherit_parent_workspaces(&mut sessions);

    // Fallback: if a subagent's parent had no transcript (not in `sessions`) but exists in metadata
    for sess in &mut sessions {
        if sess.kind == SessionKind::Subagent && sess.workspace.is_empty() {
            if let Some(ref pid) = sess.parent_id {
                if let Some(am) = app_meta.get(pid) {
                    if !am.workspace.is_empty() || am.project != "Unattributed" {
                        sess.workspace = am.workspace.clone();
                        sess.project = am.project.clone();
                    }
                } else if let Some(cm) = cli_meta.get(pid) {
                    if !cm.workspace.is_empty() || cm.project != "Unattributed" {
                        sess.workspace = cm.workspace.clone();
                        sess.project = cm.project.clone();
                    }
                }
            }
        }
    }

    for sess in &sessions {
        if sess.label_source == "App conversation database" || sess.label_source == "CLI history" {
            diag.titles_matched += 1;
        }
        if sess.project != "Unattributed" {
            diag.projects_matched += 1;
        }
    }

    // Scan `<parent_root>/conversations/*.pb` for binary-only sessions without readable transcripts
    if let Some(parent_root) = root.parent() {
        let conv_dir = parent_root.join("conversations");
        if conv_dir.is_dir() {
            if let Ok(entries) = fs::read_dir(&conv_dir) {
                let mut pb_stems: Vec<String> = entries
                    .flatten()
                    .filter_map(|e| {
                        let p = e.path();
                        if p.extension().and_then(|ext| ext.to_str()) == Some("pb") {
                            p.file_stem()
                                .and_then(|s| s.to_str())
                                .map(|s| s.to_string())
                        } else {
                            None
                        }
                    })
                    .filter(|stem| !readable_ids.contains(stem))
                    .collect();
                pb_stems.sort();
                pb_stems.dedup();
                diag.pb_only_stems = pb_stems;
            }
        }
    }

    (sessions, diag)
}

fn build_session_record(
    session_id: String,
    source: &SourceKind,
    metadata_source: &str,
    parsed: ParsedTranscript,
    subagent_links: &HashMap<String, SubagentLink>,
    app_meta: &HashMap<String, AppSessionMeta>,
    cli_meta: &HashMap<String, CliSessionMeta>,
) -> SessionRecord {
    let short_id: String = session_id.chars().take(8).collect();
    let sub_link = subagent_links.get(&session_id);
    let app_entry = app_meta.get(&session_id);
    let cli_entry = cli_meta.get(&session_id);

    // 1. Subagent & parent resolution (subagents/*.json -> app_meta.parent_id)
    let mut parent_id = sub_link.map(|l| l.parent_id.clone());
    let agent_type = sub_link.map(|l| l.agent_type.clone());
    let role = sub_link.map(|l| l.role.clone());

    if parent_id.is_none() {
        parent_id = app_entry.and_then(|a| a.parent_id.clone());
    }

    let kind = if parent_id.is_some() {
        SessionKind::Subagent
    } else {
        SessionKind::Main
    };

    // 2. Title & workspace resolution (App DB -> CLI history -> Subagent label -> Untitled)
    let mut title: Option<String> = None;
    let mut is_untitled = false;
    let mut label_source = "None".to_string();
    let mut workspace = String::new();
    let mut project = "Unattributed".to_string();

    if let Some(am) = app_entry {
        if let Some(ref t) = am.title {
            title = Some(t.clone());
            label_source = "App conversation database".to_string();
        }
        if !am.workspace.is_empty() || am.project != "Unattributed" {
            workspace = am.workspace.clone();
            project = am.project.clone();
        }
    }

    if let Some(cm) = cli_entry {
        if title.is_none() {
            if let Some(ref t) = cm.title {
                title = Some(t.clone());
                label_source = "CLI history".to_string();
            }
        }
        if workspace.is_empty() && (!cm.workspace.is_empty() || cm.project != "Unattributed") {
            workspace = cm.workspace.clone();
            project = cm.project.clone();
        }
    }

    let final_title = match title {
        Some(t) => t,
        None => {
            if kind == SessionKind::Subagent {
                let atype = agent_type.as_deref().unwrap_or("subagent");
                let r = role.as_deref().unwrap_or("").trim();
                label_source = "Subagent descriptor".to_string();
                if r.is_empty() && atype == "subagent" {
                    "Subagent".to_string()
                } else if r.is_empty() {
                    format!("[{atype}]")
                } else {
                    format!("[{atype}] {r}")
                }
            } else {
                is_untitled = true;
                "Untitled session".to_string()
            }
        }
    };

    SessionRecord {
        session_id,
        short_id,
        source: source.clone(),
        kind,
        title: final_title,
        is_untitled,
        label_source,
        project,
        workspace,
        parent_id,
        agent_type,
        role,
        first_utc: parsed.first_utc,
        last_utc: parsed.last_utc,
        first_local_date: parsed.first_local_date,
        last_local_date: parsed.last_local_date,
        duration_secs: parsed.duration_secs,
        calls: parsed.calls,
        step_count: parsed.step_count,
        fresh_in: parsed.fresh_in,
        cached: parsed.cached,
        output: parsed.output,
        total: parsed.total,
        thinking_steps: parsed.thinking_steps,
        error_steps: parsed.error_steps,
        tool_call_count: parsed.tool_call_count,
        tool_names: parsed.tool_names,
        transcript_path: parsed.transcript_path,
        metadata_source: metadata_source.to_string(),
        steps: parsed.steps,
        command_execs: parsed.command_execs,
    }
}

fn verify_scan_consistency(sessions: &[SessionRecord]) -> ConsistencyReport {
    let mut session_row_mismatches = 0u64;
    let mut session_total = 0u64;
    let mut daily_total = 0u64;

    for s in sessions {
        if s.total != s.fresh_in.saturating_add(s.cached).saturating_add(s.output) {
            session_row_mismatches += 1;
        }
        session_total = session_total.saturating_add(s.total);
        for step in &s.steps {
            if step.has_tokens && step.local_date.is_some() {
                daily_total = daily_total.saturating_add(step.total);
            }
        }
    }

    let discrepancy = session_total as i64 - daily_total as i64;
    let ok = session_row_mismatches == 0 && discrepancy == 0;
    let message = if ok {
        format!("Consistent: {session_total} tokens across sessions and daily buckets.")
    } else {
        format!(
            "Discrepancy detected: session_total={session_total}, daily_total={daily_total}, row_mismatches={session_row_mismatches}"
        )
    };

    ConsistencyReport {
        ok,
        session_row_mismatches,
        daily_row_mismatches: 0,
        session_total,
        daily_total,
        discrepancy,
        message,
    }
}
