# Token Usage Dashboard UI Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the cluttered Overview/Projects/Costs pages with a focused **Token Usage** landing screen backed by a deterministic Rust `get_token_usage` IPC command that computes per-step model attribution, capped wall time, auto-bucketed time distributions, and sortable by-model breakdowns.

**Architecture:** The Rust backend (`src-tauri/src/`) resolves each transcript step's `observed_model` from inline `Model Selection` notices during parsing, aggregates filtered token totals, time-series buckets (`1D` hourly, `1W`/`1M` daily, `6M` weekly, `Lifetime` monthly), and by-model rows with 30-minute-capped step wall time in `metrics.rs`, and exposes `get_token_usage` in `lib.rs`. The Vanilla TypeScript frontend (`ui/src/`) renders a dedicated `tokenUsage.ts` screen with a 4-dropdown top filter bar, a front-and-centre 3-segment token bar, a collapsible minimal-axis SVG time-distribution chart, and a dual-triangle sortable by-model table, while pruning the redundant Overview, Projects, and Costs pages from the shell.

**Tech Stack:** Rust (`tauri` 2, `serde`, `chrono`, `rayon`), Vanilla TypeScript (`typescript` 5.7, `vite` 6, `@tauri-apps/api` 2.2), Plain CSS (`tokens.css` / `app.css`), inline SVG charts.

---

## Execution Waves

| Wave | Tasks | Description | Files Touched (Disjoint) |
|---|---|---|---|
| **Wave 1** | Task 1, Task 2 | Rust token-usage models + per-step `observed_model` attribution; TS token-usage types + `api.getTokenUsage` client & mock | **Task 1:** `src-tauri/src/models.rs`, `src-tauri/src/scanner/transcript.rs`, `src-tauri/tests/scanner_integration.rs`<br>**Task 2:** `ui/src/types.ts`, `ui/src/api.ts` |
| **Wave 2** | Task 3, Task 4 | Rust `build_token_usage_at` / `build_token_usage` aggregation engine; Frontend `renderTokenTimeChart` SVG chart + Token Usage CSS styles | **Task 3:** `src-tauri/src/metrics.rs`<br>**Task 4:** `ui/src/charts.ts`, `ui/src/styles/app.css` |
| **Wave 3** | Task 5, Task 6 | Rust `get_token_usage` Tauri IPC command; Frontend `Token Usage` screen (`ui/src/screens/tokenUsage.ts`) | **Task 5:** `src-tauri/src/lib.rs`<br>**Task 6:** `ui/src/screens/tokenUsage.ts` |
| **Wave 4** | Task 7 | Shell/nav cleanup (`token-usage` default, remove `overview`/`projects`/`costs`), delete obsolete screen files, full build/test & live browser QA | **Task 7:** `ui/src/types.ts`, `ui/src/main.ts`, `ui/src/modals.ts`, delete `ui/src/screens/overview.ts`, `ui/src/screens/projects.ts`, `ui/src/screens/costs.ts` |

---

## Tasks

### Task 1: Rust Token Usage Models & Per-Step `observed_model` Attribution

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Modify: `src-tauri/src/models.rs:73-97`, `src-tauri/src/models.rs:624-633`
- Modify: `src-tauri/src/scanner/transcript.rs:106-138`, `src-tauri/src/scanner/transcript.rs:198-460`
- Test: `src-tauri/tests/scanner_integration.rs:74-147`

**Contracts:**
- Add `#[serde(default)] pub observed_model: String` to `StepRecord` (`src-tauri/src/models.rs:73-97`).
- Add at end of `src-tauri/src/models.rs` (after `AboutInfo` at `:633`):
  - `pub enum TimePeriod { #[serde(rename = "1d")] OneDay, #[serde(rename = "1w")] OneWeek, #[serde(rename = "1m")] OneMonth, #[serde(rename = "6m")] SixMonths, #[serde(rename = "lifetime")] Lifetime }`
  - `#[serde(rename_all = "camelCase")] pub enum TimeGranularity { Hourly, Daily, Weekly, Monthly }`
  - `#[serde(tag = "kind", content = "agentType", rename_all = "camelCase")] pub enum AgentFilter { All, MainOnly, SubagentsOnly, AgentType(String) }`
  - `#[serde(rename_all = "camelCase")] pub struct TokenUsageFilter { pub period: TimePeriod, pub project: Option<String>, pub model: Option<String>, pub agent: AgentFilter }`
  - `#[serde(rename_all = "camelCase")] pub struct TokenUsageTotals { pub fresh_in: u64, pub cached: u64, pub output: u64, pub total: u64, pub cache_hit_rate: f64, pub wall_time_secs: u64, pub calls: u64, pub sessions: u64 }`
  - `#[serde(rename_all = "camelCase")] pub struct TimeUsageBucket { pub key: String, pub axis_label: String, pub range_label: String, pub fresh_in: u64, pub cached: u64, pub output: u64, pub total: u64 }`
  - `#[serde(rename_all = "camelCase")] pub struct ModelUsageRow { pub model: String, pub fresh_in: u64, pub cached: u64, pub output: u64, pub total: u64, pub cache_hit_rate: f64, pub wall_time_secs: u64, pub calls: u64, pub sessions: u64 }`
  - `#[serde(rename_all = "camelCase")] pub struct TokenUsagePayload { pub filter: TokenUsageFilter, pub window_start: Option<String>, pub window_end: String, pub granularity: TimeGranularity, pub available_projects: Vec<String>, pub available_models: Vec<String>, pub available_agent_types: Vec<String>, pub totals: TokenUsageTotals, pub time_series: Vec<TimeUsageBucket>, pub by_model: Vec<ModelUsageRow> }`
- Make `parse_iso_ts` `pub(crate)` in `src-tauri/src/scanner/transcript.rs:106` so `metrics.rs` can reuse it.
- In `parse_transcript_reader` (`src-tauri/src/scanner/transcript.rs:198-460`), after pushing all `StepRecord`s, run a deterministic pass `assign_observed_models(&mut out.steps)`:
  1. Find first `step.model_switch`: if `from_model` is non-empty and `!from_model.eq_ignore_ascii_case("none")`, set `current = clean_model_name(&sw.from_model)`, else `current = "Unrecorded".to_string()`.
  2. Walk `steps` in order: when `step.model_switch` is `Some(sw)`, update `current` to `clean_model_name(&sw.to_model)` (or `"Unrecorded"` if empty/None); set `step.observed_model = current.clone()`.

- [ ] **Step 1: Write the failing test**

Add test `transcript_assigns_observed_model_from_switches_and_unrecorded` in `src-tauri/tests/scanner_integration.rs` verifying:
- A transcript with step 0 (no switch), step 1 (`Model Selection` from `Gemini 3.8 Flash` to `Gemini 4 Argon`), step 2 (no switch) assigns `observed_model`: step 0 → `"Gemini 3.8 Flash"`, step 1 → `"Gemini 4 Argon"`, step 2 → `"Gemini 4 Argon"`.
- A transcript with step 0 (`Model Selection` from `None` to `Claude Sonnet 4`) assigns step 0 → `"Claude Sonnet 4"`.
- A transcript with zero switch notices assigns every step `"Unrecorded"`.

- [ ] **Step 2: Run test to verify it fails (Red)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test scanner_integration transcript_assigns_observed_model`  
Expected: FAIL to compile because `StepRecord.observed_model` does not exist yet.

- [ ] **Step 3: Write minimal implementation (Green)**

1. Add `observed_model: String` to `StepRecord` and append the 8 Token Usage structs/enums to `src-tauri/src/models.rs`.
2. Change `fn parse_iso_ts` to `pub(crate) fn parse_iso_ts` at `src-tauri/src/scanner/transcript.rs:106`.
3. Initialize `observed_model: String::new()` at `src-tauri/src/scanner/transcript.rs:438-460` and call `assign_observed_models(&mut out.steps)` before returning `Ok(out)`.

- [ ] **Step 4: Run tests to verify they pass (Green)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --test scanner_integration`  
Expected: PASS (all existing + new integration tests green).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/models.rs src-tauri/src/scanner/transcript.rs src-tauri/tests/scanner_integration.rs
git commit -m "feat(rust): add token usage models and per-step observed_model attribution"
```

---

### Task 2: Frontend TypeScript Token Usage Types & API Client

**Wave:** 1  
**Depends on:** None  
**Files Touched:**
- Modify: `ui/src/types.ts:30-52`, `ui/src/types.ts:440-452`
- Modify: `ui/src/api.ts:1-46`, `ui/src/api.ts:820-839`

**Contracts:**
- In `ui/src/types.ts`:
  - Add `observedModel?: string;` to `StepRecord` (`ui/src/types.ts:30-52`).
  - Add `"token-usage"` to `ScreenId` (`ui/src/types.ts:440-447`) while temporarily retaining `"overview" | "projects" | "costs"` until Task 7 cleans up `main.ts`/`modals.ts` so `typecheck` stays green in Wave 1.
  - Append matching TypeScript interfaces mirroring Task 1's Rust camelCase serde types: `TimePeriod`, `TimeGranularity`, `AgentFilter`, `TokenUsageFilter`, `TokenUsageTotals`, `TimeUsageBucket`, `ModelUsageRow`, `TokenUsagePayload`.
- In `ui/src/api.ts`:
  - Add `async getTokenUsage(filter: TokenUsageFilter): Promise<TokenUsagePayload>` on `export const api` (`ui/src/api.ts:18-134`): calls `invoke<TokenUsagePayload>("get_token_usage", { filter })` when `isTauri()` (`ui/src/api.ts:14-16`), else returns `mockTokenUsage(filter)`.
  - Implement `mockTokenUsage(filter: TokenUsageFilter): TokenUsagePayload` at the bottom of `ui/src/api.ts` generating deterministic realistic data across all 5 periods (`1d` 24 hourly buckets, `1w` 7 daily, `1m` 30 daily, `6m` 26 weekly, `lifetime` 6 monthly), 3 projects, 3 models + `"Unrecorded"`, and Main/Subagent (`researcher`, `implementer`) filtering. Match the Spec §4.1 contract exactly: `totals` and `timeSeries` filter by all 4 fields including `filter.model`, whereas `byModel` ignores `filter.model` (filtering only by `period`, `project`, `agent`) so clicking a model row in browser dev mode highlights rather than collapsing the table to 1 row.

- [ ] **Step 1: Verify baseline typecheck**

Run: `npm --prefix ui run typecheck`  
Expected: PASS (exit code 0).

- [ ] **Step 2: Add TypeScript types and `api.getTokenUsage` + `mockTokenUsage`**

Update `ui/src/types.ts` and `ui/src/api.ts` per the contracts above.

- [ ] **Step 3: Verify typecheck and Vite build pass**

Run: `npm --prefix ui run build`  
Expected: PASS (`tsc --noEmit && vite build` exits 0 with zero errors).

- [ ] **Step 4: Commit**

```bash
git add ui/src/types.ts ui/src/api.ts
git commit -m "feat(ui): add TokenUsage TypeScript types and getTokenUsage API client"
```

---

### Task 3: Rust `build_token_usage` Aggregation Engine

**Wave:** 2  
**Depends on:** Task 1  
**Files Touched:**
- Modify: `src-tauri/src/metrics.rs:1-15`, `src-tauri/src/metrics.rs:1015-1067`

**Contracts:**
- Add constant at top of `src-tauri/src/metrics.rs`: `pub const WALL_TIME_GAP_CAP_SECS: i64 = 1800;` (30 minutes).
- Import `DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Timelike, Utc` from `chrono`, `parse_iso_ts` from `crate::scanner::transcript`, and the new Token Usage models from `crate::models`.
- Public functions:
  - `pub fn build_token_usage(scan: &ScanResult, filter: &TokenUsageFilter) -> TokenUsagePayload` (calls `build_token_usage_at(scan, filter, Local::now())`)
  - `pub fn build_token_usage_at(scan: &ScanResult, filter: &TokenUsageFilter, now: DateTime<Local>) -> TokenUsagePayload`
- Core aggregation rules:
  1. **Dropdown options** (`available_projects`, `available_models`, `available_agent_types`): collected across **all** scanned sessions so dropdowns never collapse when filtered; `"Unrecorded"` sorted last in `available_models` if present.
  2. **Session filters**:
     - Project: `filter.project` matches `session.project` (when `Some`).
     - Agent: `All` matches all; `MainOnly` matches `session.kind == SessionKind::Main`; `SubagentsOnly` matches `session.kind == SessionKind::Subagent`; `AgentType(t)` matches `session.kind == SessionKind::Subagent && session.agent_type.as_deref() == Some(t.as_str())`.
  3. **Time window, display labels & bucket scaffold** (using `now`):
     - `window_start: Option<String>` and `window_end: String` are pre-formatted local display captions for the UI header:
       - `OneDay` (`Hourly`): 24 contiguous local hour buckets ending at `now`'s hour (`[now - 23h truncated to hour .. now truncated to hour]`). `window_start`: `Some("Nov 21, 18:00")` (`%b %-d, %H:00`), `window_end`: `"Nov 22, 17:00"`. Bucket `axis_label`: `"%H:00"`, `range_label`: `"%b %-d, %H:00–%H:00"` (e.g., `"Nov 22, 14:00–15:00"`).
       - `OneWeek` (`Daily`): 7 calendar days `[today - 6d .. today]`. `window_start`: `Some("%b %-d, %Y")`, `window_end`: `"%b %-d, %Y"`. Bucket `axis_label`: `"%b %-d"`, `range_label`: `"%b %-d, %Y"` (e.g., `"Nov 18, 2026"`).
       - `OneMonth` (`Daily`): 30 calendar days `[today - 29d .. today]`. Same date formats as `OneWeek`.
       - `SixMonths` (`Weekly`): Monday-anchored weeks covering `[today - 182d .. today]`. `window_start`/`window_end`: `"%b %-d, %Y"`. Bucket `axis_label`: `"%b %-d"`, `range_label`: `"Nov 9–15, 2026"` (or `"Oct 28 – Nov 3, 2026"` across month boundaries).
       - `Lifetime` (`Monthly`): calendar months from earliest observed step date to `today`'s month (or current month if empty). `window_start`: `Some("%b %Y")` of earliest observed month, or `None` if no steps exist; `window_end`: `"%b %Y"` of `today`. Bucket `axis_label`: `"%b '%y"`, `range_label`: `"%b %Y"` (e.g., `"Nov 2026"`).
  4. **Per-step wall time & token attribution**:
     - For each matching session, walk `session.steps` in order tracking `prev_ts: Option<DateTime<Utc>>`:
       - Parse `step_ts: Option<DateTime<Utc>> = st.created_at.as_deref().and_then(parse_iso_ts).map(|dt| dt.with_timezone(&Utc))` (note: `parse_iso_ts` at `src-tauri/src/scanner/transcript.rs:106` returns `Option<DateTime<FixedOffset>>`, so `.with_timezone(&Utc)` normalizes it).
       - If both `prev_ts` and `step_ts` exist and `step_ts >= prev_ts`, `delta = (step_ts - prev_ts).num_seconds()`; `wall = if delta <= WALL_TIME_GAP_CAP_SECS { delta as u64 } else { 0 }`; else `wall = 0`. Update `prev_ts = step_ts` (resets to `None` on undated step so undated gaps are not bridged).
       - Determine if step falls inside window (using `step_ts` converted to `Local`; for non-`OneDay` periods, fall back to `st.local_date` / `session.first_local_date` if `step_ts` is `None`; for `OneDay`, undated steps are excluded).
       - Always accumulate into `by_model[st.observed_model]` (so `by_model` respects `period`, `project`, `agent`, allowing the UI to highlight the active model row without collapsing the table).
       - If `filter.model` is `None` or matches `st.observed_model`, also accumulate into `totals` and the step's `time_series` bucket.
       - Tokens (`fresh_in`, `cached`, `output`, `total`) and `calls` increment only when `st.has_tokens`; `wall_time_secs` accumulates on all in-window steps; `sessions` counts distinct matching sessions.
  5. **Cache hit rate**: `safe_div(cached as f64, (fresh_in + cached) as f64, 0.0)` (ref `src-tauri/src/metrics.rs:14-24`). Sort `by_model` by `total` descending by default.

- [ ] **Step 1: Write failing unit tests in `src-tauri/src/metrics.rs`**

Add unit tests inside `#[cfg(test)] mod tests` (`src-tauri/src/metrics.rs:1015-1067`):
1. `token_usage_1d_hourly_buckets_and_hover_labels`: asserts 24 hourly buckets, exact token placement in the right hour, `window_start`/`window_end` display format, and `range_label` format (`"Nov 22, 14:00–15:00"`).
2. `token_usage_caps_wall_time_gaps_over_30_minutes`: asserts a 10-min gap adds `600s`, a 45-min gap adds `0s`, and mid-session model switch splits wall time and tokens accurately across both models.
3. `token_usage_filters_by_project_agent_and_model`: asserts `MainOnly`, `SubagentsOnly`, `AgentType("researcher")`, `project`, and `model` filters update `totals` and `time_series` while `by_model` keeps all models for the active period/project/agent.
4. `token_usage_cache_hit_rate_and_empty_window`: asserts `cache_hit_rate == 0.75` for `fresh=100, cached=300` and `0.0` (with `window_start == None` on `Lifetime`) when empty.

- [ ] **Step 2: Run tests to verify they fail (Red)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml metrics::tests::token_usage`  
Expected: FAIL to compile (`build_token_usage_at` not defined).

- [ ] **Step 3: Implement `build_token_usage_at` and `build_token_usage` (Green)**

Add `WALL_TIME_GAP_CAP_SECS`, window/bucket builders, and `build_token_usage_at` / `build_token_usage` in `src-tauri/src/metrics.rs`.

- [ ] **Step 4: Run tests to verify they pass (Green)**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`  
Expected: PASS (all unit + integration tests green).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/metrics.rs
git commit -m "feat(rust): implement build_token_usage aggregation with auto-bucketing and capped wall time"
```

---

### Task 4: Frontend Time-Distribution SVG Chart & Token Usage CSS

**Wave:** 2  
**Depends on:** Task 2  
**Files Touched:**
- Modify: `ui/src/charts.ts:1-15`, `ui/src/charts.ts:370-377`
- Modify: `ui/src/styles/app.css` (append Token Usage section at end of file)

**UI/UX Pro Max Direction & Token Contract:**
- **Product:** Local token telemetry view for Antigravity developers tracking exact input, cached, output, cache hit rate, and wall time.
- **Character:** Calm, exact, instrument-grade, tabular.
- **World:** Precision telemetry ledger with crisp `1px` borders, zero gradients, zero emoji.
- **Tokens (reuse `ui/src/styles/tokens.css:38-40,116-118`):** `--bg-canvas`, `--bg-surface`, `--bg-subtle`, `--border-card`, `--text-strong`, `--text-standard`, `--text-muted`, `--data-new` (Input), `--data-cached` (Cached), `--data-output` (Output), `--focus-ring`. All numeric values use `font-variant-numeric: tabular-nums`.

**Contracts:**
- Export in `ui/src/charts.ts`:
  ```ts
  export function renderTokenTimeChart(
    container: HTMLElement,
    buckets: TimeUsageBucket[],
    numberFormat: "compact" | "full"
  ): void
  ```
  - Follows the exact `.chart-wrap` + inline `<svg>` + invisible `.time-hit` `<rect>` + `.chart-tooltip` pattern from `renderDailyUsageChart` (`ui/src/charts.ts:11-177`).
  - **Minimal axes:** single subtle baseline `<line>`, single muted top max-value label on the left/right, sparse x-axis tick labels (max ~7 evenly spaced labels so 24h / 30d / 26w / >24m labels never overlap).
  - **Stacked columns:** bottom-to-top Input (`var(--data-new)`), Cached (`var(--data-cached)`), Output (`var(--data-output)`).
  - **Hover tooltip:** hovering or focusing any `.time-hit` column highlights that column (subtle tint backdrop) and shows `bucket.rangeLabel` (exact time segment covered) + Total + Input / Cached / Output counts formatted with `formatTokens` (`ui/src/format.ts:16-35`) and `formatExactTokens` (`ui/src/format.ts:12-14`).
  - **Empty state:** when all buckets have `total === 0`, renders a clean flat baseline with centered muted caption `"No token activity in this period"`.
- Append `.sr-only` utility class and `.tu-*` styles in `ui/src/styles/app.css`:
  - `.sr-only` (visually hidden screen-reader label utility: `position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0, 0, 0, 0); white-space: nowrap; border: 0;`).
  - `.tu-header` / `.tu-filters` (wraps cleanly at 375px and 1280px, `min-height: 36px` selects, `44px` touch target on mobile `@media (max-width: 640px)`, visible `2px solid var(--focus-ring)`).
  - `.tu-hero-card` + `.tu-seg-bar` (rounded 3-segment horizontal bar, `min-width: 3px` for non-zero segments, segment hover tooltip) + `.tu-seg-legend`.
  - `.tu-chart-card` + `.tu-chart-toggle` (collapsible header).
  - `.tu-table-wrap` (`overflow-x: auto`, no page overflow), `.tu-table-head`, `.tu-filter-pill`, `.tu-table`, `.tu-sort-btn` with dual stacked SVG triangles `.tu-tri-up` / `.tu-tri-down` (`.active` highlighted in `--text-strong`, inactive in `--text-faint`), clickable model rows `.tu-model-row` / `.tu-model-row.is-selected` / `.tu-model-row.is-dimmed`, and `.tu-unrecorded` muted italic style.

- [ ] **Step 1: Implement `renderTokenTimeChart` in `ui/src/charts.ts`**

Import `TimeUsageBucket` from `./types.ts` and implement `renderTokenTimeChart` per contract above.

- [ ] **Step 2: Append `.sr-only` and `.tu-*` styles to `ui/src/styles/app.css`**

Ensure light and dark mode contrast (`>= 4.5:1`) using `tokens.css` variables only (no hardcoded hex).

- [ ] **Step 3: Verify typecheck and CSS/Vite bundle build**

Run: `npm --prefix ui run build`  
Expected: PASS (exit code 0, zero TypeScript or CSS warnings/errors).

- [ ] **Step 4: Commit**

```bash
git add ui/src/charts.ts ui/src/styles/app.css
git commit -m "feat(ui): add minimal-axis token time-distribution chart and Token Usage styles"
```

---

### Task 5: Wire `get_token_usage` Tauri IPC Command

**Wave:** 3  
**Depends on:** Task 3  
**Files Touched:**
- Modify: `src-tauri/src/lib.rs:74-121`, `src-tauri/src/lib.rs:283-297`

**Contracts:**
- In `src-tauri/src/lib.rs` inside `pub mod commands` (`src-tauri/src/lib.rs:74-277`):
  - Import `TokenUsageFilter`, `TokenUsagePayload` from `crate::models`.
  - Add command following the exact `AppState` locking pattern of `get_dashboard` (`src-tauri/src/lib.rs:110-120`):
    ```rust
    #[tauri::command]
    pub fn get_token_usage(
        filter: TokenUsageFilter,
        state: State<'_, AppState>,
    ) -> Result<TokenUsagePayload, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let scan = ensure_scan(&mut guard);
        Ok(metrics::build_token_usage(scan, &filter))
    }
    ```
  - Register `commands::get_token_usage` in `tauri::generate_handler![...]` (`src-tauri/src/lib.rs:283-297`).

- [ ] **Step 1: Add command and register in `generate_handler!`**

Modify `src-tauri/src/lib.rs` per contract above.

- [ ] **Step 2: Verify full Rust compilation and test suite**

Run: `cargo test --manifest-path src-tauri/Cargo.toml`  
Expected: PASS (compiles cleanly with zero warnings on new code and all tests pass).

- [ ] **Step 3: Commit**

```bash
git add src-tauri/src/lib.rs
git commit -m "feat(rust): expose get_token_usage Tauri IPC command"
```

---

### Task 6: Implement `Token Usage` Screen (`ui/src/screens/tokenUsage.ts`)

**Wave:** 3  
**Depends on:** Task 2, Task 4  
**Files Touched:**
- Create: `ui/src/screens/tokenUsage.ts`

**Contracts:**
- Exported types & functions:
  ```ts
  export type ModelSortColumn =
    | "freshIn"
    | "cached"
    | "output"
    | "total"
    | "cacheHitRate"
    | "wallTimeSecs";

  export interface ModelSortState {
    column: ModelSortColumn;
    direction: "asc" | "desc";
  }

  export interface TokenUsageCallbacks {
    onFilterChange: (patch: Partial<TokenUsageFilter>) => void;
    onResetFilters: () => void;
    onSortChange: (next: ModelSortState) => void;
    onToggleChart: (visible: boolean) => void;
  }

  export function sortModelRows(
    rows: ModelUsageRow[],
    sort: ModelSortState
  ): ModelUsageRow[]

  export function renderTokenUsage(
    container: HTMLElement,
    payload: TokenUsagePayload,
    sort: ModelSortState,
    chartVisible: boolean,
    numberFormat: "compact" | "full",
    callbacks: TokenUsageCallbacks
  ): void
  ```
- Local formatting helper:
  - `function formatCacheHitRate(freshIn: number, cached: number, rate: number): string` — returns `"—"` when `freshIn + cached === 0`, otherwise `${(rate * 100).toFixed(1)}%` (used in both the hero card and the By-Model table so `0/0` is distinguished from `0.0%` and values `>= 10%` keep one decimal place per Spec §3.1 & §5.2).
- Component structure & behavior:
  1. **Top Header & 4-Dropdown Filter Bar**:
     - Title `"Token Usage"` + active window caption: `payload.windowStart ? \`${payload.windowStart} – ${payload.windowEnd}\` : payload.windowEnd`.
     - 4 `<select>` dropdowns each paired with `<label class="sr-only">` and `aria-label`:
       - **Period**: `1d` (`Last 24h`), `1w` (`Last 7 days`), `1m` (`Last 30 days`), `6m` (`Last 6 months`), `lifetime` (`Lifetime`).
       - **Project**: `All projects` (`""`) + `payload.availableProjects`.
       - **Model**: `All models` (`""`) + `payload.availableModels`.
       - **Agent**: `All agents` (`all`), `Main only` (`mainOnly`), `Subagents only` (`subagentsOnly`), + each `payload.availableAgentTypes` (`agentType:<name>`).
     - `Reset` button rendered only when any filter differs from defaults (`1w`, `null`, `null`, `{ kind: "all" }`).
  2. **Front-and-Centre Segmented Token Bar Card**:
     - Big tabular total token count (`formatTokens(totals.total, numberFormat)`, `title` with `formatExactTokens`), plus inline `Cache hit rate` (`formatCacheHitRate(totals.freshIn, totals.cached, totals.cacheHitRate)`) and `Wall time` (`formatDuration(totals.wallTimeSecs)`).
     - Proportional 3-segment bar (Input, Cached, Output) with `min-width: 3px` for non-zero slices and interactive hover tooltip showing exact token count & share.
     - 3-item legend directly beneath (`Input`, `Cached`, `Output` with color dot, formatted count, and percentage formatted to 1 decimal place).
     - Empty state when `totals.total === 0`: muted bar track + `"No token activity in this period"` + `Reset filters` button if filters are active.
  3. **Collapsible Time-Distribution Chart Card**:
     - Header with `"Usage over time"`, granularity pill (`Hourly`/`Daily`/`Weekly`/`Monthly`), and toggle button (`aria-expanded="${chartVisible}"`, label `"Hide chart"` / `"Show chart"`).
     - When `chartVisible` is true, mounts `renderTokenTimeChart(chartEl, payload.timeSeries, numberFormat)` (ref `ui/src/charts.ts`).
  4. **By-Model Distribution Table Card**:
     - Card header `"Distribution by model"` with an active filter context pill (`.tu-filter-pill`) summarizing any active `project`, `agent` (`kind !== "all"`), or `model` filter.
     - Columns: `Model`, `Input`, `Cached`, `Output`, `Total`, `Cache Hit Rate` (using `formatCacheHitRate`), `Wall Time`.
     - Every numeric column header is a `<button type="button" class="tu-sort-btn" data-col="...">` with `aria-sort` on the `<th>` and **two clean stacked SVG triangles** (`▲` pointing up, `▼` pointing down, `aria-hidden="true"`). Clicking toggles `desc` ↔ `asc` on the active column, or selects a new column defaulting to `desc`.
     - Rows sorted via `sortModelRows(payload.byModel, sort)`.
     - When `payload.filter.model !== null`, apply `.is-selected` to the matching row and `.is-dimmed` to non-matching rows.
     - `"Unrecorded"` rendered with `.tu-unrecorded` and `title="No Model Selection notice was recorded in these transcripts"`.
     - Clicking (or pressing `Enter`/`Space` on) a model row calls `callbacks.onFilterChange({ model: isSelected ? null : row.model })`.
     - When `payload.byModel.length === 0`, render empty-table state `"No model activity matches the current filters."`.

- [ ] **Step 1: Create `ui/src/screens/tokenUsage.ts`**

Implement `formatCacheHitRate`, `sortModelRows`, and `renderTokenUsage` using existing helpers from `../format.ts` (`escapeHtml`, `formatTokens`, `formatExactTokens`, `formatDuration`) and `renderTokenTimeChart` from `../charts.ts`.

- [ ] **Step 2: Verify TypeScript compilation and Vite build**

Run: `npm --prefix ui run build`  
Expected: PASS (exit code 0).

- [ ] **Step 3: Commit**

```bash
git add ui/src/screens/tokenUsage.ts
git commit -m "feat(ui): implement Token Usage screen with filters, segmented bar, time chart, and sortable model table"
```

---

### Task 7: Wire App Shell, Prune Redundant Screens & Live Browser Verification

**Wave:** 4  
**Depends on:** Task 5, Task 6  
**Files Touched:**
- Modify: `ui/src/types.ts:440-447`
- Modify: `ui/src/main.ts:18-1190`
- Modify: `ui/src/modals.ts:27-64`
- Delete: `ui/src/screens/overview.ts`, `ui/src/screens/projects.ts`, `ui/src/screens/costs.ts`

**Contracts:**
- `ui/src/types.ts:440-447`: finalize `ScreenId = "token-usage" | "sessions" | "session-detail" | "data-sources" | "settings"`.
- `ui/src/main.ts`:
  - Replace `renderOverview`/`renderProjects`/`renderCosts` imports (`:18,21-22`) with `renderTokenUsage`, `ModelSortState` from `./screens/tokenUsage.ts`.
  - Update `AppState` (`:32-67`):
    - Add `tokenUsageFilter: TokenUsageFilter` (default `{ period: "1w", project: null, model: null, agent: { kind: "all" } }`), `tokenUsage: TokenUsagePayload | null`, `tokenUsageError: string | null`, `modelSort: ModelSortState` (default `{ column: "total", direction: "desc" }`), `showTimeChart: boolean` (hydrated from `localStorage.getItem("agy_show_time_chart") !== "false"`).
    - Remove obsolete `AppState` fields (`dailyColorBy`, `projectRankBy`, `selectedProject`, `waterfallSource`, `forecastMethod`, `forecastHorizon`, `forecastMetric`, `forecast`, `forecastLoading`, `forecastError`) and remove the `state.selectedProject` `Escape` handler at `ui/src/main.ts:1182-1184`.
  - Default `state.screen = "token-usage"` and `state.history = [{ screen: "token-usage" }]` (`:70,72`).
  - Sidebar `navItems` (`:318-324`): `token-usage` (`"Token Usage"`, reusing `icons.overview` from `ui/src/icons.ts:85`), `sessions` (`"Sessions"`), `data-sources` (`"Data Sources"`); Settings remains in sidebar footer (`:463-468`).
  - Update `screenTitleMap` (`:342-350`), View menu (`:536-541`), Home button (`:1044` → `navigate("token-usage")`), and sidebar project click (`:1086` → set `tokenUsageFilter.project = proj`, call `refreshTokenUsage()`, and `navigate("token-usage")`).
  - Hide the legacy global filter bar (`renderFilterBarHtml`, `:498`) on `"token-usage"`, `"data-sources"`, and `"settings"`.
  - In `.status-line` (`ui/src/main.ts:507`), omit the right-hand `${state.filter.currency} · ${dash?.activeModel.name}` cost/currency readout when `state.screen === "token-usage"` so no cost/currency clutter appears on the primary view.
  - Add `refreshTokenUsage()` calling `api.getTokenUsage(state.tokenUsageFilter)` with loading (`aria-busy="true"`) and actionable error banner (`role="alert"` with Retry button). Call `refreshTokenUsage()` **after** `await api.scanAll()` completes in both `init()` (`:286-305`) and `runRescan()`, as well as on filter changes.
  - Render `renderTokenUsage(...)` in `renderBodyOnly()` when `state.screen === "token-usage"`.
  - Remove dead `loadForecast()` / `"costs"` / `"projects"` / `"overview"` branches.
- `ui/src/modals.ts:27-34`: update Quick Search `screens` list to `token-usage` (`"Token Usage"`), `sessions`, `data-sources`, `settings`; clicking a project in Quick Search sets `tokenUsageFilter.project`, calls `refreshTokenUsage()`, and navigates to `"token-usage"`.
- Delete `ui/src/screens/overview.ts`, `ui/src/screens/projects.ts`, and `ui/src/screens/costs.ts`.

- [ ] **Step 1: Update `ui/src/types.ts`, `ui/src/main.ts`, `ui/src/modals.ts` and remove obsolete screen files**

Apply all shell, routing, state, and Quick Search updates per contracts above, and delete the 3 obsolete screen files.

- [ ] **Step 2: Run full backend & frontend verification**

Run:
1. `cargo test --manifest-path src-tauri/Cargo.toml` → Expected: PASS (all Rust tests green).
2. `npm --prefix ui run build` → Expected: PASS (`tsc --noEmit && vite build` exits 0 with zero errors).

- [ ] **Step 3: Live Browser / DOM Verification (1280px & 375px)**

Start the Vite dev server (`npm --prefix ui run dev`) and verify in a real browser (via `browser` subagent or Playwright/headless check):
1. Landing screen opens directly on **Token Usage** with `Last 7 days`, `All projects`, `All models`, `All agents` selected.
2. Segmented bar renders Input / Cached / Output proportionally with legend and hover tooltips.
3. Time-distribution chart is visible by default, collapses/expands via toggle (and persists across reload), switches granularity across `1D` (Hourly) → `1W` (Daily) → `1M` (Daily) → `6M` (Weekly) → `Lifetime` (Monthly), and hovering a bar displays token breakdown + exact time segment label.
4. By-Model table shows dual `▲`/`▼` triangles on every numeric column (`Input`, `Cached`, `Output`, `Total`, `Cache Hit Rate`, `Wall Time`), sorting toggles ascending/descending accurately, and clicking a model row toggles the Model filter (highlighting the active row without collapsing the table).
5. Sidebar shows only **Token Usage**, **Sessions**, **Data Sources**, and **Settings** (no Overview/Projects/Costs), and `.status-line` shows no currency/pricing clutter on Token Usage.
6. Both `1280px` desktop and `375px` mobile layouts have zero page-level horizontal overflow, zero console errors, and zero failed requests.

- [ ] **Step 4: Commit**

```bash
git add ui/src/types.ts ui/src/main.ts ui/src/modals.ts
git rm ui/src/screens/overview.ts ui/src/screens/projects.ts ui/src/screens/costs.ts
git commit -m "feat(ui): wire Token Usage as primary landing screen and remove Overview/Projects/Costs"
```
