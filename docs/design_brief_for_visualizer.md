# Antigravity Usage — Native Windows App: Screen Design Brief (v3)

> Hand this whole document **and the two reference screenshots** to the visualizer agent:
> - `docs/Screenshot 2026-11-15 205048.png`: Antigravity 2.0 App (light)
> - `docs/Screenshot 2026-11-15 205007.png`: Antigravity CLI 1.5.4 (light theme)
>
> The visualizer's job is to make **static mockups of every screen in §6 and every state in §7**, using the sample data in §8.
>
> **Design goal:** this should look like **one more window of the Antigravity 2.0 App**. Same menu bar, toolbar, sidebar, white content panel, typography and monochrome calm. Colour from the **CLI's palette** appears only where it carries meaning: in data, status, and the CLI's own brand mark.

---

## 1. What the app is

A Windows desktop app (Rust) that reads the token logs that **Antigravity 2.0 App** and **Antigravity CLI** write on this PC, and explains them in plain language: how much was used, where it went, what it would cost at API prices, and how much to trust each number. It is read-only and offline: no uploads, no telemetry, and it never edits Antigravity's files.

**User:** one technical person checking their own usage. Questions they should be able to answer in under 10 seconds:
1. How much did I use, and is it going up?
2. Which projects and sessions used the most?
3. What would this cost at API prices, and what drives that cost?
4. Is the App or the CLI using more?
5. Is anything missing from what I'm shown?

---

## 2. Design principles

1. **Write a sentence before showing a chart.** Every screen opens with one plain-English sentence made from the live numbers.
2. **Never show one big "total tokens" number by itself.** About 90% of tokens are cheap cached re-reads. Always split into **New input / Cached input / Output**.
3. **Show token share next to cost share.** Cached input is ~90% of tokens but under 40% of cost, and output is 1% of tokens but ~22% of cost.
4. **Always show which source data came from.** App vs CLI is shown with a colour **and** a text badge **and** a glyph, never colour alone.
5. **Show gaps; don't hide them.** Zero days stay zero, sessions with no project go in "Unattributed", and unreadable files are counted.
6. **Tell estimates apart from measurements.** Tokens are measured. Costs are estimated and get "≈".
7. **Use plain names.** Overview, Sessions, Projects, Costs, Data Sources, Settings.
8. **Keep the chrome monochrome and the data in colour.** Like the Antigravity App, the interface itself is black, greys and white. That way every coloured pixel on screen means something.

---

## 3. Visual system

### 3.1 Where the values come from

| Value | Source |
|---|---|
| App neutrals, panel, selection, black primary, code chip | **Pixel-sampled** from the App screenshot |
| CLI semantic colours, diff colours, borders, pixel-logo colours | **Pixel-sampled** from the CLI screenshot |
| Font Google Sans; dark theme `#131313` / `#1F1F1F` / `#E3E3E3`; spinner style | **Read** from the installed App bundle (v44.9.1) |
| Corner radii, shadows, motion timings, data-colour assignment | **Inferred** from the screenshots and Material 3 |

### 3.2 Neutrals: the App's monochrome chrome

| Role | Value | Seen in the App as |
|---|---|---|
| Window canvas (title bar, sidebar) | `#FAFAFA` | everything outside the content panel |
| Surface (content panel, cards, menus) | `#FFFFFF` | the conversation panel, the composer |
| Subtle fill (inline code, table header, hover, input fill) | `#F5F5F5` | inline code chips |
| Panel border | `#E0E0E0` | edge of the content panel |
| Control border (inputs, outline buttons, composer ring) | `#E6E6E6` | composer outline |
| Text, strongest (headings, active items, logo) | `#0A0A0C` | body text, logo, active conversation |
| Text, standard (icons, breadcrumb, sidebar items) | `#3F3F46` | toolbar icons, breadcrumb, sidebar rows |
| Text, muted (menus, folders, metadata) | `#71717A` | "Antigravity Workspace View Window", folder names |
| Text, section label / relative time | `#828283` / `#6C6C6D` | "Projects", "3m" |
| Text, faint (faded list end, disabled) | `#BBBBBF` | the faded last sidebar item |
| Inline code text | `#3E5270` | code chips in replies |
| **Primary action** | `#0A0A0C` fill, white content | the round black send button |
| **Selected nav row** | `#FFFFFF` rounded row with a hairline `#F0F0F0` edge, lifted off the `#FAFAFA` canvas | the active conversation in the sidebar |

**No blue chrome.** Blue appears only on links (`#1A73E8`) and the keyboard focus ring (2px `#1A73E8`).

### 3.3 Colour for meaning: the CLI palette

Sampled from the CLI light theme:

| CLI use | Value |
|---|---|
| Header "Antigravity CLI 1.5.4" / key hints / selected item | `#4285F4` |
| "you:" prompt | `#1967D2` |
| Success heading ("Here's the change:") | `#188038` |
| `tool:` and `warning:` labels | `#E37400` (warning icon `#FFB02E`) |
| `task:` label | `#9334E6` |
| `error:` label | `#D93025` |
| Link | `#1A73E8` |
| Line numbers / CLI body text | `#80868B` / `#5F6368` |
| Diff added row / removed row | `#E6F4EA` / `#FCE8E6` |
| Panel and divider lines | `#DADCE0` |
| Pixel "A" logo | `#F2922E` orange · `#EF5442` red · `#DBB131` yellow · `#7CC251` green · `#62BAD5` teal · `#3D89FB` blue · `#8F64B4` purple |

**Data colours used in this app (always the same meaning):**

| Meaning | Colour | Why |
|---|---|---|
| New input | `#1967D2` | the CLI's "you:" blue, because it's what you sent |
| Cached input | `#AECBFA` | a pale tint of the same blue; it's also input, but cheap |
| Output | `#E37400` | the CLI's tool/warning orange. It's small but expensive, and blue vs orange is safe for colourblind users |
| Source **App** | `#3F3F46` zinc, badge `APP` + small black "A" glyph | the App's own black logo |
| Source **CLI** | `#9334E6` purple, badge `CLI` + small pixel-"A" glyph | taken from the CLI's palette |
| OK / Warning / Error | `#188038` / `#E37400` on `#FEF7E0` / `#D93025` on `#FCE8E6` | the CLI's status colours |
| Estimate | `≈` in `#71717A` with a dotted underline | |

Badges are pills 20px tall with a 10% tint fill and full-colour text. In charts, CLI is solid and App has a light 45° hatch, so the two can be told apart even without colour.

The **pixel-gradient A** appears only as the CLI's identity mark (Data Sources card, CLI badge glyph, loading animation). It never appears as a decorative gradient.

### 3.4 Typography

- **UI:** Google Sans (the App's font). Fallbacks: Inter, then Segoe UI Variable. As in the App screenshot, the content panel uses generous line height (~1.6) and the chrome sits at a slightly smaller size.
- **Numbers, IDs, paths, the status line:** a monospace like the App's inline-code chips, Google Sans Code if bundling is allowed, otherwise Cascadia Mono, with tabular figures. Paths and IDs sit in `#F5F5F5` chips with `#3E5270` text, exactly like the App's inline code.
- **Scale:** Summary sentence 24/36 regular with numbers in medium · Page title 20/28 medium · Card title 15/22 medium · Body 14/22 · Sidebar and menus 14/20 · Caption 12/16 `#71717A` · KPI number 30/38 regular mono.
- Sentence case everywhere. ALL CAPS only for the APP/CLI badges.

### 3.5 Shape, borders, shading

| Element | Radius | Edge / shadow |
|---|---|---|
| Content panel | 16px | 1px `#E0E0E0`, no shadow |
| Cards inside the panel | 12px | 1px `#E6E6E6`, no shadow |
| Sidebar selected row, sidebar top button | 10px | white fill, 1px `#F0F0F0`, shadow `0 1px 2px rgba(0,0,0,.04)` |
| Filter bar (styled like the App's composer) | 20px | 1px `#E6E6E6` + soft ring `0 1px 3px rgba(0,0,0,.06)` |
| Inputs, table container, tooltips | 8px | 1px `#E6E6E6` |
| Primary buttons | full pill / circle | `#0A0A0C` fill |
| Secondary buttons | full pill | white, 1px `#E6E6E6` |
| Menus, popovers, dialogs, quick search | 12px | `0 4px 16px rgba(0,0,0,.08)`, 1px `#E6E6E6` |
| Round floating buttons (like the App's "scroll to bottom") | circle | white, 1px `#E6E6E6`, light shadow |

Hover adds a 4% black overlay (`#F5F5F5` on white); pressed is 8%. Selection inside the white panel uses a `#F5F5F5` fill with `#0A0A0C` text. Spacing is on a 4px grid: panel padding 32, card padding 20, card gap 16.

Icons are thin outline icons in `#3F3F46` at 20px (Material Symbols Outlined, weight 300), matching the App's toolbar and sidebar icons.

### 3.6 Motion

| What | How |
|---|---|
| Page switch | content fades in and rises 6px, 220ms, `cubic-bezier(0.2,0,0,1)` |
| KPI numbers | count up on first load only, 400ms |
| Bars and columns | grow from the baseline, 300ms, 12ms stagger |
| Line or area charts | draw left to right, 400ms |
| Chart hover | thin `#0A0A0C` 20%-opacity crosshair plus a white tooltip card, 100ms |
| Row expand | height reveal 200ms, chevron rotates 90° |
| Side panel | slides from the right 280ms; the main panel dims under an 8% black scrim |
| Sidebar collapse | width animates 200ms, labels fade out |
| Loading | skeleton blocks shimmer `#F5F5F5` → `#EEEEEE`. The first-scan hero is the **pixel A assembling square by square** in its seven colours, 900ms, looping |
| Rescan | 2px ring spinner, 1s linear (the App's spinner) |
| Toast | rises from bottom-center 200ms, white card, auto-hides after 4s |
| Reduced motion | everything becomes instant; the pixel A shows fully formed and static |

### 3.7 Dark theme (secondary)

Canvas `#131313`, surface `#1F1F1F`, text `#E3E3E3`, borders `rgba(255,255,255,0.16)` (from the App bundle). The primary action flips to a white fill with black content. Data colours change to new `#8AB4F8`, cached `#3C5A8A`, output `#FCAD70`, CLI `#C58AF9`, App `#A1A1AA`. Mock **only Overview** in dark.

---

## 4. Numbers and wording rules

- Compact: 307.7M · 15.72M · 116.9K. Exact values appear in tooltips (`307,693,417 tokens`).
- Money: `≈ ₹4,707` primary, `≈ $53.49` secondary. No decimals for ₹ above 100.
- Percent: no decimals, except below 10% (`9.2%`).
- Dates `15 Nov 2026`; 24h times; durations `1h 12m`. Relative times in the sidebar, as in the App: `3m`, `9m`, `5d`.
- Every metric label has an ⓘ that opens its glossary line (§9).
- Unknowns are written out in words: "Untitled session", "Unattributed", "Not recorded". Never a blank or "null".

---

## 5. App shell: a copy of the Antigravity App frame

Mock at 1440×900. Match the App screenshot's structure exactly:

1. **Menu bar** (canvas `#FAFAFA`, ~36px): text menus in `#71717A`: **Usage · View · Window · Help**. Thin-line Windows caption buttons on the right. No coloured title bar.
2. **Toolbar row** (sidebar width, ~44px): black bold **"A" logo** (`#0A0A0C`), then sidebar-toggle, back, forward and search icons in `#3F3F46`. Search opens Quick search (Ctrl+K).
3. **Sidebar** (≈300px, on canvas, no border), mirroring the App's sidebar:
   - Top button, styled exactly like "+ New Conversation" (white, 10px radius, hairline): **"↻ Rescan"**, with a caption on the right "20:25".
   - Nav rows with outline icons: **Overview · Sessions · Projects · Costs · Data Sources**. The selected row is a white raised row, like the App's active conversation.
   - Section label **"Sources"** (`#828283`), with a filter icon on the right like the App's "Projects" header. Two rows: `APP  Antigravity App  6` and `CLI  Antigravity CLI  114`, each with its glyph, and a status dot only when something is wrong.
   - Section label **"Recent sessions"**, grouped by project with folder icons, as in the App. Child rows are indented, show a truncated title, and have a right-aligned relative time in `#6C6C6D` (e.g. "Refactor pricing cat… 3m"). Clicking one opens Session detail. The list fades out at the bottom like the App's.
   - Pinned at the bottom: **⚙ Settings**.
4. **Breadcrumb row** (over the panel, ~44px): `Overview` or `Sessions / Refactor pricing catalog` in `#3F3F46`, with a grey "/" separator. On the right, App-style icons: ⋮ (more: Export CSV, Copy summary) and a right-panel toggle (opens the glossary / "About these numbers" panel).
5. **Content panel:** white, 16px radius, `#E0E0E0` border, inset 8px from the right and bottom window edges. This is the App's conversation panel.
   - **Filter bar**, styled like the App's composer and pinned at the top of the panel: a white 20px-radius box with a soft ring. Inside, App-composer-style text dropdowns with a chevron and a two-tone label: `Last 30 days ▾` · `All sources ▾` · `All projects ▾` · `≈ Gemini 3.8 Flash` **`pricing`** `▾` (the second word in muted grey, like "Claude Opus 5.5 **Medium**") · `₹ INR ▾`. When filters differ from the default, a small round black "reset" icon button sits at the far right where the App's send button is.
   - The page body scrolls beneath it. A round white "↓" floating button appears when there's more to scroll, as in the App.
   - **Status line** at the bottom of the panel, in mono caption text (a nod to the CLI footer `[4-4 of 25 items]`): `[ last scan 20:25 · 236 files · 120 with tokens · 0 warnings ]`. Warnings turn it orange with a `#FFB02E` warning glyph.

---

## 6. Screen briefs

Each brief covers: **Purpose → Layout (top to bottom) → Content & copy → Interactions → Edge cases.**

### 6.1 Overview

**Purpose:** answer questions 1, 3 and 4 at a glance.

1. **Summary sentence:**
   *"From 17 Oct to 15 Nov you used **307.7M tokens** in **120 sessions**. **90%** were cached re-reads. At Gemini 3.8 Flash prices that's about **≈ ₹4,707**."*
   Caption: *"CLI 17–24 Oct · App 28 Oct–15 Nov · no activity 25–27 Oct."*
2. **Four KPI cards:**
   | Card (with a dot in its data colour) | Number | Caption | Footer |
   |---|---|---|---|
   | New input | 28.30M | Fresh text sent to the model | App/CLI split bar, "CLI 91% · App 9%" |
   | Cached input | 276.31M | Context re-read from cache, ~10× cheaper | split bar |
   | Output | 3.08M | Text, code and reasoning the model wrote | split bar |
   | Estimated cost (neutral dot) | ≈ ₹4,707 | If billed at API list prices | "≈ $53.49 · Gemini 3.8 Flash" |
3. **Card: "Where the tokens go vs where the money goes."** Two 100% bars, 28px tall, 8px radius, with labels inside the segments:
   - Tokens: Cached 89.8% · New 9.2% · Output 1.0%
   - Cost: New 39.7% · Cached 38.7% · Output 21.6%
   - Caption: *"Cached input is almost all of your volume but under 40% of the cost. Output is tiny but expensive."*
4. **Card: Daily usage** (280px chart). Stacked columns per day by token type, with App columns hatched. A segmented control at the top right: "Colour by: Token type | Source". Every day from 17 Oct to 15 Nov is shown, so 25–27 Oct are visibly empty. A thin dashed divider between 24 and 28 Oct is labelled *"CLI → App"*. Tooltip: date, three token counts, ≈ cost, sessions.
5. **Two cards side by side:**
   - **Top sessions by cost** (5 rows): badge · title · project caption · ≈ cost · mini 3-colour bar. Link "All sessions →".
   - **Top projects by cost** (5 rows): folder icon · project · sessions · ≈ cost · App/CLI split bar. Link "All projects →".
6. **Card: App vs CLI**, two columns, each headed by its glyph: sessions · tokens · cache-hit rate (CLI 91%, App 85%) · avg tokens per session (CLI 2.54M, App 3.09M) · active dates · ≈ cost (CLI ≈ ₹4,388, App ≈ ₹319).

**Edge case:** with one source only, the App-vs-CLI card reads *"Only CLI data found. Check Data Sources."*

### 6.2 Sessions

**Purpose:** find any session and see what it cost.

1. Summary: *"120 sessions with token data. 3 started subagents. 4 have no project."*
2. Toolbar: a search field (`#F5F5F5` fill, 8px radius, "Search title, ID or project"), a switch "Group subagents under parent", and a "Columns ▾" text button.
3. **Table card.** `#F5F5F5` header row in 12px medium `#71717A`. Rows are 44px with `#F0F0F0` dividers and a hover fill of `#FAFAFA`.
   Columns: Source badge · Title · Project · Started · Duration · Steps · New · Cached · Output · ≈ Cost · mini bar. Numbers are right-aligned in mono.
   - Untitled → *"Untitled session"* in `#71717A` italic plus an ID code chip `3163d2d4`.
   - No project → *"Unattributed"* in `#71717A` with an ⓘ.
   - Parents have a chevron and a `+2 subagents` pill. Expanded children are indented with a 1px `#E0E0E0` tree line, and the parent's figures gain the caption *"incl. subagents"*.
   - Hovering a title shows the tooltip *"Title from App conversation database"* / *"Title from CLI history"*.
4. Footer: "1–25 of 120", with secondary pill buttons for previous/next.

**Interactions:** click a row → Session detail. Columns are sortable; the default is ≈ Cost, descending.
**Empty search:** *"No sessions match 'xyz'"* with a "Clear search" text button.

### 6.3 Session detail

**Purpose:** explain where a single session's tokens went.

1. The breadcrumb shows `Sessions / Refactor pricing catalog`.
2. **Header card:** title (20px medium), source badge, project path chip, started → ended, duration, steps, conversation ID chip with a copy icon. For subagents: *"Started by Parent session title →"*.
3. Summary: *"This session ran 1h 12m over 84 steps and used 4.1M tokens (≈ ₹62). 9 steps caused 71% of the cost."*
4. **Mini KPI row:** New · Cached · Output · ≈ Cost.
5. **Card: Tokens over the session.** A cumulative stacked area (x = step, time in tooltip). Underneath, on the same x-axis, a per-step column strip. Error steps are `#D93025` dots on the axis; tool steps are `#E37400` ticks.
6. **Tabs** (text tabs with a 2px `#0A0A0C` underline on the active one): Steps · Tools · Subagents.
   - **Steps:** a table styled after the CLI transcript: # in `#80868B` mono like line numbers, time, a type label coloured like the CLI (`tool:` orange, `task:` purple, `error:` red, model reply green), status, three token columns. Error rows get a faint `#FCE8E6` background, and the row with the cost spike gets a faint `#FEF7E0`. Rows with reasoning have a "▸ Thought process" disclosure (the CLI's wording) that expands to a `#F5F5F5` block.
   - **Tools:** ranked horizontal bars by call count, with a secondary label for tokens used in those steps.
   - **Subagents:** mini table of child sessions with totals.
7. **Provenance card:** *"Token data · `…/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl` · Title & project · `conversation_summaries.db`"* with an "Open folder" link in `#1A73E8`.

**Edge case:** no tool calls → the Tools tab shows *"No tool calls in this session."*

### 6.4 Projects

**Purpose:** see which codebase or folder the usage went into.

1. Summary: *"2 projects account for 78% of estimated cost. 4 sessions (≈ 3% of cost) aren't linked to a project."*
2. Segmented control "Rank by: Cost · Tokens · Sessions" (selected segment white on a `#F5F5F5` track).
3. **Ranked list card.** Each row: folder icon, project name (medium `#0A0A0C`) with its path chip beneath, a horizontal bar split App zinc / CLI purple, then sessions, ≈ cost and tokens on the right. **Unattributed** is always last, with a `#BBBBBF` bar and an ⓘ.
4. Clicking a row opens a **right side panel** (480px, white, 12px radius, elevated) with the project's summary sentence, a daily sparkline, and its sessions table.

### 6.5 Costs

**Purpose:** explain the estimate, compare models, and project ahead.

1. **Info banner** (`#F5F5F5` fill, 12px radius, info icon in `#3F3F46`): *"Costs are estimates. Antigravity's logs don't say which model answered each step, so every token is priced at the model you pick. This is what the usage would cost on the API, not what you paid."*
2. **Card: Pricing used.** Model dropdown (composer-style), three price tiles per 1M tokens (New \$0.75 · Cached \$0.075 · Output \$3.75, each tile with its data-colour dot), the effective dates, and a status chip: "Verified" (`#188038` on `#E6F4EA`) or "Approximate" (`#E37400` on `#FEF7E0`).
3. **Card: Cost breakdown.** Waterfall: New ≈ ₹1,868 + Cached ≈ ₹1,824 + Output ≈ ₹1,015 = ≈ ₹4,707, with an All/CLI/App toggle.
4. **Card: Same usage, other models.** Table of model · vendor · ≈ cost · "× cheapest" · bar. The current model row has a `#F5F5F5` fill and a black "current" pill. Approximate prices carry an "approx." chip.
5. **Card: Your plan vs API price.** Not set: *"Add what you pay per month in Settings to compare."* with a black pill button "Open Settings". Set: two numbers side by side and the caption *"The difference isn't savings or loss, because subscription quotas work differently."*
6. **Card: Forecast.** The locked state is shown: lock icon, *"Forecasts need at least 14 active days. You have 13."* and a thin progress bar at 13/14 in `#0A0A0C`. A ghosted preview behind it shows a median line, a P10–P90 band, a cap at 2× the observed window, and the caption *"Based on your recent pattern only."*

### 6.6 Data Sources

**Purpose:** show exactly what was read and what was missed.

1. Summary: *"Both sources were read. 120 of 236 log files had token data. Nothing failed to parse."*
2. **Two source cards side by side.** The App card is headed by the black "A" logo and "Antigravity App". The CLI card is headed by the **pixel-gradient A** and "Antigravity CLI" in the CLI's `#4285F4` bold mono header style. Each card has an on/off switch and a status chip `● OK` (`#188038`).
   | Row | App | CLI |
   |---|---|---|
   | Folder | `~/.gemini/antigravity/brain` | `~/.gemini/antigravity-cli/brain` |
   | Transcript files | 8 | 228 |
   | With token data | 6 | 114 |
   | Without token data | 2 | 114 |
   | Dates | 28 Oct – 15 Nov 2026 | 17 – 24 Oct 2026 |
   | New / Cached / Output | 2.68M / 15.72M / 116.9K | 25.62M / 260.59M / 2.96M |
   | Titles & projects from | `conversation_summaries.db` (read-only) | `history.jsonl` |
   | Titles found | 5 of 6 | (illustrative) |
   | Projects found | 6 of 6 (illustrative) | (illustrative) |
   Footer link: "Open folder".
3. **Card: Not readable (collapsible).** *"Older sessions that only have binary `.pb` files have no readable token log. N skipped."* When expanded, it lists IDs as code chips.
4. **Card: Last scan.** Time, duration (1.4s), files read, and a black pill button **"Rescan now"** with the 1s spinner while running.
5. Secondary pill button: "+ Add custom folder".

### 6.7 Settings

**Purpose:** change sources, prices, money, display and refresh. Laid out like the CLI's Settings screen, but in the App's style:

- Top: a search field "Search settings…" (echoes the CLI's `Search: type to filter...`).
- Left column: section list, with the selected section as a white raised row (App style) and a small `#4285F4` "›" marker (CLI style, echoing `> light (current)`).
- Right column: one card per section. Each row has a label plus a muted helper line on the left and the control on the right, with `#F0F0F0` dividers between rows.
- **Saves automatically:** a white toast reads *"Saved"*. Invalid input shows an inline `#D93025` message and is not saved.
- Footer key hints in mono, CLI-style: `↑/↓ Navigate   Enter Edit   Esc Back`, with the keys in `#4285F4`.

Sections:
1. **Sources**
   - Antigravity App folder: path chip + "Browse…" + switch. *"Where the App keeps conversations."*
   - Antigravity CLI folder: same.
   - Custom folders: list with × to remove each, plus "+ Add folder".
   - Read App titles & projects from `conversation_summaries.db`: switch (on). *"Opened read-only. Turn off to show IDs only."*
   - "Restore defaults" text button.
2. **Pricing**
   - Default pricing model: composer-style dropdown.
   - Price catalog file: path chip + "Browse…" + "Open in editor".
   - **Price catalog table:** model · vendor · from · until · new / cached / output per 1M · Verified/Approximate chip. Read-only, with the caption *"Edit the catalog file to change prices."*
   - Helper: *"If no price covers a date, the nearest earlier price is used and marked ≈."*
3. **Money**
   - Currency: segmented `INR · USD`.
   - USD → INR rate: number field `88.00`, *"Used only for display."*
   - Monthly plan amount: currency field (0 = not set), *"What you actually pay. Used only for the plan comparison."*
   - Billing period: `30` days.
4. **Display**
   - Theme: radio list in CLI style: `light (current)`, `dark`, `follow Windows`, with the selected one marked by `›` and `#4285F4` text.
   - Density: `Comfortable · Compact`.
   - Numbers: `Compact (307.7M) · Full (307,693,417)`.
   - Week starts: `Monday · Sunday`.
   - Reduce motion: `Follow Windows · On · Off`.
5. **Refresh**
   - Rescan automatically: switch + interval (`1 min · 5 min · 15 min · Manual only`).
   - Watch folders for new sessions: switch. *"Updates as soon as Antigravity writes a new log."*
   - Clear cached scan: secondary pill button.
6. **Privacy:** an info card: *"Reads local files only. Never uploads, never sends telemetry, never writes to Antigravity's folders."* Lists the folders it reads, plus "Open app data folder".
7. **About:** app name, version `0.1.0`, build date. Detected versions: "Antigravity App 44.9.1 · Antigravity CLI 1.5.4". Links: "View logs", "Open diagnostics folder".

---

## 7. States to mock

1. **First run, nothing found.** A centered white card showing the black A logo, *"No Antigravity data found"*, the caption *"Looked in `~/.gemini/antigravity/brain` and `~/.gemini/antigravity-cli/brain`."*, a black pill "Choose folder…" and a text button "Open Settings".
2. **First scan.** The pixel A assembling square by square in the panel center, *"Reading 236 log files…"* beneath it, and skeleton cards fading in behind.
3. **Only one source.** The sidebar App row is greyed out with an orange dot, the status line reads *"App folder not found"*, and the App-vs-CLI card is replaced by a hint.
4. **Partial-data warning.** A banner on `#FEF7E0` with a `#FFB02E` warning glyph and `#3F3F46` text: *"2 sessions couldn't be read. See Data Sources."*
5. **Quick search (Ctrl+K).** A centered 560px white box (12px radius, elevated) with results grouped as Sessions / Projects / Screens and mono key hints `↑↓ Enter Esc`.
6. **Settings feedback.** The "Saved" toast, plus an inline error on the FX field: *"Enter a number greater than 0."*

---

## 8. Sample data (use the same everywhere)

**Real totals from this PC:**

| | Sessions w/ tokens | New input | Cached input | Output | Total |
|---|---|---|---|---|---|
| CLI | 114 | 25.62M | 260.59M | 2.96M | 289.17M |
| App | 6 | 2.68M | 15.72M | 116.9K | 18.52M |
| **All** | **120** | **28.30M** | **276.31M** | **3.08M** | **307.69M** |

**Derived** (Gemini 3.8 Flash \$0.75 / \$0.075 / \$3.75 per 1M; ₹88 = \$1):
- Cost: CLI ≈ \$49.86 (≈ ₹4,388) · App ≈ \$3.63 (≈ ₹319) · **All ≈ \$53.49 (≈ ₹4,707)**
- By type: New ≈ \$21.23 (₹1,868) · Cached ≈ \$20.72 (₹1,824) · Output ≈ \$11.54 (₹1,015)
- Token share: Cached 89.8% · New 9.2% · Output 1.0%. Cost share: New 39.7% · Cached 38.7% · Output 21.6%
- Cache-hit rate: CLI 91% · App 85% · All 91%
- Avg tokens per session: CLI 2.54M · App 3.09M

**Illustrative (keep consistent):** sidebar recent sessions grouped under `AntigravityUsageDashboard` ("Rust Windows App UI Des… 3m", "Antigravity Usage Dashbo… 9m", "Antigravity App Usage Tr… 33m"), `SLMRetraining`, `Learning`. These are taken from the App screenshot. Other titles: "Refactor pricing catalog", "Fix transcript parser edge case", "Untitled session". Daily values: CLI ≈ 36M/day on 17–24 Oct; App smaller across 28 Oct–15 Nov with several zero days. The "13 active days" in the forecast lock is also illustrative.

---

## 9. Glossary (ⓘ tooltips and the right-side "About these numbers" panel)

- **New input:** text sent to the model that wasn't already cached. Full input price.
- **Cached input:** earlier conversation context re-read from cache. About 10% of the input price.
- **Output:** everything the model generated, including reasoning and code.
- **Cache-hit rate:** cached input ÷ (new + cached input). Higher is cheaper.
- **Estimated cost (≈):** tokens × list price of the selected model. Not what you were charged.
- **Session:** one Antigravity conversation.
- **Subagent:** a session started by another session. Its usage also counts in its parent ("incl. subagents").
- **Unattributed:** no project folder was recorded.
- **Source:** which Antigravity product wrote the log, App or CLI.

---

## 10. Deliverables from the visualizer

At 1440×900, light theme, same sample data throughout. Put a reference screenshot of the Antigravity App beside frame 1 to show the match.
1. Overview (light), plus Overview (dark)
2. Sessions (one parent expanded)
3. Session detail (Steps tab, one "Thought process" expanded, one error row)
4. Projects (side panel open)
5. Costs (forecast locked)
6. Data Sources
7. Settings: one frame with Sources + Pricing (catalog table), one with Money + Display + Refresh + Privacy + About
8. States §7.1–§7.6
9. One **motion storyboard**: page enter, KPI count-up, bar grow, row expand, pixel-A assembly, each with its timing written beside it.
