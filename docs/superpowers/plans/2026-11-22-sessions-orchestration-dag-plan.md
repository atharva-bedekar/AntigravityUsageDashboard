# Sessions & Orchestration DAG Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add per-step JSON `"model"` slug normalization, plan/spec artifact & subagent turn-count extraction, and a dedicated **Sessions** screen featuring a sortable top-level sessions table and an interactive left-to-right Orchestration DAG panel with side-by-side `Planner → Orchestrator` linking.

**Architecture:** The Rust scanner (`src-tauri/src/scanner/`) parses top-level `PLANNER_RESPONSE.model` slugs into canonical display names with strict per-step priority, extracts canonical `docs/superpowers/(plans|specs)/*.md` written/referenced keys, and records `spawn_step_index` + parent-child `message_turns`. `src-tauri/src/metrics.rs` rolls up top-level `Main` session family usage, classifies `Planner`/`Orchestrator`/`Main` roles, links `Planner → Orchestrator` session pairs, and constructs wave-grouped `SessionDagPayload` graphs exposed via two new Tauri IPC commands (`get_sessions_overview`, `get_session_dag`). The Vanilla TypeScript frontend (`ui/src/`) renders the **Sessions** screen (`ui/src/screens/sessions.ts`) and inline SVG Orchestration DAG (`ui/src/dag.ts`) using existing CSS tokens (`ui/src/styles/tokens.css`), wired into the sidebar below **Token Usage**.

**Tech Stack:** Rust (`tauri` 2, `serde`, `serde_json`, `chrono`, `regex`, `rayon`), Vanilla TypeScript (`typescript` 5.7, `vite` 6, `@tauri-apps/api` 2.2), Plain CSS (`tokens.css` / `app.css`), inline SVG.

---

## Execution Waves

| Wave | Tasks | Description | Files Touched (Disjoint) |
|---|---|---|---|
| **Wave 1** | Task 1, Task 2 | Rust models + transcript `"model"` slug parsing, plan/spec extraction, spawn/message turn metadata; TS Sessions/DAG types + `api` client & deterministic browser mocks | **Task 1:** `src-tauri/src/models.rs`, `src-tauri/src/scanner/transcript.rs`, `src-tauri/src/scanner/subagents.rs`, `src-tauri/src/scanner/mod.rs`, `src-tauri/src/export.rs`, `src-tauri/src/snapshots.rs`, `src-tauri/src/metrics.rs` (test struct literal only), `src-tauri/tests/scanner_integration.rs`<br>**Task 2:** `ui/src/types.ts`, `ui/src/api.ts` |
| **Wave 2** | Task 3, Task 4 | Rust `build_sessions_overview_at`, `build_sessions_overview`, `build_session_dag`, role classification & cross-session linking; Frontend `renderOrchestrationDag` SVG renderer & `.sess-*`/`.dag-*` CSS | **Task 3:** `src-tauri/src/metrics.rs`<br>**Task 4:** `ui/src/dag.ts` (new), `ui/src/styles/app.css` |
| **Wave 3** | Task 5, Task 6 | Rust `get_sessions_overview` & `get_session_dag` Tauri IPC commands; Frontend `Sessions` screen (`ui/src/screens/sessions.ts`) | **Task 5:** `src-tauri/src/lib.rs`<br>**Task 6:** `ui/src/screens/sessions.ts` (new) |
| **Wave 4** | Task 7 | Shell wiring (`"sessions"` `ScreenId`, sidebar tab below Token Usage, View menu, Quick Search, focus restoration, sequence guards), full build/test & live browser QA | **Task 7:** `ui/src/types.ts`, `ui/src/main.ts`, `ui/src/modals.ts` |

> **Wave 1 Typecheck Note:** `ScreenId` in `ui/src/types.ts:441` remains `"token-usage" | "settings"` during Wave 1 and adds `"sessions"` in Wave 4 (Task 7) alongside `ui/src/main.ts` and `ui/src/modals.ts`, keeping Wave 1 `npm --prefix ui run build` 100% green and avoiding cross-task edits.

---

## Tasks

### Task 1: Rust Models & Scanner Extraction (`model`, Plan/Spec Paths, Spawn & Turn Metadata)

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Modify: `src-tauri/src/models.rs:102-147`, `src-tauri/src/models.rs:721-734`
- Modify: `src-tauri/src/scanner/transcript.rs:16-105`, `src-tauri/src/scanner/transcript.rs:142-269`, `src-tauri/src/scanner/transcript.rs:328-598`
- Modify: `src-tauri/src/scanner/subagents.rs:60-87`
- Modify: `src-tauri/src/scanner/mod.rs:470-503`
- Modify (struct literal sync for new `SessionRecord` fields): `src-tauri/src/export.rs:174-229`, `src-tauri/src/snapshots.rs:210-242`, `src-tauri/src/metrics.rs:1643-1676`
- Test: `src-tauri/tests/scanner_integration.rs:448-476`

**Contracts:**
1. **`src-tauri/src/models.rs`:**
   - Extend `SessionRecord` (`models.rs:104-136`) with:
     - `#[serde(default)] pub spawn_step_index: Option<i64>`
     - `#[serde(default)] pub written_plan_paths: Vec<String>`
     - `#[serde(default)] pub referenced_plan_paths: Vec<String>`
     - `#[serde(default)] pub message_turns: std::collections::HashMap<String, u64>`
   - Extend `SubagentLink` (`models.rs:141-146`) with:
     - `#[serde(default)] pub spawn_step_index: Option<i64>`
   - Append Sessions & Orchestration DAG IPC models at end of `src-tauri/src/models.rs` (after `TokenUsagePayload` at `:734`), all with `#[serde(rename_all = "camelCase")]`:
     - `pub enum SessionRole { Planner, Orchestrator, Main }`
     - `pub enum SessionLinkDirection { ToOrchestrator, FromPlanner }`
     - `pub struct SessionsFilter { pub period: TimePeriod, pub project: Option<String> }`
     - `pub struct SessionOverviewRow { pub session_id: String, pub title: String, pub project: String, pub source: SourceKind, pub role: SessionRole, pub subagent_count: u64, pub fresh_in: u64, pub cached: u64, pub output: u64, pub total: u64, pub cache_hit_rate: f64, pub wall_time_secs: u64, pub calls: u64, pub first_utc: Option<String>, pub last_utc: Option<String>, pub linked_session_id: Option<String>, pub link_direction: Option<SessionLinkDirection>, pub linked_plan_name: Option<String> }`
     - `pub struct SessionsOverviewPayload { pub filter: SessionsFilter, pub window_start: Option<String>, pub window_end: String, pub available_projects: Vec<String>, pub sessions: Vec<SessionOverviewRow> }`
     - `pub struct DagNode { pub node_id: String, pub session_id: String, pub parent_node_id: Option<String>, pub is_root: bool, pub wave_index: u32, pub agent_type: String, pub role_label: String, pub model: String, pub fresh_in: u64, pub cached: u64, pub output: u64, pub total: u64, pub cache_hit_rate: f64, pub wall_time_secs: u64, pub calls: u64, pub tool_call_count: u64, pub message_turns: u64 }`
     - `pub struct DagEdge { pub from_node_id: String, pub to_node_id: String, pub kind: String, pub message_turns: u64 }`
     - `pub struct SessionDagGraph { pub session_id: String, pub title: String, pub project: String, pub role: SessionRole, pub wave_count: u32, pub nodes: Vec<DagNode>, pub edges: Vec<DagEdge> }`
     - `pub struct CrossSessionLink { pub planner_session_id: String, pub orchestrator_session_id: String, pub plan_name: String }`
     - `pub struct SessionDagPayload { pub selected_session_id: String, pub primary: SessionDagGraph, pub secondary: Option<SessionDagGraph>, pub link: Option<CrossSessionLink> }`

2. **`src-tauri/src/scanner/transcript.rs`:**
   - Extend `ParsedTranscript` (`transcript.rs:82-104`) with:
     - `pub written_plan_paths: Vec<String>`
     - `pub referenced_plan_paths: Vec<String>`
     - `pub spawned_conversations: HashMap<String, i64>` (maps child `conversationId` → earliest parent `step_index`)
     - `pub message_turns: HashMap<String, u64>` (maps child `conversationId` → count of `SYSTEM_MESSAGE` `[Message] ... sender=<uuid>` turns + outbound `send_message` tool calls with `args.Recipient == <uuid>`)
   - **Model slug normalization (`normalize_model_slug(raw: &str) -> Option<String>`):**
     - Reuse `trim_model_raw`, `is_valid_model_name`, `clean_model_name`, and `truncate_chars` (`transcript.rs:127-188`).
     - If `!is_valid_model_name(raw)` return `None`.
     - If `trimmed` contains `-` and no spaces: split on `-`, drop `"tiered"` tokens (case-insensitive), repeatedly pop trailing effort/mode tokens matching `high | medium | low | minimal | max | thinking | fast | default` (case-insensitive), title-case alphabetical tokens (`c.to_ascii_uppercase()` + rest lowercase) while preserving numeric/version tokens (`"4"`, `"4.5"`, `"3.8"`) verbatim, join with `" "`, and apply `truncate_chars(..., 60)`.
     - Otherwise (already space-separated, e.g. `"Gemini 3.8 Flash (High)"`): return `Some(clean_model_name(trimmed))` if non-empty and not `"None"`.
   - **Per-step `explicit_models` & `assign_observed_models(steps: &mut [StepRecord], explicit_models: &[Option<String>])`:**
     - Keep a parallel `explicit_models: Vec<Option<String>>` in `parse_transcript_reader` (no change needed to `StepRecord` struct literals in other modules!).
     - When `type_upper == "PLANNER_RESPONSE"`, read `obj.get("model").and_then(|v| v.as_str()).and_then(normalize_model_slug)` into `explicit_models`.
     - In `assign_observed_models`:
       - Initialize `current_switch_model` from first `step.model_switch` `from_model` (using `normalize_model_label`), else `"Unrecorded"`, and `last_explicit_model: Option<String> = None`.
       - For `(step, explicit)` in `steps.iter_mut().zip(explicit_models.iter())`:
         1. If `let Some(sw) = &step.model_switch`: `current_switch_model = normalize_model_label(&sw.to_model)`.
         2. Priority 1: `Some(m)` in `explicit` → set `step.observed_model = m.clone()`, `last_explicit_model = Some(m.clone())`.
         3. Priority 2: else if `current_switch_model != "Unrecorded"` → set `step.observed_model = current_switch_model.clone()`.
         4. Priority 3: else if `let Some(prev) = &last_explicit_model` → set `step.observed_model = prev.clone()`.
         5. Fallback: `"Unrecorded".to_string()`.
   - **Plan/spec canonical extraction (`extract_plan_paths_from_text`):**
     - Regex: `(?i)docs[/\\]+superpowers[/\\]+(plans|specs)[/\\]+([A-Za-z0-9._-]+\.md)`.
     - Normalize `\` → `/`, lowercase `docs/superpowers/<kind>/<file>.md`, reject template placeholders where `<file>` starts with `yyyy-mm-dd` (case-insensitive) or contains `<`, `>`, `{`, `}`.
     - Per step in `parse_transcript_reader`:
       - Skip `type_upper == "GENERIC"` for plan path scanning.
       - If `type_upper == "USER_INPUT"`: scan `content_str` → insert into `written_set`? No, insert into `referenced_set`.
       - For `PLANNER_RESPONSE` `tool_calls`:
         - If `raw_name` in `["write_file", "write_to_file", "edit_file", "replace_file_content", "multi_replace_file_content"]`, inspect `args` keys `Path`, `TargetFile`, `path`, `filePath` → insert into `written_set`.
         - If `raw_name` in `["read_file", "view_file"]`, inspect `args` keys `Path`, `AbsolutePath`, `path` → insert into `referenced_set`.
       - If `type_upper == "PLANNER_RESPONSE"`: scan `content_str` → insert into `referenced_set`.
     - Finalize `out.written_plan_paths` (sorted `Vec`) and `out.referenced_plan_paths` (sorted `Vec` excluding items already in `written_set`).
   - **Spawned conversation & message turn extraction:**
     - On `GENERIC` steps, inspect `content_str` with regex `(?i)"?(?:conversationId|conversation_id)"?\s*[:=]\s*"?([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})"?` (or general UUID/slug `[A-Za-z0-9_-]{8,}`) and record `out.spawned_conversations.entry(cid).or_insert(step_index)`.
     - On `SYSTEM_MESSAGE` steps, match `[Message] ... sender=<id>` (`(?i)\[Message\][^\r\n]*?\bsender=([A-Za-z0-9._-]+)`) → increment `out.message_turns[sender] += 1`.
     - On `PLANNER_RESPONSE` `tool_calls` where `raw_name == "send_message"`, inspect `args.get("Recipient")` (or `recipient`) → increment `out.message_turns[recipient] += 1`.

3. **`src-tauri/src/scanner/subagents.rs` & `src-tauri/src/scanner/mod.rs`:**
   - In `load_subagent_links` (`subagents.rs:60-87`): parse `spawn_step_index` from `val.get("spawnStepIndex").or_else(|| val.get("spawn_step_index")).and_then(|v| v.as_i64())`.
   - In `build_session_record` (`mod.rs:389-503`):
     - Propagate `spawn_step_index` from `sub_link.and_then(|l| l.spawn_step_index)` (fallback lookup from parent's `spawned_conversations` happens in `scan_single_source` after all items are parsed, or store `spawned_conversations` on `ParsedTranscript` and resolve `spawn_step_index` for child records in `scan_single_source` (`mod.rs:326-349`)!).
     - Populate `written_plan_paths`, `referenced_plan_paths`, `message_turns` from `parsed`.
   - Update `SessionRecord` test constructors in `src-tauri/src/export.rs:174-229`, `src-tauri/src/snapshots.rs:210-242`, and `src-tauri/src/metrics.rs:1643-1676` with default empty values for the 4 new `SessionRecord` fields.

- [ ] **Step 1: Write the failing tests**

Add integration tests in `src-tauri/tests/scanner_integration.rs` (after line 476):
1. `transcript_parses_planner_response_model_slugs_with_priority`:
   - Tests `"gemini-4-hydrogen-tiered-high"` → `"Gemini 4 Hydrogen"`, `"gemini-4-neon-medium"` → `"Gemini 4 Neon"`, `"gemini-4-argon-medium"` → `"Gemini 4 Argon"`, `"claude-4.5-sonnet-thinking"` → `"Claude 4.5 Sonnet"`.
   - Verifies priority: explicit `PLANNER_RESPONSE.model` overrides `Model Selection` notice on a given step, `Model Selection` propagates to subsequent steps without explicit `"model"`, and intermediate tool steps carry prior explicit model when no `Model Selection` exists.
   - Verifies existing transcripts without `"model"` field still produce `"Unrecorded"`.
2. `transcript_extracts_plan_paths_excluding_generic_and_placeholders`:
   - `USER_INPUT` mentioning `@[docs/superpowers/specs/2026-11-22-foo-design.md]` → `referenced_plan_paths`.
   - `PLANNER_RESPONSE` `write_file` tool call with `D:\Code\Repo\docs\superpowers\plans\2026-11-22-foo-plan.md` → `written_plan_paths` (`"docs/superpowers/plans/2026-11-22-foo-plan.md"`).
   - `GENERIC` `git status` listing `docs/superpowers/plans/2026-11-22-unrelated-plan.md` and `PLANNER_RESPONSE` mentioning `docs/superpowers/plans/YYYY-MM-DD-template.md` → both excluded.
3. `scanner_extracts_spawn_step_index_and_message_turns`:
   - Parent transcript with `GENERIC` creation containing `conversationId`, two `SYSTEM_MESSAGE` steps from that child UUID, and one outbound `send_message` to `Recipient` → child `SessionRecord.spawn_step_index` populated from `GENERIC` (and overridden if `subagents/*.json` has `spawnStepIndex`), and parent `message_turns[child_id] == 3`.

- [ ] **Step 2: Run tests to verify they fail (Red)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test scanner_integration`  
Expected: FAIL to compile because `written_plan_paths`, `referenced_plan_paths`, `spawn_step_index`, and `message_turns` do not exist yet.

- [ ] **Step 3: Write minimal implementation (Green)**

Implement the `models.rs`, `transcript.rs`, `subagents.rs`, `mod.rs`, and test struct literal updates per the Contracts above. Keep all new functions focused (`normalize_model_slug`, `extract_plan_paths_from_text`, `extract_spawned_conversation_id`, `extract_system_sender`).

- [ ] **Step 4: Run tests to verify they pass (Green)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`  
Expected: PASS (all unit and integration tests pass with 0 warnings/errors).

---

### Task 2: Frontend TypeScript Sessions & DAG Types + API Client & Browser Mocks

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Modify: `ui/src/types.ts:500-512`
- Modify: `ui/src/api.ts:1-20`, `ui/src/api.ts:40-62`, `ui/src/api.ts:1236-1255`

**Contracts:**
- **In `ui/src/types.ts` (append after `TokenUsagePayload` at `:512`):**
  Mirror Task 1's Rust camelCase serde types exactly:
  ```ts
  export type SessionRole = "planner" | "orchestrator" | "main";
  export type SessionLinkDirection = "toOrchestrator" | "fromPlanner";
  export interface SessionsFilter { period: TimePeriod; project: string | null; }
  export interface SessionOverviewRow {
    sessionId: string; title: string; project: string; source: SourceKind;
    role: SessionRole; subagentCount: number; freshIn: number; cached: number;
    output: number; total: number; cacheHitRate: number; wallTimeSecs: number;
    calls: number; firstUtc: string | null; lastUtc: string | null;
    linkedSessionId: string | null; linkDirection: SessionLinkDirection | null;
    linkedPlanName: string | null;
  }
  export interface SessionsOverviewPayload {
    filter: SessionsFilter; windowStart: string | null; windowEnd: string;
    availableProjects: string[]; sessions: SessionOverviewRow[];
  }
  export interface DagNode {
    nodeId: string; sessionId: string; parentNodeId: string | null;
    isRoot: boolean; waveIndex: number; agentType: string; roleLabel: string;
    model: string; freshIn: number; cached: number; output: number; total: number;
    cacheHitRate: number; wallTimeSecs: number; calls: number;
    toolCallCount: number; messageTurns: number;
  }
  export interface DagEdge {
    fromNodeId: string; toNodeId: string; kind: "dispatch" | "feedback";
    messageTurns: number;
  }
  export interface SessionDagGraph {
    sessionId: string; title: string; project: string; role: SessionRole;
    waveCount: number; nodes: DagNode[]; edges: DagEdge[];
  }
  export interface CrossSessionLink {
    plannerSessionId: string; orchestratorSessionId: string; planName: string;
  }
  export interface SessionDagPayload {
    selectedSessionId: string; primary: SessionDagGraph;
    secondary: SessionDagGraph | null; link: CrossSessionLink | null;
  }
  ```
- **In `ui/src/api.ts`:**
  - Import `SessionDagPayload`, `SessionsFilter`, `SessionsOverviewPayload` in `ui/src/api.ts:1-19`.
  - Add on `export const api` (`ui/src/api.ts:45`):
    - `async getSessionsOverview(filter: SessionsFilter): Promise<SessionsOverviewPayload>` → `invoke<SessionsOverviewPayload>("get_sessions_overview", { filter })` when `isTauri()`, else `mockSessionsOverview(filter)`.
    - `async getSessionDag(sessionId: string): Promise<SessionDagPayload>` → `invoke<SessionDagPayload>("get_session_dag", { sessionId })` when `isTauri()`, else `mockSessionDag(sessionId)`.
  - Implement deterministic browser mocks at end of `ui/src/api.ts`:
    - `mockSessionsOverview(filter)`: includes:
      1. Linked **Planner** (`"sess-planner-01"`, role `"planner"`, 3 subagents, `linkedSessionId: "sess-orch-01"`, `linkDirection: "toOrchestrator"`, `linkedPlanName: "2026-11-22-token-usage-ui-plan.md"`).
      2. Linked **Orchestrator** (`"sess-orch-01"`, role `"orchestrator"`, 8 subagents, `linkedSessionId: "sess-planner-01"`, `linkDirection: "fromPlanner"`, `linkedPlanName: "2026-11-22-token-usage-ui-plan.md"`).
      3. Standalone multi-wave **Main** session (`"sess-main-02"`, role `"main"`, 2 subagents).
      4. Standalone 0-subagent **Main** session (`"sess-solo-03"`, role `"main"`, 0 subagents) across a second project (`"PersonalTools"`) and older timestamps so timeline & project filters work deterministically.
    - `mockSessionDag(sessionId)`:
      - When `sessionId` is `"sess-planner-01"` or `"sess-orch-01"`, returns both `primary` (Planner with `researcher` wave 1 + `plan-critic` wave 2 with `3` message turns) and `secondary` (Orchestrator with parallel `implementer` waves 1 & 2, `code-reviewer` wave 3, `verifier` wave 4, models `"Gemini 4 Argon"`, `"Gemini 4 Neon"`, `"Gemini 4 Hydrogen"`), plus `link` (`planName: "2026-11-22-token-usage-ui-plan.md"`).
      - When `"sess-solo-03"`, returns a single root `"Main Agent"` node (`waveCount: 0`, `edges: []`).
      - When `"sess-main-02"`, returns root + 2 subagent nodes.

- [ ] **Step 1: Verify baseline typecheck**

Run: `npm --prefix ui run typecheck`  
Expected: PASS (exit code 0).

- [ ] **Step 2: Add TypeScript types and `api.getSessionsOverview` / `api.getSessionDag` + mocks**

Update `ui/src/types.ts` and `ui/src/api.ts` per the Contracts above.

- [ ] **Step 3: Verify typecheck and Vite build pass**

Run: `npm --prefix ui run build`  
Expected: PASS (`tsc --noEmit && vite build` exits 0 with zero errors).

---

### Task 3: Rust Sessions Aggregation, Role Classification, Cross-Session Linking & DAG Builder

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:**
- Modify: `src-tauri/src/metrics.rs:1-18`, `src-tauri/src/metrics.rs:1500-2093`

**Contracts:**
- **Imports (`src-tauri/src/metrics.rs:5-12`):** Import `CrossSessionLink`, `DagEdge`, `DagNode`, `SessionDagGraph`, `SessionDagPayload`, `SessionLinkDirection`, `SessionOverviewRow`, `SessionRole`, `SessionsFilter`, `SessionsOverviewPayload`.
- **Shared Period Bounds Helper:** Extract or add `resolve_period_window(period: TimePeriod, now: DateTime<Local>, sessions: &[&SessionRecord]) -> (Option<String>, String, Option<(DateTime<Local>, DateTime<Local>)>, Option<(NaiveDate, NaiveDate)>)` matching `build_window_scaffold` (`metrics.rs:1120-1279`) so `1d` (24h hourly bounds), `1w` (7d), `1m` (30d), `6m` (182d Monday-aligned), and `lifetime` produce identical `window_start`, `window_end`, and step membership.
- **Session Family & Wall-Time Helpers:**
  - `collect_descendant_ids(root_id: &str, children_map: &HashMap<&str, Vec<&SessionRecord>>) -> Vec<String>` using BFS with a `HashSet` cycle guard.
  - `compute_session_wall_time(steps: &[StepRecord], in_window: impl Fn(&StepRecord) -> bool) -> u64`: uses `WALL_TIME_GAP_CAP_SECS` (`1800`s, `metrics.rs:17`), matching `build_token_usage_at` (`metrics.rs:1396-1415`).
  - `summarize_session_models(steps: &[StepRecord]) -> String`: collects distinct `effective_model_label(&st.observed_model)` values (excluding `"Unrecorded"` if at least one recorded model exists) in chronological order, joined with `", "`, or `"Unrecorded"`.
- **Role Classification (`classify_session_role`):**
  - Given a `SessionKind::Main` session and its direct child `agent_type` strings:
    - Has `implementer`, `code-reviewer`, or `verifier` child → `SessionRole::Orchestrator`.
    - Else if `referenced_plan_paths` has a `docs/superpowers/plans/*.md` not in `written_plan_paths` → `SessionRole::Orchestrator`.
    - Else if `!written_plan_paths.is_empty()` OR has `plan-critic` child → `SessionRole::Planner`.
    - Else → `SessionRole::Main`.
- **Cross-Session Linking (`link_planner_orchestrator_sessions`):**
  - Extract canonical keys (`docs/superpowers/(plans|specs)/<file>.md`) and stem keys (`strip_plan_stem`: strips `-design.md`, `-spec.md`, `-plan.md`, `.md` when filename starts with `YYYY-MM-DD-`) for each `SessionKind::Main` session.
  - Match each candidate `Orchestrator` with the closest preceding `Planner` (`planner.first_utc <= orchestrator.first_utc`, or closest `last_utc` if `first_utc` missing) sharing an exact key (preferred) or stem key, producing a 1-to-1 `HashMap<String, LinkMeta>` (`linked_session_id`, `link_direction`, `linked_plan_name` = basename such as `2026-11-22-token-usage-ui-plan.md`).
- **Public Aggregation Entrypoints:**
  - `pub fn build_sessions_overview(scan: &ScanResult, filter: &SessionsFilter) -> SessionsOverviewPayload`
  - `pub fn build_sessions_overview_at(scan: &ScanResult, filter: &SessionsFilter, now: DateTime<Local>) -> SessionsOverviewPayload`:
    - Collects `available_projects` from all `SessionKind::Main` sessions with `calls > 0` (dropdown never collapses).
    - Filters `Main` sessions by `filter.project`.
    - For each `Main` session + its descendants: sums in-period `fresh_in`, `cached`, `output`, `calls`, and per-session capped `wall_time_secs`; counts `subagent_count` as total descendant subagents (`descendants.len() as u64`); skips sessions with `0` in-period calls and `0` in-period wall time.
    - Computes `cache_hit_rate = safe_div(cached as f64, (fresh_in + cached) as f64, 0.0)`.
    - Populates `role`, `linked_session_id`, `link_direction`, `linked_plan_name` across all `Main` sessions, and sorts rows by `total` descending (`then_with` `last_utc` desc, `session_id` asc).
  - `pub fn build_session_dag(scan: &ScanResult, session_id: &str) -> Result<SessionDagPayload, String>`:
    - Resolves `session_id` to its root `SessionKind::Main` ancestor (cycle-guarded); returns `Err` if not found.
    - Builds `SessionDagGraph` for a root session:
      - Root node at `wave_index = 0`, `agent_type` = `"Planner" | "Orchestrator" | "Main Agent"`, `role_label = root.title`.
      - Direct child subagents grouped into chronological waves `1..N`: ordered by `(spawn_step_index.unwrap_or(i64::MAX), first_utc, session_id)`; consecutive children share the same wave if both share the same `Some(spawn_step_index)` OR (when either lacks `spawn_step_index`) their `[first_utc, last_utc]` timestamps overlap (`cur_first <= wave_max_last`). If all timestamps are missing, place together in wave `1`.
      - Nested subagents (parent is a subagent) attach at `wave_index = parent.wave_index + 1`.
      - Emits `"dispatch"` edge `parent -> child` for every subagent (`message_turns` from `parent.message_turns.get(&child.session_id)`), and if `message_turns > 0`, also emits `"feedback"` edge `child -> parent` with `message_turns`.
    - If root has a linked counterpart, `primary = build_graph(planner)`, `secondary = Some(build_graph(orchestrator))`, `link = Some(CrossSessionLink { ... })`; else `primary = build_graph(root)`, `secondary = None`, `link = None`.

- [ ] **Step 1: Write the failing unit tests**

Add unit tests at the bottom of `src-tauri/src/metrics.rs` (`mod tests`, after line 2092):
1. `sessions_overview_rolls_up_subagents_filters_and_sorts_by_total_desc`: tests family rollup (`parent + 2 subagents`), project dropdown preservation, period filtering (`1w` vs `1d`), and descending `total` sort.
2. `sessions_overview_classifies_and_links_planner_to_orchestrator`: tests `Planner` (authored plan + `plan-critic`) linked to `Orchestrator` (read plan + `implementer` + `verifier`), verifying `role`, `linked_session_id`, `link_direction` (`ToOrchestrator` / `FromPlanner`), and `linked_plan_name`, plus stem fallback (`-design.md` ↔ `-plan.md`).
3. `session_dag_groups_waves_extracts_feedback_and_handles_zero_and_nested_subagents`:
   - Verifies 0-subagent session produces 1 root node (`wave_count == 0`, `edges.is_empty()`).
   - Verifies parallel wave grouping (same `spawn_step_index` -> same `wave_index`, later `spawn_step_index` -> next wave), timestamp-overlap fallback when `spawn_step_index` is `None`, nested subagent wave `parent.wave_index + 1`, and `"feedback"` edge emission when `message_turns > 0`.
   - Verifies linked `Planner` or `Orchestrator` selection returns both `primary` (Planner) and `secondary` (Orchestrator) with `CrossSessionLink`.

- [ ] **Step 2: Run tests to verify they fail (Red)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml sessions_`  
Expected: FAIL to compile because `build_sessions_overview_at` and `build_session_dag` do not exist yet.

- [ ] **Step 3: Write minimal implementation (Green)**

Implement `build_sessions_overview`, `build_sessions_overview_at`, `build_session_dag`, and private helpers in `src-tauri/src/metrics.rs`.

- [ ] **Step 4: Run tests to verify they pass (Green)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`  
Expected: PASS (all unit and integration tests green).

---

### Task 4: Frontend Orchestration DAG Renderer (`ui/src/dag.ts`) & Sessions/DAG Styles (`ui/src/styles/app.css`)

**Wave:** 2  
**Depends on:** Task 2  
**Files Touched:**
- Create: `ui/src/dag.ts`
- Modify: `ui/src/styles/app.css:2198-2287`

**Unslop 3-Line Direction & Aesthetic Token Contract:**
- **Product:** An interactive left-to-right agent orchestration graph and sortable sessions ledger for inspecting multi-agent token cost, dispatch waves, and Planner → Orchestrator handoffs.
- **Character:** Archival, instrument-grade, exact (zero decorative neon gradients, zero emojis, strict `tabular-nums`, crisp `1px` borders).
- **World:** Technical telemetry schematic on quiet daylight/night-shift surfaces.
- **Tokens (strictly from `ui/src/styles/tokens.css`, ZERO hardcoded hex):**
  - Surfaces: `--bg-canvas`, `--bg-surface`, `--bg-subtle`, `--bg-hover`
  - Borders & Focus: `1px solid var(--border-card)`, `--border-divider`, `2px solid var(--focus-ring)`
  - Agent Type Accent Stripes: `planner`/`orchestrator`/`main` → `--cli-blue`/`--text-strong`; `researcher` → `--data-new`; `plan-critic` → `--status-warn`; `implementer` → `--status-ok`; `code-reviewer` → `--source-cli`; `verifier` → `--source-custom`; fallback → `--text-muted`.

**Contracts:**
- **`ui/src/dag.ts`:**
  - Export `renderOrchestrationDag(container: HTMLElement, payload: SessionDagPayload, numberFormat: "compact" | "full"): void`.
  - Layout math (deterministic SVG coordinates):
    - Card dimensions: `NODE_W = 204`, `NODE_H = 74`, `COL_GAP = 64`, `ROW_GAP = 18`, `CLUSTER_GAP = 148` (room for prominent bridge arrow + plan filename pill).
    - Single cluster (`secondary === null`): columns `0..primary.waveCount` left-to-right; each column's nodes stacked vertically and centered relative to tallest column. If `primary.nodes.length === 1` (`0` subagents), render root node + subtle caption `"No subagents spawned in this session"`.
    - Linked clusters (`secondary !== null` and `link !== null`): render `primary` (Planner) cluster on left inside subtle cluster frame (`is-active-cluster` outline when `selectedSessionId === primary.sessionId`), horizontal bridge connector `→` with pill badge (`link.planName`), and `secondary` (Orchestrator) cluster on right (`is-active-cluster` when `selectedSessionId === secondary.sessionId`).
    - Edges:
      - `"dispatch"`: solid cubic Bézier path (`stroke="var(--border-divider)"`, `marker-end="url(#dag-arrow)"`).
      - `"feedback"`: dashed curved return path (`stroke-dasharray="4 3"`, `marker-end="url(#dag-arrow-muted)"`) with pill label `<N> turns` / `1 turn`.
    - Node card (`<g class="dag-node" data-node-id="..." tabindex="0" role="button" aria-label="...">`):
      - `1px` border (`var(--border-card)`), `--bg-surface` fill, `rx="8"`, `4px` left accent stripe (`data-agent-type`), 3 compact text lines (never prompt/content text!):
        1. Top badge: `agentType`
        2. Primary label: truncated `roleLabel`
        3. Footer (`tabular-nums`): `<formatTokens(node.total, numberFormat)> · <formatDuration(node.wallTimeSecs)>`
    - Floating telemetry tooltip (`.dag-tooltip`, `role="status"`): shown on `mouseenter`, `focus`, `click`; dismissed on `mouseleave`, `blur`, `Escape`. Shows: `agentType · roleLabel`, `Model`, `Total`, `Input`, `Cached`, `Output`, `Cache Hit Rate`, `Wall Time`, `LLM Calls`, `Tool Calls`, and `Message Turns` (if > 0).
  - Wrap SVG inside `<div class="dag-scroll-wrap">` (`overflow-x: auto; max-width: 100%;`) + `<div class="dag-canvas-stage" style="position:relative">`.
- **`ui/src/styles/app.css` (append before `@media (max-width: 640px)` at `:2200`, plus responsive rules inside `@media (max-width: 640px)`):**
  - `.sess-name-btn`, `.sess-title-cell`, `.sess-role-pill` (`.is-planner`, `.is-orchestrator`), `.sess-badge-linked`, `.sess-row.is-selected`
  - `.dag-panel`, `.dag-panel-head`, `.dag-legend`, `.dag-close-btn`, `.dag-plan-pill`, `.dag-scroll-wrap`, `.dag-node` (`:focus-visible` with `outline: 2px solid var(--focus-ring)`), `.dag-stripe-*` per agent type using CSS variables only, `.dag-cluster-box.is-active`, `.dag-tooltip`, `.dag-empty-note`.
  - Mobile (`@media (max-width: 640px)`): `min-height: 44px` touch targets on `.sess-name-btn` and `.dag-close-btn`.

- [ ] **Step 1: Create `ui/src/dag.ts` implementing `renderOrchestrationDag`**

Author `ui/src/dag.ts` with clean helper functions (`layoutGraph`, `renderClusterSvg`, `renderTooltipHtml`, `attachDagInteractions`). Ensure zero hardcoded hex colors and zero transcript prompt text.

- [ ] **Step 2: Append `.sess-*` and `.dag-*` styles to `ui/src/styles/app.css`**

Use `tokens.css` custom properties exclusively (`var(--...)`). Verify zero hex literals in the appended CSS block.

- [ ] **Step 3: Verify typecheck, build, and zero hardcoded hex colors**

Run:
```powershell
npm --prefix ui run build
rg -n "#[0-9a-fA-F]{3,8}" ui/src/dag.ts
```
Expected: `npm --prefix ui run build` exits 0; `rg` on `ui/src/dag.ts` returns 0 matches.

---

### Task 5: Rust Tauri IPC Commands (`get_sessions_overview`, `get_session_dag`)

**Wave:** 3  
**Depends on:** Task 3  
**Files Touched:**
- Modify: `src-tauri/src/lib.rs:88-96`, `src-tauri/src/lib.rs:122-135`, `src-tauri/src/lib.rs:293-308`

**Contracts:**
- In `src-tauri/src/lib.rs` `pub mod commands`:
  - Import `SessionDagPayload`, `SessionsFilter`, `SessionsOverviewPayload` from `crate::models`.
  - Add:
    ```rust
    #[tauri::command]
    pub fn get_sessions_overview(
        filter: SessionsFilter,
        state: State<'_, AppState>,
    ) -> Result<SessionsOverviewPayload, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let scan = ensure_scan(&mut guard);
        Ok(metrics::build_sessions_overview(scan, &filter))
    }

    #[tauri::command]
    pub fn get_session_dag(
        session_id: String,
        state: State<'_, AppState>,
    ) -> Result<SessionDagPayload, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let scan = ensure_scan(&mut guard);
        metrics::build_session_dag(scan, &session_id)
    }
    ```
  - Register `commands::get_sessions_overview` and `commands::get_session_dag` inside `tauri::generate_handler![...]` (`src-tauri/src/lib.rs:293-308`).

- [ ] **Step 1: Add the two Tauri commands and register them in `generate_handler!`**

Edit `src-tauri/src/lib.rs` following the exact locking and `ensure_scan` pattern used by `get_token_usage` (`src-tauri/src/lib.rs:122-130`).

- [ ] **Step 2: Verify compilation and full Rust test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`  
Expected: PASS (0 compile errors, all tests pass).

---

### Task 6: Frontend Sessions Screen (`ui/src/screens/sessions.ts`)

**Wave:** 3  
**Depends on:** Task 2, Task 4  
**Files Touched:**
- Create: `ui/src/screens/sessions.ts`

**Contracts:**
- **Exports:**
  - `export type SessionSortColumn = "subagentCount" | "freshIn" | "cached" | "output" | "total" | "cacheHitRate" | "wallTimeSecs";`
  - `export interface SessionSortState { column: SessionSortColumn; direction: "asc" | "desc"; }`
  - `export interface SessionsCallbacks { onFilterChange: (patch: Partial<SessionsFilter>) => void; onResetFilters: () => void; onSortChange: (next: SessionSortState) => void; onSelectSession: (sessionId: string) => void; onCloseDag: () => void; onRetryDag: (sessionId: string) => void; }`
  - `export function sortSessionRows(rows: SessionOverviewRow[], sort: SessionSortState): SessionOverviewRow[]`
  - `export function renderSessions(container: HTMLElement, payload: SessionsOverviewPayload, sort: SessionSortState, selectedSessionId: string | null, dag: SessionDagPayload | null, dagLoading: boolean, dagError: string | null, numberFormat: "compact" | "full", callbacks: SessionsCallbacks): void`
- **UI Structure (reusing `.tu-*` layout & patterns from `ui/src/screens/tokenUsage.ts`):**
  1. **Header (`.tu-header`):**
     - Left: `<h1>Sessions</h1>`, `.tu-window-caption` (`windowStart – windowEnd` + `· N main sessions`).
     - Right (`.tu-filters`):
       - `<select id="sess-filter-period" aria-label="Period">` (`1d`, `1w`, `1m`, `6m`, `lifetime`).
       - `<select id="sess-filter-project" aria-label="Project">` (`All projects` + `availableProjects`).
       - Conditional `<button type="button" class="tu-reset-btn" id="sess-reset-filters">Reset</button>` only when `filter.period !== "1w" || filter.project !== null`.
  2. **Top Sessions Table Card (`.tu-table-card`):**
     - Empty state: `"No main sessions match the current filters."` + conditional `<button type="button" class="tu-reset-btn" id="sess-empty-reset">Reset filters</button>`.
     - Table inside `.tu-table-wrap`:
       - Columns: `Session` (non-sortable), `Project` (non-sortable), `Subagents`, `Input`, `Cached`, `Output`, `Total` (default desc), `Cache Hit Rate`, `Wall Time` (all 7 numeric columns sortable via `.tu-sort-btn.sess-sort-btn[data-col]` with dual-triangle SVG indicators).
       - `Session` cell renders `<button type="button" class="sess-name-btn" data-session-id="...">` + role pill (`Planner` / `Orchestrator` when `row.role !== "main"`) + `"Linked"` badge (`sess-badge-linked`, `title="Linked to ..."` using `linkedPlanName`) when `row.linkedSessionId !== null`.
       - Selected row gets `.is-selected` and `aria-pressed="true"` on its `.sess-name-btn`.
  3. **Orchestration DAG Panel (mounted below table when `selectedSessionId !== null`):**
     - `.tu-table-card.dag-panel` with header:
       - Left: selected session title + role pill; when `dag?.link` is present, subtitle `"Linked Workflow: Planner → Orchestrator"` + `<span class="dag-plan-pill">` showing `dag.link.planName`.
       - Right: edge legend (`Dispatch` solid arrow, `Feedback` dashed arrow) + `<button type="button" class="dag-close-btn" id="dag-close-btn" aria-label="Close orchestration DAG">`.
     - Body states:
       - Loading (`dagLoading && !dag`): `aria-busy="true"` loading indicator.
       - Error (`dagError`): `.tu-error-banner` (`role="alert"`) + `<button id="dag-retry-btn">Retry</button>`.
       - Ready (`dag`): `<div id="dag-canvas-host"></div>` passed to `renderOrchestrationDag(host, dag, numberFormat)`.

- [ ] **Step 1: Create `ui/src/screens/sessions.ts`**

Implement `sortSessionRows` and `renderSessions` matching the Contracts above and `ui/src/screens/tokenUsage.ts` conventions.

- [ ] **Step 2: Verify typecheck and Vite build pass**

Run: `npm --prefix ui run build`  
Expected: PASS (`tsc --noEmit && vite build` exits 0 with zero errors).

---

### Task 7: Shell Wiring, Sidebar Tab, Focus Lifecycle & Live Verification

**Wave:** 4  
**Depends on:** Task 5, Task 6  
**Files Touched:**
- Modify: `ui/src/types.ts:441`
- Modify: `ui/src/modals.ts:27-30`
- Modify: `ui/src/main.ts:5-20`, `ui/src/main.ts:43-118`, `ui/src/main.ts:214-270`, `ui/src/main.ts:306-464`, `ui/src/main.ts:636-669`, `ui/src/main.ts:723-898`

**Focus Lifecycle Contract:**
- Extend focus capture/restore (`main.ts:214-270`) to cover Sessions controls (`#sess-filter-period`, `#sess-filter-project`, `#sess-reset-filters` → fallback `#sess-filter-period`, `#sess-empty-reset` → fallback `#sess-filter-period`, `#sess-retry-btn`, `.sess-sort-btn[data-col]`, `.sess-name-btn[data-session-id]`, `#dag-close-btn` → fallback `.sess-name-btn[data-session-id]` of the previously selected session, `#dag-retry-btn`) so async re-renders, filter resets, and closing the DAG never drop focus to `document.body`.
- Pressing `Escape` while a DAG node tooltip is open dismisses the tooltip (handled in `dag.ts`); pressing `Escape` on the Sessions screen when the DAG is open and no overlay/tooltip is open can close the DAG and restore focus to the triggering `.sess-name-btn`.

**Contracts:**
1. **`ui/src/types.ts:441`:**
   - Update `export type ScreenId = "token-usage" | "sessions" | "settings";`.
2. **`ui/src/modals.ts:27-30`:**
   - Update `screens` array in `renderQuickSearchModal` to include `{ id: "sessions", label: "Sessions" }` between `"Token Usage"` and `"Settings"`.
3. **`ui/src/main.ts`:**
   - Import `SessionDagPayload`, `SessionsFilter`, `SessionsOverviewPayload` from `./types.ts` and `renderSessions`, `SessionSortState` from `./screens/sessions.ts`.
   - Extend `AppState` & `state`:
     - `sessionsFilter: SessionsFilter` (default `{ period: "1w", project: null }`)
     - `sessionsOverview: SessionsOverviewPayload | null`
     - `sessionsLoading: boolean`, `sessionsError: string | null`
     - `sessionSort: SessionSortState` (default `{ column: "total", direction: "desc" }`)
     - `selectedSessionId: string | null`
     - `sessionDag: SessionDagPayload | null`, `sessionDagLoading: boolean`, `sessionDagError: string | null`
   - Add sequence counters `let sessionsSeq = 0;` and `let sessionDagSeq = 0;` plus `refreshSessionsOverview()` and `loadSessionDag(sessionId: string)` guarding against stale async responses.
   - Update `navItems` (`main.ts:439-441`):
     ```ts
     const navItems: Array<{ id: ScreenId; label: string; icon: (s?: number) => string }> = [
       { id: "token-usage", label: "Token Usage", icon: icons.overview },
       { id: "sessions", label: "Sessions", icon: icons.sessions },
     ];
     ```
   - Update `renderMenuButton("view", ...)` (`main.ts:645-649`) to add `<button type="button" class="menu-dropdown-item" data-nav="sessions">Sessions</button>` below `Token Usage`.
   - Update `renderStatusLineInner` (`main.ts:462`) so both `"token-usage"` and `"sessions"` omit the legacy model/currency suffix.
   - Call `await refreshSessionsOverview()` in `init()` (`main.ts:412`) and `runRescan()` (`main.ts:375`), and if `state.selectedSessionId` is still selected during `runRescan()`, refresh `loadSessionDag(state.selectedSessionId)`.
   - Add `else if (state.screen === "sessions")` branch in `renderBodyOnly()` (`main.ts:818`) handling loading (`aria-busy="true"`), `role="alert"` error banner + Retry, `renderSessions(...)`, and focus restoration.
   - Guardrail: keep Data Sources, Sources sidebar section, Recent Sessions sidebar list, Overview, Projects, and Costs removed.

- [ ] **Step 1: Wire `"sessions"` across `types.ts`, `modals.ts`, and `main.ts`**

Apply the updates per the Contracts above.

- [ ] **Step 2: Run full Rust test suite and frontend build/typecheck**

Run:
```powershell
cargo test --manifest-path src-tauri/Cargo.toml
npm --prefix ui run build
```
Expected: All Rust tests pass; `tsc --noEmit && vite build` exits 0 with zero errors.

- [ ] **Step 3: Live Browser Verification (1280px Desktop & 375px Mobile + Light/Dark Theme)**

Start the Vite dev server (`npm --prefix ui run dev`) and verify in a live headless/browser session:
1. Sidebar shows **Token Usage**, **Sessions** (directly below), and pinned **Settings** (no removed screens).
2. Clicking **Sessions** opens the Sessions screen; sorting columns, filtering by Timeline/Project, and clicking **Reset** work with zero console errors.
3. Clicking the linked **Planner** or **Orchestrator** row opens the side-by-side `Planner → Orchestrator` DAG below the table with the plan filename badge, dispatch arrows, and `3 turns` feedback edge; hovering and `Tab`-focusing a node shows the telemetry tooltip; `Escape` dismisses tooltip / closes DAG and restores focus.
4. Clicking the 0-subagent row renders the single root `Main Agent` node with `"No subagents spawned in this session"`.
5. Zero page-level horizontal overflow at both `1280px` and `375px`, and crisp contrast in both Light and Dark themes.
