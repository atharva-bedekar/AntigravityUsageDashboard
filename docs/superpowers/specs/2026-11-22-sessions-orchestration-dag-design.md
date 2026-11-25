# Sessions & Orchestration DAG Design Spec

**Date:** 2026-11-22  
**Status:** Draft — Awaiting User Approval  
**Scope:** Rust/Tauri transcript scanner & backend aggregation (`src-tauri/src/`) and Vanilla TypeScript frontend (`ui/src/`)

---

## 1. Goals & Scope

This specification defines:
1. **Per-step JSON `"model"` parsing (`src-tauri/src/scanner/transcript.rs`)** so recent Antigravity App transcripts that carry a top-level `"model"` slug on `PLANNER_RESPONSE` lines resolve to canonical human-readable model display names instead of `"Unrecorded"`.
2. **A dedicated Sessions screen (`ui/src/screens/sessions.ts`) & sidebar navigation entry** showing top-level `Main` sessions with rolled-up subagent metrics, sortable columns, and timeline/project filtering.
3. **An interactive Orchestration DAG Panel** rendered directly below the Sessions table when a session is clicked, visualizing left-to-right dispatch waves, parallel subagent stacking, bidirectional `send_message` / `SYSTEM_MESSAGE` feedback turns, hover/keyboard telemetry tooltips, and **side-by-side cross-session `Planner → Orchestrator` workflow linking** when two sessions share a `docs/superpowers/(plans|specs)/*.md` artifact.

---

## 2. Per-Step JSON `"model"` Parsing & Normalization (`src-tauri/src/scanner/transcript.rs`)

### 2.1 Motivation
Recent Antigravity App transcripts emit a top-level `"model"` string field on `PLANNER_RESPONSE` JSONL lines (e.g., `"gemini-4-neon-medium"`, `"gemini-4-argon-medium"`, `"gemini-4-hydrogen-tiered-high"`), often without any inline `Model Selection` change notice — especially inside spawned subagents. Currently `parse_transcript_reader` only looks at `Model Selection` text notices (`extract_model_switch`), causing recent main sessions and subagents to be reported as `"Unrecorded"`.

### 2.2 Normalization Rules (`normalize_model_slug`)
Convert raw slug values into canonical display names that match `Model Selection` labels:
1. Trim whitespace and surrounding backticks. If empty or case-insensitively `"none"`, treat as invalid/absent.
2. Validate characters with `is_valid_model_name` so corrupted/regex strings are rejected.
3. If the value looks like a hyphenated slug (contains `-` and no spaces, e.g. `"gemini-4-hydrogen-tiered-high"`):
   - Split on `-` into tokens.
   - Strip `-tiered` tokens (case-insensitive).
   - Strip a trailing effort/mode suffix token if it matches `high | medium | low | minimal | max | thinking | fast | default` (case-insensitive, stripping repeatedly if stacked such as `-tiered-high`).
   - Title-case alphabetical word tokens while preserving numeric/version tokens (`"4"`, `"3.8"`, `"5.5"`, etc.) verbatim:
     - `"gemini-4-hydrogen-tiered-high"` → `"Gemini 4 Hydrogen"`
     - `"gemini-4-neon-medium"` → `"Gemini 4 Neon"`
     - `"gemini-4-argon-medium"` → `"Gemini 4 Argon"`
     - `"claude-4.5-sonnet-thinking"` → `"Claude 4.5 Sonnet"`
4. If the value already contains spaces (e.g., `"Gemini 3.8 Flash (High)"` from `Model Selection` notices), apply existing `clean_model_name` + `thinking_suffix_re` stripping so both `PLANNER_RESPONSE.model` and `Model Selection` converge on identical canonical labels.
5. Truncate final display label to 60 characters (`truncate_chars`).

### 2.3 Per-Step Attribution Priority (`assign_observed_models`)
Store an `explicit_model: Option<String>` (extracted only when `type_upper == "PLANNER_RESPONSE"` and top-level `"model"` is a valid non-empty string, normalized via `normalize_model_slug`) alongside `model_switch: Option<ModelSwitchRecord>` while walking JSONL lines.

During `assign_observed_models(&mut out.steps)`:
- Initialize `current_switch_model` from the first `step.model_switch` (`from_model` if non-empty and not `"None"`), else `"Unrecorded"`.
- For each step in chronological order:
  1. If `step.model_switch` is `Some(sw)`, update `current_switch_model = normalize_model_label(&sw.to_model)`.
  2. Resolve `step.observed_model` with strict per-step priority:
     - **Priority 1:** If step `i` has a valid explicit `PLANNER_RESPONSE.model`, set `step.observed_model` to that normalized model name and update `last_explicit_model = Some(explicit)`.
     - **Priority 2:** Else if `Model Selection` switch propagation has established a model (`current_switch_model != "Unrecorded"`), set `step.observed_model = current_switch_model`.
     - **Priority 3:** Else if a prior `PLANNER_RESPONSE.model` was observed earlier in the session (for intermediate tool-output steps before the next `PLANNER_RESPONSE`), carry `last_explicit_model`; otherwise `"Unrecorded"`.
     - If an explicit `Model Selection` notice occurs later, `current_switch_model` updates cleanly; any subsequent `PLANNER_RESPONSE.model` continues to win for that specific `PLANNER_RESPONSE` step.
- **Backward Compatibility:** Older transcripts lacking `"model"` on `PLANNER_RESPONSE` lines produce `explicit_model = None` on every step, yielding identical behavior to the current `Model Selection` propagation and `"Unrecorded"` fallback.

---

## 3. Sessions Page & Sidebar Navigation (`ui/src/`)

### 3.1 Sidebar & Routing (`ui/src/types.ts`, `ui/src/main.ts`, `ui/src/modals.ts`)
- Update `ScreenId`:
  ```ts
  export type ScreenId = "token-usage" | "sessions" | "settings";
  ```
- Update `navItems` in `ui/src/main.ts`:
  1. **Token Usage** (`id: "token-usage"`, `icons.overview`)
  2. **Sessions** (`id: "sessions"`, `icons.sessions`) — directly below **Token Usage**
- Keep **Settings** pinned in `.sidebar-footer` (`id="sb-nav-settings"`).
- Add `"Sessions"` to the `View` menu dropdown (`data-nav="sessions"`) and Quick Search (`Ctrl+K`) screen shortcuts.
- **Guardrail:** Keep Data Sources, Sources sidebar section, Recent Sessions sidebar list, Overview, Projects, and Costs removed.

### 3.2 Sessions Top Filter Bar (`ui/src/screens/sessions.ts`)
Mirror the `.tu-header` + `.tu-filters` layout from `ui/src/screens/tokenUsage.ts`:
- Left: Screen title `Sessions` + window caption (e.g., `Nov 16 – Nov 22, 2026` or `Lifetime`) and subtle session count (`N main sessions`).
- Right:
  1. **Timeline** (`<select id="sess-filter-period">`): `1d` (`Last 24h`), `1w` (`Last 7 days`, **default**), `1m` (`Last 30 days`), `6m` (`Last 6 months`), `lifetime` (`Lifetime`).
  2. **Project** (`<select id="sess-filter-project">`): `All projects` (**default**) + distinct sorted project names.
  3. **Reset** (`<button id="sess-reset-filters">`): rendered conditionally only when `period !== "1w" || project !== null`.

### 3.3 Top Sessions Table
Displays **top-level `Main` sessions only** (`SessionKind::Main`, excluding subagent rows from the table; subagents are rolled up into their parent session's subagent count, aggregate token totals, and DAG).

#### Columns
| Column | Alignment | Content / Behavior | Sortable |
|---|---|---|---|
| **Session** | Left | `<button type="button" class="sess-name-btn">` with session title + subtle `"Linked"` badge (`sess-badge-linked`) when linked to a counterpart + role pill (`Planner` / `Orchestrator`) when detected (`role !== "main"`). Clicking selects/toggles the session in `.is-selected` state and opens/updates the Orchestration DAG Panel below. | No |
| **Project** | Left | Project name (muted if `"Unattributed"`) | No |
| **Subagents** | Right (`tabular-nums`) | Count of subagents invoked (`subagentCount`) | Yes (`subagentCount`) |
| **Input** | Right (`tabular-nums`) | Rolled-up fresh input tokens (`freshIn`, formatted via `formatTokens`) | Yes (`freshIn`) |
| **Cached** | Right (`tabular-nums`) | Rolled-up cached read tokens (`cached`) | Yes (`cached`) |
| **Output** | Right (`tabular-nums`) | Rolled-up output tokens (`output`) | Yes (`output`) |
| **Total** | Right (`tabular-nums`) | Rolled-up total tokens (`total`) — **default sort descending** | Yes (`total`) |
| **Cache Hit Rate** | Right (`tabular-nums`) | `formatCacheHitRate(freshIn, cached, cacheHitRate)` (`—` when `freshIn + cached === 0`) | Yes (`cacheHitRate`) |
| **Wall Time** | Right (`tabular-nums`) | 30-min-capped wall time (`formatDuration(wallTimeSecs)`) | Yes (`wallTimeSecs`) |

- **Sortable Headers:** Reuse the exact dual-triangle SVG header pattern (`ModelSortColumn` / `.tu-sort-btn` + `.tu-sort-icons`) with `SessionSortColumn = "subagentCount" | "freshIn" | "cached" | "output" | "total" | "cacheHitRate" | "wallTimeSecs"`, defaulting to `{ column: "total", direction: "desc" }`.
- **Rolled-up Main Session Telemetry:** A top-level row's `freshIn`, `cached`, `output`, `total`, `cacheHitRate`, and `wallTimeSecs` aggregate the main session plus all descendant subagents within the selected timeline window (using the 30-minute `WALL_TIME_GAP_CAP_SECS = 1800` step-delta cap per session), while individual node metrics remain visible inside the DAG panel. (The row also tracks `ownTotal` vs `rolledUpTotal` if needed, with table cells displaying the rolled-up session family usage.)
- **Selection Behavior:** Clicking a session's `<button>` selects that row (`.is-selected`) and opens/updates the Orchestration DAG Panel below the table. Clicking the already-selected session's button collapses the DAG panel (or clicking the DAG header's close `×` button closes it).

---

## 4. Orchestration DAG Panel (Below the Sessions Table)

### 4.1 Panel Container & Header
Rendered inside a `.tu-table-card`-styled container directly below the Sessions table whenever `selectedSessionId !== null`:
- **Header left:**
  - Title: Selected session's title (or workflow title) + role pill (`Planner` / `Orchestrator` / `Main`).
  - Subtitle when linked: `"Linked Workflow: Planner → Orchestrator"` + monospace plan/spec pill showing `linkedPlanName` (e.g., `2026-11-22-token-usage-ui-plan.md`).
- **Header right:**
  - Compact legend for edge types (`──▶ Dispatch`, `- -▶ Feedback / turns`) and a crisp close `<button type="button" aria-label="Close orchestration DAG">`.
- **Viewport & Scroll Safety:**
  - The SVG canvas sits inside a horizontal scroll wrapper (`.dag-scroll-wrap { overflow-x: auto; max-width: 100%; }`) so wide multi-wave or linked workflows scroll cleanly inside the card with zero page-level horizontal overflow at `1280px` and `375px`.

### 4.2 Left-to-Right Flow Layout (Inline SVG)
- **Direction:** Strict left → right.
- **Root Node (Column 0):** The main-agent session node (`Planner`, `Orchestrator`, or `Main Agent`), vertically centered against its downstream waves.
- **Dispatch Wave Columns (Columns 1..N):**
  - Child subagents are grouped into chronological **dispatch waves** based on `spawn_step_index` (or fallback `first_utc` overlap):
    - Subagents dispatched within the same parent `PLANNER_RESPONSE` turn (same `spawn_step_index`) or whose `[first_utc, last_utc]` execution intervals overlap when `spawn_step_index` is missing belong to the **same wave column** and **stack vertically**.
    - Distinct later dispatches advance to the next wave column to the right.
- **Node Card Anatomy (`foreignObject` or crisp SVG `<g>` + HTML overlay / native SVG geometry):**
  - Recommended implementation: crisp SVG `<g class="dag-node" tabindex="0" role="button" aria-label="...">` cards (or HTML-accessible SVG nodes) with `1px` border (`--border-card`), `--bg-surface` fill, rounded corners (`rx="8"`), and a `4px` accent left stripe keyed by `agentType` mapped solely through CSS custom properties in `tokens.css` (zero hardcoded hex colors in JS/TS):
    - `planner` / `orchestrator` / `main`: `--cli-blue` / `--text-strong`
    - `researcher`: `--data-new`
    - `plan-critic`: `--status-warn`
    - `implementer`: `--status-ok`
    - `code-reviewer`: `--source-cli`
    - `verifier`: `--source-custom`
    - `worker` / `subagent` / other: `--text-muted`
  - **Node text lines (3 compact lines, zero prompt text):**
    1. **Top badge:** Agent / subagent `agentType` (`TypeName`, e.g., `plan-critic`, `implementer`, `researcher`, `code-reviewer`, `verifier`, or `Planner` / `Orchestrator` / `Main Agent`).
    2. **Primary label:** Custom `role` given by the main agent (`subagentDescriptor.role`, e.g., `"Rust Models & Transcript Implementer"`), falling back to truncated session `title` or `agentType` if unnamed, truncated cleanly with ellipsis to fit the card width.
    3. **Compact footer metric (`tabular-nums`):** `<formatted total tokens> · <formatted wall time>` (e.g., `1.42M · 3m 12s`).

### 4.3 Edges & Feedback Indicators
- **Dispatch Edge (Solid `→`):** Smooth cubic Bézier SVG path with `marker-end` arrowhead connecting the parent root (or preceding wave spine) to each subagent node in its dispatch wave.
- **Return / Feedback Edge & Turn Badge (`- -▶`):** When `messageTurns > 0` (back-and-forth `send_message` / `SYSTEM_MESSAGE` exchanges between parent and subagent, such as `Planner ↔ Plan Critic` iterations):
  - Render a subtle dashed return curve below/above the dispatch edge and a compact pill badge on the edge (`2 turns`, `3 msgs`, etc.) using `--border-divider` / `--text-muted` tokens.

### 4.4 Hover & Keyboard Focus Tooltip
Every agent and subagent node has `tabindex="0"` and triggers a floating telemetry tooltip on `mouseenter`, `focus`, and `click` (dismissed on `mouseleave`, `blur`, `Escape`):
- **Agent type & custom role/name** (e.g., `plan-critic · Plan Critic`)
- **Model:** Canonical normalized model name (or comma-separated list if multiple models were used across steps, or `"Unrecorded"`)
- **Token breakdown (`tabular-nums`):**
  - **Total**
  - **Input** (fresh)
  - **Cached**
  - **Output**
  - **Cache Hit Rate** (`formatCacheHitRate`)
- **Execution telemetry:**
  - **Wall time** (30-min-capped `formatDuration(wallTimeSecs)`)
  - **LLM calls** (`calls`) and **Tool calls** (`toolCallCount`)
- **Privacy Guardrail:** Never include raw prompts, `USER_INPUT`, `thinking`, or `content` snippets in the DAG node labels or tooltip.

### 4.5 Cross-Session `Planner → Orchestrator` Side-by-Side View
When the selected session has a linked counterpart (`link !== null`):
- The DAG panel renders **both session graphs side-by-side left-to-right** in one unified SVG canvas:
  1. **Left Cluster — Planner Session:** Planner root node + its chronological `researcher` / `plan-critic` waves.
  2. **Bridge Connector:** A prominent horizontal connecting arrow (`→`) between the Planner cluster and the Orchestrator cluster, labeled with a pill badge showing the shared plan/spec filename (e.g., `2026-11-22-token-usage-ui-plan.md`).
  3. **Right Cluster — Orchestrator Session:** Orchestrator root node + its chronological `implementer` / `code-reviewer` / `verifier` waves.
- **Active Cluster Highlight:** Clicking either the **Planner** row OR the **Orchestrator** row in the top Sessions table opens this exact combined `Planner → Orchestrator` DAG, with a subtle `--focus-ring` / `--bg-subtle` cluster outline indicating which of the two rows is currently selected in the table.

---

## 5. Backend Data Extraction & Linking Rules (`src-tauri/src/`)

### 5.1 Plan / Spec Path Extraction (`src-tauri/src/scanner/transcript.rs`)
Add `written_plan_paths: Vec<String>` and `referenced_plan_paths: Vec<String>` to `ParsedTranscript` and `SessionRecord` (sorted, deduplicated canonical keys).

#### Scanning Sources per Step
Scan only high-signal fields and explicitly **skip noisy `GENERIC` tool output steps** (such as `git status` or `rg --files` listings):
1. **`USER_INPUT` `content`:** Scan `@[...]` mentions and inline file paths → add to `referenced_plan_paths`.
2. **`PLANNER_RESPONSE` `tool_calls[].args`:**
   - For `write_file`, `write_to_file`, `edit_file`, `replace_file_content`, `multi_replace_file_content` (inspecting `Path`, `TargetFile`, `path`, `filePath`): add extracted canonical key to `written_plan_paths`.
   - For `read_file`, `view_file` (inspecting `Path`, `AbsolutePath`, `path`): add extracted canonical key to `referenced_plan_paths`.
3. **`PLANNER_RESPONSE` `content`:** Scan narrative text / markdown links for paths → add to `referenced_plan_paths` (unless already in `written_plan_paths`).

#### Canonical Path Normalization
1. Replace `\\` and `\` with `/`.
2. Strip surrounding quotes (`"`, `'`, `` ` ``), `@[`, `]`, and trailing `#L123` / `#L12-L34` line anchors.
3. Match case-insensitively against regex:
   `docs/superpowers/(plans|specs)/([A-Za-z0-9._-]+\.md)`
4. Lowercase the matched key (`docs/superpowers/plans/<file>.md` or `docs/superpowers/specs/<file>.md`).
5. **Template Placeholder Filter:** Reject placeholder examples such as `yyyy-mm-dd-...` (case-insensitive) or filenames containing `<` / `>` / `{` / `}`.

### 5.2 Subagent Dispatch & Messaging Metadata (`subagents.rs`, `transcript.rs`)
- **`SubagentLink` (`models.rs`, `subagents.rs`):**
  Add `pub spawn_step_index: Option<i64>` parsed from `subagents/*.json` (`spawnStepIndex` / `spawn_step_index` when present), propagated onto `SessionRecord.spawn_step_index: Option<i64>`.
- **Parent `GENERIC` Creation & `SYSTEM_MESSAGE` Turn Tracking (`transcript.rs`):**
  - On `GENERIC` steps in a parent session, inspect `content` for subagent creation outputs containing `conversationId` / `conversation_id` UUIDs; record `(step_index, child_conversation_id)` in `ParsedTranscript.spawned_conversations` so if `subagents/*.json` lacks `spawnStepIndex`, the parent step index where the subagent was created still determines its exact wave.
  - On `SYSTEM_MESSAGE` steps, parse `[Message] ... sender=<uuid>` lines (and count outbound `send_message` tool calls whose `args.Recipient` matches a child `conversationId`) to compute `message_turns: HashMap<String, u64>` (persisted on `ParsedTranscript` / `SessionRecord`) representing bidirectional turn exchanges between parent and each child subagent.

### 5.3 Main Session Role Classification (`src-tauri/src/metrics.rs`)
Define `pub enum SessionRole { Planner, Orchestrator, Main }` (`#[serde(rename_all = "camelCase")]`):
For each top-level (`SessionKind::Main`) session with its direct child subagent `agent_type` values:
- **`Planner`:**
  - Authored (`written_plan_paths` non-empty) a `docs/superpowers/(plans|specs)/*.md` file, **OR**
  - Spawned a `plan-critic` subagent without spawning `implementer` or `verifier`.
- **`Orchestrator`:**
  - Referenced/read (`referenced_plan_paths` contains a `docs/superpowers/plans/*.md` file and `written_plan_paths` does not contain that plan) **OR**
  - Spawned `implementer`, `code-reviewer`, or `verifier` subagents.
- **`Main`:** Standard session satisfying neither rule.
*(Tie-breaker if a single session both writes a plan and implements it: classify as `Orchestrator` if it spawns `implementer`/`verifier`, otherwise `Planner`.)*

### 5.4 Cross-Session `Planner → Orchestrator` Linking (`src-tauri/src/metrics.rs`)
Between distinct top-level (`SessionKind::Main`) sessions:
1. Extract matching keys for each session:
   - Exact canonical key: `docs/superpowers/(plans|specs)/<filename>.md`
   - Stem key (for pairing a spec with its plan): strip `-design.md`, `-spec.md`, `-plan.md`, `.md` after `<YYYY-MM-DD>-<slug>` when both share the same date + slug (e.g., `2026-11-22-token-usage-ui-design.md` ↔ `2026-11-22-token-usage-ui-plan.md`). Exact `plans/<file>.md` matches take precedence over stem matches.
2. When a candidate `Planner` session (authored the plan/spec or earlier session with `plan-critic`) and a distinct `Orchestrator` session (consumed the plan or later session with `implementer`/`verifier`) share a key:
   - Pair the `Planner` → `Orchestrator` (preferring the closest chronological `Planner` preceding the `Orchestrator`).
   - Populate on each session row:
     - `linked_session_id: Option<String>`
     - `link_direction: Option<SessionLinkDirection>` (`"toOrchestrator" | "fromPlanner"`)
     - `linked_plan_name: Option<String>` (basename e.g. `2026-11-22-token-usage-ui-plan.md`)

---

## 6. Interfaces: Rust IPC Models, Commands & TypeScript Types

### 6.1 Rust Models (`src-tauri/src/models.rs`) & Commands (`src-tauri/src/lib.rs`)
All structs use `#[serde(rename_all = "camelCase")]`:

```rust
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionRole {
    Planner,
    Orchestrator,
    Main,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionLinkDirection {
    ToOrchestrator,
    FromPlanner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsFilter {
    pub period: TimePeriod,         // "1d" | "1w" | "1m" | "6m" | "lifetime"
    pub project: Option<String>,    // None = All projects
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverviewRow {
    pub session_id: String,
    pub title: String,
    pub project: String,
    pub source: SourceKind,
    pub role: SessionRole,
    pub subagent_count: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub wall_time_secs: u64,
    pub calls: u64,
    pub first_utc: Option<String>,
    pub last_utc: Option<String>,
    pub linked_session_id: Option<String>,
    pub link_direction: Option<SessionLinkDirection>,
    pub linked_plan_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsOverviewPayload {
    pub filter: SessionsFilter,
    pub window_start: Option<String>,
    pub window_end: String,
    pub available_projects: Vec<String>,
    pub sessions: Vec<SessionOverviewRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagNode {
    pub node_id: String,            // session_id
    pub session_id: String,
    pub parent_node_id: Option<String>,
    pub is_root: bool,
    pub wave_index: u32,            // 0 = root, 1..N = chronological dispatch waves
    pub agent_type: String,         // "Planner" | "Orchestrator" | "Main Agent" | "researcher" | "plan-critic" | "implementer" | ...
    pub role_label: String,         // subagentDescriptor.role or fallback title/type
    pub model: String,              // primary or comma-joined normalized model(s), or "Unrecorded"
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub wall_time_secs: u64,
    pub calls: u64,
    pub tool_call_count: u64,
    pub message_turns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagEdge {
    pub from_node_id: String,
    pub to_node_id: String,
    pub kind: String,               // "dispatch" | "feedback"
    pub message_turns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDagGraph {
    pub session_id: String,
    pub title: String,
    pub project: String,
    pub role: SessionRole,
    pub wave_count: u32,
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossSessionLink {
    pub planner_session_id: String,
    pub orchestrator_session_id: String,
    pub plan_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDagPayload {
    pub selected_session_id: String,
    pub primary: SessionDagGraph,   // Planner when linked, else the selected session
    pub secondary: Option<SessionDagGraph>, // Orchestrator when linked
    pub link: Option<CrossSessionLink>,
}
```

Register two new Tauri commands in `src-tauri/src/lib.rs` (`commands` module + `tauri::generate_handler!`):
- `get_sessions_overview(filter: SessionsFilter, state: State<'_, AppState>) -> Result<SessionsOverviewPayload, String>`
- `get_session_dag(session_id: String, state: State<'_, AppState>) -> Result<SessionDagPayload, String>`

### 6.2 TypeScript Types & Browser Dev Mocks (`ui/src/types.ts`, `ui/src/api.ts`)
- Mirror all structs above in `ui/src/types.ts`.
- Add `api.getSessionsOverview(filter: SessionsFilter): Promise<SessionsOverviewPayload>` and `api.getSessionDag(sessionId: string): Promise<SessionDagPayload>` in `ui/src/api.ts`.
- Provide deterministic browser dev mock data in `ui/src/api.ts` for non-Tauri mode (`!isTauri()`), including:
  - A linked **Planner → Orchestrator** pair sharing `2026-11-22-token-usage-ui-plan.md`:
    - Planner session with `researcher` wave + `plan-critic` wave showing `3 turns` feedback edge (`Gemini 4 Hydrogen`, `Gemini 4 Neon`).
    - Orchestrator session with parallel `implementer` waves, `code-reviewer` wave, and `verifier` wave (`Gemini 4 Argon`, `Gemini 4 Neon`, `Gemini 4 Hydrogen`).
  - Standalone `Main` sessions (both with subagents and 0-subagent single-node sessions) across multiple projects and timestamps.

---

## 7. Non-Goals, Edge Cases & Guardrails

1. **Removed Screens Remain Removed:** Do NOT reintroduce Data Sources, Sources sidebar section, Recent Sessions sidebar list, Overview, Projects, or Costs pages.
2. **Privacy in Telemetry & Tooltips:** Do NOT expose raw transcript prompts, `USER_INPUT` text, `thinking` text, or file contents in DAG nodes or tooltips — display structural telemetry only (agent type, custom role/name, model, tokens, wall time, LLM calls, tool calls, turn counts).
3. **Zero Hardcoded Hex Colors:** All DAG node borders, accent stripes, edges, badges, and tooltips must reference CSS variables from `ui/src/styles/tokens.css` so light and dark themes work automatically.
4. **Typography & Borders:** Crisp `1px` borders (`--border-card`), `font-variant-numeric: tabular-nums` on all numeric columns and DAG metrics.
5. **Accessibility & Keyboard Navigation:** Every DAG node has `tabindex="0"`, descriptive `aria-label`, and visible `:focus-visible` ring; hovering or focusing opens the telemetry tooltip, `Escape` closes it.
6. **Responsive Overflow:** Wrap wide DAG SVGs inside a horizontal scroll container (`.dag-scroll-wrap`) so `1280px` desktop and `375px` narrow viewports have zero page-level horizontal overflow.
7. **Edge Cases:**
   - **0-subagent session:** Renders a single root `Main Agent` node in the DAG panel with `"No subagents spawned in this session"`.
   - **Orphan / nested subagents:** Subagents whose `parent_id` is itself a subagent attach to that parent node in the next wave column (`wave_index = parent.wave_index + 1`).
   - **Missing `spawn_step_index`:** Group child subagents into waves by overlapping `[first_utc, last_utc]` intervals ordered chronologically; if timestamps are missing, place sequentially in wave 1.
   - **Empty Sessions filter result:** Render an inline empty state inside the table card with a conditional `"Reset filters"` button when filters differ from default (`1w`, `All projects`).
