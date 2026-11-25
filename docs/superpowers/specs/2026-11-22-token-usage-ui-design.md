# Token Usage Dashboard UI Redesign — Design Spec

**Date:** 2026-11-22  
**Status:** Draft — Awaiting User Approval (Checkpoint 1)  
**Scope:** Rust/Tauri backend aggregation updates (`src-tauri/`) and Vanilla TypeScript frontend redesign (`ui/`)

---

## 1. Goal

Replace the cluttered multi-page Overview/Projects/Costs experience with a single, clear, concise **Token Usage** landing screen that immediately answers:
1. **How many tokens did I use, and what is the Input / Cached / Output split?** (front-and-centre segmented bar, defaulted to the last 7 days across all projects)
2. **When did heavy vs. light usage happen during that window?** (minimal-axis time-distribution bar chart with exact time-segment hover tooltips)
3. **Which models consumed those tokens, what was their cache hit rate, and how much wall time did they take?** (sortable by-model table filtered by time period, project, model, and agent/subagent)

No estimated cost clutter, no forecasts, and no speculative analytics on the primary screen — strictly observed, directly available local telemetry.

---

## 2. Confirmed User Requirements

1. **Primary Screen & Navigation**:
   - **Token Usage** becomes the primary landing screen (replacing `Overview`).
   - Sidebar retains **Token Usage**, **Sessions** (with **Session Detail** drill-down), **Data Sources**, and **Settings**.
   - Redundant **Projects** and **Costs** top-level screens are removed from navigation.
2. **Top Filter Bar (all filters at the top of Token Usage)**:
   - **Time Period**: `1D` (Last 24 hours), `1W` (Last 7 days — **default**), `1M` (Last 30 days), `6M` (Last 6 months), `Lifetime` (All time).
   - **Project**: `All projects` (**default**) + all observed projects from scanned sessions.
   - **Model**: `All models` (**default**) + all observed models from `Model Selection` notices + `Unrecorded`.
   - **Agent / Subagent**: `All` (**default**), `Main only`, `Subagents only`, plus each individual observed `agentType` (e.g., `researcher`, `implementer`, `plan-critic`).
3. **Front-and-Centre Segmented Token Bar**:
   - Displays combined **Input (fresh)**, **Cached**, and **Output** token distribution for the active filter selection.
   - Shows total token count, exact segment counts & percentages, and segment hover tooltips.
4. **Time-Distribution Chart**:
   - **Visible by default** with a compact show/hide toggle.
   - Auto-buckets by selected time period:
     - `1D` → **Hourly** (24 one-hour buckets)
     - `1W` → **Daily** (7 daily buckets)
     - `1M` → **Daily** (30 daily buckets)
     - `6M` → **Weekly** (~26 weekly buckets)
     - `Lifetime` → **Monthly** (all months from first observed step to current month)
   - Minimal axes (clean baseline, sparse muted labels, no heavy gridlines).
   - Hovering any column displays the exact token usage (Total, Input, Cached, Output) **and the exact time segment covered** (e.g., `Nov 22, 14:00–15:00`, `Nov 18, 2026`, `Nov 9–15, 2026`, `Oct 2026`).
5. **By-Model Distribution Table**:
   - Columns: `Model`, `Input`, `Cached`, `Output`, `Total`, `Cache Hit Rate`, `Wall Time`.
   - Every numeric column (`Input`, `Cached`, `Output`, `Total`, `Cache Hit Rate`, `Wall Time`) displays **two clean sort triangles** (`▲` ascending / `▼` descending) to inspect largest or smallest values.
   - Default sort: `Total` descending.
   - Clicking a model row toggles the top **Model** filter to that model (clicking again resets to `All models`).
6. **Model Attribution Rule**:
   - Raw Antigravity transcripts do not record a per-step `model` field; they log inline `Model Selection` change notices (`from X to Y`).
   - Steps from each `Model Selection` notice forward are attributed to `to_model`; steps before the first switch are attributed to `from_model` (if `from_model` is not `None`); sessions/steps with no recorded switch notice are attributed to `"Unrecorded"`. Never fabricate or guess a model.
7. **Cumulative Wall Time Rule**:
   - Sum of consecutive step-to-step timestamp deltas (`step[i].ts - step[i-1].ts`) attributed to step `i`'s model, with any single gap `> 30 minutes` (1,800 seconds) capped at `0` (or excluded as an idle break) so overnight open tabs do not inflate wall time.

---

## 3. Architecture & Data Flow

### 3.1 Per-Step Model Attribution & Wall-Time Calculation (Rust Backend)

All aggregation remains in the Rust backend (`src-tauri/src/`) so the UI receives pre-aggregated, consistent numbers over Tauri IPC.

#### Step-Level Model Resolution (`scanner/transcript.rs` / `metrics.rs`)
For each `SessionRecord` with ordered `steps`:
1. Scan `steps` for the first `step.model_switch` (if any):
   - Let `initial_model` = `first_switch.from_model` if it is non-empty and case-insensitively not `"None"`, otherwise `"Unrecorded"`.
2. Walk `steps` in order maintaining `current_model = initial_model`:
   - If `step.model_switch` is `Some(sw)`, update `current_model = normalize_model_label(&sw.to_model)` before attributing the step (and all subsequent steps until the next switch).
   - Store `observed_model: String` on `StepRecord` (or compute deterministically during scan so every step has its attributed model).
3. Normalize raw model strings by trimming whitespace and surrounding backticks. Empty/`None` resolves to `"Unrecorded"`.

#### Step-Level Wall-Time Attribution
For each `SessionRecord` with ordered `steps`:
1. Maintain `prev_ts: Option<DateTime<Utc>>` from each step's parsed `created_at`.
2. For step `i` with timestamp `ts`:
   - If `prev_ts` exists and `ts >= prev_ts`, let `delta_secs = (ts - prev_ts).num_seconds()`.
   - If `delta_secs <= 1800` (30 minutes), attribute `delta_secs` to step `i` (and therefore to step `i`'s `observed_model`, `project`, `agent_kind`/`agent_type`, and time bucket).
   - If `delta_secs > 1800`, treat the gap as an idle break and contribute `0` seconds to wall time.
   - Update `prev_ts = Some(ts)`.
3. A step only contributes its tokens and wall time if its timestamp falls within the active time-period window and matches the active `project`, `model`, and `agent` filters.

#### Cache Hit Rate Formula
For any bucket or model row:
- `input_total = fresh_in + cached`
- `cache_hit_rate = if input_total > 0 { cached as f64 / input_total as f64 } else { 0.0 }` (displayed as `0.0%`–`100.0%`, or `—` when `input_total == 0`).

### 3.2 Time-Period Windows & Bucket Granularity

Anchored to local current time (`now = Local::now()`):

| Period Key | Label | Window Definition | Bucket Granularity | Hover Segment Label Format |
|---|---|---|---|---|
| `1d` | `Last 24h` | `[now - 24h, now]` | **Hourly** (24 contiguous 1h buckets) | `Nov 22, 14:00–15:00` |
| `1w` *(default)* | `Last 7 days` | `[today - 6d 00:00, now]` (7 calendar days incl. today) | **Daily** (7 buckets) | `Nov 18, 2026` |
| `1m` | `Last 30 days` | `[today - 29d 00:00, now]` (30 calendar days incl. today) | **Daily** (30 buckets) | `Nov 18, 2026` |
| `6m` | `Last 6 months` | `[today - 182d 00:00, now]` (~26 weeks) | **Weekly** (Mon–Sun weeks) | `Nov 9–15, 2026` |
| `lifetime` | `Lifetime` | `[min_observed_ts, now]` | **Monthly** (`YYYY-MM` calendar months) | `Nov 2026` |

All zero-activity buckets within the selected window are emitted with `0` tokens so the time-distribution chart accurately reflects light/empty periods alongside heavy spikes.

---

## 4. Interfaces (Rust IPC & TypeScript Types)

### 4.1 New / Updated IPC Command

Add a dedicated, focused IPC command `get_token_usage(filter: TokenUsageFilter) -> Result<TokenUsagePayload, String>` in `src-tauri/src/lib.rs` (keeping existing `get_dashboard`, `get_session_detail`, `scan_all`, `get_settings`, `save_settings`, `get_about_info`, etc. intact for Sessions, Data Sources, and Settings).

#### Request: `TokenUsageFilter` (`#[serde(rename_all = "camelCase")]`)
```rust
pub struct TokenUsageFilter {
    pub period: TimePeriod,         // "1d" | "1w" | "1m" | "6m" | "lifetime"
    pub project: Option<String>,    // None = All projects
    pub model: Option<String>,      // None = All models; Some("Unrecorded") supported
    pub agent: AgentFilter,         // All | MainOnly | SubagentsOnly | AgentType(String)
}
```

#### Response: `TokenUsagePayload` (`#[serde(rename_all = "camelCase")]`)
```rust
pub struct TokenUsagePayload {
    pub filter: TokenUsageFilter,
    pub window_start: Option<String>,        // Local ISO / formatted start
    pub window_end: String,                  // Local ISO / formatted end
    pub granularity: TimeGranularity,        // "hourly" | "daily" | "weekly" | "monthly"

    // Filter dropdown options (computed from all scanned sessions so dropdowns never collapse)
    pub available_projects: Vec<String>,
    pub available_models: Vec<String>,       // Sorted alphabetically, "Unrecorded" last if present
    pub available_agent_types: Vec<String>,  // Distinct observed subagent agentType values

    // Segmented bar totals (respects all 4 filters)
    pub totals: TokenUsageTotals,            // freshIn, cached, output, total, cacheHitRate, wallTimeSecs, calls, sessions

    // Time-distribution chart buckets (respects all 4 filters)
    pub time_series: Vec<TimeUsageBucket>,   // key, axisLabel, rangeLabel, freshIn, cached, output, total

    // By-model table rows (respects period, project, agent; when a single model is filtered,
    // either highlights/filters to that model — see UI behavior below)
    pub by_model: Vec<ModelUsageRow>,        // model, freshIn, cached, output, total, cacheHitRate, wallTimeSecs, calls, sessions
}
```

> **Note on `by_model` when a Model filter is active:** `by_model` returns all models matching the current `period`, `project`, and `agent` filters, while the UI marks the active filtered model row as selected (and dims unselected rows or lets clicking the active row unfilter back to `All models`), so the user never gets trapped in a 1-row table and can compare or switch models in one click. Meanwhile, the segmented bar and time-distribution chart strictly reflect **all 4 filters** including the selected model.

---

## 5. UI Layout & Visual Design (`ui/`)

### 5.1 App Shell & Navigation Cleanup
- **Sidebar** (`ui/src/main.ts`):
  - Primary nav items: **Token Usage** (default), **Sessions**, **Data Sources**.
  - Footer nav item: **Settings**.
  - Remove **Overview**, **Projects**, and **Costs** from the sidebar, `ScreenId` routing, Quick Search (`Ctrl+K`), and menu bar shortcuts.
- **Persistent Global Filter Bar**:
  - Remove the old multi-screen composer filter bar (`currency`, `pricing model`, `App/CLI` toggle) from `Token Usage`, `Data Sources`, and `Settings`.
  - **Token Usage** renders its own integrated top header + 4-dropdown filter bar.
  - **Sessions** keeps its existing search + grouping + sortable session table (filtering against the active scan data).

### 5.2 Token Usage Screen Layout (Top-to-Bottom Hierarchy)

1. **Header & Unified Top Filter Bar** (single clean row, wraps gracefully on narrow viewports):
   - Left: Screen title (`Token Usage`) + subtle active window caption (e.g., `Nov 16 – Nov 22, 2026`).
   - Right: 4 compact dropdowns in consistent order:
     1. **Time Period** (`Last 24h`, `Last 7 days`, `Last 30 days`, `Last 6 months`, `Lifetime`)
     2. **Project** (`All projects`, ...)
     3. **Model** (`All models`, ...)
     4. **Agent** (`All agents`, `Main only`, `Subagents only`, `Subagent: <type>`, ...)
   - Plus a subtle `Reset` button that only appears when any filter differs from the default (`1W`, `All projects`, `All models`, `All agents`).

2. **Hero Card — Segmented Token Distribution Bar (Front & Centre)**:
   - Prominent total token headline (e.g., `12.4M tokens` with exact count on hover, `font-variant-numeric: tabular-nums`) and secondary inline metrics (`Cache hit rate: 78.4%` · `Wall time: 4h 12m`).
   - Full-width, rounded **3-segment horizontal bar** showing proportional widths of:
     - **Input (Fresh)** (distinct semantic color, e.g., blue `--token-input`)
     - **Cached** (distinct semantic color, e.g., teal/emerald `--token-cached`)
     - **Output** (distinct semantic color, e.g., amber/violet `--token-output`)
   - Clean 3-item horizontal legend directly beneath the bar showing swatch, label, exact formatted token count, and percentage share (`Input 1.8M · 14.5%`, `Cached 9.6M · 77.4%`, `Output 1.0M · 8.1%`).
   - Hovering any segment displays a crisp tooltip with exact unformatted count and share.

3. **Time-Distribution Chart Card (Collapsible, Open by Default)**:
   - Compact header row: title (`Usage over time`) + subtle granularity pill (`Hourly` / `Daily` / `Weekly` / `Monthly`) on the left, and a clean collapse/expand toggle button (`Hide chart` / `Show chart`) on the right.
   - Inline SVG stacked vertical column chart using the **same 3 colors** (Input, Cached, Output) as the segmented bar above.
   - **Minimal axes**:
     - No y-axis gridline clutter (at most a subtle baseline and a single top max-value reference label).
     - Sparse x-axis labels (first, middle, last or evenly spaced ticks so labels never collide).
   - **Hover interaction**:
     - Hovering any column highlights the column and shows a floating tooltip containing:
       - **Exact time segment covered** (e.g., `Nov 22, 14:00–15:00` or `Nov 9–15, 2026`)
       - **Total tokens**
       - **Input / Cached / Output** breakdown.

4. **By-Model Distribution Table Card**:
   - Header: `Distribution by model` (with active filter context pill if filtered by project/agent/model).
   - Table columns (right-aligned numeric columns with `tabular-nums`):
     1. `Model` (left-aligned; `"Unrecorded"` styled subtly in muted italic with tooltip explaining no `Model Selection` notice was present in the transcript)
     2. `Input`
     3. `Cached`
     4. `Output`
     5. `Total`
     6. `Cache Hit Rate`
     7. `Wall Time` (formatted cleanly as `Xh Ym`, `Xm Ys`, or `<1m`)
   - **Dual Sort Triangles**:
     - Every numeric column header renders two stacked clean SVG triangles (`▲` top, `▼` bottom).
     - Inactive triangles are muted; the active sort column highlights either `▲` (ascending / smallest first) or `▼` (descending / largest first).
     - Clicking a numeric column header toggles `desc` ↔ `asc` (clicking a new column defaults to `desc` to show largest first).
   - **Row Click**:
     - Clicking a model row toggles the top **Model** filter to that model (highlighted row border/tint); clicking the already-selected row clears the Model filter back to `All models`.

---

## 6. Error Handling, Edge Cases & Autonomous Engineering Defaults

### Edge Cases
- **Empty data / zero tokens in selected window**: Segmented bar renders an empty muted track with `0 tokens` and a brief `"No token activity in this period"` message; time chart renders a flat empty baseline; table shows `"No model activity matches the current filters."`
- **Single-segment 100% or tiny <1% segments**: Enforce a minimum visual width (e.g., `3px`) for any non-zero segment in the segmented bar so tiny output or input slices remain visible and hoverable.
- **Sessions with steps missing `created_at`**: Fall back to session `first_local_date` for daily/weekly/monthly buckets; exclude undated steps from hourly `1D` buckets and from step-gap wall-time deltas (never invent timestamps).
- **Large time spans in `Lifetime`**: If `Lifetime` spans > 24 months, x-axis labels automatically thin to quarterly/yearly ticks while every monthly bar remains hoverable.

### Autonomous Engineering Defaults (Documented Here)
- **Chart rendering**: Continue using zero-dependency inline `<svg>` in `ui/src/charts.ts` with `ResizeObserver` / clean listener disposal on re-render.
- **Formatting**: Respect existing `DisplayConfig.number_format` (`compact` vs `full`) and light/dark theme tokens in `ui/src/styles/tokens.css`; use `tabular-nums` on all numeric cells and readouts.
- **Chart toggle persistence**: Persist the `Show/Hide time distribution` toggle state in `localStorage` so it stays as the user left it across rescan/reloads.
- **Wall-time idle cap constant**: `WALL_TIME_GAP_CAP_SECS = 1800` (30 minutes) defined as a named constant in `src-tauri/src/metrics.rs`.
- **Table sort state**: Preserved in `AppState` across filter changes (default `{ column: "total", direction: "desc" }`).

---

## 7. Explicitly Out of Scope

- Estimated monetary costs (`$` / `₹`), pricing calculators, subscription comparisons, and model cost benchmarks (removed from primary navigation).
- Usage forecasting / projections (`compute_forecast` UI).
- Web search or external network/API calls.
- Porting legacy Python `agy_dash/deep.py` metrics (tool payload bytes, artifact counts, inter-agent messages, checkpoints) — can be planned in a separate follow-up spec if desired.
- File-system live watcher implementation (`notify` crate wiring).
