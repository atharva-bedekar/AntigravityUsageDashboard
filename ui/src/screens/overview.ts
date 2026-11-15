import { DashboardPayload, ScreenId } from "../types.ts";
import {
  escapeHtml,
  formatDate,
  formatDateShort,
  formatExactTokens,
  formatMoney,
  formatPercent,
  formatTokens,
} from "../format.ts";
import { appLogoSvg, icons, infoIconHtml, pixelASvg, sourceBadgeHtml } from "../icons.ts";
import { renderDailyUsageChart } from "../charts.ts";

export interface OverviewCallbacks {
  onNavigate: (screen: ScreenId, sessionId?: string) => void;
  onSelectProject: (project: string) => void;
  onColorByChange: (mode: "token" | "source") => void;
}

export function renderOverview(
  container: HTMLElement,
  data: DashboardPayload,
  numberFormat: "compact" | "full",
  dailyColorBy: "token" | "source",
  cb: OverviewCallbacks
): void {
  const { totals, cliTotals, appTotals, cost, activeModel, filter } = data;
  const currency = filter.currency;
  const secondaryCurrency = currency === "INR" ? "USD" : "INR";
  const secondaryCost =
    currency === "INR" ? cost.totalUsd : cost.totalUsd * cost.usdInr;

  const cliPctFresh =
    totals.freshIn > 0 ? Math.round((cliTotals.freshIn / totals.freshIn) * 100) : 0;
  const appPctFresh = totals.freshIn > 0 ? 100 - cliPctFresh : 0;
  const cliPctCached =
    totals.cached > 0 ? Math.round((cliTotals.cached / totals.cached) * 100) : 0;
  const appPctCached = totals.cached > 0 ? 100 - cliPctCached : 0;
  const cliPctOut =
    totals.output > 0 ? Math.round((cliTotals.output / totals.output) * 100) : 0;
  const appPctOut = totals.output > 0 ? 100 - cliPctOut : 0;

  // Build sub-caption with source date spans
  const cliComp = data.sourceComparison.find((s) => s.sourceKey === "cli");
  const appComp = data.sourceComparison.find((s) => s.sourceKey === "app");
  const spanParts: string[] = [];
  if (cliComp && cliComp.sessions > 0 && cliComp.minDate && cliComp.maxDate) {
    spanParts.push(
      `CLI ${formatDateShort(cliComp.minDate)}–${formatDateShort(cliComp.maxDate)}`
    );
  }
  if (appComp && appComp.sessions > 0 && appComp.minDate && appComp.maxDate) {
    spanParts.push(
      `App ${formatDateShort(appComp.minDate)}–${formatDateShort(appComp.maxDate)}`
    );
  }
  const zeroDays = data.daily.filter((d) => d.total === 0).length;
  if (zeroDays > 0) {
    spanParts.push(`${zeroDays} zero-activity day${zeroDays === 1 ? "" : "s"}`);
  }

  const topSessions = [...data.sessions]
    .filter((s) => s.kind !== "subagent")
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5);

  const topProjects = [...data.projects]
    .sort((a, b) => b.costUsd - a.costUsd)
    .slice(0, 5);

  const hasApp = (appComp?.sessions ?? 0) > 0;
  const hasCli = (cliComp?.sessions ?? 0) > 0;

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <div>
        <p class="summary-sentence">
          From <strong>${escapeHtml(formatDateShort(data.minDate) || "start")}</strong> to
          <strong>${escapeHtml(formatDateShort(data.maxDate) || "today")}</strong> you used
          <strong title="${formatExactTokens(totals.total)} tokens">${formatTokens(totals.total, numberFormat)} tokens</strong>
          in <strong>${totals.sessions} sessions</strong> (${cliTotals.sessions} CLI, ${appTotals.sessions} App).
          <strong>${formatPercent(totals.cacheHitRate)}</strong> were cached re-reads.
          At ${escapeHtml(activeModel.name)} prices that's about
          <strong><span class="approx" title="Estimated API list price">≈</span>${formatMoney(cost.totalCurrency, currency)}</strong>.
        </p>
        <p class="summary-caption">${escapeHtml(spanParts.join(" · ") || "No active date range")}</p>
      </div>

      <div class="grid-4">
        <div class="card kpi-card">
          <div class="kpi-label-row">
            <span class="kpi-label-left"><span class="dot dot-new"></span>New input</span>
            ${infoIconHtml("new_input", "New input")}
          </div>
          <div class="kpi-value" title="${formatExactTokens(totals.freshIn)} tokens">${formatTokens(totals.freshIn, numberFormat)}</div>
          <div class="kpi-caption">Fresh text sent to the model</div>
          <div class="kpi-footer">
            <div class="split-bar">
              <div class="split-seg-cli" style="width:${cliPctFresh}%"></div>
              <div class="split-seg-app" style="width:${appPctFresh}%"></div>
            </div>
            <div class="split-caption">CLI ${cliPctFresh}% · App ${appPctFresh}%</div>
          </div>
        </div>

        <div class="card kpi-card">
          <div class="kpi-label-row">
            <span class="kpi-label-left"><span class="dot dot-cached"></span>Cached input</span>
            ${infoIconHtml("cached_input", "Cached input")}
          </div>
          <div class="kpi-value" title="${formatExactTokens(totals.cached)} tokens">${formatTokens(totals.cached, numberFormat)}</div>
          <div class="kpi-caption">Context re-read from cache, ~10× cheaper</div>
          <div class="kpi-footer">
            <div class="split-bar">
              <div class="split-seg-cli" style="width:${cliPctCached}%"></div>
              <div class="split-seg-app" style="width:${appPctCached}%"></div>
            </div>
            <div class="split-caption">CLI ${cliPctCached}% · App ${appPctCached}%</div>
          </div>
        </div>

        <div class="card kpi-card">
          <div class="kpi-label-row">
            <span class="kpi-label-left"><span class="dot dot-output"></span>Output</span>
            ${infoIconHtml("output", "Output")}
          </div>
          <div class="kpi-value" title="${formatExactTokens(totals.output)} tokens">${formatTokens(totals.output, numberFormat)}</div>
          <div class="kpi-caption">Text, code and reasoning the model wrote</div>
          <div class="kpi-footer">
            <div class="split-bar">
              <div class="split-seg-cli" style="width:${cliPctOut}%"></div>
              <div class="split-seg-app" style="width:${appPctOut}%"></div>
            </div>
            <div class="split-caption">CLI ${cliPctOut}% · App ${appPctOut}%</div>
          </div>
        </div>

        <div class="card kpi-card">
          <div class="kpi-label-row">
            <span class="kpi-label-left"><span class="dot dot-neutral"></span>Estimated cost</span>
            ${infoIconHtml("estimated_cost", "Estimated cost")}
          </div>
          <div class="kpi-value"><span class="approx">≈</span>${formatMoney(cost.totalCurrency, currency)}</div>
          <div class="kpi-caption">If billed at API list prices</div>
          <div class="kpi-footer">
            <div class="split-caption">≈ ${formatMoney(secondaryCost, secondaryCurrency)} · ${escapeHtml(activeModel.name)}</div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Where the tokens go vs where the money goes</h3>
          </div>
          <div style="display:flex;gap:14px;font-size:12px;color:var(--text-muted)">
            <span><span class="dot dot-cached"></span> Cached input</span>
            <span><span class="dot dot-new"></span> New input</span>
            <span><span class="dot dot-output"></span> Output</span>
          </div>
        </div>
        <div class="share-bar-row">
          <div class="share-bar-header">
            <span>Tokens (${formatTokens(totals.total, numberFormat)} total)</span>
            <span class="mono">Cached ${formatPercent(totals.cachedShare)} · New ${formatPercent(totals.freshShare)} · Output ${formatPercent(totals.outputShare)}</span>
          </div>
          <div class="share-bar-track">
            <div class="share-seg share-seg-cached" style="width:${totals.cachedShare}%">${totals.cachedShare >= 12 ? `Cached ${formatPercent(totals.cachedShare)}` : ""}</div>
            <div class="share-seg share-seg-new" style="width:${totals.freshShare}%">${totals.freshShare >= 8 ? `New ${formatPercent(totals.freshShare)}` : ""}</div>
            <div class="share-seg share-seg-output" style="width:${totals.outputShare}%">${totals.outputShare >= 8 ? `Out ${formatPercent(totals.outputShare)}` : ""}</div>
          </div>
        </div>
        <div class="share-bar-row" style="margin-bottom:8px">
          <div class="share-bar-header">
            <span>Cost (≈ ${formatMoney(cost.totalCurrency, currency)})</span>
            <span class="mono">New ${formatPercent(cost.freshShare)} · Cached ${formatPercent(cost.cachedShare)} · Output ${formatPercent(cost.outputShare)}</span>
          </div>
          <div class="share-bar-track">
            <div class="share-seg share-seg-new" style="width:${cost.freshShare}%">${cost.freshShare >= 10 ? `New ${formatPercent(cost.freshShare)}` : ""}</div>
            <div class="share-seg share-seg-cached" style="width:${cost.cachedShare}%">${cost.cachedShare >= 10 ? `Cached ${formatPercent(cost.cachedShare)}` : ""}</div>
            <div class="share-seg share-seg-output" style="width:${cost.outputShare}%">${cost.outputShare >= 10 ? `Output ${formatPercent(cost.outputShare)}` : ""}</div>
          </div>
        </div>
        <div class="card-subtitle">
          Cached input is ${formatPercent(totals.cachedShare)} of your token volume but ${formatPercent(cost.cachedShare)} of the cost. Output is ${formatPercent(totals.outputShare)} of tokens but ${formatPercent(cost.outputShare)} of cost.
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Daily usage</h3>
            <div class="card-subtitle">Calendar-complete daily volume (App columns hatched)</div>
          </div>
          <div style="display:flex;align-items:center;gap:8px">
            <span style="font-size:12px;color:var(--text-muted)">Colour by:</span>
            <div class="segmented" id="daily-color-seg">
              <button type="button" class="segmented-btn ${dailyColorBy === "token" ? "active" : ""}" data-mode="token">Token type</button>
              <button type="button" class="segmented-btn ${dailyColorBy === "source" ? "active" : ""}" data-mode="source">Source</button>
            </div>
          </div>
        </div>
        <div id="overview-daily-chart"></div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top sessions by cost</h3>
            <button type="button" class="link-btn" id="ov-all-sessions">All sessions →</button>
          </div>
          <div>
            ${
              topSessions.length === 0
                ? `<div class="card-subtitle">No sessions in current filter.</div>`
                : topSessions
                    .map((s) => {
                      const tot = Math.max(1, s.total);
                      const pC = (s.cached / tot) * 100;
                      const pN = (s.freshIn / tot) * 100;
                      const pO = (s.output / tot) * 100;
                      return `
                        <div class="rank-row ov-session-row" data-id="${escapeHtml(s.sessionId)}">
                          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
                            ${sourceBadgeHtml(s.source)}
                            <div style="min-width:0">
                              <div style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;${s.isUntitled ? "color:var(--text-muted);font-style:italic" : ""}">${escapeHtml(s.title)}</div>
                              <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(s.project)}</div>
                            </div>
                          </div>
                          <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
                            <div class="mini-mix-bar">
                              <div style="width:${pC}%;background:var(--data-cached)"></div>
                              <div style="width:${pN}%;background:var(--data-new)"></div>
                              <div style="width:${pO}%;background:var(--data-output)"></div>
                            </div>
                            <span class="mono" style="font-weight:500;min-width:68px;text-align:right">≈ ${formatMoney(s.costCurrency, currency)}</span>
                          </div>
                        </div>
                      `;
                    })
                    .join("")
            }
          </div>
        </div>

        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Top projects by cost</h3>
            <button type="button" class="link-btn" id="ov-all-projects">All projects →</button>
          </div>
          <div>
            ${
              topProjects.length === 0
                ? `<div class="card-subtitle">No projects in current filter.</div>`
                : topProjects
                    .map((p) => {
                      const tot = Math.max(1, p.total);
                      const pCli = (p.cliTotal / tot) * 100;
                      const pApp = (p.appTotal / tot) * 100;
                      return `
                        <div class="rank-row ov-project-row" data-project="${escapeHtml(p.project)}">
                          <div style="display:flex;align-items:center;gap:10px;min-width:0;flex:1">
                            <span style="color:var(--text-muted)">${icons.folder(16)}</span>
                            <div style="min-width:0">
                              <div style="font-weight:500;${p.isUnattributed ? "color:var(--text-muted)" : ""}">${escapeHtml(p.project)}</div>
                              <div style="font-size:12px;color:var(--text-muted)">${p.sessionCount} sessions</div>
                            </div>
                          </div>
                          <div style="display:flex;align-items:center;gap:12px;flex-shrink:0">
                            <div class="mini-mix-bar">
                              <div style="width:${pCli}%;background:var(--source-cli)"></div>
                              <div style="width:${pApp}%;background:var(--source-app)"></div>
                            </div>
                            <span class="mono" style="font-weight:500;min-width:68px;text-align:right">≈ ${formatMoney(p.costCurrency, currency)}</span>
                          </div>
                        </div>
                      `;
                    })
                    .join("")
            }
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <h3 class="card-title">App vs CLI comparison</h3>
        </div>
        ${
          !hasApp || !hasCli
            ? `<div class="card-subtitle">Only ${hasCli ? "CLI" : hasApp ? "App" : "no"} data found in the current filter. Check <button type="button" class="link-btn" id="ov-goto-sources">Data Sources</button>.</div>`
            : `
            <div class="grid-2">
              <div style="padding-right:12px;border-right:1px solid var(--border-subtle)">
                <div style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:10px">
                  ${appLogoSvg(16)} <span>Antigravity App</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:13px">
                  <span style="color:var(--text-muted)">Sessions with tokens</span><span class="mono">${appComp!.sessions}</span>
                  <span style="color:var(--text-muted)">Total tokens</span><span class="mono">${formatTokens(appComp!.total, numberFormat)}</span>
                  <span style="color:var(--text-muted)">Cache-hit rate</span><span class="mono">${formatPercent(appComp!.cacheHitRate)}</span>
                  <span style="color:var(--text-muted)">Avg tokens / session</span><span class="mono">${formatTokens(appComp!.avgTokensPerSession, numberFormat)}</span>
                  <span style="color:var(--text-muted)">Active dates</span><span class="mono">${escapeHtml(formatDate(appComp!.minDate))} – ${escapeHtml(formatDate(appComp!.maxDate))}</span>
                  <span style="color:var(--text-muted)">≈ Estimated cost</span><span class="mono" style="font-weight:600">≈ ${formatMoney(appComp!.costCurrency, currency)}</span>
                </div>
              </div>
              <div style="padding-left:6px">
                <div style="display:flex;align-items:center;gap:8px;font-weight:500;margin-bottom:10px;color:var(--cli-blue)">
                  ${pixelASvg(16)} <span>Antigravity CLI</span>
                </div>
                <div style="display:grid;grid-template-columns:1fr auto;gap:6px 12px;font-size:13px">
                  <span style="color:var(--text-muted)">Sessions with tokens</span><span class="mono">${cliComp!.sessions}</span>
                  <span style="color:var(--text-muted)">Total tokens</span><span class="mono">${formatTokens(cliComp!.total, numberFormat)}</span>
                  <span style="color:var(--text-muted)">Cache-hit rate</span><span class="mono">${formatPercent(cliComp!.cacheHitRate)}</span>
                  <span style="color:var(--text-muted)">Avg tokens / session</span><span class="mono">${formatTokens(cliComp!.avgTokensPerSession, numberFormat)}</span>
                  <span style="color:var(--text-muted)">Active dates</span><span class="mono">${escapeHtml(formatDate(cliComp!.minDate))} – ${escapeHtml(formatDate(cliComp!.maxDate))}</span>
                  <span style="color:var(--text-muted)">≈ Estimated cost</span><span class="mono" style="font-weight:600">≈ ${formatMoney(cliComp!.costCurrency, currency)}</span>
                </div>
              </div>
            </div>
          `
        }
      </div>
    </div>
  `;

  const chartEl = container.querySelector("#overview-daily-chart") as HTMLElement;
  if (chartEl) {
    renderDailyUsageChart(chartEl, data.daily, currency, numberFormat, dailyColorBy);
  }

  container.querySelectorAll<HTMLButtonElement>("#daily-color-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const mode = btn.dataset.mode === "source" ? "source" : "token";
      cb.onColorByChange(mode);
    });
  });

  container.querySelector("#ov-all-sessions")?.addEventListener("click", () => cb.onNavigate("sessions"));
  container.querySelector("#ov-all-projects")?.addEventListener("click", () => cb.onNavigate("projects"));
  container.querySelector("#ov-goto-sources")?.addEventListener("click", () => cb.onNavigate("data-sources"));

  container.querySelectorAll<HTMLElement>(".ov-session-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      if (id) cb.onNavigate("session-detail", id);
    });
  });

  container.querySelectorAll<HTMLElement>(".ov-project-row").forEach((row) => {
    row.addEventListener("click", () => {
      const proj = row.dataset.project;
      if (proj) cb.onSelectProject(proj);
    });
  });
}
