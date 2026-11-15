import { SessionDetailPayload } from "../types.ts";
import {
  escapeHtml,
  formatDateTime,
  formatDuration,
  formatExactTokens,
  formatMoney,
  formatPercent,
  formatTimeHm,
  formatTokens,
  middleTruncate,
} from "../format.ts";
import { icons, sourceBadgeHtml } from "../icons.ts";
import { renderSessionDualCharts } from "../charts.ts";

export interface SessionDetailCallbacks {
  onOpenSession: (sessionId: string) => void;
  onOpenFolder: (path: string) => void;
  onCopyText: (text: string, label: string) => void;
  onTabChange: (tab: "steps" | "tools" | "subagents") => void;
}

export function renderSessionDetail(
  container: HTMLElement,
  detail: SessionDetailPayload,
  currency: "INR" | "USD",
  numberFormat: "compact" | "full",
  activeTab: "steps" | "tools" | "subagents",
  expandedThoughts: Set<number>,
  cb: SessionDetailCallbacks
): void {
  const s = detail.summary;
  const spikeSet = new Set(detail.topSpikeSteps);

  const stepTypeBadge = (stepType: string, isError: boolean) => {
    const t = isError ? "error" : stepType.toLowerCase();
    if (t.includes("error")) {
      return `<span class="mono" style="color:var(--status-error);font-weight:600">error:</span>`;
    }
    if (t.includes("tool")) {
      return `<span class="mono" style="color:var(--data-output);font-weight:600">tool:</span>`;
    }
    if (t.includes("task") || t.includes("subagent")) {
      return `<span class="mono" style="color:var(--source-cli);font-weight:600">task:</span>`;
    }
    if (t.includes("user") || t.includes("you")) {
      return `<span class="mono" style="color:var(--data-new);font-weight:600">you:</span>`;
    }
    return `<span class="mono" style="color:var(--status-ok);font-weight:600">model</span>`;
  };

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <div class="card">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;flex-wrap:wrap">
          <div>
            <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
              <h2 style="margin:0;font-size:20px;font-weight:500;${s.isUntitled ? "color:var(--text-muted);font-style:italic" : ""}">${escapeHtml(s.title)}</h2>
              ${sourceBadgeHtml(s.source)}
              ${s.agentType ? `<span class="code-chip">${escapeHtml(s.agentType)}</span>` : ""}
            </div>
            ${
              s.parentId
                ? `<div style="margin-top:6px;font-size:13px">
                    <button type="button" class="link-btn" id="sd-parent-link">Started by ${escapeHtml(detail.parentTitle || s.parentId.slice(0, 8))} →</button>
                  </div>`
                : ""
            }
          </div>
          <button type="button" class="code-chip clickable" id="sd-copy-id" title="Copy conversation ID">
            <span>id: ${escapeHtml(s.shortId)}</span>
            ${icons.copy(12)}
          </button>
        </div>

        <div style="display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin-top:12px;font-size:12.5px;color:var(--text-muted)">
          ${
            s.workspace
              ? `<button type="button" class="code-chip clickable" id="sd-copy-ws" title="${escapeHtml(s.workspace)}">
                  ${icons.folder(13)}
                  <span>${escapeHtml(middleTruncate(s.workspace, 52))}</span>
                  ${icons.copy(11)}
                </button>`
              : `<span class="code-chip">Unattributed</span>`
          }
          <span class="mono">${escapeHtml(formatDateTime(s.firstUtc))} → ${escapeHtml(formatTimeHm(s.lastUtc))}</span>
          <span class="mono">Duration: ${escapeHtml(formatDuration(s.durationSecs))}</span>
          <span class="mono">${s.stepCount} steps</span>
          <span class="mono">Cache-hit: ${formatPercent(s.cacheHitRate)}</span>
        </div>
      </div>

      <p class="summary-sentence" style="font-size:18px">
        This session ran <strong>${escapeHtml(formatDuration(s.durationSecs))}</strong> over
        <strong>${s.stepCount} steps</strong> and used
        <strong title="${formatExactTokens(s.total)} tokens">${formatTokens(s.total, numberFormat)} tokens</strong>
        (<strong><span class="approx">≈</span>${formatMoney(s.costCurrency, currency)}</strong>).
        ${
          detail.topSpikeSteps.length > 0
            ? `<strong>${detail.topSpikeSteps.length} step${detail.topSpikeSteps.length === 1 ? "" : "s"}</strong> caused <strong>${formatPercent(detail.topSpikeShare)}</strong> of the cost.`
            : ""
        }
      </p>

      <div class="grid-4">
        <div class="card kpi-card">
          <div class="kpi-label-left"><span class="dot dot-new"></span>New input</div>
          <div class="kpi-value" style="font-size:22px">${formatTokens(s.freshIn, numberFormat)}</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label-left"><span class="dot dot-cached"></span>Cached input</div>
          <div class="kpi-value" style="font-size:22px">${formatTokens(s.cached, numberFormat)}</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label-left"><span class="dot dot-output"></span>Output</div>
          <div class="kpi-value" style="font-size:22px">${formatTokens(s.output, numberFormat)}</div>
        </div>
        <div class="card kpi-card">
          <div class="kpi-label-left"><span class="dot dot-neutral"></span>Estimated cost</div>
          <div class="kpi-value" style="font-size:22px">≈ ${formatMoney(s.costCurrency, currency)}</div>
        </div>
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Tokens over the session</h3>
            <div class="card-subtitle">Cumulative stacked area & per-step spike strip (${detail.errorSteps} error${detail.errorSteps === 1 ? "" : "s"}, ${detail.toolCallCount} tool calls)</div>
          </div>
          <div style="display:flex;gap:12px;font-size:11.5px;color:var(--text-muted)">
            <span><span class="dot dot-cached"></span> Cached</span>
            <span><span class="dot dot-new"></span> New</span>
            <span><span class="dot dot-output"></span> Output</span>
            <span style="color:var(--status-error)">● Error</span>
          </div>
        </div>
        <div id="sd-dual-charts"></div>
      </div>

      <div class="card">
        <div class="tabs-bar">
          <button type="button" class="tab-btn ${activeTab === "steps" ? "active" : ""}" data-tab="steps">
            Steps <span class="tab-count">${detail.steps.length}</span>
          </button>
          <button type="button" class="tab-btn ${activeTab === "tools" ? "active" : ""}" data-tab="tools">
            Tools <span class="tab-count">${detail.toolCallCount}</span>
          </button>
          <button type="button" class="tab-btn ${activeTab === "subagents" ? "active" : ""}" data-tab="subagents">
            Subagents <span class="tab-count">${detail.subagents.length}</span>
          </button>
        </div>

        <div id="sd-tab-body">
          ${
            activeTab === "steps"
              ? renderStepsTab(detail, currency, numberFormat, spikeSet, expandedThoughts, stepTypeBadge)
              : activeTab === "tools"
              ? renderToolsTab(detail, numberFormat)
              : renderSubagentsTab(detail, currency, numberFormat)
          }
        </div>
      </div>

      <div class="card" style="display:flex;align-items:center;justify-content:space-between;gap:12px;flex-wrap:wrap;font-size:12.5px">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;color:var(--text-muted)">
          <span>Token data:</span>
          <span class="code-chip">${escapeHtml(middleTruncate(detail.transcriptPath, 64))}</span>
          <span>· Title & project:</span>
          <span class="code-chip">${escapeHtml(detail.metadataSource)}</span>
        </div>
        <button type="button" class="link-btn" id="sd-open-folder">Open folder in Explorer ${icons.external(13)}</button>
      </div>
    </div>
  `;

  const chartHost = container.querySelector("#sd-dual-charts") as HTMLElement;
  if (chartHost) {
    renderSessionDualCharts(chartHost, detail.steps, currency, numberFormat);
  }

  container.querySelector("#sd-copy-id")?.addEventListener("click", () => {
    cb.onCopyText(s.sessionId, "Conversation ID copied");
  });

  container.querySelector("#sd-copy-ws")?.addEventListener("click", () => {
    cb.onCopyText(s.workspace, "Workspace path copied");
  });

  container.querySelector("#sd-parent-link")?.addEventListener("click", () => {
    if (s.parentId) cb.onOpenSession(s.parentId);
  });

  container.querySelector("#sd-open-folder")?.addEventListener("click", () => {
    cb.onOpenFolder(detail.transcriptPath);
  });

  container.querySelectorAll<HTMLButtonElement>(".tab-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const tab = btn.dataset.tab as "steps" | "tools" | "subagents";
      if (tab) cb.onTabChange(tab);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".thought-toggle").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.step);
      if (expandedThoughts.has(idx)) {
        expandedThoughts.delete(idx);
      } else {
        expandedThoughts.add(idx);
      }
      cb.onTabChange("steps");
    });
  });

  container.querySelectorAll<HTMLElement>(".sd-subagent-row").forEach((row) => {
    row.addEventListener("click", () => {
      const id = row.dataset.id;
      if (id) cb.onOpenSession(id);
    });
  });
}

function renderStepsTab(
  detail: SessionDetailPayload,
  currency: "INR" | "USD",
  numberFormat: "compact" | "full",
  spikeSet: Set<number>,
  expandedThoughts: Set<number>,
  stepTypeBadge: (t: string, err: boolean) => string
): string {
  if (detail.steps.length === 0) {
    return `<div class="card-subtitle">No steps recorded in this transcript.</div>`;
  }
  return `
    <div class="table-scroll">
      <table class="data-table">
        <thead>
          <tr>
            <th>#</th>
            <th>Time</th>
            <th>Type / Action</th>
            <th>Status</th>
            <th class="num">New</th>
            <th class="num">Cached</th>
            <th class="num">Output</th>
            <th class="num">≈ Cost</th>
          </tr>
        </thead>
        <tbody>
          ${detail.steps
            .map((st) => {
              const rowCls = st.isError ? "row-error" : spikeSet.has(st.stepIndex) ? "row-spike" : "";
              const thoughtText = st.thinkingFull || st.thinkingPreview;
              const isExp = expandedThoughts.has(st.stepIndex);
              const toolLabel = st.toolCalls.map((tc) => tc.name).join(", ");
              return `
                <tr class="${rowCls}">
                  <td class="mono" style="color:#80868B">${st.stepIndex}</td>
                  <td class="mono" style="font-size:12px;color:var(--text-muted)">${escapeHtml(st.localTime || "--:--")}</td>
                  <td>
                    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
                      ${stepTypeBadge(st.stepType, st.isError)}
                      ${toolLabel ? `<span class="code-chip">${escapeHtml(toolLabel)}</span>` : ""}
                      ${st.contentPreview ? `<span style="color:var(--text-standard)">${escapeHtml(st.contentPreview.slice(0, 90))}</span>` : ""}
                    </div>
                    ${
                      thoughtText
                        ? `<div class="thought-disclosure">
                            <button type="button" class="thought-toggle" data-step="${st.stepIndex}">
                              ${isExp ? "▾" : "▸"} Thought process
                            </button>
                            ${isExp ? `<div class="thought-body selectable">${escapeHtml(thoughtText)}</div>` : ""}
                          </div>`
                        : ""
                    }
                  </td>
                  <td><span class="status-chip ${st.isError ? "status-chip-err" : "status-chip-ok"}">${escapeHtml(st.status || "OK")}</span></td>
                  <td class="num">${formatTokens(st.freshIn, numberFormat)}</td>
                  <td class="num">${formatTokens(st.cached, numberFormat)}</td>
                  <td class="num">${formatTokens(st.output, numberFormat)}</td>
                  <td class="num">≈ ${formatMoney(st.costCurrency, currency)}</td>
                </tr>
              `;
            })
            .join("")}
        </tbody>
      </table>
    </div>
  `;
}

function renderToolsTab(detail: SessionDetailPayload, numberFormat: "compact" | "full"): string {
  if (detail.toolStats.length === 0) {
    return `<div class="card-subtitle" style="padding:12px 0">No tool calls in this session.</div>`;
  }
  const maxCalls = Math.max(1, ...detail.toolStats.map((t) => t.callCount));
  return `
    <div class="stack-gap">
      <div style="display:flex;flex-direction:column;gap:10px">
        ${detail.toolStats
          .map(
            (t) => `
          <div style="display:grid;grid-template-columns:160px 1fr 130px;align-items:center;gap:12px;font-size:13px">
            <span class="code-chip">${escapeHtml(t.name)}</span>
            <div style="height:10px;background:var(--bg-subtle);border-radius:999px;overflow:hidden">
              <div style="height:100%;width:${(t.callCount / maxCalls) * 100}%;background:var(--data-output);border-radius:999px"></div>
            </div>
            <span class="mono" style="text-align:right;font-size:12px;color:var(--text-muted)">${t.callCount}× · ${formatTokens(t.tokenTotal, numberFormat)}</span>
          </div>`
          )
          .join("")}
      </div>
      ${
        detail.commandExecs.length > 0
          ? `<div>
              <h4 style="margin:8px 0;font-size:13px;font-weight:500">Command executions</h4>
              <table class="data-table">
                <thead><tr><th>Step</th><th>Command</th><th class="num">Duration</th><th class="num">Exit</th></tr></thead>
                <tbody>
                  ${detail.commandExecs
                    .slice(0, 10)
                    .map(
                      (c) => `<tr>
                        <td class="mono">#${c.stepIndex}</td>
                        <td class="mono" style="font-size:12px">${escapeHtml(c.commandLine.slice(0, 80))}</td>
                        <td class="num">${c.durationSecs != null ? `${c.durationSecs.toFixed(1)}s` : "—"}</td>
                        <td class="num">${c.exitCode ?? "—"}</td>
                      </tr>`
                    )
                    .join("")}
                </tbody>
              </table>
            </div>`
          : ""
      }
    </div>
  `;
}

function renderSubagentsTab(
  detail: SessionDetailPayload,
  currency: "INR" | "USD",
  numberFormat: "compact" | "full"
): string {
  if (detail.subagents.length === 0) {
    return `<div class="card-subtitle" style="padding:12px 0">No subagents were started in this session.</div>`;
  }
  return `
    <table class="data-table">
      <thead><tr><th>Title</th><th>Role / Type</th><th class="num">Steps</th><th class="num">Tokens</th><th class="num">≈ Cost</th></tr></thead>
      <tbody>
        ${detail.subagents
          .map(
            (sub) => `
          <tr class="clickable-row sd-subagent-row" data-id="${escapeHtml(sub.sessionId)}">
            <td style="font-weight:500">${escapeHtml(sub.title)}</td>
            <td>${sub.agentType ? `<span class="code-chip">${escapeHtml(sub.agentType)}</span>` : "—"}</td>
            <td class="num">${sub.stepCount}</td>
            <td class="num">${formatTokens(sub.total, numberFormat)}</td>
            <td class="num">≈ ${formatMoney(sub.costCurrency, currency)}</td>
          </tr>`
          )
          .join("")}
      </tbody>
    </table>
  `;
}
