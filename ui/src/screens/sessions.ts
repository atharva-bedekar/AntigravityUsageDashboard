import { DashboardPayload, SessionSummary } from "../types.ts";
import {
  escapeHtml,
  formatDateTime,
  formatDuration,
  formatMoney,
  formatTokens,
} from "../format.ts";
import { icons, infoIconHtml, sourceBadgeHtml } from "../icons.ts";

export type SessionSortKey =
  | "source"
  | "title"
  | "project"
  | "started"
  | "duration"
  | "steps"
  | "freshIn"
  | "cached"
  | "output"
  | "cost";

export interface SessionsUiState {
  search: string;
  groupSubagents: boolean;
  sortKey: SessionSortKey;
  sortDir: "asc" | "desc";
  page: number;
  pageSize: number;
  expandedParents: Set<string>;
  visibleCols: Record<string, boolean>;
  columnsMenuOpen: boolean;
}

export function createDefaultSessionsState(): SessionsUiState {
  return {
    search: "",
    groupSubagents: true,
    sortKey: "cost",
    sortDir: "desc",
    page: 1,
    pageSize: 25,
    expandedParents: new Set<string>(),
    visibleCols: {
      source: true,
      title: true,
      project: true,
      started: true,
      duration: true,
      steps: true,
      freshIn: true,
      cached: true,
      output: true,
      cost: true,
      mix: true,
    },
    columnsMenuOpen: false,
  };
}

export function renderSessions(
  container: HTMLElement,
  data: DashboardPayload,
  state: SessionsUiState,
  numberFormat: "compact" | "full",
  onOpenSession: (sessionId: string) => void,
  onStateChange: () => void
): void {
  const currency = data.filter.currency;
  const allSessions = data.sessions;
  const byId = new Map(allSessions.map((s) => [s.sessionId, s]));

  const parentCount = allSessions.filter((s) => s.childIds.length > 0).length;
  const unattributedCount = allSessions.filter((s) => s.project === "Unattributed").length;

  // Build rows: when groupSubagents is ON, hide child rows from top-level and roll up totals
  const q = state.search.trim().toLowerCase();
  const matchesQuery = (s: SessionSummary) =>
    !q ||
    s.title.toLowerCase().includes(q) ||
    s.sessionId.toLowerCase().includes(q) ||
    s.shortId.toLowerCase().includes(q) ||
    s.project.toLowerCase().includes(q) ||
    s.toolNames.some((t) => t.toLowerCase().includes(q));

  interface RowModel {
    session: SessionSummary;
    children: SessionSummary[];
    rollupFresh: number;
    rollupCached: number;
    rollupOutput: number;
    rollupTotal: number;
    rollupCost: number;
    rollupSteps: number;
  }

  let rows: RowModel[] = [];
  if (state.groupSubagents) {
    const topLevel = allSessions.filter((s) => !s.parentId || !byId.has(s.parentId));
    rows = topLevel
      .map((s) => {
        const children = s.childIds
          .map((cid) => byId.get(cid))
          .filter((c): c is SessionSummary => Boolean(c));
        const rollupFresh = s.freshIn + children.reduce((a, c) => a + c.freshIn, 0);
        const rollupCached = s.cached + children.reduce((a, c) => a + c.cached, 0);
        const rollupOutput = s.output + children.reduce((a, c) => a + c.output, 0);
        const rollupTotal = s.total + children.reduce((a, c) => a + c.total, 0);
        const rollupCost = s.costCurrency + children.reduce((a, c) => a + c.costCurrency, 0);
        const rollupSteps = s.stepCount + children.reduce((a, c) => a + c.stepCount, 0);
        return {
          session: s,
          children,
          rollupFresh,
          rollupCached,
          rollupOutput,
          rollupTotal,
          rollupCost,
          rollupSteps,
        };
      })
      .filter((r) => matchesQuery(r.session) || r.children.some(matchesQuery));
  } else {
    rows = allSessions
      .filter(matchesQuery)
      .map((s) => ({
        session: s,
        children: [],
        rollupFresh: s.freshIn,
        rollupCached: s.cached,
        rollupOutput: s.output,
        rollupTotal: s.total,
        rollupCost: s.costCurrency,
        rollupSteps: s.stepCount,
      }));
  }

  // Sort
  const dir = state.sortDir === "asc" ? 1 : -1;
  rows.sort((a, b) => {
    switch (state.sortKey) {
      case "source":
        return a.session.source.kind.localeCompare(b.session.source.kind) * dir;
      case "title":
        return a.session.title.localeCompare(b.session.title) * dir;
      case "project":
        return a.session.project.localeCompare(b.session.project) * dir;
      case "started":
        return (a.session.firstUtc ?? "").localeCompare(b.session.firstUtc ?? "") * dir;
      case "duration":
        return (a.session.durationSecs - b.session.durationSecs) * dir;
      case "steps":
        return (a.rollupSteps - b.rollupSteps) * dir;
      case "freshIn":
        return (a.rollupFresh - b.rollupFresh) * dir;
      case "cached":
        return (a.rollupCached - b.rollupCached) * dir;
      case "output":
        return (a.rollupOutput - b.rollupOutput) * dir;
      case "cost":
      default:
        return (a.rollupCost - b.rollupCost) * dir;
    }
  });

  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / state.pageSize));
  if (state.page > totalPages) state.page = totalPages;
  const startIdx = (state.page - 1) * state.pageSize;
  const pagedRows = rows.slice(startIdx, startIdx + state.pageSize);

  const sortArrow = (key: SessionSortKey) =>
    state.sortKey === key ? (state.sortDir === "asc" ? " ↑" : " ↓") : "";

  const col = (k: string) => state.visibleCols[k] !== false;

  const colList = [
    { key: "source", label: "Source" },
    { key: "title", label: "Title" },
    { key: "project", label: "Project" },
    { key: "started", label: "Started" },
    { key: "duration", label: "Duration" },
    { key: "steps", label: "Steps" },
    { key: "freshIn", label: "New" },
    { key: "cached", label: "Cached" },
    { key: "output", label: "Output" },
    { key: "cost", label: "≈ Cost" },
    { key: "mix", label: "Mix" },
  ];

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <p class="summary-sentence" style="font-size:19px">
        <strong>${allSessions.length} sessions</strong> with token data.
        <strong>${parentCount}</strong> started subagents.
        <strong>${unattributedCount}</strong> have no project.
      </p>

      <div style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <div style="position:relative;flex:1;min-width:240px;max-width:380px">
          <span style="position:absolute;left:10px;top:50%;transform:translateY(-50%);color:var(--text-muted);display:flex">${icons.search(15)}</span>
          <input id="sess-search-input" class="text-input" style="width:100%;padding-left:32px" type="text" placeholder="Search title, ID or project" value="${escapeHtml(state.search)}" />
        </div>

        <div style="display:flex;align-items:center;gap:16px;position:relative">
          <label style="display:inline-flex;align-items:center;gap:8px;font-size:13px;cursor:pointer">
            <span>Group subagents under parent</span>
            <span class="switch">
              <input type="checkbox" id="sess-group-toggle" ${state.groupSubagents ? "checked" : ""} />
              <span class="switch-slider"></span>
            </span>
          </label>

          <div style="position:relative">
            <button type="button" class="btn-secondary" id="sess-cols-btn">Columns ▾</button>
            ${
              state.columnsMenuOpen
                ? `<div class="menu-dropdown" style="right:0;left:auto;min-width:170px">
                    ${colList
                      .map(
                        (c) => `
                        <label class="menu-dropdown-item" style="cursor:pointer">
                          <span>${c.label}</span>
                          <input type="checkbox" class="sess-col-chk" data-col="${c.key}" ${col(c.key) ? "checked" : ""} />
                        </label>`
                      )
                      .join("")}
                  </div>`
                : ""
            }
          </div>
        </div>
      </div>

      <div class="card table-card">
        ${
          pagedRows.length === 0
            ? `<div style="padding:36px;text-align:center">
                <div style="font-size:15px;font-weight:500;margin-bottom:8px">No sessions match '${escapeHtml(state.search)}'</div>
                <button type="button" class="link-btn" id="sess-clear-search">Clear search</button>
              </div>`
            : `
            <div class="table-scroll">
              <table class="data-table">
                <thead>
                  <tr>
                    ${col("source") ? `<th class="sortable" data-sort="source">Source${sortArrow("source")}</th>` : ""}
                    ${col("title") ? `<th class="sortable" data-sort="title">Title${sortArrow("title")}</th>` : ""}
                    ${col("project") ? `<th class="sortable" data-sort="project">Project${sortArrow("project")}</th>` : ""}
                    ${col("started") ? `<th class="sortable" data-sort="started">Started${sortArrow("started")}</th>` : ""}
                    ${col("duration") ? `<th class="sortable" data-sort="duration">Duration${sortArrow("duration")}</th>` : ""}
                    ${col("steps") ? `<th class="sortable num" data-sort="steps">Steps${sortArrow("steps")}</th>` : ""}
                    ${col("freshIn") ? `<th class="sortable num" data-sort="freshIn">New${sortArrow("freshIn")}</th>` : ""}
                    ${col("cached") ? `<th class="sortable num" data-sort="cached">Cached${sortArrow("cached")}</th>` : ""}
                    ${col("output") ? `<th class="sortable num" data-sort="output">Output${sortArrow("output")}</th>` : ""}
                    ${col("cost") ? `<th class="sortable num" data-sort="cost">≈ Cost${sortArrow("cost")}</th>` : ""}
                    ${col("mix") ? `<th>Mix</th>` : ""}
                  </tr>
                </thead>
                <tbody>
                  ${pagedRows
                    .map((r) => {
                      const s = r.session;
                      const isExpanded = state.expandedParents.has(s.sessionId);
                      const hasChildren = r.children.length > 0;
                      const tot = Math.max(1, r.rollupTotal);
                      const pC = (r.rollupCached / tot) * 100;
                      const pN = (r.rollupFresh / tot) * 100;
                      const pO = (r.rollupOutput / tot) * 100;
                      const titleTooltip =
                        s.labelSource === "conversation_summaries.db"
                          ? "Title from App conversation database"
                          : s.labelSource === "history.jsonl"
                          ? "Title from CLI history"
                          : `Title from ${s.labelSource}`;

                      const parentRow = `
                        <tr class="clickable-row sess-row" data-id="${escapeHtml(s.sessionId)}">
                          ${col("source") ? `<td>${sourceBadgeHtml(s.source)}</td>` : ""}
                          ${
                            col("title")
                              ? `<td title="${escapeHtml(titleTooltip)}">
                                  <div style="display:flex;align-items:center;gap:6px">
                                    ${
                                      hasChildren
                                        ? `<button type="button" class="icon-btn sess-expand-btn" data-parent="${escapeHtml(s.sessionId)}" style="width:22px;height:22px">${isExpanded ? icons.chevronDown(14) : icons.chevronRight(14)}</button>`
                                        : ""
                                    }
                                    <span style="${s.isUntitled ? "color:var(--text-muted);font-style:italic" : "font-weight:500"}">${escapeHtml(s.title)}</span>
                                    ${s.isUntitled ? `<span class="code-chip">${escapeHtml(s.shortId)}</span>` : ""}
                                    ${hasChildren ? `<span class="code-chip">+${r.children.length} subagent${r.children.length === 1 ? "" : "s"}</span>` : ""}
                                  </div>
                                  ${hasChildren ? `<div style="font-size:11px;color:var(--text-muted);padding-left:28px">incl. subagents</div>` : ""}
                                </td>`
                              : ""
                          }
                          ${
                            col("project")
                              ? `<td>
                                  ${
                                    s.project === "Unattributed"
                                      ? `<span style="color:var(--text-muted);display:inline-flex;align-items:center;gap:4px">Unattributed ${infoIconHtml("unattributed", "Unattributed")}</span>`
                                      : `<span class="code-chip">${escapeHtml(s.project)}</span>`
                                  }
                                </td>`
                              : ""
                          }
                          ${col("started") ? `<td class="mono" style="font-size:12px;color:var(--text-muted);white-space:nowrap">${escapeHtml(formatDateTime(s.firstUtc))}</td>` : ""}
                          ${col("duration") ? `<td class="mono" style="font-size:12.5px">${escapeHtml(formatDuration(s.durationSecs))}</td>` : ""}
                          ${col("steps") ? `<td class="num">${r.rollupSteps}</td>` : ""}
                          ${col("freshIn") ? `<td class="num" style="color:var(--data-new)">${formatTokens(r.rollupFresh, numberFormat)}</td>` : ""}
                          ${col("cached") ? `<td class="num">${formatTokens(r.rollupCached, numberFormat)}</td>` : ""}
                          ${col("output") ? `<td class="num" style="color:var(--data-output)">${formatTokens(r.rollupOutput, numberFormat)}</td>` : ""}
                          ${col("cost") ? `<td class="num" style="font-weight:600">≈ ${formatMoney(r.rollupCost, currency)}</td>` : ""}
                          ${
                            col("mix")
                              ? `<td><div class="mini-mix-bar"><div style="width:${pC}%;background:var(--data-cached)"></div><div style="width:${pN}%;background:var(--data-new)"></div><div style="width:${pO}%;background:var(--data-output)"></div></div></td>`
                              : ""
                          }
                        </tr>
                      `;

                      const childRows =
                        hasChildren && isExpanded
                          ? r.children
                              .map((c) => {
                                const cTot = Math.max(1, c.total);
                                return `
                                  <tr class="clickable-row subagent-child sess-row" data-id="${escapeHtml(c.sessionId)}">
                                    ${col("source") ? `<td><span class="source-badge source-badge-custom">SUB</span></td>` : ""}
                                    ${
                                      col("title")
                                        ? `<td><div class="tree-indent"><span>${escapeHtml(c.title)}</span>${c.agentType ? `<span class="code-chip">${escapeHtml(c.agentType)}</span>` : ""}</div></td>`
                                        : ""
                                    }
                                    ${col("project") ? `<td style="color:var(--text-muted)">${escapeHtml(c.project)}</td>` : ""}
                                    ${col("started") ? `<td class="mono" style="font-size:12px;color:var(--text-muted)">${escapeHtml(formatDateTime(c.firstUtc))}</td>` : ""}
                                    ${col("duration") ? `<td class="mono" style="font-size:12px">${escapeHtml(formatDuration(c.durationSecs))}</td>` : ""}
                                    ${col("steps") ? `<td class="num">${c.stepCount}</td>` : ""}
                                    ${col("freshIn") ? `<td class="num">${formatTokens(c.freshIn, numberFormat)}</td>` : ""}
                                    ${col("cached") ? `<td class="num">${formatTokens(c.cached, numberFormat)}</td>` : ""}
                                    ${col("output") ? `<td class="num">${formatTokens(c.output, numberFormat)}</td>` : ""}
                                    ${col("cost") ? `<td class="num">≈ ${formatMoney(c.costCurrency, currency)}</td>` : ""}
                                    ${
                                      col("mix")
                                        ? `<td><div class="mini-mix-bar"><div style="width:${(c.cached / cTot) * 100}%;background:var(--data-cached)"></div><div style="width:${(c.freshIn / cTot) * 100}%;background:var(--data-new)"></div><div style="width:${(c.output / cTot) * 100}%;background:var(--data-output)"></div></div></td>`
                                        : ""
                                    }
                                  </tr>
                                `;
                              })
                              .join("")
                          : "";

                      return parentRow + childRows;
                    })
                    .join("")}
                </tbody>
              </table>
            </div>
          `
        }

        <div style="display:flex;align-items:center;justify-content:space-between;padding:10px 14px;border-top:1px solid var(--border-subtle);font-size:12.5px;color:var(--text-muted)">
          <div>
            Showing ${totalRows === 0 ? 0 : startIdx + 1}–${Math.min(startIdx + state.pageSize, totalRows)} of ${totalRows}
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <select id="sess-page-size" class="text-input" style="padding:3px 8px;font-size:12px">
              <option value="25" ${state.pageSize === 25 ? "selected" : ""}>25 / page</option>
              <option value="50" ${state.pageSize === 50 ? "selected" : ""}>50 / page</option>
              <option value="100" ${state.pageSize === 100 ? "selected" : ""}>100 / page</option>
            </select>
            <button type="button" class="btn-secondary" id="sess-prev" ${state.page <= 1 ? "disabled" : ""}>Previous</button>
            <button type="button" class="btn-secondary" id="sess-next" ${state.page >= totalPages ? "disabled" : ""}>Next</button>
          </div>
        </div>
      </div>
    </div>
  `;

  const searchInput = container.querySelector("#sess-search-input") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    state.search = searchInput.value;
    state.page = 1;
    onStateChange();
    const el = container.querySelector("#sess-search-input") as HTMLInputElement | null;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  });

  container.querySelector("#sess-clear-search")?.addEventListener("click", () => {
    state.search = "";
    state.page = 1;
    onStateChange();
  });

  container.querySelector("#sess-group-toggle")?.addEventListener("change", (e) => {
    state.groupSubagents = (e.target as HTMLInputElement).checked;
    state.page = 1;
    onStateChange();
  });

  container.querySelector("#sess-cols-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.columnsMenuOpen = !state.columnsMenuOpen;
    onStateChange();
  });

  container.querySelectorAll<HTMLInputElement>(".sess-col-chk").forEach((chk) => {
    chk.addEventListener("change", () => {
      const k = chk.dataset.col;
      if (k) {
        state.visibleCols[k] = chk.checked;
        onStateChange();
      }
    });
  });

  container.querySelectorAll<HTMLElement>("th.sortable").forEach((th) => {
    th.addEventListener("click", () => {
      const key = th.dataset.sort as SessionSortKey;
      if (!key) return;
      if (state.sortKey === key) {
        state.sortDir = state.sortDir === "asc" ? "desc" : "asc";
      } else {
        state.sortKey = key;
        state.sortDir = key === "title" || key === "project" || key === "source" ? "asc" : "desc";
      }
      onStateChange();
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".sess-expand-btn").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const pid = btn.dataset.parent;
      if (!pid) return;
      if (state.expandedParents.has(pid)) {
        state.expandedParents.delete(pid);
      } else {
        state.expandedParents.add(pid);
      }
      onStateChange();
    });
  });

  container.querySelectorAll<HTMLElement>(".sess-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".info-btn")) return;
      const id = row.dataset.id;
      if (id) onOpenSession(id);
    });
  });

  container.querySelector("#sess-page-size")?.addEventListener("change", (e) => {
    state.pageSize = Number((e.target as HTMLSelectElement).value) || 25;
    state.page = 1;
    onStateChange();
  });

  container.querySelector("#sess-prev")?.addEventListener("click", () => {
    if (state.page > 1) {
      state.page -= 1;
      onStateChange();
    }
  });

  container.querySelector("#sess-next")?.addEventListener("click", () => {
    if (state.page < totalPages) {
      state.page += 1;
      onStateChange();
    }
  });
}
