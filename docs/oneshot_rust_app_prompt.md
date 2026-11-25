# One-Shot Master Prompt: Antigravity Usage (Native Windows Rust Application)

> **How to use this document:** Copy everything inside the prompt block below (or pass this entire file) to your coding agent / builder. Pair it with the two reference screenshots (`docs/Screenshot 2026-11-15 205048.png` and `docs/Screenshot 2026-11-15 205007.png`) if the agent supports image inputs.

---

```markdown
# ROLE & OBJECTIVE

You are a Staff Rust Systems & Desktop UI Engineer. Your mission is to perform a complete **one-shot overhaul** of this repository and build **Antigravity Usage**, a native Windows 11 desktop application written in Rust that reads, attributes, prices, and visualizes local token usage across **both** **Antigravity 2.0 App** (`~/.gemini/antigravity`) and **Antigravity CLI** (`~/.gemini/antigravity-cli`).

The application must look and feel like a native companion window to the latest **Antigravity 2.0 App** (monochrome zinc/white chrome, Google Sans typography, raised white sidebar selection pills, composer-style filter bar) while using the **Antigravity CLI** light-theme semantic palette strictly for data meaning, status, and CLI provenance.

---

# 1. NON-NEGOTIABLE GUARDRAILS

1. **Strictly Read-Only & Offline:**
   - Never create, modify, lock, or delete any file inside `~/.gemini/antigravity` or `~/.gemini/antigravity-cli`.
   - Open `~/.gemini/antigravity/conversation_summaries.db` in **read-only mode** (`SQLITE_OPEN_READ_ONLY` / `?mode=ro&immutable=1`). If SQLite WAL locks or concurrent App writes occur, fall back cleanly to copying the `.db` (and `-wal`/`-shm` if present) to a temp buffer in memory/app-cache or opening with `nolock=1` so the running Antigravity App is never blocked.
   - Make zero network calls. Bind no public ports. Send zero telemetry.
2. **Data Integrity & Epistemic Honesty:**
   - **Never show a standalone "Total Tokens" headline without immediately splitting it into `New input`, `Cached input`, and `Output`.** (~90% of volume is cached context reads billed at ~1/10th price; a single total is misleading.)
   - **Token share vs. Cost share** must be displayed side by side.
   - **Costs are estimates (`≈`), never facts.** Transcripts do not record per-step model IDs; costs are always `tokens × selected_model_price` for the observed date. Mark every cost with `≈` and a tooltip explaining why.
   - **Calendar completeness:** Missing days between the first and last observed dates must be rendered as explicit `0` bars on time-series charts—never smoothed over or omitted.
   - **Explicit unknowns:** Never render empty cells, `null`, `(not in history.jsonl)`, or `(unknown)`. Use explicit human labels: `Untitled session` (with short ID chip), `Unattributed` (for missing project/workspace), and count skipped/unreadable binary `.pb`-only sessions on the Data Sources screen.
3. **Zero Divisions & Safe Math:**
   - Every ratio/rate calculation must go through `safe_div(num, den, default)` returning `0.0` when `den == 0` or inputs are non-finite. `NaN` or `Inf` must never reach the UI.

---

# 2. TECHNICAL STACK & REPOSITORY LAYOUT

Build a workspace or clean crate layout at the repository root (keep existing Python files intact or under `legacy/` only if needed for reference, or place the Rust project cleanly at Cargo root `Cargo.toml`):

- **Recommended Stack:** **Tauri v2 (Rust backend + native WebView2 window on Windows 11)** OR **iced / egui / GPUI / Dioxus Desktop**—choose **Tauri v2 + Rust core + TypeScript/Vanilla-or-React + SVG/Canvas charts** (or pure Rust UI if you can hit 100% pixel fidelity to the design spec below).
  - *Why Tauri v2 is preferred here:* Windows 11 WebView2 is preinstalled, allows exact CSS/font/SVG fidelity to the Antigravity 2.0 Electron/Chromium visual system, supports custom window chrome, and keeps 100% of file scanning, SQLite reading, pricing, statistics, and snapshots in fast, multi-threaded Rust commands.
- **Rust Crates:**
  - `serde`, `serde_json` (streaming line-by-line JSONL parsing via `BufReader`)
  - `rusqlite` (with `bundled` feature for reading `conversation_summaries.db` read-only and managing local `snapshots.db`)
  - `chrono` (ISO-8601 timestamp parsing with timezone conversion to local calendar dates)
  - `rayon` (parallel scanning across session directories)
  - `notify` (optional file-watcher for live session updates when enabled in Settings)
  - `regex` (tool name validation, command exit code & duration extraction, model switch parsing)
  - `rand`, `rand_distr` (seeded RNG for Bootstrap & Monte Carlo forecasting)
  - `url` / percent-decoding (for converting `file:///...` `workspace_uris` into clean Windows paths like `D:\Code\AntigravityUsageDashboard`)

### Proposed Module Architecture (`src/` or `src-tauri/src/`)
```text
src/
├── main.rs / lib.rs          # App entry, window configuration, IPC/command handlers
├── config.rs                 # Multi-source config loader/saver, defaults, validation
├── scanner/
│   ├── mod.rs                # Parallel multi-root orchestrator & scan diagnostics
│   ├── transcript.rs         # Fast streaming transcript.jsonl / transcript_full.jsonl parser
│   ├── app_meta.rs           # Read-only SQLite reader for ~/.gemini/antigravity/conversation_summaries.db
│   ├── cli_meta.rs           # Reader for ~/.gemini/antigravity-cli/history.jsonl & settings.json
│   └── subagents.rs          # Reader for <session>/.system_generated/subagents/*.json & parent resolution
├── pricing.rs                # Dated, versioned model price catalog & date-coverage lookup
├── metrics.rs                # Pure functions: totals, cost breakdowns, cache hit rate, consistency checks
├── forecast.rs               # Linear, Bootstrap (seed=7), Monte Carlo (seed=11), Holt's Trend (≥14d gate)
├── snapshots.rs              # Idempotent local SQLite history (data/snapshots.db)
└── export.rs                 # CSV export & plain-English summary clipboard generator
```

---

# 3. DATA SOURCES & EXACT INGESTION SCHEMAS

The app scans **multiple sources** simultaneously and tags every record with `source: SourceKind` (`App`, `Cli`, or `Custom(String)`):

| Source | Default `brain` Root | Metadata Store (Titles, Projects, Parents) | Binary-Only Legacy Folder |
|---|---|---|---|
| **Antigravity 2.0 App** | `~/.gemini/antigravity/brain` | `~/.gemini/antigravity/conversation_summaries.db` (SQLite, read-only) | `~/.gemini/antigravity/conversations/*.pb` |
| **Antigravity CLI** | `~/.gemini/antigravity-cli/brain` | `~/.gemini/antigravity-cli/history.jsonl` + `settings.json` | `~/.gemini/antigravity-cli/conversations/*.pb` |

### 3.1 Token & Step Extraction (`<brain>/<conversationId>/.system_generated/logs/`)
- Prefer `transcript_full.jsonl` if it exists; otherwise read `transcript.jsonl`. (Both contain identical token fields, while `transcript_full.jsonl` also has untruncated step content.)
- If a `<brain>/<conversationId>` directory has neither file, count it under `without_transcript` in Data Sources diagnostics.
- Also scan `<parent_root>/conversations/*.pb`: any `.pb` stem `<id>` that has no readable `transcript.jsonl` / `transcript_full.jsonl` in `brain/<id>` is counted in the Data Sources **"Not readable (binary `.pb` only)"** collapsible panel.
- Each line in `transcript*.jsonl` is a JSON object:
  - **Token-bearing model step:** `input_tokens` is an integer (`isinstance(input_tokens, int)`).
    - `fresh_in = input_tokens` (fresh, non-cached input tokens)
    - `cached = cache_read_tokens.unwrap_or(0)` (cached context read tokens)
    - `output = output_tokens.unwrap_or(0)` (output tokens, including reasoning/thinking)
    - `total = fresh_in + cached + output` (mutually exclusive categories)
  - **Timestamp & Local Date Attribution:**
    - Parse `created_at` (ISO-8601 UTC/offset string) and convert to the **user's local timezone** before extracting `YYYY-MM-DD` for daily aggregation.
  - **Step Details (for Session Detail view):**
    - `step_index`: integer
    - `type`: string (`USER_INPUT`, `PLANNER_RESPONSE`, `CHECKPOINT`, `ERROR_MESSAGE`, etc.)
    - `source`: string (`USER_EXPLICIT`, `MODEL`, `SYSTEM`, etc.)
    - `status`: string (`DONE`, `ERROR`, `INVALID`, `FAILED`, etc.)
    - `thinking`: optional string (non-empty means reasoning occurred on this step; store a truncated preview + full expandable text on demand)
    - `content`: optional string
      - Detect **model switches** matching regex: `The user changed setting \`Model Selection\` from (.+?) to (.+?)[\r\n\`]`
      - Detect **permission denials** matching case-insensitive regex: `permission check failed|was denied|deny rule`
      - Detect **command completion stamps** on the step immediately following a `run_command` tool call: extract `Created At: <ISO>` and `Completed At: <ISO>` plus `command exited with code (-?\d+)` or cancellation note. Reject durations `< 0` or `> 14400` seconds (4h cap).
    - `tool_calls`: optional array of objects `{ "name": "...", "args": { ... } }`.
      - **Sanitize tool names:** only accept names matching `^[a-z][a-z0-9_]{0,39}$` (one corrupt transcript in real data has a 2KB prose string as a tool name—drop invalid names and increment `corrupted_tool_names_dropped`).
      - If `name == "call_mcp_tool"`, extract `args.ServerName`.
      - If `name == "run_command"`, extract `args.CommandLine` and `args.toolSummary`.

### 3.2 Metadata & Attribution Resolution (App vs. CLI)

To prevent App sessions from appearing as `(not in history.jsonl)` or `(unknown)` workspace, resolve session metadata using this exact precedence order:

1. **Subagent Descriptor Files (`<brain>/<parentId>/.system_generated/subagents/*.json`):**
   - Each JSON file has `conversationId` and `subagentDescriptor: { "typeName": "...", "role": "..." }`.
   - Marks `conversationId` as `kind = Subagent`, `parent_id = <parentId>`, `agent_type = typeName`, `role = role`.
2. **Antigravity App SQLite Database (`~/.gemini/antigravity/conversation_summaries.db`):**
   - Open read-only. Inspect table columns dynamically via `PRAGMA table_info(conversation_summaries)` (and check `conversation_parents` if present) so minor schema migrations never crash the reader.
   - Expected fields on `conversation_summaries`:
     - `conversation_id` (or primary key ID column)
     - `title`: optional text. If non-empty, use as session `title` and record `label_source = "App conversation database"`.
     - `workspace_uris`: text (JSON array of URI strings such as `["file:///d%3A/Code/AntigravityUsageDashboard"]`, or comma/newline-separated URI/path string). Parse the first URI, percent-decode (`%3A` → `:`), strip `file:///` prefix, normalize slashes to Windows format (`D:\Code\AntigravityUsageDashboard`), and derive `project = Path::file_name()` (e.g. `AntigravityUsageDashboard`).
     - `parent_conversation_id`: optional text. Also query `SELECT conversation_id, parent_id FROM conversation_parents` if that table exists. If non-empty, mark session `kind = Subagent` and link `parent_id`.
3. **Antigravity CLI History (`~/.gemini/antigravity-cli/history.jsonl`):**
   - Line-delimited JSON with `{ "conversationId": "...", "display": "...", "workspace": "..." }`.
   - Use the first non-empty `display` (whitespace-collapsed, up to 80 chars) as `title` with `label_source = "CLI history"`.
   - Use `workspace` to populate workspace path and `project = Path::file_name()`.
4. **Parent Workspace Inheritance for Subagents:**
   - If a session is a `Subagent` and has no direct `workspace`, inherit `workspace` and `project` from its `parent_id` session.
5. **Clean Fallbacks (Never ugly internal strings):**
   - Missing title → display `Untitled session` (in muted italic) + short ID chip (`first 8 chars of conversation_id`). If it is a subagent without a title, display `[<agent_type>] <role>` (or `Subagent` if role is empty).
   - Missing workspace/project → `project = "Unattributed"`, `workspace = ""`, with tooltip *"No project folder was recorded for this session."*

### 3.3 Parent / Subagent Rollup Rules
- In **global KPI totals, daily charts, project totals, and cost breakdowns**, each session directory in `brain/` is counted **once** (no double-counting between parent and child).
- In the **Sessions table**, when **"Group subagents under parent"** is toggled ON (default):
  - Child sessions (`parent_id = Some(pid)`) are nested underneath their parent row with a disclosure chevron and a `+N subagents` pill.
  - The parent row displays its rolled-up total (`own + sum(children)`) with the caption `incl. subagents`, while expanding the row shows the parent's own row and each indented child row with a `1px #E0E0E0` tree line.
  - If a subagent's `parent_id` session has no token log of its own, keep the subagent visible at top level with a muted badge `parent <id8>`.

---

# 4. PRICING, METRICS & FORECASTING SPECIFICATIONS

### 4.1 Dated Versioned Price Catalog (`config/pricing.json` + Built-in Seed)
Carry over the exact seeded catalog from `agy_dash/pricing.py` (USD per 1M tokens):
- `gemini-3.8-flash`:
  - `2026-10-01` .. `2026-12-31`: `input: $0.75`, `cached: $0.075`, `output: $3.75` (`verified: true`)
  - `2027-01-01` .. `None`: `input: $1.50`, `cached: $0.15`, `output: $7.50` (`verified: true`)
- `gemini-4-argon` (`2026-10-01`..): `$2.00 / $0.10 / $10.00` (`verified: true`)
- `gemini-3.1-pro` (`2026-09-01`..): `$1.25 / $0.31 / $10.00` (`verified: false`)
- `claude-haiku`: `$1.00 / $0.10 / $5.00` (`verified: false`)
- `claude-sonnet`: `$3.00 / $0.30 / $15.00` (`verified: false`)
- `claude-opus`: `$15.00 / $1.50 / $75.00` (`verified: false`)
- `gpt-mini`: `$0.15 / $0.075 / $0.60` (`verified: false`)
- `gpt-flagship`: `$2.50 / $1.25 / $10.00` (`verified: false`)
- `llama-70b-api`: `$0.60 / $0.60 / $0.70` (`verified: false`)
- `deepseek-v3-api`: `$0.27 / $0.07 / $1.10` (`verified: false`)
- `qwen-32b-api`: `$0.20 / $0.20 / $0.60` (`verified: false`)
- `mistral-large-api`: `$2.00 / $0.50 / $6.00` (`verified: false`)

**Lookup rule (`price_on(model_id, date)`):**
- If an entry covers `date` (`effective_from <= date <= effective_until`), return `(entry, is_date_estimate = false)`.
- Otherwise, pick the newest entry with `effective_from <= date` (or the earliest entry if `date` predates all versions) and return `(entry, is_date_estimate = true)`.

### 4.2 Core Formulas
- `total_tokens = fresh_in + cached + output`
- `cost_usd = (fresh_in * input_usd + cached * cached_usd + output * output_usd) / 1_000_000.0`
- `cost_in_currency = if currency == "INR" { cost_usd * usd_inr } else { cost_usd }` (default `usd_inr = 88.0`)
- `cache_hit_rate = safe_div(cached, fresh_in + cached, 0.0)`
- `token_share = (fresh_in / total, cached / total, output / total)`
- `cost_share = (cost_fresh / cost_total, cost_cached / cost_total, cost_out / cost_total)`
- **Consistency Check (`verify_consistency`):** Verify that every session and daily row satisfies `total == fresh_in + cached + output` and that unfiltered `sum(sessions.total) == sum(daily.total)`. Surface any discrepancy on the Data Sources screen.

**Reference Verification Numbers (at Gemini 3.8 Flash `$0.75 / $0.075 / $3.75`, `USD_INR = 88.0`):**
- **CLI (114 sessions):** `25.62M` new / `260.59M` cached / `2.96M` output = `289.17M` total → `≈ $49.86` (`≈ ₹4,388`), cache-hit `91%`.
- **App (6 sessions):** `2.68M` new / `15.72M` cached / `116.9K` output = `18.52M` total → `≈ $3.63` (`≈ ₹319`), cache-hit `85%`.
- **Combined (120 sessions):** `28.30M` new / `276.31M` cached / `3.08M` output = `307.69M` total → `≈ $53.49` (`≈ ₹4,707`), cache-hit `91%`.
- **Token Share:** Cached `89.8%` · New `9.2%` · Output `1.0%`.
- **Cost Share:** New `39.7%` (`≈ ₹1,868`) · Cached `38.7%` (`≈ ₹1,824`) · Output `21.6%` (`≈ ₹1,015`).

### 4.3 Forecasting Engine (Costs Screen)
- **Hard Gate:** Require `active_days >= 14` (days with `calls > 0` across enabled sources) to unlock trend forecasting. When `active_days < 14`, render the **Locked Forecast Card** showing a lock icon, *"Forecasts need at least 14 active days. You have N."*, a `N / 14` progress bar in `#0A0A0C`, and a ghosted preview.
- When unlocked (`active_days >= 14`), cap forecast horizon at `2 × observed_days` and support:
  1. **Linear Baseline:** OLS line + `±1.96 × std(residuals) × sqrt(step)` band.
  2. **Bootstrap Resampling:** 2,000 draws with replacement (`seed = 7`), P10 / P50 / P90 bands.
  3. **Monte Carlo Simulation:** 2,000 lognormal paths anchored on recent 5-day mean (`seed = 11`), P10 / P50 / P90 bands.
  4. **Holt's Linear Trend:** level + trend exponential smoothing (`alpha = 0.5`, `beta = 0.3`).

---

# 5. VISUAL SYSTEM (ANTIGRAVITY APP CHROME + CLI DATA PALETTE)

### 5.1 Neutral Chrome Tokens (Light Theme Default — Pixel-Matched to Antigravity 2.0 App)
| Role | Hex | Usage |
|---|---|---|
| Window canvas (menu bar, toolbar, sidebar) | `#FAFAFA` | Everything outside the inset content panel |
| Content panel & cards surface | `#FFFFFF` | Inset main panel, KPI cards, popovers, composer filter bar |
| Subtle surface fill | `#F5F5F5` | Inline code/path chips, table headers, search input fill, hover rows |
| Content panel border | `#E0E0E0` | `1px solid #E0E0E0` around the `16px`-radius main panel |
| Card & control border | `#E6E6E6` | `1px solid #E6E6E6` on cards (`12px` radius), inputs (`8px` radius), pills |
| Sidebar selected row | `#FFFFFF` | `10px` radius, `1px solid #F0F0F0`, `0 1px 2px rgba(0,0,0,0.04)` shadow |
| Primary action fill | `#0A0A0C` | Near-black pill/circle buttons with `#FFFFFF` text/icons (no blue chrome!) |
| Text: primary | `#0A0A0C` | Headings, active nav items, big numbers, primary body |
| Text: standard | `#3F3F46` | Toolbar icons, breadcrumbs, unselected sidebar rows |
| Text: muted | `#71717A` | Top menu bar items, folder labels, secondary captions |
| Text: section headers / relative times | `#828283` / `#6C6C6D` | Sidebar section headers (`Sources`, `Recent sessions`), `3m` timestamps |
| Text: faint / disabled | `#BBBBBF` | Disabled controls, bottom list fade, unattributed bar |
| Inline code/path chip text | `#3E5270` | Text inside `#F5F5F5` monospace chips |
| Links & keyboard focus ring | `#1A73E8` | Links and `2px` focus outline |

### 5.2 Semantic Data & Provenance Palette (Pixel-Matched to Antigravity CLI Light Theme)
| Meaning | Hex | Visual Encoding |
|---|---|---|
| **New input tokens** | `#1967D2` | Deep CLI `> you:` blue (solid fill) |
| **Cached input tokens** | `#AECBFA` | Pale tint of the same blue (also input, ~10× cheaper) |
| **Output tokens** | `#E37400` | CLI tool/warning orange (small volume, high cost; colourblind-safe against blue) |
| **Source: Antigravity App** | `#3F3F46` | Pill badge `APP` (`10%` tint fill, `#3F3F46` text) + monochrome black **"A"** arch glyph; **45° diagonal hatch** on shared charts |
| **Source: Antigravity CLI** | `#9334E6` | Pill badge `CLI` (`10%` tint fill, `#9334E6` mono text) + **7-colour pixel "A"** glyph; **solid fill** on shared charts |
| **Status: OK / Success** | `#188038` | Green dot / chip on `#E6F4EA` |
| **Status: Warning / Gap** | `#E37400` | Amber text/icon (`#FFB02E`) on `#FEF7E0` |
| **Status: Error** | `#D93025` | Red text/dot on `#FCE8E6` |
| **Estimate marker** | `#71717A` | `≈` prefix + dotted underline with explanation tooltip |
| **CLI Pixel "A" 7-Colour Palette** | `#F2922E`, `#EF5442`, `#DBB131`, `#7CC251`, `#62BAD5`, `#3D89FB`, `#8F64B4` | Used **only** for the CLI identity mark and first-scan pixel-assembly loader |

### 5.3 Dark Theme Tokens (Secondary — Toggled in Settings)
- Window canvas `#131313`, panel/card surface `#1F1F1F`, subtle fill `#2A2A2C`, text `#E3E3E3`, muted `#9A9A9A`, borders `rgba(255,255,255,0.16)`, primary action `#FFFFFF` fill with `#0A0A0C` text.
- Data colours in dark mode: New `#8AB4F8`, Cached `#3C5A8A`, Output `#FCAD70`, CLI `#C58AF9`, App `#A1A1AA`.

### 5.4 Typography & Formatting
- **UI Font:** `'Google Sans', 'Inter', 'Segoe UI Variable', sans-serif`.
- **Monospace Font (numbers, IDs, paths, status bar):** `'Google Sans Code', 'Cascadia Mono', Consolas, monospace` with `font-variant-numeric: tabular-nums`.
- **Number Formatting:**
  - Compact mode (default): `307.7M`, `15.72M`, `116.9K`, `842`. Hover tooltip always reveals exact integer with commas (`307,693,417 tokens`).
  - Currency: `≈ ₹4,707` (no decimals when `>= 100` in INR; 2 decimals in USD `≈ $53.49`).
  - Percentages: `0` decimals (`90%`), except `< 10%` which uses `1` decimal (`9.2%`, `1.0%`).
  - Dates: `15 Nov 2026`. Times: 24h `20:25`. Durations: `1h 12m` or `42s`.

### 5.5 Motion & Micro-Interactions
- Page transition: fade + `6px` rise over `220ms cubic-bezier(0.2, 0, 0, 1)`.
- KPI numbers: count up over `400ms` on initial scan load.
- Bar/column charts: grow from baseline over `300ms` (`12ms` stagger).
- Expandable rows (subagents, Thought process): `200ms` height reveal + `90°` chevron rotation.
- First-scan loader: the 7-colour pixel "A" assembling block-by-block (`900ms` loop) with *"Reading N log files…"*.
- Respect Windows `prefers-reduced-motion`: disable animations and render final states immediately.

---

# 6. APPLICATION SHELL & SCREEN-BY-SCREEN SPECIFICATION

Default window size: `1440×900` (minimum `1080×720`). Match the Antigravity 2.0 App window frame:

### 6.0 App Shell (Present on All Screens)
1. **Top Menu Bar (`36px`, `#FAFAFA`):**
   - Left: text menu items in `#71717A`: `Usage` (Rescan now, Export CSV, Copy summary, Quit), `View` (Overview, Sessions, Projects, Costs, Data Sources, Settings, Toggle sidebar, Toggle theme), `Window`, `Help` (About, Glossary).
   - Right: native/custom Windows caption buttons (minimize, maximize, close).
2. **Left Toolbar Row (`44px`, above sidebar):**
   - Bold monochrome black **"A"** arch icon (`#0A0A0C`), sidebar collapse toggle icon, history Back `←` and Forward `→` buttons, and Search `🔍` icon (triggers `Ctrl+K` Quick Search modal).
3. **Left Sidebar (`280px` collapsible to `64px`, `#FAFAFA` canvas, no border):**
   - **Top Action Button:** full-width raised white pill (`10px` radius, `1px solid #F0F0F0`, subtle shadow), styled like Antigravity's `+ New Conversation`: **`↻ Rescan`** on the left and last scan timestamp `20:25` in `#6C6C6D` on the right. Shows the 1s ring spinner while scanning.
   - **Primary Navigation Rows:** `Overview`, `Sessions`, `Projects`, `Costs`, `Data Sources` with 20px outline icons. Active item gets the raised `#FFFFFF` card pill treatment and `#0A0A0C` medium text.
   - **`Sources` Section Header (`#828283`):** two compact status rows:
     - `APP` glyph + `Antigravity App` + right-aligned count `6`
     - `CLI` pixel-A glyph + `Antigravity CLI` + right-aligned count `114`
     - Show an orange warning dot if a source path is missing or has parse warnings.
   - **`Recent sessions` Section Header (`#828283`):** grouped by project folder (with folder icon `📁 ProjectName` in `#71717A`) and up to 3 recent sessions per project indented underneath with truncated title + relative age (`3m`, `9m`, `5d`). Clicking any session navigates directly to **Session Detail**. Bottom of list has a subtle fade-out gradient.
   - **Bottom Pinned Item:** `⚙ Settings`.
4. **Breadcrumb Header Bar (`44px`, above the white content panel):**
   - Left: breadcrumb trail in `#3F3F46` with `/` separator (e.g. `Overview`, or `Sessions / Refactor pricing catalog`).
   - Right: `⋮` menu button (`Export current view to CSV`, `Copy plain-English summary`) and a right-drawer toggle icon that opens the **Glossary ("About these numbers")** slide-over panel.
5. **Inset White Content Panel (`#FFFFFF`, `16px` radius, `1px solid #E0E0E0`, `8px` right/bottom margin):**
   - **Sticky Composer-Style Filter Bar** at the top of the panel (`20px` radius white container, `1px solid #E6E6E6`, shadow `0 1px 3px rgba(0,0,0,0.06)`):
     - Date range pill dropdown: `All time` · `Today` · `Last 7 days` · `Last 30 days` · `Custom range…`
     - Source segmented pill: `All (120)` · `APP 6` · `CLI 114`
     - Project searchable dropdown: `All projects ▾` (includes `Unattributed`)
     - Pricing model dropdown with two-tone label: `≈ Gemini 3.8 Flash` **`pricing`** `▾`
     - Currency pill: `₹ INR ▾` / `$ USD ▾`
     - Far right: when any filter is non-default, show a round `#0A0A0C` reset button `↺` (styled like the App's round black send button).
   - **Scrollable Screen Body** (`32px` horizontal padding, `16px` grid gap).
   - **Bottom CLI-Style Status Line (`28px`, monospace `#71717A`):**
     - `[ last scan 20:25 · 236 log files · 120 with tokens · 0 warnings ]` (clicking navigates to Data Sources).

---

### 6.1 Screen 1: `Overview`
1. **Dynamic Plain-English Summary Sentence (`24px/36px`, max 2 lines):**
   - Template: *"From **{first_date}** to **{last_date}** you used **{total_tokens} tokens** in **{session_count} sessions** ({cli_count} CLI, {app_count} App). **{cache_share}%** were cached re-reads. At {model_name} prices that's about **≈ {cost_formatted}**."*
   - Sub-caption below sentence: summarizes active date spans by source and calls out any multi-day zero-activity gap between them (e.g. *"CLI 17–24 Oct · App 28 Oct–15 Nov · no activity 25–27 Oct"*).
2. **4 KPI Cards (1 row, equal width):**
   - **New input** (`#1967D2` dot): `{fresh_in}` · *"Fresh text sent to the model"* · Footer mini split bar `CLI X% · App Y%`.
   - **Cached input** (`#AECBFA` dot): `{cached}` · *"Context re-read from cache, ~10× cheaper"* · Footer mini split bar.
   - **Output** (`#E37400` dot): `{output}` · *"Text, code and reasoning the model wrote"* · Footer mini split bar.
   - **Estimated cost** (neutral dot): `≈ {cost_primary}` · *"If billed at API list prices"* · Footer `"≈ {cost_secondary} · {model_name}"`.
3. **Card: "Where the tokens go vs where the money goes" (Full Width):**
   - Two horizontal 100% stacked bars (`28px` height, `8px` radius) with inline segment labels:
     - **Tokens:** Cached (`#AECBFA`) · New (`#1967D2`) · Output (`#E37400`)
     - **Cost:** New (`#1967D2`) · Cached (`#AECBFA`) · Output (`#E37400`)
   - Dynamic takeaway caption underneath explaining the divergence between volume and cost.
4. **Card: Daily Usage Time Series (Full Width, `280px` height):**
   - Header right: segmented pill `Colour by: Token type | Source`.
   - Calendar-complete x-axis from `min_date` to `max_date` (every single day rendered; zero-activity days are visibly empty slots on the axis).
   - Stacked vertical columns per day (`New`, `Cached`, `Output`); App portion uses a `45°` hatch pattern.
   - If CLI and App date ranges are disjoint, draw a subtle vertical dashed marker labelled `CLI → App`.
   - Hover crosshair + elevated white tooltip card showing date, exact token breakdown, `≈ cost`, and active session count by source.
5. **Two Side-by-Side Cards (`50% / 50%`):**
   - **Top 5 sessions by cost:** Source badge (`APP`/`CLI`), title (or `Untitled session` + ID chip), project caption, `≈ cost`, and mini 3-colour token bar. Clicking a row opens **Session Detail**. Footer link: `All sessions →`.
   - **Top 5 projects by cost:** Folder icon, project name (`Unattributed` styled in muted grey if present), session count, `≈ cost`, and mini App/CLI split bar. Clicking a row opens **Projects** filtered to that project. Footer link: `All projects →`.
6. **Card: App vs CLI Comparison Strip (2 Columns with Divider):**
   - Left column headed by monochrome black **A** + `Antigravity App`; right column headed by 7-colour pixel **A** + `Antigravity CLI`.
   - Compares: Sessions with tokens · Total tokens · Cache-hit rate · Avg tokens/session · Active date range · `≈ Estimated cost`.

---

### 6.2 Screen 2: `Sessions`
1. **Dynamic Summary Sentence:** e.g. *"{total_sessions} sessions with token data. {parent_count} started subagents. {unattributed_count} have no project."*
2. **Toolbar:**
   - Instant search input (`#F5F5F5` fill, filters by title, conversation ID prefix, tool name, or project).
   - Toggle switch: `Group subagents under parent` (default ON).
   - `Columns ▾` visibility toggle menu.
3. **Sessions Table Card:**
   - Sticky header (`#F5F5F5`, `12px` medium `#71717A`), `44px` row height, `#F0F0F0` horizontal dividers.
   - Columns (all sortable; default sort `≈ Cost` descending):
     1. `Source` (`APP` or `CLI` pill badge)
     2. `Title` (plain title, or muted italic `Untitled session` + `#F5F5F5` mono ID chip `3163d2d4`; hover tooltip shows provenance: *"Title from App conversation database"* or *"Title from CLI history"*; if parent with subagents, show chevron `▸` and `+N subagents` pill)
     3. `Project` (folder name chip, or muted `Unattributed` with `ⓘ` tooltip)
     4. `Started` (`15 Nov 2026, 20:25`)
     5. `Duration` (`1h 12m`, computed from first to last step timestamp)
     6. `Steps` (model call count in mono)
     7. `New` (mono right-aligned)
     8. `Cached` (mono right-aligned)
     9. `Output` (mono right-aligned)
     10. `≈ Cost` (mono right-aligned, bold `#0A0A0C`)
     11. `Mix` (`64px` mini 3-colour bar)
   - Expanding a parent row reveals its own direct usage row plus each indented child subagent row connected by a `1px #E0E0E0` tree line.
4. **Pagination Footer:** `Showing 1–25 of N` + page size selector (`25 / 50 / 100`) + pill `Previous` / `Next` buttons.

---

### 6.3 Screen 3: `Session Detail`
1. **Breadcrumb:** `Sessions / {Session Title}` with Back button support.
2. **Session Header Card:**
   - Title (`20px` medium), `APP`/`CLI` badge, full workspace path in a `#F5F5F5` `#3E5270` mono chip (middle-truncated if long, click to copy), start → end timestamps, duration, step count, and copyable `conversation_id` chip.
   - If this session is a subagent, show a clickable link: `Started by: {Parent Title} →`.
3. **Dynamic Summary Sentence:**
   - *"This session ran **{duration}** over **{steps} steps** and used **{total_tokens} tokens** (**≈ {cost}**). **{top_n} steps** caused **{top_share}%** of the cost."*
4. **Mini KPI Strip:** 4 compact cards for `New input`, `Cached input`, `Output`, and `≈ Cost` (plus cache-hit rate and thinking steps count).
5. **Card: Tokens Over the Session (Dual Synchronized Charts):**
   - **Top (`180px`):** Cumulative stacked area chart (`New`, `Cached`, `Output`) across `step_index`.
   - **Bottom (`72px`, shared x-axis):** Per-step column spike strip showing tokens per individual step so expensive spikes and cache invalidations jump out immediately.
   - Axis markers: `#D93025` red dots on error steps; `#E37400` orange ticks on tool-call steps.
6. **Tabbed Inspector (`Steps` · `Tools` · `Subagents`):**
   - **`Steps` Tab (styled after the CLI transcript):**
     - Columns: `#` (`step_index` in `#80868B` mono), `Time`, `Type` (styled with CLI semantic labels: `tool:` in `#E37400`, `task:` in `#9334E6`, `error:` in `#D93025`, `you:` in `#1967D2`, `model` in `#188038`), `Status`, `New`, `Cached`, `Output`, `≈ Cost`.
     - Error rows get a subtle `#FCE8E6` background tint; top cost-spike steps get a `#FEF7E0` tint.
     - Steps with `thinking` show a collapsible **`▸ Thought process`** disclosure (matching the CLI screenshot's exact label) that expands to a `#F5F5F5` monospace/prose block.
   - **`Tools` Tab:**
     - Ranked horizontal bar list of tools invoked in this session by call count and by tokens on tool-bearing steps, plus MCP server calls (`call_mcp_tool` grouped by `ServerName`) and slowest `run_command` executions with exit codes.
   - **`Subagents` Tab:**
     - Table of child sessions spawned by this conversation (or `"No subagents were started in this session"`).
7. **Provenance Footer Card:**
   - Shows exact file path read for tokens (`transcript_full.jsonl` or `transcript.jsonl`), exact metadata source (`conversation_summaries.db` or `history.jsonl`), and an `"Open folder in Explorer"` link (`#1A73E8`).

---

### 6.4 Screen 4: `Projects`
1. **Dynamic Summary Sentence:** e.g. *"{top_two_count} projects account for {top_two_share}% of estimated cost. {unattributed_sessions} sessions (≈ {unattributed_share}% of cost) aren't linked to a project."*
2. **Toolbar:** Segmented control `Rank by: Cost · Tokens · Sessions`.
3. **Ranked Projects Card:**
   - One row per project: folder icon, project name (`15px` medium) + full path chip underneath, horizontal bar split into `App` (`#3F3F46` hatched) and `CLI` (`#9334E6` solid) segments, session count, total tokens, and `≈ cost`.
   - **`Unattributed`** is always pinned as the final row with a `#BBBBBF` bar and an `ⓘ` tooltip explaining why those sessions have no workspace.
4. **Slide-Over Project Inspector Panel (`480px` right drawer on row click):**
   - Shows the project's summary sentence, App vs CLI breakdown, daily sparkline, and filtered Sessions table where clicking any row opens **Session Detail**.

---

### 6.5 Screen 5: `Costs`
1. **Epistemic Info Banner (`#F5F5F5` card, info icon):**
   - *"Costs are estimates. Antigravity's logs don't record which model answered each step, so every token is priced at the model you pick. This is what the usage would cost on the API, not what you paid."*
2. **Card: Active Pricing Model:**
   - Composer-style model selector, 3 rate tiles per 1M tokens (`New input $X` · `Cached input $Y` · `Output $Z` with their data-colour dots), effective date range (`2026-10-01 → 2026-12-31`), and verification badge (`Verified` in `#188038` on `#E6F4EA` or `Approximate` in `#E37400` on `#FEF7E0`). If any observed dates fall outside the model's effective range, display the date-estimate warning banner.
3. **Card: Cost Breakdown Waterfall:**
   - Visual waterfall bar: `New input (≈ ₹1,868) + Cached input (≈ ₹1,824) + Output (≈ ₹1,015) = Total (≈ ₹4,707)`, with `All / CLI / App` filter pills.
4. **Card: "Same usage, other models" Benchmark Table:**
   - Evaluates the current filtered token volume against every model in the price catalog.
   - Columns: `Model`, `Vendor`, `Rates ($/1M in · cache · out)`, `Status` (`Verified` / `approx.`), `≈ Total Cost`, `× Cheapest` (`1.0×`, `2.7×`, etc.), and relative horizontal bar. Highlights the active model row in `#F5F5F5` with a black `current` pill.
5. **Card: Your Plan vs API Price:**
   - If `subscription.amount == 0`: shows *"Add what you pay per month in Settings to compare your subscription against API list prices."* + black pill button `Open Settings`.
   - If `subscription.amount > 0`: shows Monthly Plan Spend vs `≈ API List Cost` and `Tokens per ₹1 (or $1) spent`, with the neutral note: *"The difference isn't savings or loss, because subscription quotas work differently from per-token billing."*
6. **Card: Forecast (Gated at `>= 14` Active Days):**
   - Renders the locked state when `< 14` active days, or the interactive fan chart (`Linear`, `Bootstrap`, `Monte Carlo`, `Holt`) with P10–P90 band and horizon slider (`7d` up to `2 × observed_days`) when `>= 14` active days.

---

### 6.6 Screen 6: `Data Sources` (The Trust & Diagnostics Screen)
1. **Dynamic Summary Sentence:**
   - *"Both sources were read. {with_tokens} of {total_transcripts} log files had token data. {parse_errors} failed to parse."*
2. **Two Side-by-Side Source Cards (`Antigravity App` & `Antigravity CLI`):**
   - **App Card Header:** Monochrome black **A** logo + `Antigravity App` + enable/disable switch + status badge (`● OK` in `#188038`, or warning/missing).
   - **CLI Card Header:** 7-colour **pixel A** logo + `Antigravity CLI` (in `#4285F4` bold mono) + enable/disable switch + status badge.
   - **Diagnostic Rows inside each card:**
     - `Folder`: path chip (`~/.gemini/antigravity/brain` / `~/.gemini/antigravity-cli/brain`)
     - `Transcript files found`: count of `transcript*.jsonl` files
     - `Sessions with token data`: count
     - `Sessions without token data`: count (empty or pre-2026-10-05 shell sessions)
     - `Observed date range`: `min_date – max_date`
     - `New / Cached / Output`: compact token breakdown
     - `Titles & projects source`: `conversation_summaries.db (read-only)` for App; `history.jsonl` for CLI
     - `Titles matched`: `X of Y` token-bearing sessions
     - `Projects matched`: `X of Y` token-bearing sessions
     - Footer actions: `Open folder in Explorer` link.
3. **Collapsible Card: "Not readable (binary `.pb` only)":**
   - Explains: *"Older conversations that only have binary `conversations/*.pb` files without a `transcript.jsonl` have no readable token log. {count} files skipped."* Expanding lists their stem IDs as mono chips.
4. **Consistency & Scan Health Card:**
   - Shows results of `verify_consistency()`, count of dropped corrupt tool names, count of capped >4h step gaps, last scan timestamp, scan duration in milliseconds, local `snapshots.db` run count, and a primary `#0A0A0C` pill button **`↻ Rescan now`**.
5. **Custom Sources Row:** `+ Add custom brain folder` secondary pill button.

---

### 6.7 Screen 7: `Settings` (CLI-Inspired Layout inside App Chrome)
- **Top Filter:** `Search settings…` input (`#F5F5F5` fill) that live-filters setting rows across all sections.
- **Left Section Rail:** `Sources`, `Pricing`, `Money`, `Display`, `Refresh`, `Privacy`, `About`. Active section gets a raised `#FFFFFF` row with a `#4285F4` `›` prefix.
- **Right Content Column:**
  1. **Sources:** App brain path + `Browse…` + enable toggle; CLI brain path + `Browse…` + enable toggle; Custom folders list with `×` remove + `+ Add folder`; toggle `Read App titles & projects from conversation_summaries.db (read-only)`; `Restore default paths` button.
  2. **Pricing:** Default pricing model dropdown; custom `pricing.json` path + `Browse…` + `Open in editor`; full read-only **Price Catalog Table** (`Model`, `Vendor`, `From`, `Until`, `New $/1M`, `Cached $/1M`, `Output $/1M`, `Verified / Approximate` chip).
  3. **Money:** Display currency (`INR` · `USD`); `USD → INR` exchange rate input (validated `> 0`); Monthly subscription amount (`>= 0`) + billing period days (`1..365`).
  4. **Display:** Theme radio list styled after the CLI (`› light (current)`, `dark`, `follow Windows`); Density (`Comfortable` · `Compact`); Number formatting (`Compact 307.7M` · `Full 307,693,417`); Week start (`Monday` · `Sunday`); Reduced motion (`Follow Windows` · `On` · `Off`).
  5. **Refresh:** Auto-rescan interval (`Manual only` · `1 min` · `5 min` · `15 min`); file-system watcher toggle; `Clear cached snapshots` button.
  6. **Privacy:** Read-only guarantee statement + exact list of local files read + `Open app config/data folder` button.
  7. **About:** App version, build date, detected Antigravity App version (read from `%LOCALAPPDATA%\Programs\antigravity\version` if present) and CLI version, plus `Export diagnostics JSON`.
- **Auto-Save & Validation:** Valid changes persist immediately to `config/config.json` and trigger a bottom-center white toast `Saved`. Invalid numeric inputs (e.g. `USD_INR <= 0`) show an inline `#D93025` error message *"Enter a number greater than 0"* and do not overwrite the valid config.
- **Bottom CLI Key-Hint Bar:** `↑/↓ Navigate   Enter Edit   Esc Back` (keys in `#4285F4` mono).

---

### 6.8 Required UI States & Modals
1. **First-Run Empty State (neither folder exists):** Centered card with black **A** mark, *"No Antigravity data found"*, paths checked, `#0A0A0C` pill button `Choose folder…`, and `Open Settings`.
2. **First Scan Loading State:** Centered 7-colour pixel **A** assembling block-by-block, *"Reading N log files…"*, and shimmering `#F5F5F5` skeleton cards behind.
3. **Single-Source State:** If one source folder is missing, the app works normally on the available source, greys out the missing source in the sidebar with an orange dot, and notes it in the status bar.
4. **Partial Data / Parse Warning Banner:** Soft `#FEF7E0` banner with `#FFB02E` icon when any session log had corrupt JSON lines or unreadable metadata, linking to Data Sources.
5. **Quick Search Modal (`Ctrl+K`):** Elevated `560px` centered white modal searching across **Sessions** (by title or ID), **Projects**, and **Screens/Actions**, with `↑↓ Enter Esc` keyboard navigation.
6. **Glossary Slide-Over Drawer (`?` / top-right icon):** Lists plain-English definitions for `New input`, `Cached input`, `Output`, `Cache-hit rate`, `Estimated cost (≈)`, `Session`, `Subagent`, `Unattributed`, and `Source`.

---

# 7. VERIFICATION & ACCEPTANCE CRITERIA

Before declaring the build complete, execute and verify all of the following:

1. **Automated Rust Unit & Integration Tests (`cargo test`):**
   - **Transcript Parser Test:** Feeds synthetic JSONL lines (including truncated lines, non-token steps, corrupt 2KB tool names, command completion stamps, and model switch notices) and asserts exact `fresh_in`, `cached`, `output`, `total`, local-date bucketing, and tool extraction.
   - **App SQLite Metadata Test:** Creates a temporary SQLite database matching `conversation_summaries.db` (with `title`, `workspace_uris` containing percent-encoded `file:///d%3A/Code/AntigravityUsageDashboard`, and `parent_conversation_id`), opens it via the read-only `app_meta` reader, and verifies that sessions resolve to title, project `AntigravityUsageDashboard`, and parent ID—and that untitled rows become `Untitled session` and missing workspaces become `Unattributed`.
   - **Multi-Source Merge & Subagent Rollup Test:** Verifies that scanning both an App root and a CLI root keeps global/daily totals free of double-counting while rolling up subagent totals under parent rows when grouped.
   - **Pricing & Math Test:** Asserts that `28.30M` new + `276.31M` cached + `3.08M` output at Gemini 3.8 Flash (`$0.75 / $0.075 / $3.75`, `USD_INR = 88.0`) produces `≈ $53.49` (`≈ ₹4,707`), token shares `89.8% / 9.2% / 1.0%`, cost shares `39.7% / 38.7% / 21.6%`, and that `safe_div` returns `0.0` on zero denominators.
   - **Forecast Gate Test:** Confirms forecast returns `supported = false` when `active_days < 14` and unlocks deterministic Bootstrap (`seed = 7`) and Monte Carlo (`seed = 11`) outputs when `active_days >= 14`.
2. **Live Machine Smoke Verification:**
   - Run the compiled binary against the local `~/.gemini/antigravity` and `~/.gemini/antigravity-cli` directories on this machine.
   - Confirm both sources are discovered, `conversation_summaries.db` is read without locking or modifying any file in `~/.gemini`, and `git status` / `~/.gemini` timestamps confirm zero writes to Antigravity directories.
   - Build in release mode (`cargo build --release`) with zero compiler errors.
```
