use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::Path;

use serde_json::Value;

use crate::models::{SessionKind, SessionRecord, SubagentLink};

/// Scan `<brain_root>/<parentId>/.system_generated/subagents/*.json` for subagent descriptors.
/// Strictly read-only.
pub fn load_subagent_links(brain_root: &Path) -> HashMap<String, SubagentLink> {
    let mut links = HashMap::new();
    let Ok(entries) = fs::read_dir(brain_root) else {
        return links;
    };

    for entry in entries.flatten() {
        let parent_dir = entry.path();
        if !parent_dir.is_dir() {
            continue;
        }
        let Some(parent_id) = parent_dir
            .file_name()
            .and_then(|n| n.to_str())
            .map(|s| s.to_string())
        else {
            continue;
        };

        let sub_dir = parent_dir.join(".system_generated").join("subagents");
        if !sub_dir.is_dir() {
            continue;
        }

        let Ok(sub_entries) = fs::read_dir(&sub_dir) else {
            continue;
        };

        for sub_entry in sub_entries.flatten() {
            let path = sub_entry.path();
            if path.extension().and_then(|e| e.to_str()) != Some("json") {
                continue;
            }
            let Ok(bytes) = fs::read(&path) else {
                continue;
            };
            let Ok(val) = serde_json::from_slice::<Value>(&bytes) else {
                continue;
            };

            let Some(cid) = val
                .get("conversationId")
                .and_then(|v| v.as_str())
                .map(|s| s.trim().to_string())
                .filter(|s| !s.is_empty())
            else {
                continue;
            };

            let desc = val.get("subagentDescriptor");
            let agent_type = desc
                .and_then(|d| d.get("typeName"))
                .and_then(|v| v.as_str())
                .unwrap_or("subagent")
                .trim()
                .to_string();
            let role = desc
                .and_then(|d| d.get("role"))
                .and_then(|v| v.as_str())
                .unwrap_or("")
                .trim()
                .to_string();
            let spawn_step_index = val
                .get("spawnStepIndex")
                .or_else(|| val.get("spawn_step_index"))
                .and_then(|v| v.as_i64());

            links.insert(
                cid.clone(),
                SubagentLink {
                    conversation_id: cid,
                    parent_id: parent_id.clone(),
                    agent_type: if agent_type.is_empty() {
                        "subagent".to_string()
                    } else {
                        agent_type
                    },
                    role,
                    spawn_step_index,
                },
            );
        }
    }

    links
}

/// For any subagent session without a direct workspace/project, inherit `workspace` and `project`
/// from its `parent_id` ancestor (with cycle protection).
pub fn inherit_parent_workspaces(sessions: &mut [SessionRecord]) {
    let lookup: HashMap<String, (Option<String>, String, String)> = sessions
        .iter()
        .map(|s| {
            (
                s.session_id.clone(),
                (s.parent_id.clone(), s.workspace.clone(), s.project.clone()),
            )
        })
        .collect();

    for sess in sessions.iter_mut() {
        if sess.kind != SessionKind::Subagent || !sess.workspace.is_empty() {
            continue;
        }
        let mut current_parent = sess.parent_id.clone();
        let mut visited = HashSet::new();
        visited.insert(sess.session_id.clone());

        while let Some(pid) = current_parent {
            if !visited.insert(pid.clone()) {
                break;
            }
            if let Some((grandparent, ws, proj)) = lookup.get(&pid) {
                if !ws.is_empty() || proj != "Unattributed" {
                    sess.workspace = ws.clone();
                    sess.project = proj.clone();
                    break;
                }
                current_parent = grandparent.clone();
            } else {
                break;
            }
        }
    }
}
