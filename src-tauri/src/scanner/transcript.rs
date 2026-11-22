use std::collections::{HashMap, HashSet};
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use chrono::{DateTime, FixedOffset, Local};
use regex::Regex;
use serde_json::Value;

use crate::models::{CommandExecRecord, ModelSwitchRecord, StepRecord, ToolCallRecord};

const GAP_CAP_SECONDS: i64 = 4 * 3600;
const PREVIEW_MAX_CHARS: usize = 200;

fn tool_name_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| Regex::new(r"^[a-z][a-z0-9_]{0,39}$").expect("valid tool regex"))
}

fn model_switch_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"The user changed setting `Model Selection` from `?(.+?)`? to `?([^\r\n`]+)`?(?:[\r\n`]|$)")
            .expect("valid model switch regex")
    })
}

fn thinking_suffix_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\s*\((high|medium|low|minimal|max|thinking|fast|default)\)\s*$")
            .expect("valid thinking suffix regex")
    })
}

fn denial_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)permission check failed|was denied|deny rule").expect("valid denial regex")
    })
}

fn exit_code_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)command exited with code (-?\d+)").expect("valid exit code regex")
    })
}

fn cancel_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)was canceled|canceled with result").expect("valid cancel regex")
    })
}

fn stamp_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?:Created|Completed) At:\s*([0-9T:\-+.Z]{19,35})")
            .expect("valid timestamp stamp regex")
    })
}

fn plan_path_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)docs[/\\]+superpowers[/\\]+(plans|specs)[/\\]+([A-Za-z0-9._-]+\.md)")
            .expect("valid plan path regex")
    })
}

fn spawn_conv_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(
            r#"(?i)(?:\\?"?)(?:conversationId|conversation_id)(?:\\?"?)\s*[:=]\s*(?:\\?"?)([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}|[A-Za-z0-9_-]{8,})(?:\\?"?)"#,
        )
        .expect("valid spawn conversation regex")
    })
}

fn system_sender_re() -> &'static Regex {
    static RE: OnceLock<Regex> = OnceLock::new();
    RE.get_or_init(|| {
        Regex::new(r"(?i)\[Message\][^\r\n]*?\bsender=([A-Za-z0-9._-]+)")
            .expect("valid system sender regex")
    })
}

/// Locate the preferred transcript file inside a session directory (`transcript_full.jsonl` > `transcript.jsonl`).
pub fn find_transcript_file(session_dir: &Path) -> Option<PathBuf> {
    let logs_dir = session_dir.join(".system_generated").join("logs");
    let full = logs_dir.join("transcript_full.jsonl");
    if full.is_file() {
        return Some(full);
    }
    let plain = logs_dir.join("transcript.jsonl");
    if plain.is_file() {
        return Some(plain);
    }
    None
}

/// Result of streaming and parsing a single session's transcript JSONL file.
#[derive(Debug, Default)]
pub struct ParsedTranscript {
    pub transcript_path: String,
    pub calls: u64,
    pub step_count: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub thinking_steps: u64,
    pub error_steps: u64,
    pub tool_call_count: u64,
    pub tool_names: Vec<String>,
    pub first_utc: Option<String>,
    pub last_utc: Option<String>,
    pub first_local_date: Option<String>,
    pub last_local_date: Option<String>,
    pub duration_secs: u64,
    pub parse_errors: u64,
    pub corrupted_tool_names_dropped: u64,
    pub capped_step_gaps: u64,
    pub steps: Vec<StepRecord>,
    pub command_execs: Vec<CommandExecRecord>,
    pub written_plan_paths: Vec<String>,
    pub referenced_plan_paths: Vec<String>,
    pub spawned_conversations: HashMap<String, i64>,
    pub message_turns: HashMap<String, u64>,
}

#[derive(Debug, Clone)]
struct PendingCommand {
    step_index: i64,
    command_line: String,
    tool_summary: Option<String>,
}

/// Parse an ISO-8601 timestamp string into a fixed-offset DateTime.
pub(crate) fn parse_iso_ts(raw: &str) -> Option<DateTime<FixedOffset>> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return None;
    }
    DateTime::parse_from_rfc3339(trimmed).ok().or_else(|| {
        DateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%.f%z")
            .ok()
            .or_else(|| DateTime::parse_from_str(trimmed, "%Y-%m-%dT%H:%M:%S%z").ok())
    })
}

/// Truncate a string to at most `max_chars` Unicode scalar values, appending an ellipsis if truncated.
pub fn truncate_chars(s: &str, max_chars: usize) -> String {
    let mut chars = s.chars();
    let collected: String = chars.by_ref().take(max_chars).collect();
    if chars.next().is_some() {
        format!("{collected}…")
    } else {
        collected
    }
}

/// Collapse internal whitespace and trim ends.
pub fn collapse_whitespace(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn trim_model_raw(raw: &str) -> &str {
    let first_sentence = raw.split(". ").next().unwrap_or(raw);
    first_sentence.trim().trim_matches('`').trim()
}

fn is_valid_model_name(raw: &str) -> bool {
    let trimmed = trim_model_raw(raw);
    if trimmed.is_empty() || trimmed.eq_ignore_ascii_case("none") {
        return false;
    }
    if !trimmed.chars().next().is_some_and(|c| c.is_ascii_alphanumeric()) {
        return false;
    }
    if trimmed.contains("(.") || trimmed.contains(".)") {
        return false;
    }
    !trimmed.chars().any(|c| {
        matches!(
            c,
            '?' | '*'
                | '+'
                | '['
                | ']'
                | '\\'
                | '{'
                | '}'
                | '^'
                | '$'
                | '|'
                | '<'
                | '>'
                | '='
                | ';'
                | '"'
                | '\''
                | '`'
        )
    })
}

fn clean_model_name(raw: &str) -> String {
    let mut trimmed = trim_model_raw(raw);
    while let Some(m) = thinking_suffix_re().find(trimmed) {
        trimmed = trimmed[..m.start()].trim();
    }
    truncate_chars(trimmed, 60)
}

fn is_tool_or_command_step(type_upper: &str) -> bool {
    matches!(
        type_upper,
        "RUN_COMMAND"
            | "COMMAND_STATUS"
            | "SEND_COMMAND_INPUT"
            | "READ_TERMINAL"
            | "VIEW_FILE"
            | "VIEW_FILE_OUTLINE"
            | "VIEW_CODE_ITEM"
            | "GREP_SEARCH"
            | "FIND_BY_NAME"
            | "LIST_DIR"
            | "WRITE_TO_FILE"
            | "REPLACE_FILE_CONTENT"
            | "MULTI_REPLACE_FILE_CONTENT"
            | "CALL_MCP_TOOL"
            | "TOOL_CALL"
            | "TOOL_OUTPUT"
            | "TOOL_RESULT"
    )
}

fn extract_model_switch(
    step_index: i64,
    content: &str,
    type_upper: &str,
) -> Option<ModelSwitchRecord> {
    if content.is_empty() || is_tool_or_command_step(type_upper) {
        return None;
    }
    let caps = model_switch_re().captures(content)?;
    let raw_from = caps.get(1).map_or("", |m| m.as_str());
    let raw_to = caps.get(2).map_or("", |m| m.as_str());

    let from_trimmed = trim_model_raw(raw_from);
    let from_ok = from_trimmed.is_empty()
        || from_trimmed.eq_ignore_ascii_case("none")
        || is_valid_model_name(raw_from);
    if !from_ok || !is_valid_model_name(raw_to) {
        return None;
    }

    let from_model = clean_model_name(raw_from);
    let to_model = clean_model_name(raw_to);
    if to_model.is_empty() || to_model.eq_ignore_ascii_case("none") {
        return None;
    }

    Some(ModelSwitchRecord {
        step_index,
        from_model,
        to_model,
    })
}

fn normalize_model_label(raw: &str) -> String {
    let cleaned = clean_model_name(raw);
    if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("none") {
        "Unrecorded".to_string()
    } else {
        cleaned
    }
}

fn is_effort_or_mode_token(tok: &str) -> bool {
    matches!(
        tok.to_ascii_lowercase().as_str(),
        "high" | "medium" | "low" | "minimal" | "max" | "thinking" | "fast" | "default"
    )
}

pub fn normalize_model_slug(raw: &str) -> Option<String> {
    if !is_valid_model_name(raw) {
        return None;
    }
    let trimmed = trim_model_raw(raw);
    if trimmed.contains('-') && !trimmed.contains(' ') {
        let mut tokens: Vec<&str> = trimmed
            .split('-')
            .filter(|t| !t.is_empty() && !t.eq_ignore_ascii_case("tiered"))
            .collect();
        while tokens
            .last()
            .is_some_and(|t| is_effort_or_mode_token(t))
        {
            tokens.pop();
        }
        if tokens.is_empty() {
            return None;
        }
        let formatted: Vec<String> = tokens
            .into_iter()
            .map(|tok| {
                let mut chars = tok.chars();
                if let Some(first) = chars.next() {
                    if first.is_ascii_alphabetic() {
                        let mut out = String::with_capacity(tok.len());
                        out.push(first.to_ascii_uppercase());
                        for c in chars {
                            out.push(c.to_ascii_lowercase());
                        }
                        return out;
                    }
                }
                tok.to_string()
            })
            .collect();
        Some(truncate_chars(&formatted.join(" "), 60))
    } else {
        let cleaned = clean_model_name(trimmed);
        if cleaned.is_empty() || cleaned.eq_ignore_ascii_case("none") {
            None
        } else {
            Some(cleaned)
        }
    }
}

fn assign_observed_models(steps: &mut [StepRecord], explicit_models: &[Option<String>]) {
    let mut current_switch_model = steps
        .iter()
        .find_map(|s| s.model_switch.as_ref())
        .map(|sw| normalize_model_label(&sw.from_model))
        .unwrap_or_else(|| "Unrecorded".to_string());
    let mut last_explicit_model: Option<String> = None;

    for (step, explicit) in steps.iter_mut().zip(explicit_models.iter()) {
        if let Some(sw) = &step.model_switch {
            current_switch_model = normalize_model_label(&sw.to_model);
        }
        if let Some(m) = explicit {
            step.observed_model = m.clone();
            last_explicit_model = Some(m.clone());
        } else if current_switch_model != "Unrecorded" {
            step.observed_model = current_switch_model.clone();
        } else if let Some(prev) = &last_explicit_model {
            step.observed_model = prev.clone();
        } else {
            step.observed_model = "Unrecorded".to_string();
        }
    }
}

pub fn extract_plan_paths_from_text(text: &str) -> Vec<String> {
    let normalized = text.replace('\\', "/");
    let mut out = Vec::new();
    for caps in plan_path_re().captures_iter(&normalized) {
        let Some(kind) = caps.get(1).map(|m| m.as_str()) else {
            continue;
        };
        let Some(file) = caps.get(2).map(|m| m.as_str()) else {
            continue;
        };
        let file_lower = file.to_ascii_lowercase();
        if file_lower.starts_with("yyyy-mm-dd")
            || file.contains('<')
            || file.contains('>')
            || file.contains('{')
            || file.contains('}')
        {
            continue;
        }
        let kind_lower = kind.to_ascii_lowercase();
        out.push(format!("docs/superpowers/{kind_lower}/{file_lower}"));
    }
    out
}

fn extract_arg_string(val: &Value) -> Option<String> {
    let s = val.as_str()?;
    if let Ok(unwrapped) = serde_json::from_str::<String>(s) {
        return Some(unwrapped.replace("\\\\", "\\"));
    }
    Some(s.replace("\\\\", "\\"))
}

fn parse_command_completion(content: &str) -> Option<(f64, Option<i32>, bool)> {
    if !content.contains("Completed At") {
        return None;
    }
    let cancelled = cancel_re().is_match(content);
    let exit_code = exit_code_re()
        .captures(content)
        .and_then(|c| c.get(1))
        .and_then(|m| m.as_str().parse::<i32>().ok());

    if !cancelled && exit_code.is_none() {
        return None;
    }

    let stamps: Vec<DateTime<FixedOffset>> = stamp_re()
        .captures_iter(content)
        .filter_map(|c| c.get(1).and_then(|m| parse_iso_ts(m.as_str())))
        .collect();

    if stamps.len() < 2 {
        return None;
    }

    let start = stamps.first()?;
    let end = stamps.last()?;
    let dur_ms = (*end - *start).num_milliseconds();
    let dur_secs = dur_ms as f64 / 1000.0;
    if dur_secs < 0.0 || dur_secs > GAP_CAP_SECONDS as f64 {
        return None;
    }

    Some((dur_secs, if cancelled { None } else { exit_code }, cancelled))
}

fn extract_u64_token(val: Option<&Value>) -> Option<u64> {
    let v = val?;
    if let Some(u) = v.as_u64() {
        Some(u)
    } else if let Some(i) = v.as_i64() {
        if i >= 0 {
            Some(i as u64)
        } else {
            None
        }
    } else {
        None
    }
}

/// Stream and parse a `transcript*.jsonl` file into a `ParsedTranscript`.
/// Strictly read-only.
pub fn parse_transcript_file(path: &Path) -> std::io::Result<ParsedTranscript> {
    let file = File::open(path)?;
    let mut reader = BufReader::with_capacity(64 * 1024, file);
    parse_transcript_reader(&mut reader, path.to_string_lossy().into_owned())
}

/// Stream and parse any `BufRead` containing JSONL transcript lines.
pub fn parse_transcript_reader<R: BufRead>(
    reader: &mut R,
    transcript_path: String,
) -> std::io::Result<ParsedTranscript> {
    let mut out = ParsedTranscript {
        transcript_path,
        ..Default::default()
    };

    let mut unique_tools: HashSet<String> = HashSet::new();
    let mut pending_cmds: Vec<PendingCommand> = Vec::new();
    let mut explicit_models: Vec<Option<String>> = Vec::new();
    let mut written_set: HashSet<String> = HashSet::new();
    let mut referenced_set: HashSet<String> = HashSet::new();
    let mut first_dt: Option<DateTime<FixedOffset>> = None;
    let mut last_dt: Option<DateTime<FixedOffset>> = None;
    let mut prev_step_dt: Option<DateTime<FixedOffset>> = None;

    let mut raw_buf = Vec::with_capacity(4096);
    let mut line_seq: i64 = 0;

    loop {
        raw_buf.clear();
        let bytes_read = reader.read_until(b'\n', &mut raw_buf)?;
        if bytes_read == 0 {
            break;
        }

        let line_cow = String::from_utf8_lossy(&raw_buf);
        let trimmed = line_cow.trim();
        if trimmed.is_empty() {
            continue;
        }

        let obj: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => {
                out.parse_errors += 1;
                continue;
            }
        };

        out.step_count += 1;
        let step_index = obj
            .get("step_index")
            .and_then(|v| v.as_i64())
            .unwrap_or(line_seq);
        line_seq += 1;

        let created_at_str = obj
            .get("created_at")
            .and_then(|v| v.as_str())
            .map(|s| s.to_string());
        let parsed_dt = created_at_str.as_deref().and_then(parse_iso_ts);

        let (local_date, local_time) = if let Some(dt) = parsed_dt {
            let local = dt.with_timezone(&Local);
            let date_str = local.format("%Y-%m-%d").to_string();
            let time_str = local.format("%H:%M").to_string();

            if first_dt.map_or(true, |f| dt < f) {
                first_dt = Some(dt);
                out.first_utc = Some(dt.to_rfc3339());
                out.first_local_date = Some(date_str.clone());
            }
            if last_dt.map_or(true, |l| dt > l) {
                last_dt = Some(dt);
                out.last_utc = Some(dt.to_rfc3339());
                out.last_local_date = Some(date_str.clone());
            }

            if let Some(prev) = prev_step_dt {
                let gap = (dt - prev).num_seconds();
                if gap > GAP_CAP_SECONDS {
                    out.capped_step_gaps += 1;
                }
            }
            prev_step_dt = Some(dt);

            (Some(date_str), Some(time_str))
        } else {
            (None, None)
        };

        let step_type = obj
            .get("type")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let source = obj
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        let status = obj
            .get("status")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();

        let status_upper = status.to_ascii_uppercase();
        let type_upper = step_type.to_ascii_uppercase();
        let is_error = matches!(status_upper.as_str(), "ERROR" | "INVALID" | "FAILED")
            || type_upper == "ERROR_MESSAGE";
        if is_error {
            out.error_steps += 1;
        }

        // Token fields: `input_tokens` must be an integer to count as a token-bearing model step.
        let (fresh_in, cached, output, total, has_tokens) =
            if let Some(fresh) = extract_u64_token(obj.get("input_tokens")) {
                let c = extract_u64_token(obj.get("cache_read_tokens")).unwrap_or(0);
                let o = extract_u64_token(obj.get("output_tokens")).unwrap_or(0);
                let t = fresh.saturating_add(c).saturating_add(o);
                out.calls += 1;
                out.fresh_in = out.fresh_in.saturating_add(fresh);
                out.cached = out.cached.saturating_add(c);
                out.output = out.output.saturating_add(o);
                out.total = out.total.saturating_add(t);
                (fresh, c, o, t, true)
            } else {
                (0, 0, 0, 0, false)
            };

        // Thinking text
        let (thinking_preview, thinking_full) = match obj.get("thinking").and_then(|v| v.as_str()) {
            Some(t) if !t.trim().is_empty() => {
                out.thinking_steps += 1;
                let preview = truncate_chars(&collapse_whitespace(t), PREVIEW_MAX_CHARS);
                (Some(preview), Some(t.to_string()))
            }
            _ => (None, None),
        };

        // Content text, model switches, permission denials, and command completion stamps
        let content_str = obj.get("content").and_then(|v| v.as_str()).unwrap_or("");
        let content_preview = if !content_str.trim().is_empty() {
            Some(truncate_chars(&collapse_whitespace(content_str), PREVIEW_MAX_CHARS))
        } else {
            None
        };

        let permission_denied = !content_str.is_empty() && denial_re().is_match(content_str);

        let model_switch = extract_model_switch(step_index, content_str, &type_upper);
        let explicit_model = if type_upper == "PLANNER_RESPONSE" {
            obj.get("model")
                .and_then(|v| v.as_str())
                .and_then(normalize_model_slug)
        } else {
            None
        };

        if type_upper == "GENERIC" {
            for caps in spawn_conv_re().captures_iter(content_str) {
                if let Some(m) = caps.get(1) {
                    let cid = m.as_str();
                    if !matches!(
                        cid.to_ascii_lowercase().as_str(),
                        "undefined"
                            | "nullable"
                            | "required"
                            | "optional"
                            | "conversation"
                            | "conversationid"
                    ) {
                        out.spawned_conversations
                            .entry(cid.to_string())
                            .or_insert(step_index);
                    }
                }
            }
        } else if type_upper == "SYSTEM_MESSAGE" {
            for caps in system_sender_re().captures_iter(content_str) {
                if let Some(m) = caps.get(1) {
                    *out.message_turns.entry(m.as_str().to_string()).or_insert(0) += 1;
                }
            }
        } else if type_upper == "USER_INPUT" || type_upper == "PLANNER_RESPONSE" {
            for p in extract_plan_paths_from_text(content_str) {
                referenced_set.insert(p);
            }
        }

        // Sanitize tool calls
        let mut step_tool_calls = Vec::new();
        let mut step_pending_cmds = Vec::new();
        if let Some(arr) = obj.get("tool_calls").and_then(|v| v.as_array()) {
            for tc in arr {
                let raw_name = match tc.get("name").and_then(|v| v.as_str()) {
                    Some(n) => n,
                    None => {
                        out.corrupted_tool_names_dropped += 1;
                        continue;
                    }
                };
                if !tool_name_re().is_match(raw_name) {
                    out.corrupted_tool_names_dropped += 1;
                    continue;
                }

                let parsed_args: Option<Value> = match tc.get("args") {
                    Some(Value::String(s)) => serde_json::from_str::<Value>(s).ok(),
                    _ => None,
                };
                let args = parsed_args.as_ref().or_else(|| tc.get("args"));

                if type_upper == "PLANNER_RESPONSE" {
                    if matches!(
                        raw_name,
                        "write_file"
                            | "write_to_file"
                            | "edit_file"
                            | "replace_file_content"
                            | "multi_replace_file_content"
                    ) {
                        for key in ["Path", "TargetFile", "path", "filePath"] {
                            if let Some(val_str) = args.and_then(|a| a.get(key)).and_then(extract_arg_string) {
                                for p in extract_plan_paths_from_text(&val_str) {
                                    written_set.insert(p);
                                }
                            }
                        }
                    } else if matches!(raw_name, "read_file" | "view_file") {
                        for key in ["Path", "AbsolutePath", "path"] {
                            if let Some(val_str) = args.and_then(|a| a.get(key)).and_then(extract_arg_string) {
                                for p in extract_plan_paths_from_text(&val_str) {
                                    referenced_set.insert(p);
                                }
                            }
                        }
                    } else if raw_name == "send_message" {
                        if let Some(recipient) = args
                            .and_then(|a| a.get("Recipient").or_else(|| a.get("recipient")))
                            .and_then(extract_arg_string)
                        {
                            let trimmed_rec = recipient.trim();
                            if !trimmed_rec.is_empty() {
                                *out.message_turns.entry(trimmed_rec.to_string()).or_insert(0) += 1;
                            }
                        }
                    }
                }
                let server_name = if raw_name == "call_mcp_tool" {
                    args.and_then(|a| a.get("ServerName"))
                        .and_then(|v| v.as_str())
                        .map(|s| s.to_string())
                } else {
                    None
                };

                let command_line = if raw_name == "run_command" {
                    args.and_then(|a| a.get("CommandLine"))
                        .and_then(|v| v.as_str())
                        .map(|s| truncate_chars(s, 300))
                } else {
                    None
                };

                let tool_summary = args
                    .and_then(|a| a.get("toolSummary").or_else(|| a.get("toolAction")))
                    .and_then(|v| v.as_str())
                    .map(|s| truncate_chars(s, 160));

                if raw_name == "run_command" {
                    if let Some(ref cmd) = command_line {
                        if !cmd.is_empty() {
                            step_pending_cmds.push(PendingCommand {
                                step_index,
                                command_line: cmd.clone(),
                                tool_summary: tool_summary.clone(),
                            });
                        }
                    }
                }

                unique_tools.insert(raw_name.to_string());
                out.tool_call_count += 1;
                step_tool_calls.push(ToolCallRecord {
                    name: raw_name.to_string(),
                    server_name,
                    command_line,
                    tool_summary,
                });
            }
        }

        // Pair command completion stamps only with an immediately preceding `run_command` step.
        let mut command_duration_secs = None;
        let mut command_exit_code = None;
        if !step_pending_cmds.is_empty() {
            pending_cmds = step_pending_cmds;
        } else if !pending_cmds.is_empty() {
            if permission_denied {
                pending_cmds.clear();
            } else if let Some((dur, code, cancelled)) = parse_command_completion(content_str) {
                command_duration_secs = Some(dur);
                command_exit_code = code;
                if let Some(cmd) = pending_cmds.first() {
                    out.command_execs.push(CommandExecRecord {
                        step_index: cmd.step_index,
                        command_line: cmd.command_line.clone(),
                        tool_summary: cmd.tool_summary.clone(),
                        duration_secs: Some(dur),
                        exit_code: code,
                        cancelled,
                    });
                }
                pending_cmds.clear();
            } else {
                pending_cmds.clear();
            }
        }

        explicit_models.push(explicit_model);
        out.steps.push(StepRecord {
            step_index,
            created_at: created_at_str,
            local_date,
            local_time,
            step_type,
            source,
            status,
            fresh_in,
            cached,
            output,
            total,
            has_tokens,
            thinking_preview,
            thinking_full,
            content_preview,
            tool_calls: step_tool_calls,
            is_error,
            permission_denied,
            model_switch,
            observed_model: String::new(),
            command_duration_secs,
            command_exit_code,
        });
    }

    assign_observed_models(&mut out.steps, &explicit_models);

    let mut written_plan_paths: Vec<String> = written_set.iter().cloned().collect();
    written_plan_paths.sort();
    out.written_plan_paths = written_plan_paths;

    let mut referenced_plan_paths: Vec<String> = referenced_set
        .into_iter()
        .filter(|p| !written_set.contains(p))
        .collect();
    referenced_plan_paths.sort();
    out.referenced_plan_paths = referenced_plan_paths;

    if let (Some(f), Some(l)) = (first_dt, last_dt) {
        let secs = (l - f).num_seconds();
        out.duration_secs = if secs > 0 { secs as u64 } else { 0 };
    }

    let mut tools: Vec<String> = unique_tools.into_iter().collect();
    tools.sort();
    out.tool_names = tools;

    Ok(out)
}
