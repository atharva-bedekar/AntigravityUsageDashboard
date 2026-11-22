import {
  AgentFilter,
  ModelUsageRow,
  TimeGranularity,
  TimePeriod,
  TokenUsageFilter,
  TokenUsagePayload,
} from "../types.ts";
import {
  escapeHtml,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "../format.ts";
import { renderTokenTimeChart } from "../charts.ts";

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

const PERIOD_OPTIONS: Array<{ value: TimePeriod; label: string }> = [
  { value: "1d", label: "Last 24h" },
  { value: "1w", label: "Last 7 days" },
  { value: "1m", label: "Last 30 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "lifetime", label: "Lifetime" },
];

const GRANULARITY_LABELS: Record<TimeGranularity, string> = {
  hourly: "Hourly",
  daily: "Daily",
  weekly: "Weekly",
  monthly: "Monthly",
};

const MODEL_NUMERIC_COLS: Array<{ key: ModelSortColumn; label: string }> = [
  { key: "freshIn", label: "Input" },
  { key: "cached", label: "Cached" },
  { key: "output", label: "Output" },
  { key: "total", label: "Total" },
  { key: "cacheHitRate", label: "Cache Hit Rate" },
  { key: "wallTimeSecs", label: "Wall Time" },
];

/**
 * Formats cache hit rate, distinguishing 0/0 ("—") from 0.0%.
 */
function formatCacheHitRate(freshIn: number, cached: number, rate: number): string {
  if (freshIn + cached === 0) return "—";
  const safeRate = Number.isFinite(rate) ? rate : 0;
  return `${(safeRate * 100).toFixed(1)}%`;
}

function encodeAgentFilter(agent: AgentFilter): string {
  if (agent.kind === "agentType") {
    return `agentType:${agent.agentType}`;
  }
  return agent.kind;
}

function decodeAgentFilter(value: string): AgentFilter {
  if (value === "mainOnly") return { kind: "mainOnly" };
  if (value === "subagentsOnly") return { kind: "subagentsOnly" };
  if (value.startsWith("agentType:")) {
    return { kind: "agentType", agentType: value.slice("agentType:".length) };
  }
  return { kind: "all" };
}

function isFiltersModified(filter: TokenUsageFilter): boolean {
  return (
    filter.period !== "1w" ||
    filter.project !== null ||
    filter.model !== null ||
    filter.agent.kind !== "all"
  );
}

function buildFilterContextParts(filter: TokenUsageFilter): string[] {
  const parts: string[] = [];
  if (filter.project !== null) {
    parts.push(`Project: ${filter.project}`);
  }
  if (filter.agent.kind === "mainOnly") {
    parts.push("Agent: Main only");
  } else if (filter.agent.kind === "subagentsOnly") {
    parts.push("Agent: Subagents only");
  } else if (filter.agent.kind === "agentType") {
    parts.push(`Agent: ${filter.agent.agentType}`);
  }
  if (filter.model !== null) {
    parts.push(`Model: ${filter.model}`);
  }
  return parts;
}

function renderSortTriangles(active: boolean, direction: "asc" | "desc"): string {
  const upActive = active && direction === "asc" ? " active" : "";
  const downActive = active && direction === "desc" ? " active" : "";
  return `
    <span class="tu-sort-icons" aria-hidden="true">
      <svg width="8" height="5" viewBox="0 0 8 5" class="tu-tri-up${upActive}">
        <path d="M4 0L8 5H0Z"/>
      </svg>
      <svg width="8" height="5" viewBox="0 0 8 5" class="tu-tri-down${downActive}">
        <path d="M4 5L0 0H8Z"/>
      </svg>
    </span>
  `;
}

/**
 * Returns a new array of model rows sorted by the active numeric column
 * with a deterministic model-name tie-breaker.
 */
export function sortModelRows(
  rows: ModelUsageRow[],
  sort: ModelSortState
): ModelUsageRow[] {
  const col = sort.column;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const aVal = a[col];
    const bVal = b[col];
    const diff = (aVal - bVal) * dir;
    if (diff !== 0 && Number.isFinite(diff)) {
      return diff;
    }
    return a.model.localeCompare(b.model);
  });
}

/**
 * Renders the Token Usage screen: header + 4-dropdown filter bar, hero segmented
 * token bar card, collapsible usage-over-time chart card, and sortable by-model table.
 */
export function renderTokenUsage(
  container: HTMLElement,
  payload: TokenUsagePayload,
  sort: ModelSortState,
  chartVisible: boolean,
  numberFormat: "compact" | "full",
  callbacks: TokenUsageCallbacks
): void {
  const { filter, totals } = payload;
  const hasActiveFilters = isFiltersModified(filter);

  const windowCaption = payload.windowStart
    ? `${payload.windowStart} – ${payload.windowEnd}`
    : payload.windowEnd;

  const projectList =
    filter.project !== null && !payload.availableProjects.includes(filter.project)
      ? [filter.project, ...payload.availableProjects]
      : payload.availableProjects;

  const modelList =
    filter.model !== null && !payload.availableModels.includes(filter.model)
      ? [filter.model, ...payload.availableModels]
      : payload.availableModels;

  const agentTypeList =
    filter.agent.kind === "agentType" &&
    !payload.availableAgentTypes.includes(filter.agent.agentType)
      ? [filter.agent.agentType, ...payload.availableAgentTypes]
      : payload.availableAgentTypes;

  const currentAgentValue = encodeAgentFilter(filter.agent);

  const periodOptionsHtml = PERIOD_OPTIONS.map(
    (opt) =>
      `<option value="${opt.value}"${filter.period === opt.value ? " selected" : ""}>${escapeHtml(opt.label)}</option>`
  ).join("");

  const projectOptionsHtml = [
    `<option value=""${filter.project === null ? " selected" : ""}>All projects</option>`,
    ...projectList.map(
      (proj) =>
        `<option value="${escapeHtml(proj)}"${filter.project === proj ? " selected" : ""}>${escapeHtml(proj)}</option>`
    ),
  ].join("");

  const modelOptionsHtml = [
    `<option value=""${filter.model === null ? " selected" : ""}>All models</option>`,
    ...modelList.map(
      (model) =>
        `<option value="${escapeHtml(model)}"${filter.model === model ? " selected" : ""}>${escapeHtml(model)}</option>`
    ),
  ].join("");

  const agentOptionsHtml = [
    `<option value="all"${currentAgentValue === "all" ? " selected" : ""}>All agents</option>`,
    `<option value="mainOnly"${currentAgentValue === "mainOnly" ? " selected" : ""}>Main only</option>`,
    `<option value="subagentsOnly"${currentAgentValue === "subagentsOnly" ? " selected" : ""}>Subagents only</option>`,
    ...agentTypeList.map((agentType) => {
      const val = `agentType:${agentType}`;
      return `<option value="${escapeHtml(val)}"${currentAgentValue === val ? " selected" : ""}>${escapeHtml(agentType)}</option>`;
    }),
  ].join("");

  const segments = [
    { key: "input", label: "Input", value: totals.freshIn, cls: "is-input" },
    { key: "cached", label: "Cached", value: totals.cached, cls: "is-cached" },
    { key: "output", label: "Output", value: totals.output, cls: "is-output" },
  ];

  const heroBodyHtml =
    totals.total === 0
      ? `
        <div class="tu-seg-bar-wrap">
          <div class="tu-seg-bar" aria-hidden="true"></div>
        </div>
        <div class="tu-empty-hero">
          <div>No token activity in this period</div>
          ${
            hasActiveFilters
              ? `<button type="button" class="tu-reset-btn" id="tu-hero-reset" style="margin-top:10px">Reset filters</button>`
              : ""
          }
        </div>
      `
      : `
        <div class="tu-seg-bar-wrap" id="tu-seg-bar-wrap">
          <div class="tu-seg-bar">
            ${segments
              .map((seg, idx) => {
                if (seg.value <= 0) return "";
                const pct = (seg.value / totals.total) * 100;
                const pctStr = pct.toFixed(1);
                const formatted = formatTokens(seg.value, numberFormat);
                const exact = formatExactTokens(seg.value);
                const aria = `${seg.label}: ${formatted} (${exact} tokens, ${pctStr}%)`;
                return `<div class="tu-seg-slice ${seg.cls}" data-seg-idx="${idx}" tabindex="0" role="img" aria-label="${escapeHtml(aria)}" style="width: ${pct}%"></div>`;
              })
              .join("")}
          </div>
          <div class="tu-seg-tooltip" id="tu-seg-tooltip" role="status" aria-live="polite"></div>
        </div>
        <div class="tu-seg-legend">
          ${segments
            .map((seg) => {
              const pctStr = ((seg.value / totals.total) * 100).toFixed(1);
              return `
                <div class="tu-seg-legend-item">
                  <span class="tu-seg-dot ${seg.cls}"></span>
                  <span>${seg.label}</span>
                  <span class="mono">${escapeHtml(formatTokens(seg.value, numberFormat))}</span>
                  <span class="mono" style="color:var(--text-muted)">(${pctStr}%)</span>
                </div>
              `;
            })
            .join("")}
        </div>
      `;

  const filterContextParts = buildFilterContextParts(filter);
  const filterContextPillHtml =
    filterContextParts.length > 0
      ? `<span class="tu-filter-pill">${escapeHtml(filterContextParts.join(" · "))}</span>`
      : "";

  const sortedRows = sortModelRows(payload.byModel, sort);
  const hasModelFilter = filter.model !== null;

  const tableContentHtml =
    sortedRows.length === 0
      ? `<div class="tu-empty-table">No model activity matches the current filters.</div>`
      : `
        <div class="tu-table-wrap">
          <table class="tu-table">
            <thead>
              <tr>
                <th>Model</th>
                ${MODEL_NUMERIC_COLS.map((col) => {
                  const isActive = sort.column === col.key;
                  const ariaSort = isActive
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                  return `
                    <th class="num" aria-sort="${ariaSort}">
                      <button type="button" class="tu-sort-btn" data-col="${col.key}">
                        <span>${col.label}</span>
                        ${renderSortTriangles(isActive, sort.direction)}
                      </button>
                    </th>
                  `;
                }).join("")}
              </tr>
            </thead>
            <tbody>
              ${sortedRows
                .map((row, idx) => {
                  const isSelected = hasModelFilter && filter.model === row.model;
                  const isDimmed = hasModelFilter && !isSelected;
                  const rowCls = [
                    "tu-model-row",
                    isSelected ? "is-selected" : "",
                    isDimmed ? "is-dimmed" : "",
                  ]
                    .filter(Boolean)
                    .join(" ");
                  const modelCellHtml =
                    row.model === "Unrecorded"
                      ? `<span class="tu-unrecorded" title="No Model Selection notice was recorded in these transcripts">Unrecorded</span>`
                      : escapeHtml(row.model);
                  return `
                    <tr class="${rowCls}" data-row-idx="${idx}" tabindex="0">
                      <td>${modelCellHtml}</td>
                      <td class="num" title="${escapeHtml(formatExactTokens(row.freshIn))}">${escapeHtml(formatTokens(row.freshIn, numberFormat))}</td>
                      <td class="num" title="${escapeHtml(formatExactTokens(row.cached))}">${escapeHtml(formatTokens(row.cached, numberFormat))}</td>
                      <td class="num" title="${escapeHtml(formatExactTokens(row.output))}">${escapeHtml(formatTokens(row.output, numberFormat))}</td>
                      <td class="num" title="${escapeHtml(formatExactTokens(row.total))}">${escapeHtml(formatTokens(row.total, numberFormat))}</td>
                      <td class="num">${escapeHtml(formatCacheHitRate(row.freshIn, row.cached, row.cacheHitRate))}</td>
                      <td class="num">${escapeHtml(formatDuration(row.wallTimeSecs))}</td>
                    </tr>
                  `;
                })
                .join("")}
            </tbody>
          </table>
        </div>
      `;

  const granularityLabel = GRANULARITY_LABELS[payload.granularity];

  container.innerHTML = `
    <div class="page-enter tu-page">
      <div class="tu-header">
        <div class="tu-title-group">
          <h1>Token Usage</h1>
          <div class="tu-window-caption">${escapeHtml(windowCaption)}</div>
        </div>
        <div class="tu-filters">
          <label class="sr-only" for="tu-filter-period">Period</label>
          <select id="tu-filter-period" aria-label="Period">${periodOptionsHtml}</select>

          <label class="sr-only" for="tu-filter-project">Project</label>
          <select id="tu-filter-project" aria-label="Project">${projectOptionsHtml}</select>

          <label class="sr-only" for="tu-filter-model">Model</label>
          <select id="tu-filter-model" aria-label="Model">${modelOptionsHtml}</select>

          <label class="sr-only" for="tu-filter-agent">Agent</label>
          <select id="tu-filter-agent" aria-label="Agent">${agentOptionsHtml}</select>

          ${
            hasActiveFilters
              ? `<button type="button" class="tu-reset-btn" id="tu-reset-filters">Reset</button>`
              : ""
          }
        </div>
      </div>

      <section class="tu-hero-card" aria-label="Token totals">
        <div class="tu-hero-top">
          <div class="tu-hero-total" title="${escapeHtml(formatExactTokens(totals.total))} tokens">${escapeHtml(formatTokens(totals.total, numberFormat))}</div>
          <div class="tu-hero-meta">
            <span class="tu-hero-stat">Cache hit rate <strong>${escapeHtml(formatCacheHitRate(totals.freshIn, totals.cached, totals.cacheHitRate))}</strong></span>
            <span class="tu-hero-stat">Wall time <strong>${escapeHtml(formatDuration(totals.wallTimeSecs))}</strong></span>
          </div>
        </div>
        ${heroBodyHtml}
      </section>

      <section class="tu-chart-card" aria-label="Usage over time">
        <div class="tu-chart-header"${chartVisible ? "" : ' style="margin-bottom:0"'}>
          <div class="tu-chart-title-group">
            <h2>Usage over time</h2>
            <span class="tu-granularity-pill">${escapeHtml(granularityLabel)}</span>
          </div>
          <button
            type="button"
            class="tu-chart-toggle"
            id="tu-chart-toggle"
            aria-expanded="${chartVisible ? "true" : "false"}"
          >${chartVisible ? "Hide chart" : "Show chart"}</button>
        </div>
        ${chartVisible ? '<div class="tu-chart-body" id="tu-time-chart"></div>' : ""}
      </section>

      <section class="tu-table-card" aria-label="Distribution by model">
        <div class="tu-table-head">
          <h2>Distribution by model</h2>
          ${filterContextPillHtml}
        </div>
        ${tableContentHtml}
      </section>
    </div>
  `;

  // Wire filter dropdowns and reset controls
  const periodSelect = container.querySelector<HTMLSelectElement>("#tu-filter-period");
  periodSelect?.addEventListener("change", () => {
    callbacks.onFilterChange({ period: periodSelect.value as TimePeriod });
  });

  const projectSelect = container.querySelector<HTMLSelectElement>("#tu-filter-project");
  projectSelect?.addEventListener("change", () => {
    callbacks.onFilterChange({ project: projectSelect.value || null });
  });

  const modelSelect = container.querySelector<HTMLSelectElement>("#tu-filter-model");
  modelSelect?.addEventListener("change", () => {
    callbacks.onFilterChange({ model: modelSelect.value || null });
  });

  const agentSelect = container.querySelector<HTMLSelectElement>("#tu-filter-agent");
  agentSelect?.addEventListener("change", () => {
    callbacks.onFilterChange({ agent: decodeAgentFilter(agentSelect.value) });
  });

  container.querySelector("#tu-reset-filters")?.addEventListener("click", () => {
    callbacks.onResetFilters();
  });
  container.querySelector("#tu-hero-reset")?.addEventListener("click", () => {
    callbacks.onResetFilters();
  });

  // Wire segmented bar interactive tooltips
  if (totals.total > 0) {
    const segBarWrap = container.querySelector<HTMLElement>("#tu-seg-bar-wrap");
    const segTooltip = container.querySelector<HTMLElement>("#tu-seg-tooltip");
    if (segBarWrap && segTooltip) {
      const showSegTooltip = (sliceEl: HTMLElement) => {
        const idx = Number(sliceEl.dataset.segIdx);
        const seg = segments[idx];
        if (!seg) return;
        const pctStr = ((seg.value / totals.total) * 100).toFixed(1);
        const formatted = formatTokens(seg.value, numberFormat);
        const exact = formatExactTokens(seg.value);
        segTooltip.innerHTML = `
          <span class="tu-seg-dot ${seg.cls}"></span>
          <strong>${seg.label}</strong>: ${escapeHtml(formatted)} (${escapeHtml(exact)}) · ${pctStr}%
        `;
        const wrapWidth = segBarWrap.offsetWidth;
        if (wrapWidth > 0) {
          const centerPx = sliceEl.offsetLeft + sliceEl.offsetWidth / 2;
          const pctLeft = Math.max(12, Math.min(88, (centerPx / wrapWidth) * 100));
          segTooltip.style.left = `${pctLeft}%`;
        } else {
          segTooltip.style.left = "50%";
        }
        segTooltip.classList.add("visible");
      };

      const hideSegTooltip = () => {
        segTooltip.classList.remove("visible");
      };

      container.querySelectorAll<HTMLElement>(".tu-seg-slice").forEach((sliceEl) => {
        sliceEl.addEventListener("mouseenter", () => showSegTooltip(sliceEl));
        sliceEl.addEventListener("focus", () => showSegTooltip(sliceEl));
        sliceEl.addEventListener("mouseleave", hideSegTooltip);
        sliceEl.addEventListener("blur", hideSegTooltip);
      });
    }
  }

  // Wire collapsible time chart
  container.querySelector("#tu-chart-toggle")?.addEventListener("click", () => {
    callbacks.onToggleChart(!chartVisible);
  });

  if (chartVisible) {
    const chartEl = container.querySelector<HTMLElement>("#tu-time-chart");
    if (chartEl) {
      renderTokenTimeChart(chartEl, payload.timeSeries, numberFormat);
    }
  }

  // Wire model table sort buttons
  container.querySelectorAll<HTMLButtonElement>(".tu-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = btn.dataset.col as ModelSortColumn | undefined;
      if (!col) return;
      const nextDirection: "asc" | "desc" =
        sort.column === col ? (sort.direction === "desc" ? "asc" : "desc") : "desc";
      callbacks.onSortChange({ column: col, direction: nextDirection });
    });
  });

  // Wire model row click & keyboard selection
  container.querySelectorAll<HTMLTableRowElement>(".tu-model-row").forEach((rowEl) => {
    const toggleRow = () => {
      const idx = Number(rowEl.dataset.rowIdx);
      const row = sortedRows[idx];
      if (!row) return;
      const isSelected = filter.model === row.model;
      callbacks.onFilterChange({ model: isSelected ? null : row.model });
    };

    rowEl.addEventListener("click", toggleRow);
    rowEl.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        toggleRow();
      }
    });
  });
}
