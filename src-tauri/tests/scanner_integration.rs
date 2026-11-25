use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicU64, Ordering};

use rusqlite::Connection;

use antigravity_usage_lib::models::{
    AppConfig, DisplayConfig, FxConfig, RefreshConfig, SessionKind, SourceKind, SubscriptionConfig,
};
use antigravity_usage_lib::scanner::app_meta::{load_app_metadata, parse_workspace_uri};
use antigravity_usage_lib::scanner::scan_all_sources;
use antigravity_usage_lib::scanner::transcript::{find_transcript_file, parse_transcript_reader};

static TEST_DIR_SEQ: AtomicU64 = AtomicU64::new(0);

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(prefix: &str) -> Self {
        let id = TEST_DIR_SEQ.fetch_add(1, Ordering::Relaxed);
        let path = std::env::temp_dir().join(format!(
            "agy_scanner_test_{prefix}_{}_{}",
            std::process::id(),
            id
        ));
        let _ = fs::remove_dir_all(&path);
        fs::create_dir_all(&path).expect("create temp dir");
        Self { path }
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn default_test_config(app_brain: &PathBuf, cli_brain: &PathBuf) -> AppConfig {
    AppConfig {
        app_brain_root: app_brain.to_string_lossy().into_owned(),
        app_enabled: true,
        read_app_sqlite: true,
        cli_brain_root: cli_brain.to_string_lossy().into_owned(),
        cli_enabled: true,
        custom_sources: Vec::new(),
        db_path: String::new(),
        pricing_path: None,
        default_model_id: "gemini-3.8-flash".to_string(),
        reporting_currency: "INR".to_string(),
        fx: FxConfig { usd_inr: 88.0 },
        subscription: SubscriptionConfig {
            amount: 0.0,
            currency: "INR".to_string(),
            period_days: 30,
            label: String::new(),
        },
        display: DisplayConfig {
            theme: "light".to_string(),
            density: "comfortable".to_string(),
            number_format: "compact".to_string(),
            week_start: "monday".to_string(),
            reduced_motion: "system".to_string(),
        },
        refresh: RefreshConfig {
            interval_minutes: 0,
            file_watcher_enabled: false,
        },
    }
}

#[test]
fn transcript_parser_handles_tokens_corrupt_tools_stamps_and_switches() {
    let huge_corrupt_tool = "x".repeat(2048);
    let jsonl = format!(
        concat!(
            "{{\"step_index\":0,\"type\":\"USER_INPUT\",\"source\":\"USER_EXPLICIT\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"content\":\"Hello\"}}\n",
            "{{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":1000,\"cache_read_tokens\":9000,\"output_tokens\":250,\"thinking\":\"Let me check the files.\",\"content\":\"The user changed setting `Model Selection` from `Gemini 3.8 Flash` to `Gemini 4 Argon`\\nRunning command.\",\"tool_calls\":[{{\"name\":\"run_command\",\"args\":{{\"CommandLine\":\"cargo test\",\"toolSummary\":\"Run tests\"}}}},{{\"name\":\"call_mcp_tool\",\"args\":{{\"ServerName\":\"code-review-graph\"}}}},{{\"name\":\"{corrupt}\",\"args\":{{}}}}]}}\n",
            "{{\"step_index\":2,\"type\":\"GENERIC\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:20Z\",\"content\":\"Created At: 2026-11-10T10:00:06Z\\nCompleted At: 2026-11-10T10:00:18Z\\nThe command exited with code 0.\"}}\n",
            "{{\"step_index\":3,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"ERROR\",\"created_at\":\"2026-11-10T10:01:00Z\",\"input_tokens\":500,\"cache_read_tokens\":1000,\"output_tokens\":100,\"content\":\"permission check failed for write_file\"}}\n",
            "{{\"broken_json_line\": \n",
            "{{\"step_index\":4,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T16:00:00Z\",\"input_tokens\":200,\"output_tokens\":50,\"tool_calls\":[{{\"name\":\"run_command\",\"args\":{{\"CommandLine\":\"sleep 99999\"}}}}]}}\n",
            "{{\"step_index\":5,\"type\":\"GENERIC\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T22:00:00Z\",\"content\":\"Created At: 2026-11-10T16:00:00Z\\nCompleted At: 2026-11-10T22:00:00Z\\nThe command exited with code 0.\"}}\n"
        ),
        corrupt = huge_corrupt_tool
    );

    let mut cursor = Cursor::new(jsonl.as_bytes());
    let parsed = parse_transcript_reader(&mut cursor, "synthetic/transcript_full.jsonl".to_string())
        .expect("parse synthetic transcript");

    assert_eq!(parsed.calls, 3);
    assert_eq!(parsed.step_count, 6);
    assert_eq!(parsed.parse_errors, 1);
    assert_eq!(parsed.fresh_in, 1700);
    assert_eq!(parsed.cached, 10000);
    assert_eq!(parsed.output, 400);
    assert_eq!(parsed.total, 12100);
    assert_eq!(parsed.thinking_steps, 1);
    assert_eq!(parsed.error_steps, 1);
    assert_eq!(parsed.corrupted_tool_names_dropped, 1);
    assert_eq!(parsed.tool_call_count, 3); // 2 on step 1 + 1 on step 4
    assert_eq!(
        parsed.tool_names,
        vec!["call_mcp_tool".to_string(), "run_command".to_string()]
    );
    assert_eq!(parsed.capped_step_gaps, 2); // 10:01 -> 16:00 (5h59m) and 16:00 -> 22:00 (6h)

    // Model switch extracted cleanly
    let sw = parsed.steps[1].model_switch.as_ref().expect("model switch");
    assert_eq!(sw.from_model, "Gemini 3.8 Flash");
    assert_eq!(sw.to_model, "Gemini 4 Argon");

    // Permission denial extracted
    assert!(parsed.steps[3].permission_denied);

    // First command execution (12s, exit 0) accepted; second (6h > 4h cap) rejected
    assert_eq!(parsed.command_execs.len(), 1);
    assert!((parsed.command_execs[0].duration_secs.unwrap() - 12.0).abs() < 0.01);
    assert_eq!(parsed.command_execs[0].exit_code, Some(0));
}

#[test]
fn transcript_assigns_observed_model_from_switches_and_unrecorded() {
    // 1. Transcript with switch on step 1 from Gemini 3.8 Flash -> Gemini 4 Argon
    let with_switch = concat!(
        "{\"step_index\":0,\"type\":\"USER_INPUT\",\"source\":\"USER_EXPLICIT\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"content\":\"Hello\"}\n",
        "{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"The user changed setting `Model Selection` from `Gemini 3.8 Flash` to `Gemini 4 Argon`\"}\n",
        "{\"step_index\":2,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:10Z\",\"input_tokens\":150,\"output_tokens\":30,\"content\":\"Follow up\"}\n"
    );
    let parsed_switch = parse_transcript_reader(
        &mut Cursor::new(with_switch.as_bytes()),
        "synthetic/with_switch.jsonl".to_string(),
    )
    .expect("parse with_switch");
    assert_eq!(parsed_switch.steps[0].observed_model, "Gemini 3.8 Flash");
    assert_eq!(parsed_switch.steps[1].observed_model, "Gemini 4 Argon");
    assert_eq!(parsed_switch.steps[2].observed_model, "Gemini 4 Argon");

    // 2. Transcript with switch on step 0 from None -> Claude Sonnet 4
    let from_none = concat!(
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"The user changed setting `Model Selection` from `None` to `Claude Sonnet 4`\"}\n"
    );
    let parsed_none = parse_transcript_reader(
        &mut Cursor::new(from_none.as_bytes()),
        "synthetic/from_none.jsonl".to_string(),
    )
    .expect("parse from_none");
    assert_eq!(parsed_none.steps[0].observed_model, "Claude Sonnet 4");

    // 3. Transcript with zero switch notices assigns every step "Unrecorded"
    let no_switch = concat!(
        "{\"step_index\":0,\"type\":\"USER_INPUT\",\"source\":\"USER_EXPLICIT\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"content\":\"Hello\"}\n",
        "{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"Hi\"}\n"
    );
    let parsed_no_switch = parse_transcript_reader(
        &mut Cursor::new(no_switch.as_bytes()),
        "synthetic/no_switch.jsonl".to_string(),
    )
    .expect("parse no_switch");
    assert_eq!(parsed_no_switch.steps[0].observed_model, "Unrecorded");
    assert_eq!(parsed_no_switch.steps[1].observed_model, "Unrecorded");
}

#[test]
fn transcript_file_preference_picks_full_over_plain() {
    let tmp = TempDir::new("pref");
    let logs = tmp.path.join("sess1").join(".system_generated").join("logs");
    fs::create_dir_all(&logs).unwrap();
    fs::write(logs.join("transcript.jsonl"), "{}\n").unwrap();
    assert_eq!(
        find_transcript_file(&tmp.path.join("sess1"))
            .unwrap()
            .file_name()
            .unwrap(),
        "transcript.jsonl"
    );

    fs::write(logs.join("transcript_full.jsonl"), "{}\n").unwrap();
    assert_eq!(
        find_transcript_file(&tmp.path.join("sess1"))
            .unwrap()
            .file_name()
            .unwrap(),
        "transcript_full.jsonl"
    );
}

#[test]
fn app_sqlite_metadata_reads_readonly_and_parses_uris() {
    let (ws, proj) = parse_workspace_uri(r#"["file:///d%3A/Code/AntigravityUsageDashboard"]"#);
    assert_eq!(ws, r"D:\Code\AntigravityUsageDashboard");
    assert_eq!(proj, "AntigravityUsageDashboard");

    let tmp = TempDir::new("sqlite");
    let app_root = tmp.path.join("antigravity");
    let app_brain = app_root.join("brain");
    fs::create_dir_all(&app_brain).unwrap();

    let db_path = app_root.join("conversation_summaries.db");
    {
        let conn = Connection::open(&db_path).expect("create test sqlite db");
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                workspace_uris TEXT,
                parent_conversation_id TEXT
            );
            CREATE TABLE conversation_parents (
                conversation_id TEXT PRIMARY KEY,
                parent_id TEXT
            );
            INSERT INTO conversation_summaries VALUES
                ('11111111-aaaa-bbbb-cccc-000000000001', 'Refactor scanner', '[\"file:///d%3A/Code/AntigravityUsageDashboard\"]', NULL),
                ('22222222-aaaa-bbbb-cccc-000000000002', NULL, '', '11111111-aaaa-bbbb-cccc-000000000001'),
                ('33333333-aaaa-bbbb-cccc-000000000003', '', NULL, NULL);
            INSERT INTO conversation_parents VALUES
                ('33333333-aaaa-bbbb-cccc-000000000003', '11111111-aaaa-bbbb-cccc-000000000001');",
        )
        .expect("seed sqlite rows");
    }

    let (meta, warnings) = load_app_metadata(&app_brain);
    assert!(warnings.is_empty(), "unexpected warnings: {warnings:?}");

    let s1 = meta.get("11111111-aaaa-bbbb-cccc-000000000001").unwrap();
    assert_eq!(s1.title.as_deref(), Some("Refactor scanner"));
    assert_eq!(s1.project, "AntigravityUsageDashboard");
    assert_eq!(s1.workspace, r"D:\Code\AntigravityUsageDashboard");
    assert_eq!(s1.parent_id, None);

    let s2 = meta.get("22222222-aaaa-bbbb-cccc-000000000002").unwrap();
    assert_eq!(s2.title, None);
    assert_eq!(s2.project, "Unattributed");
    assert_eq!(
        s2.parent_id.as_deref(),
        Some("11111111-aaaa-bbbb-cccc-000000000001")
    );

    let s3 = meta.get("33333333-aaaa-bbbb-cccc-000000000003").unwrap();
    assert_eq!(
        s3.parent_id.as_deref(),
        Some("11111111-aaaa-bbbb-cccc-000000000001")
    );
}

#[test]
fn multi_source_merge_and_subagent_workspace_inheritance() {
    let tmp = TempDir::new("multisource");

    // --- App root ---
    let app_root = tmp.path.join("antigravity");
    let app_brain = app_root.join("brain");
    let app_convs = app_root.join("conversations");
    fs::create_dir_all(&app_brain).unwrap();
    fs::create_dir_all(&app_convs).unwrap();

    // App DB
    let db_path = app_root.join("conversation_summaries.db");
    {
        let conn = Connection::open(&db_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE conversation_summaries (
                conversation_id TEXT PRIMARY KEY,
                title TEXT,
                workspace_uris TEXT,
                parent_conversation_id TEXT
            );
            INSERT INTO conversation_summaries VALUES
                ('app-parent-0001', 'App Parent Task', '[\"file:///d%3A/Code/AntigravityUsageDashboard\"]', NULL),
                ('app-untitled-0002', NULL, NULL, NULL);",
        )
        .unwrap();
    }

    // App parent session
    let app_p_logs = app_brain
        .join("app-parent-0001")
        .join(".system_generated")
        .join("logs");
    fs::create_dir_all(&app_p_logs).unwrap();
    fs::write(
        app_p_logs.join("transcript_full.jsonl"),
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:00Z\",\"input_tokens\":100,\"cache_read_tokens\":900,\"output_tokens\":50}\n",
    )
    .unwrap();

    // App untitled session
    let app_u_logs = app_brain
        .join("app-untitled-0002")
        .join(".system_generated")
        .join("logs");
    fs::create_dir_all(&app_u_logs).unwrap();
    fs::write(
        app_u_logs.join("transcript.jsonl"),
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T11:00:00Z\",\"input_tokens\":200,\"cache_read_tokens\":0,\"output_tokens\":25}\n",
    )
    .unwrap();

    // App .pb-only file (no transcript) + .pb with transcript
    fs::write(app_convs.join("legacy-pb-only-1.pb"), b"binary").unwrap();
    fs::write(app_convs.join("app-parent-0001.pb"), b"binary").unwrap();

    // --- CLI root ---
    let cli_root = tmp.path.join("antigravity-cli");
    let cli_brain = cli_root.join("brain");
    fs::create_dir_all(&cli_brain).unwrap();

    fs::write(
        cli_root.join("history.jsonl"),
        "{\"conversationId\":\"cli-main-0001\",\"display\":\"Fix   build   pipeline\",\"workspace\":\"D:\\\\Code\\\\MyCliRepo\"}\n",
    )
    .unwrap();

    // CLI main session with subagent descriptor
    let cli_m_dir = cli_brain.join("cli-main-0001");
    let cli_m_logs = cli_m_dir.join(".system_generated").join("logs");
    let cli_m_subs = cli_m_dir.join(".system_generated").join("subagents");
    fs::create_dir_all(&cli_m_logs).unwrap();
    fs::create_dir_all(&cli_m_subs).unwrap();
    fs::write(
        cli_m_logs.join("transcript.jsonl"),
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-11T09:00:00Z\",\"input_tokens\":300,\"cache_read_tokens\":700,\"output_tokens\":100}\n",
    )
    .unwrap();
    fs::write(
        cli_m_subs.join("sub1.json"),
        "{\"conversationId\":\"cli-sub-0001\",\"subagentDescriptor\":{\"typeName\":\"researcher\",\"role\":\"Inspect logs\"}}",
    )
    .unwrap();

    // CLI subagent session (no direct workspace in history.jsonl -> should inherit from cli-main-0001)
    let cli_s_logs = cli_brain
        .join("cli-sub-0001")
        .join(".system_generated")
        .join("logs");
    fs::create_dir_all(&cli_s_logs).unwrap();
    fs::write(
        cli_s_logs.join("transcript.jsonl"),
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-11T09:05:00Z\",\"input_tokens\":50,\"cache_read_tokens\":150,\"output_tokens\":20}\n",
    )
    .unwrap();

    // CLI empty dir without transcript
    fs::create_dir_all(cli_brain.join("cli-empty-0000")).unwrap();

    let cfg = default_test_config(&app_brain, &cli_brain);
    let result = scan_all_sources(&cfg);

    assert_eq!(result.sessions.len(), 4);
    assert!(result.diagnostics.consistency.ok);

    // Total across all 4 sessions (no double-counting):
    // fresh: 100 + 200 + 300 + 50 = 650
    // cached: 900 + 0 + 700 + 150 = 1750
    // output: 50 + 25 + 100 + 20 = 195
    // total: 2595
    let sum_total: u64 = result.sessions.iter().map(|s| s.total).sum();
    assert_eq!(sum_total, 2595);
    assert_eq!(result.diagnostics.consistency.session_total, 2595);
    assert_eq!(result.diagnostics.total_with_tokens, 4);
    assert_eq!(result.diagnostics.total_without_tokens, 1);
    assert_eq!(result.diagnostics.total_pb_only, 1);

    let app_diag = result
        .diagnostics
        .sources
        .iter()
        .find(|s| s.source == SourceKind::App)
        .unwrap();
    assert_eq!(app_diag.pb_only_stems, vec!["legacy-pb-only-1".to_string()]);

    let untitled = result
        .sessions
        .iter()
        .find(|s| s.session_id == "app-untitled-0002")
        .unwrap();
    assert_eq!(untitled.title, "Untitled session");
    assert!(untitled.is_untitled);
    assert_eq!(untitled.project, "Unattributed");

    let cli_main = result
        .sessions
        .iter()
        .find(|s| s.session_id == "cli-main-0001")
        .unwrap();
    assert_eq!(cli_main.title, "Fix build pipeline");
    assert_eq!(cli_main.project, "MyCliRepo");

    let cli_sub = result
        .sessions
        .iter()
        .find(|s| s.session_id == "cli-sub-0001")
        .unwrap();
    assert_eq!(cli_sub.kind, SessionKind::Subagent);
    assert_eq!(cli_sub.parent_id.as_deref(), Some("cli-main-0001"));
    assert_eq!(cli_sub.title, "[researcher] Inspect logs");
    assert_eq!(cli_sub.project, "MyCliRepo");
}

#[test]
fn transcript_ignores_regex_literal_and_tool_output_model_switch_false_positives() {
    // 1. Standalone regex literal in PLANNER_RESPONSE leaves model_switch=None and observed_model="Unrecorded"
    let regex_only = concat!(
        "{\"step_index\":0,\"type\":\"USER_INPUT\",\"source\":\"USER_EXPLICIT\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"content\":\"Inspect regex\"}\n",
        "{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"Regex::new(r\\\"The user changed setting `Model Selection` from `?(.+?)`? to `?([^\\\\r\\\\n`]+)`?(?:[\\\\r\\\\n`]|$)\\\")\"}\n",
        "{\"step_index\":2,\"type\":\"VIEW_FILE\",\"source\":\"TOOL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:10Z\",\"content\":\"The user changed setting `Model Selection` from `Gemini 3.8 Flash` to `Gemini 4 Argon`\"}\n",
        "{\"step_index\":3,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:15Z\",\"input_tokens\":50,\"output_tokens\":10,\"content\":\"The user changed setting `Model Selection` from `Claude Opus 5.5` to `None`\"}\n"
    );

    let parsed_unrecorded = parse_transcript_reader(
        &mut Cursor::new(regex_only.as_bytes()),
        "synthetic/regex_false_positive.jsonl".to_string(),
    )
    .expect("parse regex_only");

    for step in &parsed_unrecorded.steps {
        assert!(
            step.model_switch.is_none(),
            "unexpected model_switch on step {}: {:?}",
            step.step_index,
            step.model_switch
        );
        assert_eq!(step.observed_model, "Unrecorded");
    }

    // 2. Regex literal after a valid switch preserves the prior valid observed_model
    let after_valid = concat!(
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"The user changed setting `Model Selection` from `None` to `Gemini 4 Argon`\"}\n",
        "{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":120,\"output_tokens\":30,\"content\":\"Regex::new(r\\\"The user changed setting `Model Selection` from `?(.+?)`? to `?([^\\\\r\\\\n`]+)`?(?:[\\\\r\\\\n`]|$)\\\")\"}\n"
    );

    let parsed_after = parse_transcript_reader(
        &mut Cursor::new(after_valid.as_bytes()),
        "synthetic/regex_after_valid.jsonl".to_string(),
    )
    .expect("parse after_valid");

    assert!(parsed_after.steps[0].model_switch.is_some());
    assert!(parsed_after.steps[1].model_switch.is_none());
    assert_eq!(parsed_after.steps[0].observed_model, "Gemini 4 Argon");
    assert_eq!(parsed_after.steps[1].observed_model, "Gemini 4 Argon");
}

#[test]
fn transcript_merges_thinking_level_suffixes_into_base_model_names() {
    let jsonl = concat!(
        "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"The user changed setting `Model Selection` from `Claude Opus 5.5 (High)` to `Claude Opus 5.5 (Medium)`\"}\n",
        "{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":150,\"output_tokens\":30,\"content\":\"The user changed setting `Model Selection` from `Claude Opus 5.5 (Medium)` to `Gemini 4 Neon (Low)`\"}\n",
        "{\"step_index\":2,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:10Z\",\"input_tokens\":200,\"output_tokens\":40,\"content\":\"The user changed setting `Model Selection` from `Gemini 4 Neon (minimal)` to `Claude Sonnet 5.5 (Thinking) (MAX)`\"}\n"
    );

    let parsed = parse_transcript_reader(
        &mut Cursor::new(jsonl.as_bytes()),
        "synthetic/thinking_suffixes.jsonl".to_string(),
    )
    .expect("parse thinking_suffixes");

    let sw0 = parsed.steps[0].model_switch.as_ref().expect("sw0");
    assert_eq!(sw0.from_model, "Claude Opus 5.5");
    assert_eq!(sw0.to_model, "Claude Opus 5.5");
    assert_eq!(parsed.steps[0].observed_model, "Claude Opus 5.5");

    let sw1 = parsed.steps[1].model_switch.as_ref().expect("sw1");
    assert_eq!(sw1.from_model, "Claude Opus 5.5");
    assert_eq!(sw1.to_model, "Gemini 4 Neon");
    assert_eq!(parsed.steps[1].observed_model, "Gemini 4 Neon");

    let sw2 = parsed.steps[2].model_switch.as_ref().expect("sw2");
    assert_eq!(sw2.from_model, "Gemini 4 Neon");
    assert_eq!(sw2.to_model, "Claude Sonnet 5.5");
    assert_eq!(parsed.steps[2].observed_model, "Claude Sonnet 5.5");
}

#[test]
fn transcript_parses_planner_response_model_slugs_with_priority() {
    // 1. Explicit model slugs normalized, effort/mode/tiered tokens stripped, effort-only rejected,
    //    priorities: explicit > active switch > last_explicit > "Unrecorded".
    let jsonl = concat!(
        "{\"step_index\":0,\"type\":\"USER_INPUT\",\"source\":\"USER_EXPLICIT\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"content\":\"Start\"}\n",
        "{\"step_index\":1,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"model\":\"claude-opus-4-5-thinking\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"Step 1\"}\n",
        "{\"step_index\":2,\"type\":\"GENERIC\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:06Z\",\"content\":\"Tool done\"}\n",
        "{\"step_index\":3,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:10Z\",\"model\":\"high-thinking\",\"input_tokens\":50,\"output_tokens\":10,\"content\":\"Invalid effort-only slug\"}\n",
        "{\"step_index\":4,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:15Z\",\"model\":\"gemini-3.8-flash-tiered-high\",\"input_tokens\":80,\"output_tokens\":15,\"content\":\"The user changed setting `Model Selection` from `None` to `Gemini 4 Argon`\"}\n",
        "{\"step_index\":5,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:20Z\",\"input_tokens\":90,\"output_tokens\":20,\"content\":\"No explicit model here\"}\n",
        "{\"step_index\":6,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:25Z\",\"model\":\"Claude Sonnet 4 (High)\",\"input_tokens\":70,\"output_tokens\":10,\"content\":\"Space-separated explicit\"}\n"
    );

    let parsed = parse_transcript_reader(
        &mut Cursor::new(jsonl.as_bytes()),
        "synthetic/model_slugs.jsonl".to_string(),
    )
    .expect("parse model_slugs");

    assert_eq!(parsed.steps[0].observed_model, "Unrecorded");
    assert_eq!(parsed.steps[1].observed_model, "Claude Opus 4 5");
    // Step 2 (GENERIC) falls back to last_explicit_model because no switch is active
    assert_eq!(parsed.steps[2].observed_model, "Claude Opus 4 5");
    // Step 3 ("high-thinking" -> None) falls back to last_explicit_model
    assert_eq!(parsed.steps[3].observed_model, "Claude Opus 4 5");
    // Step 4 has BOTH explicit ("Gemini 3.8 Flash") and switch ("Gemini 4 Argon"): explicit wins!
    assert_eq!(parsed.steps[4].observed_model, "Gemini 3.8 Flash");
    // Step 5 has no explicit model, active switch is "Gemini 4 Argon": switch wins over last_explicit!
    assert_eq!(parsed.steps[5].observed_model, "Gemini 4 Argon");
    // Step 6 has space-separated explicit model with "(High)" suffix stripped
    assert_eq!(parsed.steps[6].observed_model, "Claude Sonnet 4");
}

#[test]
fn transcript_extracts_plan_paths_excluding_generic_and_placeholders() {
    let jsonl = concat!(
        "{\"step_index\":0,\"type\":\"GENERIC\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:00Z\",\"content\":\"docs/superpowers/plans/2026-11-10-ignore-generic.md\"}\n",
        "{\"step_index\":1,\"type\":\"USER_INPUT\",\"source\":\"USER_EXPLICIT\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:01Z\",\"content\":\"Implement docs/superpowers/specs/2026-11-10-design.md and skip docs/superpowers/plans/YYYY-MM-DD-template.md and docs/superpowers/specs/<slug>.md and docs/superpowers/plans/{id}.md\"}\n",
        "{\"step_index\":2,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-10T10:00:05Z\",\"input_tokens\":100,\"output_tokens\":20,\"content\":\"Drafting docs/superpowers/plans/2026-11-10-Feature-Plan.md\",\"tool_calls\":[{\"name\":\"write_to_file\",\"args\":{\"TargetFile\":\"\\\"D:\\\\\\\\Code\\\\\\\\Repo\\\\\\\\docs\\\\\\\\superpowers\\\\\\\\plans\\\\\\\\2026-11-10-Feature-Plan.md\\\"\"}},{\"name\":\"edit_file\",\"args\":{\"filePath\":\"docs/superpowers/specs/2026-11-10-Edited-Spec.md\"}},{\"name\":\"read_file\",\"args\":{\"AbsolutePath\":\"docs\\\\superpowers\\\\specs\\\\2026-11-10-Read-Only.md\"}}]}\n"
    );

    let parsed = parse_transcript_reader(
        &mut Cursor::new(jsonl.as_bytes()),
        "synthetic/plan_paths.jsonl".to_string(),
    )
    .expect("parse plan_paths");

    assert_eq!(
        parsed.written_plan_paths,
        vec![
            "docs/superpowers/plans/2026-11-10-feature-plan.md".to_string(),
            "docs/superpowers/specs/2026-11-10-edited-spec.md".to_string(),
        ]
    );
    // Notice 2026-11-10-feature-plan.md was also mentioned in PLANNER_RESPONSE content,
    // so it must be excluded from referenced_plan_paths since it's in written_plan_paths.
    assert_eq!(
        parsed.referenced_plan_paths,
        vec![
            "docs/superpowers/specs/2026-11-10-design.md".to_string(),
            "docs/superpowers/specs/2026-11-10-read-only.md".to_string(),
        ]
    );
}

#[test]
fn scanner_extracts_spawn_step_index_and_message_turns() {
    let tmp = TempDir::new("spawn_and_turns");
    let app_brain = tmp.path.join("app_brain");
    let cli_root = tmp.path.join("cli");
    let cli_brain = cli_root.join("brain");
    fs::create_dir_all(&app_brain).unwrap();
    fs::create_dir_all(&cli_brain).unwrap();

    let parent_id = "parent-orch-0001";
    let sub_json_id = "sub-from-json-0001";
    let sub_gen_id = "sub-from-gen-0002";

    let parent_dir = cli_brain.join(parent_id);
    let parent_logs = parent_dir.join(".system_generated").join("logs");
    let parent_subs = parent_dir.join(".system_generated").join("subagents");
    fs::create_dir_all(&parent_logs).unwrap();
    fs::create_dir_all(&parent_subs).unwrap();

    // Parent transcript:
    // - step 2: PLANNER_RESPONSE sends message to sub-from-json-0001
    // - step 4: GENERIC spawns sub-from-gen-0002
    // - step 5: PLANNER_RESPONSE sends JSON-quoted message to sub-from-json-0001
    // - step 6: SYSTEM_MESSAGE from sub-from-gen-0002
    // - step 7: GENERIC mentions sub-from-gen-0002 again (earliest step 4 must win)
    // - step 8: SYSTEM_MESSAGE from sub-from-json-0001
    let parent_jsonl = concat!(
        "{\"step_index\":2,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:00Z\",\"input_tokens\":100,\"output_tokens\":20,\"tool_calls\":[{\"name\":\"send_message\",\"args\":{\"Recipient\":\"sub-from-json-0001\",\"Message\":\"Start task 1\"}}]}\n",
        "{\"step_index\":4,\"type\":\"GENERIC\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:05Z\",\"content\":\"Spawned subagent {\\\"conversationId\\\": \\\"sub-from-gen-0002\\\"}\"}\n",
        "{\"step_index\":5,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:10Z\",\"input_tokens\":50,\"output_tokens\":10,\"tool_calls\":[{\"name\":\"send_message\",\"args\":{\"recipient\":\"\\\"sub-from-json-0001\\\"\",\"Message\":\"Follow up\"}}]}\n",
        "{\"step_index\":6,\"type\":\"SYSTEM_MESSAGE\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:15Z\",\"content\":\"[Message] timestamp=2026-11-12T10:00:15Z sender=sub-from-gen-0002 priority=HIGH content=done\"}\n",
        "{\"step_index\":7,\"type\":\"GENERIC\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:16Z\",\"content\":\"Update conversation_id=sub-from-gen-0002\"}\n",
        "{\"step_index\":8,\"type\":\"SYSTEM_MESSAGE\",\"source\":\"SYSTEM\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:20Z\",\"content\":\"[Message] timestamp=2026-11-12T10:00:20Z sender=sub-from-json-0001 priority=HIGH content=done\"}\n"
    );
    fs::write(parent_logs.join("transcript.jsonl"), parent_jsonl).unwrap();

    // Subagent 1 has explicit spawnStepIndex in JSON
    fs::write(
        parent_subs.join("sub1.json"),
        format!(
            "{{\"conversationId\":\"{sub_json_id}\",\"spawnStepIndex\":2,\"subagentDescriptor\":{{\"typeName\":\"coder\",\"role\":\"Task 1\"}}}}"
        ),
    )
    .unwrap();

    // Subagent 2 omits spawnStepIndex in JSON -> falls back to parent GENERIC step 4
    fs::write(
        parent_subs.join("sub2.json"),
        format!(
            "{{\"conversationId\":\"{sub_gen_id}\",\"subagentDescriptor\":{{\"typeName\":\"reviewer\",\"role\":\"Task 2\"}}}}"
        ),
    )
    .unwrap();

    for sid in [sub_json_id, sub_gen_id] {
        let s_logs = cli_brain.join(sid).join(".system_generated").join("logs");
        fs::create_dir_all(&s_logs).unwrap();
        fs::write(
            s_logs.join("transcript.jsonl"),
            "{\"step_index\":0,\"type\":\"PLANNER_RESPONSE\",\"source\":\"MODEL\",\"status\":\"DONE\",\"created_at\":\"2026-11-12T10:00:02Z\",\"input_tokens\":30,\"output_tokens\":10}\n",
        )
        .unwrap();
    }

    let cfg = default_test_config(&app_brain, &cli_brain);
    let result = scan_all_sources(&cfg);

    let parent = result
        .sessions
        .iter()
        .find(|s| s.session_id == parent_id)
        .expect("parent session");
    assert_eq!(parent.spawn_step_index, None);
    assert_eq!(parent.message_turns.get(sub_json_id).copied(), Some(3)); // 2 send_message + 1 SYSTEM_MESSAGE
    assert_eq!(parent.message_turns.get(sub_gen_id).copied(), Some(1)); // 1 SYSTEM_MESSAGE

    let sub1 = result
        .sessions
        .iter()
        .find(|s| s.session_id == sub_json_id)
        .expect("sub1 session");
    assert_eq!(sub1.spawn_step_index, Some(2));

    let sub2 = result
        .sessions
        .iter()
        .find(|s| s.session_id == sub_gen_id)
        .expect("sub2 session");
    assert_eq!(sub2.spawn_step_index, Some(4));
}
