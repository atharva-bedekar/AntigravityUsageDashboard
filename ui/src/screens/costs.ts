import { DashboardPayload, ForecastMethod, ForecastResult } from "../types.ts";
import {
  escapeHtml,
  formatDate,
  formatMoney,
  formatPercent,
  formatTokens,
} from "../format.ts";
import { icons } from "../icons.ts";
import { renderForecastChart } from "../charts.ts";

export interface CostsCallbacks {
  onModelChange: (modelId: string) => void;
  onWaterfallSourceChange: (src: "all" | "cli" | "app") => void;
  onOpenSettings: () => void;
  onForecastParamsChange: (method: ForecastMethod, horizonDays: number, metric: "cost" | "tokens") => void;
}

export function renderCosts(
  container: HTMLElement,
  data: DashboardPayload,
  waterfallSource: "all" | "cli" | "app",
  forecast: ForecastResult | null,
  forecastMethod: ForecastMethod,
  forecastHorizon: number,
  forecastMetric: "cost" | "tokens",
  numberFormat: "compact" | "full",
  cb: CostsCallbacks
): void {
  const currency = data.filter.currency;
  const active = data.activeModel;
  const wfCost =
    waterfallSource === "cli"
      ? data.cliCost
      : waterfallSource === "app"
      ? data.appCost
      : data.cost;

  const sub = data.subscriptionComparison;
  const activeDays = data.activeDays;
  const minReq = 14;
  const isUnlocked = activeDays >= minReq && forecast?.supported;

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <div class="epistemic-banner">
        <span style="color:var(--text-standard);flex-shrink:0;margin-top:2px">${icons.info(18)}</span>
        <div>
          <strong>Costs are estimates.</strong> Antigravity's logs don't record which model answered each step, so every token is priced at the model you pick. This is what the usage would cost on the API, not what you paid.
        </div>
      </div>

      ${
        data.cost.hasDateEstimates && data.cost.dateEstimateWarning
          ? `<div class="warning-banner">
              <div style="display:flex;align-items:center;gap:8px">
                <span style="color:var(--status-warn-icon)">${icons.warning(16)}</span>
                <span>${escapeHtml(data.cost.dateEstimateWarning)}</span>
              </div>
            </div>`
          : ""
      }

      <div class="card">
        <div class="card-header">
          <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap">
            <h3 class="card-title">Pricing used</h3>
            <select id="costs-model-select" class="text-input" style="font-weight:500">
              ${data.catalog
                .map(
                  (m) => `<option value="${escapeHtml(m.modelId)}" ${m.modelId === active.modelId ? "selected" : ""}>≈ ${escapeHtml(m.name)} (${escapeHtml(m.vendor)})</option>`
                )
                .join("")}
            </select>
          </div>
          <div style="display:flex;align-items:center;gap:10px">
            <span class="mono" style="font-size:12px;color:var(--text-muted)">
              Effective ${escapeHtml(formatDate(active.effectiveFrom))} – ${active.effectiveUntil ? escapeHtml(formatDate(active.effectiveUntil)) : "present"}
            </span>
            <span class="status-chip ${active.verified ? "status-chip-ok" : "status-chip-warn"}">
              ${active.verified ? "Verified" : "Approximate"}
            </span>
          </div>
        </div>

        <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:12px">
          <div class="card" style="padding:14px">
            <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-muted)">
              <span class="dot dot-new"></span> New input
            </div>
            <div class="mono" style="font-size:20px;margin-top:6px">$${active.latestInputUsd.toFixed(3)} <span style="font-size:12px;color:var(--text-muted)">/ 1M tokens</span></div>
          </div>
          <div class="card" style="padding:14px">
            <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-muted)">
              <span class="dot dot-cached"></span> Cached input
            </div>
            <div class="mono" style="font-size:20px;margin-top:6px">$${active.latestCachedUsd.toFixed(3)} <span style="font-size:12px;color:var(--text-muted)">/ 1M tokens</span></div>
          </div>
          <div class="card" style="padding:14px">
            <div style="display:flex;align-items:center;gap:6px;font-size:12.5px;color:var(--text-muted)">
              <span class="dot dot-output"></span> Output
            </div>
            <div class="mono" style="font-size:20px;margin-top:6px">$${active.latestOutputUsd.toFixed(3)} <span style="font-size:12px;color:var(--text-muted)">/ 1M tokens</span></div>
          </div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Cost breakdown</h3>
            <div class="card-subtitle">Waterfall of New + Cached + Output</div>
          </div>
          <div class="segmented" id="costs-wf-seg">
            <button type="button" class="segmented-btn ${waterfallSource === "all" ? "active" : ""}" data-src="all">All</button>
            <button type="button" class="segmented-btn ${waterfallSource === "cli" ? "active" : ""}" data-src="cli">CLI</button>
            <button type="button" class="segmented-btn ${waterfallSource === "app" ? "active" : ""}" data-src="app">App</button>
          </div>
        </div>

        <div class="mono" style="display:flex;align-items:center;gap:10px;flex-wrap:wrap;font-size:13.5px;margin-bottom:12px">
          <span><span class="dot dot-new"></span> New ≈ ${formatMoney(wfCost.freshCurrency, currency)}</span>
          <span style="color:var(--text-muted)">+</span>
          <span><span class="dot dot-cached"></span> Cached ≈ ${formatMoney(wfCost.cachedCurrency, currency)}</span>
          <span style="color:var(--text-muted)">+</span>
          <span><span class="dot dot-output"></span> Output ≈ ${formatMoney(wfCost.outputCurrency, currency)}</span>
          <span style="color:var(--text-muted)">=</span>
          <span class="code-chip" style="background:var(--btn-primary-bg);color:var(--btn-primary-fg);font-weight:600">Total ≈ ${formatMoney(wfCost.totalCurrency, currency)}</span>
        </div>

        <div class="share-bar-track" style="height:22px">
          <div class="share-seg share-seg-new" style="width:${wfCost.freshShare}%">${wfCost.freshShare >= 10 ? formatPercent(wfCost.freshShare) : ""}</div>
          <div class="share-seg share-seg-cached" style="width:${wfCost.cachedShare}%">${wfCost.cachedShare >= 10 ? formatPercent(wfCost.cachedShare) : ""}</div>
          <div class="share-seg share-seg-output" style="width:${wfCost.outputShare}%">${wfCost.outputShare >= 10 ? formatPercent(wfCost.outputShare) : ""}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Same usage, other models</h3>
            <div class="card-subtitle">Evaluated across ${formatTokens(data.totals.total, numberFormat)} filtered tokens</div>
          </div>
        </div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Vendor</th>
                <th class="num">Rates ($/1M in · cache · out)</th>
                <th>Status</th>
                <th class="num">≈ Cost</th>
                <th class="num">× Cheapest</th>
                <th style="width:160px">Relative</th>
              </tr>
            </thead>
            <tbody>
              ${data.benchmark
                .map(
                  (b) => `
                <tr style="${b.isCurrent ? "background:var(--bg-subtle)" : ""}">
                  <td style="font-weight:500">
                    ${escapeHtml(b.name)}
                    ${b.isCurrent ? `<span class="code-chip" style="background:var(--btn-primary-bg);color:var(--btn-primary-fg);margin-left:6px;font-size:10.5px">current</span>` : ""}
                  </td>
                  <td style="color:var(--text-muted)">${escapeHtml(b.vendor)}</td>
                  <td class="num" style="font-size:12px;color:var(--text-muted)">$${b.inputUsd.toFixed(2)} · $${b.cachedUsd.toFixed(3)} · $${b.outputUsd.toFixed(2)}</td>
                  <td>
                    <span class="status-chip ${b.verified ? "status-chip-ok" : "status-chip-warn"}">${b.verified ? "Verified" : "approx."}</span>
                  </td>
                  <td class="num" style="font-weight:600">≈ ${formatMoney(b.costCurrency, currency)}</td>
                  <td class="num">${b.ratioToCheapest.toFixed(1)}×</td>
                  <td>
                    <div style="height:8px;background:var(--bg-subtle);border-radius:999px;overflow:hidden">
                      <div style="height:100%;width:${Math.max(3, b.relativeBar * 100)}%;background:${b.isCurrent ? "var(--data-new)" : "var(--text-standard)"};border-radius:999px"></div>
                    </div>
                  </td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>

      <div class="grid-2">
        <div class="card">
          <div class="card-header">
            <h3 class="card-title">Your plan vs API price</h3>
          </div>
          ${
            !sub.configured
              ? `<div class="stack-gap">
                  <div class="card-subtitle">Add what you pay per month in Settings to compare your subscription against API list prices.</div>
                  <div><button type="button" class="btn-primary" id="costs-open-settings">Open Settings</button></div>
                </div>`
              : `<div class="stack-gap">
                  <div class="grid-2">
                    <div>
                      <div style="font-size:12px;color:var(--text-muted)">${escapeHtml(sub.planLabel || "Monthly plan")} (${sub.periodDays}d)</div>
                      <div class="mono" style="font-size:22px;font-weight:500">${formatMoney(sub.planAmount, sub.planCurrency)}</div>
                    </div>
                    <div>
                      <div style="font-size:12px;color:var(--text-muted)">≈ API list price</div>
                      <div class="mono" style="font-size:22px;font-weight:500">≈ ${formatMoney(sub.apiCostCurrency, currency)}</div>
                    </div>
                  </div>
                  <div class="mono" style="font-size:12.5px;color:var(--text-muted)">
                    ${formatTokens(sub.tokensPerUnit, numberFormat)} tokens per ${sub.planCurrency === "USD" ? "$1" : "₹1"} spent
                  </div>
                  <div class="card-subtitle">
                    The difference isn't savings or loss, because subscription quotas work differently from per-token billing.
                  </div>
                </div>`
          }
        </div>

        <div class="card" style="position:relative;overflow:hidden">
          <div class="card-header">
            <div>
              <h3 class="card-title">Forecast</h3>
              <div class="card-subtitle">${isUnlocked ? escapeHtml(forecast?.assumptions || "Based on recent pattern") : "Based on your recent pattern only"}</div>
            </div>
            ${
              isUnlocked
                ? `<div style="display:flex;gap:6px;align-items:center">
                    <select id="fc-method" class="text-input" style="font-size:12px;padding:3px 8px">
                      <option value="linear" ${forecastMethod === "linear" ? "selected" : ""}>Linear</option>
                      <option value="bootstrap" ${forecastMethod === "bootstrap" ? "selected" : ""}>Bootstrap</option>
                      <option value="monteCarlo" ${forecastMethod === "monteCarlo" ? "selected" : ""}>Monte Carlo</option>
                      <option value="holt" ${forecastMethod === "holt" ? "selected" : ""}>Holt</option>
                    </select>
                    <select id="fc-metric" class="text-input" style="font-size:12px;padding:3px 8px">
                      <option value="cost" ${forecastMetric === "cost" ? "selected" : ""}>Cost</option>
                      <option value="tokens" ${forecastMetric === "tokens" ? "selected" : ""}>Tokens</option>
                    </select>
                  </div>`
                : ""
            }
          </div>

          <div id="costs-forecast-chart"></div>

          ${
            !isUnlocked
              ? `<div style="position:absolute;inset:52px 16px 16px;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center;background:rgba(255,255,255,0.72);backdrop-filter:blur(2px);border-radius:10px;padding:16px">
                  <div style="color:var(--text-strong)">${icons.lock(22)}</div>
                  <div style="font-weight:500">Forecasts need at least ${minReq} active days. You have ${activeDays}.</div>
                  <div style="width:220px;height:6px;background:var(--bg-subtle);border-radius:999px;overflow:hidden">
                    <div style="height:100%;width:${Math.min(100, (activeDays / minReq) * 100)}%;background:var(--btn-primary-bg)"></div>
                  </div>
                  <div class="mono" style="font-size:12px;color:var(--text-muted)">${activeDays} / ${minReq} active days</div>
                </div>`
              : `<div style="display:flex;align-items:center;justify-content:space-between;gap:12px;margin-top:8px;font-size:12px">
                  <label style="display:flex;align-items:center;gap:8px;color:var(--text-muted)">
                    Horizon: <input type="range" id="fc-horizon" min="7" max="${forecast?.maxHorizonDays ?? 60}" value="${forecastHorizon}" />
                    <span class="mono">${forecastHorizon}d</span>
                  </label>
                  <div class="mono">
                    Median ${forecast?.horizonDays}d: <strong>${forecastMetric === "cost" ? `≈ ${formatMoney(forecast?.cumulativeMedian ?? 0, currency)}` : formatTokens(forecast?.cumulativeMedian ?? 0, numberFormat)}</strong>
                  </div>
                </div>`
          }
        </div>
      </div>
    </div>
  `;

  const fcHost = container.querySelector("#costs-forecast-chart") as HTMLElement | null;
  if (fcHost) {
    renderForecastChart(
      fcHost,
      forecast ?? {
        supported: false,
        activeDays,
        minRequiredDays: minReq,
        observedDays: data.observedDays,
        maxHorizonDays: 60,
        horizonDays: forecastHorizon,
        method: forecastMethod,
        methodLabel: forecastMethod,
        metric: forecastMetric,
        observedMean: 0,
        cumulativeLow: 0,
        cumulativeMedian: 0,
        cumulativeHigh: 0,
        assumptions: "",
        notes: [],
        points: [],
      },
      currency,
      numberFormat
    );
  }

  container.querySelector("#costs-model-select")?.addEventListener("change", (e) => {
    cb.onModelChange((e.target as HTMLSelectElement).value);
  });

  container.querySelectorAll<HTMLButtonElement>("#costs-wf-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      cb.onWaterfallSourceChange((btn.dataset.src as "all" | "cli" | "app") || "all");
    });
  });

  container.querySelector("#costs-open-settings")?.addEventListener("click", cb.onOpenSettings);

  container.querySelector("#fc-method")?.addEventListener("change", (e) => {
    cb.onForecastParamsChange((e.target as HTMLSelectElement).value as ForecastMethod, forecastHorizon, forecastMetric);
  });
  container.querySelector("#fc-metric")?.addEventListener("change", (e) => {
    cb.onForecastParamsChange(forecastMethod, forecastHorizon, (e.target as HTMLSelectElement).value as "cost" | "tokens");
  });
  container.querySelector("#fc-horizon")?.addEventListener("change", (e) => {
    cb.onForecastParamsChange(forecastMethod, Number((e.target as HTMLInputElement).value) || 14, forecastMetric);
  });
}
