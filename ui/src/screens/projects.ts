import { DashboardPayload, ProjectSummary } from "../types.ts";
import {
  escapeHtml,
  formatDateTime,
  formatMoney,
  formatPercent,
  formatTokens,
  middleTruncate,
} from "../format.ts";
import { icons, infoIconHtml, sourceBadgeHtml } from "../icons.ts";
import { renderProjectSparkline } from "../charts.ts";

export type ProjectRankBy = "cost" | "tokens" | "sessions";

export function renderProjects(
  container: HTMLElement,
  data: DashboardPayload,
  rankBy: ProjectRankBy,
  selectedProject: string | null,
  numberFormat: "compact" | "full",
  onRankChange: (rank: ProjectRankBy) => void,
  onSelectProject: (project: string | null) => void,
  onOpenSession: (sessionId: string) => void
): void {
  const currency = data.filter.currency;

  const attributed = data.projects.filter((p) => !p.isUnattributed);
  const unattributed = data.projects.find((p) => p.isUnattributed);

  attributed.sort((a, b) => {
    if (rankBy === "tokens") return b.total - a.total;
    if (rankBy === "sessions") return b.sessionCount - a.sessionCount;
    return b.costUsd - a.costUsd;
  });

  const sorted = unattributed ? [...attributed, unattributed] : attributed;
  const maxVal = Math.max(
    1,
    ...sorted.map((p) =>
      rankBy === "tokens" ? p.total : rankBy === "sessions" ? p.sessionCount : p.costUsd
    )
  );

  const totalCost = Math.max(0.0001, data.cost.totalUsd);
  const topTwoCost = attributed.slice(0, 2).reduce((a, p) => a + p.costUsd, 0);
  const topTwoShare = (topTwoCost / totalCost) * 100;
  const unattShare = unattributed ? (unattributed.costUsd / totalCost) * 100 : 0;

  const inspected: ProjectSummary | undefined = selectedProject
    ? sorted.find((p) => p.project === selectedProject)
    : undefined;

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <div style="display:flex;align-items:flex-end;justify-content:space-between;gap:12px;flex-wrap:wrap">
        <p class="summary-sentence" style="font-size:19px;margin:0">
          <strong>${Math.min(2, attributed.length)} project${attributed.length === 1 ? "" : "s"}</strong> account for
          <strong>${formatPercent(topTwoShare)}</strong> of estimated cost.
          ${
            unattributed
              ? `<strong>${unattributed.sessionCount} sessions</strong> (≈ ${formatPercent(unattShare)} of cost) aren't linked to a project.`
              : `All sessions are linked to a project.`
          }
        </p>

        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <span style="font-size:12.5px;color:var(--text-muted)">Rank by:</span>
          <div class="segmented" id="proj-rank-seg">
            <button type="button" class="segmented-btn ${rankBy === "cost" ? "active" : ""}" data-rank="cost">Cost</button>
            <button type="button" class="segmented-btn ${rankBy === "tokens" ? "active" : ""}" data-rank="tokens">Tokens</button>
            <button type="button" class="segmented-btn ${rankBy === "sessions" ? "active" : ""}" data-rank="sessions">Sessions</button>
          </div>
        </div>
      </div>

      <div class="card">
        ${
          sorted.length === 0
            ? `<div class="card-subtitle">No projects found in the current filter.</div>`
            : sorted
                .map((p) => {
                  const metricVal =
                    rankBy === "tokens" ? p.total : rankBy === "sessions" ? p.sessionCount : p.costUsd;
                  const barWidthPct = Math.max(2, (metricVal / maxVal) * 100);
                  const tot = Math.max(1, p.total);
                  const cliPct = (p.cliTotal / tot) * 100;
                  const appPct = (p.appTotal / tot) * 100;

                  return `
                    <div class="rank-row proj-row" data-project="${escapeHtml(p.project)}" style="padding:12px 10px">
                      <div style="display:flex;align-items:center;gap:10px;min-width:220px;flex:1.2">
                        <span style="color:var(--text-muted)">${icons.folder(17)}</span>
                        <div style="min-width:0">
                          <div style="font-size:15px;font-weight:500;display:flex;align-items:center;gap:6px;${p.isUnattributed ? "color:var(--text-muted)" : ""}">
                            <span>${escapeHtml(p.project)}</span>
                            ${p.isUnattributed ? infoIconHtml("unattributed", "Unattributed") : ""}
                          </div>
                          ${
                            p.workspace
                              ? `<div class="code-chip" style="margin-top:3px;font-size:11px">${escapeHtml(middleTruncate(p.workspace, 44))}</div>`
                              : `<div style="font-size:11.5px;color:var(--text-muted)">No workspace recorded</div>`
                          }
                        </div>
                      </div>

                      <div style="flex:1;min-width:140px">
                        <div style="height:10px;width:100%;background:var(--bg-subtle);border-radius:999px;overflow:hidden">
                          <div style="height:100%;width:${barWidthPct}%;display:flex;border-radius:999px;overflow:hidden">
                            ${
                              p.isUnattributed
                                ? `<div style="width:100%;background:var(--text-faint)"></div>`
                                : `<div style="width:${cliPct}%;background:var(--source-cli)"></div><div style="width:${appPct}%;background:var(--source-app)"></div>`
                            }
                          </div>
                        </div>
                        <div style="font-size:11px;color:var(--text-muted);margin-top:3px" class="mono">
                          ${p.isUnattributed ? "Unmapped" : `CLI ${formatPercent(cliPct)} · App ${formatPercent(appPct)}`}
                        </div>
                      </div>

                      <div style="text-align:right;min-width:170px">
                        <div class="mono" style="font-weight:600">≈ ${formatMoney(p.costCurrency, currency)}</div>
                        <div class="mono" style="font-size:12px;color:var(--text-muted)">${p.sessionCount} sessions · ${formatTokens(p.total, numberFormat)}</div>
                      </div>
                    </div>
                  `;
                })
                .join("")
        }
      </div>
    </div>

    ${
      inspected
        ? renderProjectDrawerHtml(inspected, data, currency, numberFormat)
        : ""
    }
  `;

  container.querySelectorAll<HTMLButtonElement>("#proj-rank-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      onRankChange((btn.dataset.rank as ProjectRankBy) || "cost");
    });
  });

  container.querySelectorAll<HTMLElement>(".proj-row").forEach((row) => {
    row.addEventListener("click", (e) => {
      if ((e.target as HTMLElement).closest(".info-btn")) return;
      const proj = row.dataset.project;
      if (proj) onSelectProject(proj);
    });
  });

  if (inspected) {
    const sparkHost = container.querySelector("#proj-drawer-spark") as HTMLElement | null;
    if (sparkHost) {
      renderProjectSparkline(sparkHost, inspected.dailyTotals);
    }
    container.querySelector("#proj-drawer-close")?.addEventListener("click", () => onSelectProject(null));
    container.querySelector("#proj-drawer-scrim")?.addEventListener("click", (e) => {
      if (e.target === e.currentTarget) onSelectProject(null);
    });
    container.querySelectorAll<HTMLElement>(".proj-drawer-session").forEach((row) => {
      row.addEventListener("click", () => {
        const id = row.dataset.id;
        if (id) onOpenSession(id);
      });
    });
  }
}

function renderProjectDrawerHtml(
  proj: ProjectSummary,
  data: DashboardPayload,
  currency: "INR" | "USD",
  numberFormat: "compact" | "full"
): string {
  const projSessions = data.sessions
    .filter((s) => s.project === proj.project)
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 20);

  return `
    <div class="drawer-scrim" id="proj-drawer-scrim">
      <div class="drawer-panel">
        <div class="drawer-header">
          <div>
            <div style="display:flex;align-items:center;gap:8px">
              ${icons.folder(18)}
              <h3 style="margin:0;font-size:17px;font-weight:500">${escapeHtml(proj.project)}</h3>
            </div>
            ${proj.workspace ? `<div class="code-chip" style="margin-top:6px">${escapeHtml(middleTruncate(proj.workspace, 46))}</div>` : ""}
          </div>
          <button type="button" class="icon-btn" id="proj-drawer-close" aria-label="Close drawer">${icons.close(16)}</button>
        </div>

        <div class="drawer-body stack-gap">
          <div style="font-size:14px;line-height:1.5">
            <strong>${proj.sessionCount} sessions</strong> (${proj.cliSessions} CLI, ${proj.appSessions} App) used
            <strong>${formatTokens(proj.total, numberFormat)} tokens</strong>
            (<strong>≈ ${formatMoney(proj.costCurrency, currency)}</strong>).
          </div>

          <div class="grid-2">
            <div class="card" style="padding:12px">
              <div style="font-size:12px;color:var(--text-muted)">CLI</div>
              <div class="mono" style="font-size:16px;font-weight:500">≈ ${formatMoney(proj.cliCostCurrency, currency)}</div>
            </div>
            <div class="card" style="padding:12px">
              <div style="font-size:12px;color:var(--text-muted)">App</div>
              <div class="mono" style="font-size:16px;font-weight:500">≈ ${formatMoney(proj.appCostCurrency, currency)}</div>
            </div>
          </div>

          <div class="card" style="padding:14px">
            <div style="font-size:12.5px;font-weight:500;margin-bottom:8px">Daily token activity</div>
            <div id="proj-drawer-spark"></div>
          </div>

          <div>
            <div style="font-size:13px;font-weight:500;margin-bottom:8px">Sessions (${projSessions.length})</div>
            ${projSessions
              .map(
                (s) => `
              <div class="rank-row proj-drawer-session" data-id="${escapeHtml(s.sessionId)}">
                <div style="display:flex;align-items:center;gap:8px;min-width:0;flex:1">
                  ${sourceBadgeHtml(s.source)}
                  <div style="min-width:0">
                    <div style="font-size:13px;font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(s.title)}</div>
                    <div class="mono" style="font-size:11px;color:var(--text-muted)">${escapeHtml(formatDateTime(s.firstUtc))}</div>
                  </div>
                </div>
                <span class="mono" style="font-weight:500">≈ ${formatMoney(s.costCurrency, currency)}</span>
              </div>`
              )
              .join("")}
          </div>
        </div>
      </div>
    </div>
  `;
}
