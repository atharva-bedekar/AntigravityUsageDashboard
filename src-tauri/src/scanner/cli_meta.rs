use std::collections::HashMap;
use std::fs::File;
use std::io::{BufRead, BufReader};
use std::path::Path;

use serde_json::Value;

use crate::scanner::app_meta::{derive_project_name, parse_workspace_uri};
use crate::scanner::transcript::{collapse_whitespace, truncate_chars};

/// Metadata for a single conversation extracted from `history.jsonl`.
#[derive(Debug, Clone, Default)]
pub struct CliSessionMeta {
    pub title: Option<String>,
    pub workspace: String,
    pub project: String,
}

/// Optional settings extracted from `<cli_root>/settings.json`.
#[derive(Debug, Clone, Default)]
pub struct CliSettingsMeta {
    pub model: Option<String>,
}

/// Load session titles and workspaces from `<cli_brain_root>/../history.jsonl` (read-only).
pub fn load_cli_history(cli_brain_root: &Path) -> (HashMap<String, CliSessionMeta>, Vec<String>) {
    let mut out: HashMap<String, CliSessionMeta> = HashMap::new();
    let mut warnings = Vec::new();

    let hist_path = match cli_brain_root.parent() {
        Some(p) => p.join("history.jsonl"),
        None => return (out, warnings),
    };

    if !hist_path.is_file() {
        return (out, warnings);
    }

    let file = match File::open(&hist_path) {
        Ok(f) => f,
        Err(e) => {
            warnings.push(format!("Could not open {}: {e}", hist_path.display()));
            return (out, warnings);
        }
    };

    let mut reader = BufReader::with_capacity(64 * 1024, file);
    let mut raw_buf = Vec::with_capacity(2048);

    loop {
        raw_buf.clear();
        match reader.read_until(b'\n', &mut raw_buf) {
            Ok(0) => break,
            Ok(_) => {}
            Err(e) => {
                warnings.push(format!("Error reading {}: {e}", hist_path.display()));
                break;
            }
        }

        let line = String::from_utf8_lossy(&raw_buf);
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }

        let obj: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(_) => continue,
        };

        let cid = match obj.get("conversationId").and_then(|v| v.as_str()) {
            Some(c) if !c.trim().is_empty() => c.trim().to_string(),
            _ => continue,
        };

        let entry = out.entry(cid).or_insert_with(|| CliSessionMeta {
            title: None,
            workspace: String::new(),
            project: "Unattributed".to_string(),
        });

        if entry.title.is_none() {
            if let Some(display) = obj.get("display").and_then(|v| v.as_str()) {
                let collapsed = collapse_whitespace(display);
                if !collapsed.is_empty() {
                    entry.title = Some(truncate_chars(&collapsed, 80));
                }
            }
        }

        if entry.workspace.is_empty() {
            if let Some(ws) = obj.get("workspace").and_then(|v| v.as_str()) {
                let ws_trimmed = ws.trim();
                if !ws_trimmed.is_empty() {
                    let (normalized, project) = if ws_trimmed.starts_with("file://") {
                        parse_workspace_uri(ws_trimmed)
                    } else {
                        let norm = ws_trimmed.replace('/', "\\");
                        let proj = derive_project_name(&norm);
                        (norm, proj)
                    };
                    if !normalized.is_empty() {
                        entry.workspace = normalized;
                        entry.project = project;
                    }
                }
            }
        }
    }

    (out, warnings)
}

/// Load optional CLI settings from `<cli_brain_root>/../settings.json` (read-only).
pub fn load_cli_settings(cli_brain_root: &Path) -> CliSettingsMeta {
    let settings_path = match cli_brain_root.parent() {
        Some(p) => p.join("settings.json"),
        None => return CliSettingsMeta::default(),
    };

    let Ok(bytes) = std::fs::read(&settings_path) else {
        return CliSettingsMeta::default();
    };
    let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
        return CliSettingsMeta::default();
    };

    let model = val
        .get("model")
        .and_then(|v| v.as_str())
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty());

    CliSettingsMeta { model }
}
