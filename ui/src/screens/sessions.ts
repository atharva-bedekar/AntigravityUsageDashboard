import {
  SessionDagPayload,
  SessionOverviewRow,
  SessionRole,
  SessionsFilter,
  SessionsOverviewPayload,
  TimePeriod,
} from "../types.ts";
import {
  escapeHtml,
  formatCacheHitRate,
  formatDuration,
  formatExactTokens,
  formatTokens,
} from "../format.ts";
import { renderOrchestrationDag } from "../dag.ts";

export type SessionSortColumn =
  | "subagentCount"
  | "freshIn"
  | "cached"
  | "output"
  | "total"
  | "cacheHitRate"
  | "wallTimeSecs";

export interface SessionSortState {
  column: SessionSortColumn;
  direction: "asc" | "desc";
}

export interface SessionsCallbacks {
  onFilterChange: (patch: Partial<SessionsFilter>) => void;
  onResetFilters: () => void;
  onSortChange: (next: SessionSortState) => void;
  onSelectSession: (sessionId: string) => void;
  onCloseDag: () => void;
  onRetryDag: (sessionId: string) => void;
}

const PERIOD_OPTIONS: Array<{ value: TimePeriod; label: string }> = [
  { value: "1d", label: "Last 24h" },
  { value: "1w", label: "Last 7 days" },
  { value: "1m", label: "Last 30 days" },
  { value: "6m", label: "Last 6 months" },
  { value: "lifetime", label: "Lifetime" },
];

const SESSION_NUMERIC_COLS: Array<{ key: SessionSortColumn; label: string }> = [
  { key: "subagentCount", label: "Subagents" },
  { key: "freshIn", label: "Input" },
  { key: "cached", label: "Cached" },
  { key: "output", label: "Output" },
  { key: "total", label: "Total" },
  { key: "cacheHitRate", label: "Cache Hit Rate" },
  { key: "wallTimeSecs", label: "Wall Time" },
];

function isFiltersModified(filter: SessionsFilter): boolean {
  return filter.period !== "1w" || filter.project !== null;
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

function renderRolePill(role: SessionRole): string {
  if (role === "main") return "";
  const cls = role === "planner" ? "is-planner" : "is-orchestrator";
  const label = role === "planner" ? "Planner" : "Orchestrator";
  return `<span class="sess-role-pill ${cls}">${label}</span>`;
}

function buildLinkedBadgeTitle(row: SessionOverviewRow): string {
  if (row.linkedPlanName) {
    if (row.linkDirection === "toOrchestrator") {
      return `Linked to orchestrator via plan: ${row.linkedPlanName}`;
    }
    if (row.linkDirection === "fromPlanner") {
      return `Linked from planner via plan: ${row.linkedPlanName}`;
    }
    return `Linked workflow: ${row.linkedPlanName}`;
  }
  if (row.linkDirection === "toOrchestrator") {
    return "Linked to orchestrator session";
  }
  if (row.linkDirection === "fromPlanner") {
    return "Linked from planner session";
  }
  return "Linked workflow session";
}

/**
 * Returns a new array of session rows sorted numerically by `sort.column`
 * with deterministic tie-breakers (`total` descending, then `sessionId` ascending).
 */
export function sortSessionRows(
  rows: SessionOverviewRow[],
  sort: SessionSortState
): SessionOverviewRow[] {
  const col = sort.column;
  const dir = sort.direction === "asc" ? 1 : -1;
  return [...rows].sort((a, b) => {
    const diff = (a[col] - b[col]) * dir;
    if (diff !== 0 && Number.isFinite(diff)) {
      return diff;
    }
    const totalDiff = b.total - a.total;
    if (totalDiff !== 0 && Number.isFinite(totalDiff)) {
      return totalDiff;
    }
    return a.sessionId.localeCompare(b.sessionId);
  });
}

function renderDagPanel(
  payload: SessionsOverviewPayload,
  selectedSessionId: string,
  dag: SessionDagPayload | null,
  dagLoading: boolean,
  dagError: string | null
): string {
  const selectedRow = payload.sessions.find((r) => r.sessionId === selectedSessionId);
  const activeGraph = dag
    ? dag.secondary && dag.secondary.sessionId === selectedSessionId
      ? dag.secondary
      : dag.primary
    : null;
  const panelTitle = selectedRow?.title ?? activeGraph?.title ?? selectedSessionId;
  const panelRole = selectedRow?.role ?? activeGraph?.role ?? "main";

  const linkedHtml = dag?.link
    ? `
      <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;font-size:12px;color:var(--text-muted)">
        <span>Linked Workflow: Planner → Orchestrator</span>
        <span class="dag-plan-pill" title="${escapeHtml(dag.link.planName)}">${escapeHtml(dag.link.planName)}</span>
      </div>
    `
    : "";

  let bodyHtml = "";
  if (dagLoading && !dag) {
    bodyHtml = `<div class="tu-empty-table" aria-busy="true">Loading orchestration graph…</div>`;
  } else if (dagError) {
    bodyHtml = `
      <div class="tu-error-banner" role="alert">
        <span>${escapeHtml(dagError)}</span>
        <button type="button" class="tu-reset-btn" id="dag-retry-btn">Retry</button>
      </div>
    `;
  } else if (dag) {
    bodyHtml = `<div id="dag-canvas-host"></div>`;
  }

  return `
    <section class="tu-table-card dag-panel" aria-label="Orchestration DAG">
      <div class="dag-panel-head">
        <div style="display:flex;flex-direction:column;gap:6px;min-width:0">
          <div style="display:flex;align-items:center;flex-wrap:wrap;gap:8px;min-width:0">
            <h2 style="margin:0;font-size:15px;font-weight:500;color:var(--text-strong)">${escapeHtml(panelTitle)}</h2>
            ${renderRolePill(panelRole)}
          </div>
          ${linkedHtml}
        </div>
        <div style="display:flex;align-items:center;flex-wrap:wrap;gap:10px 14px">
          <div class="dag-legend" aria-label="Edge legend">
            <span style="display:inline-flex;align-items:center;gap:6px">
              <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
                <line x1="1" y1="5" x2="18" y2="5" stroke="var(--border-divider)" stroke-width="1.5" />
                <path d="M 16 2 L 22 5 L 16 8 Z" fill="var(--text-muted)" />
              </svg>
              <span>Dispatch</span>
            </span>
            <span style="display:inline-flex;align-items:center;gap:6px">
              <svg width="24" height="10" viewBox="0 0 24 10" aria-hidden="true">
                <line x1="1" y1="5" x2="18" y2="5" stroke="var(--text-muted)" stroke-width="1.4" stroke-dasharray="4 3" />
                <path d="M 16 2 L 22 5 L 16 8 Z" fill="var(--text-muted)" />
              </svg>
              <span>Feedback</span>
            </span>
          </div>
          <button type="button" class="dag-close-btn" id="dag-close-btn" aria-label="Close orchestration DAG">Close</button>
        </div>
      </div>
      ${bodyHtml}
    </section>
  `;
}

/**
 * Renders the Sessions overview screen: header + period/project filter bar,
 * sortable sessions table, and an interactive orchestration DAG panel for the
 * selected session.
 */
export function renderSessions(
  container: HTMLElement,
  payload: SessionsOverviewPayload,
  sort: SessionSortState,
  selectedSessionId: string | null,
  dag: SessionDagPayload | null,
  dagLoading: boolean,
  dagError: string | null,
  numberFormat: "compact" | "full",
  callbacks: SessionsCallbacks
): void {
  const { filter } = payload;
  const hasActiveFilters = isFiltersModified(filter);

  const windowCaption = payload.windowStart
    ? `${payload.windowStart} – ${payload.windowEnd}`
    : payload.windowEnd;
  const sessionCountLabel = `${payload.sessions.length} ${payload.sessions.length === 1 ? "session" : "sessions"}`;
  const headerCaption = `${windowCaption} · ${sessionCountLabel}`;

  const projectList =
    filter.project !== null && !payload.availableProjects.includes(filter.project)
      ? [filter.project, ...payload.availableProjects]
      : payload.availableProjects;

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

  const sortedRows = sortSessionRows(payload.sessions, sort);

  const tableContentHtml =
    sortedRows.length === 0
      ? `
        <div class="tu-empty-table">
          <div>No sessions match the current filters.</div>
          ${
            hasActiveFilters
              ? `<button type="button" class="tu-reset-btn" id="sess-empty-reset" style="margin-top:10px">Reset filters</button>`
              : ""
          }
        </div>
      `
      : `
        <div class="tu-table-wrap">
          <table class="tu-table">
            <thead>
              <tr>
                <th>Session</th>
                <th>Project</th>
                ${SESSION_NUMERIC_COLS.map((col) => {
                  const isActive = sort.column === col.key;
                  const ariaSort = isActive
                    ? sort.direction === "asc"
                      ? "ascending"
                      : "descending"
                    : "none";
                  return `
                    <th class="num" aria-sort="${ariaSort}">
                      <button type="button" class="tu-sort-btn sess-sort-btn" data-col="${col.key}">
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
                .map((row) => {
                  const isSelected = selectedSessionId === row.sessionId;
                  const linkedBadgeHtml =
                    row.linkedSessionId !== null
                      ? `<span class="sess-badge-linked" title="${escapeHtml(buildLinkedBadgeTitle(row))}">Linked</span>`
                      : "";
                  const projectCellHtml =
                    row.project === "Unattributed"
                      ? `<span class="sess-project-muted">Unattributed</span>`
                      : escapeHtml(row.project);

                  return `
                    <tr class="sess-row${isSelected ? " is-selected" : ""}">
                      <td>
                        <div class="sess-title-cell">
                          <button type="button" class="sess-name-btn" data-session-id="${escapeHtml(row.sessionId)}" aria-pressed="${isSelected ? "true" : "false"}">${escapeHtml(row.title)}</button>
                          ${renderRolePill(row.role)}
                          ${linkedBadgeHtml}
                        </div>
                      </td>
                      <td>${projectCellHtml}</td>
                      <td class="num">${escapeHtml(formatExactTokens(row.subagentCount))}</td>
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

  const dagPanelHtml =
    selectedSessionId !== null
      ? renderDagPanel(payload, selectedSessionId, dag, dagLoading, dagError)
      : "";

  container.innerHTML = `
    <div class="page-enter tu-page">
      <div class="tu-header">
        <div class="tu-title-group">
          <h1>Sessions</h1>
          <div class="tu-window-caption">${escapeHtml(headerCaption)}</div>
        </div>
        <div class="tu-filters">
          <label class="sr-only" for="sess-filter-period">Period</label>
          <select id="sess-filter-period" aria-label="Period">${periodOptionsHtml}</select>

          <label class="sr-only" for="sess-filter-project">Project</label>
          <select id="sess-filter-project" aria-label="Project">${projectOptionsHtml}</select>

          ${
            hasActiveFilters
              ? `<button type="button" class="tu-reset-btn" id="sess-reset-filters">Reset</button>`
              : ""
          }
        </div>
      </div>

      <section class="tu-table-card" aria-label="Sessions list">
        ${tableContentHtml}
      </section>

      ${dagPanelHtml}
    </div>
  `;

  const periodSelect = container.querySelector<HTMLSelectElement>("#sess-filter-period");
  periodSelect?.addEventListener("change", () => {
    callbacks.onFilterChange({ period: periodSelect.value as TimePeriod });
  });

  const projectSelect = container.querySelector<HTMLSelectElement>("#sess-filter-project");
  projectSelect?.addEventListener("change", () => {
    callbacks.onFilterChange({ project: projectSelect.value || null });
  });

  container.querySelector("#sess-reset-filters")?.addEventListener("click", () => {
    callbacks.onResetFilters();
  });

  container.querySelector("#sess-empty-reset")?.addEventListener("click", () => {
    callbacks.onResetFilters();
  });

  container.querySelectorAll<HTMLButtonElement>(".sess-sort-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const col = btn.dataset.col as SessionSortColumn | undefined;
      if (!col) return;
      const nextDirection: "asc" | "desc" =
        sort.column === col ? (sort.direction === "desc" ? "asc" : "desc") : "desc";
      callbacks.onSortChange({ column: col, direction: nextDirection });
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".sess-name-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sessionId = btn.dataset.sessionId;
      if (sessionId) {
        callbacks.onSelectSession(sessionId);
      }
    });
  });

  if (selectedSessionId !== null) {
    container.querySelector("#dag-close-btn")?.addEventListener("click", () => {
      callbacks.onCloseDag();
    });

    container.querySelector("#dag-retry-btn")?.addEventListener("click", () => {
      callbacks.onRetryDag(selectedSessionId);
    });

    if (dag && !dagError && !(dagLoading && !dag)) {
      const host = container.querySelector<HTMLElement>("#dag-canvas-host");
      if (host) {
        renderOrchestrationDag(host, dag, numberFormat);
      }
    }
  }
}
