import { AppConfig, DashboardPayload, SourceDiagnostics } from "../types.ts";
import {
  escapeHtml,
  formatDate,
  formatTokens,
} from "../format.ts";
import { appLogoSvg, icons, pixelASvg } from "../icons.ts";

export interface DataSourcesCallbacks {
  onToggleSource: (kind: "app" | "cli", enabled: boolean) => void;
  onRescan: () => void;
  onOpenFolder: (path: string) => void;
  onOpenSettingsSources: () => void;
}

export function renderDataSources(
  container: HTMLElement,
  data: DashboardPayload,
  config: AppConfig,
  scanning: boolean,
  pbExpanded: boolean,
  numberFormat: "compact" | "full",
  onTogglePb: () => void,
  cb: DataSourcesCallbacks
): void {
  const diag = data.diagnostics;
  const appSrc = diag.sources.find((s) => s.source.kind === "app");
  const cliSrc = diag.sources.find((s) => s.source.kind === "cli");
  const allPbStems = diag.sources.flatMap((s) => s.pbOnlyStems);

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <p class="summary-sentence" style="font-size:19px">
        <strong>${diag.sources.filter((s) => s.exists && s.enabled).length} source${diag.sources.filter((s) => s.exists && s.enabled).length === 1 ? "" : "s"}</strong> read.
        <strong>${diag.totalWithTokens}</strong> of <strong>${diag.totalTranscripts}</strong> log files had token data.
        ${
          diag.totalParseErrors === 0
            ? "Nothing failed to parse."
            : `<strong>${diag.totalParseErrors}</strong> lines failed to parse.`
        }
      </p>

      <div class="grid-2">
        ${renderSourceCard(appSrc, "app", config.appEnabled, numberFormat)}
        ${renderSourceCard(cliSrc, "cli", config.cliEnabled, numberFormat)}
      </div>

      <div class="card">
        <div class="card-header" style="margin-bottom:${pbExpanded ? "10px" : "0"}">
          <button type="button" class="thought-toggle" id="ds-pb-toggle" style="font-size:14px;color:var(--text-strong);font-family:var(--font-sans);font-weight:500">
            ${pbExpanded ? "▾" : "▸"} Not readable (${allPbStems.length} binary .pb-only file${allPbStems.length === 1 ? "" : "s"})
          </button>
          <span class="card-subtitle" style="margin:0">Legacy binary cache</span>
        </div>
        <div style="font-size:13px;color:var(--text-muted);margin-top:6px">
          Older conversations that only have binary <span class="code-chip">.pb</span> files without a <span class="code-chip">transcript.jsonl</span> have no readable token log. ${allPbStems.length} skipped.
        </div>
        ${
          pbExpanded && allPbStems.length > 0
            ? `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-top:12px">
                ${allPbStems.map((id) => `<span class="code-chip">${escapeHtml(id)}</span>`).join("")}
              </div>`
            : ""
        }
      </div>

      <div class="card">
        <div class="card-header">
          <div>
            <h3 class="card-title">Consistency & Scan Health</h3>
            <div class="card-subtitle">${escapeHtml(diag.consistency.message)}</div>
          </div>
          <button type="button" class="btn-primary" id="ds-rescan-btn">
            ${scanning ? `<span class="ring-spinner" style="border-top-color:var(--btn-primary-fg)"></span>` : icons.refresh(15)}
            <span>Rescan now</span>
          </button>
        </div>

        <div class="grid-4" style="font-size:12.5px">
          <div>
            <div style="color:var(--text-muted)">Last scanned</div>
            <div class="mono" style="font-weight:500">${escapeHtml(diag.scannedAtLocalHm)} (${diag.durationMs}ms)</div>
          </div>
          <div>
            <div style="color:var(--text-muted)">Consistency check</div>
            <div><span class="status-chip ${diag.consistency.ok ? "status-chip-ok" : "status-chip-err"}">${diag.consistency.ok ? "● Match" : "Mismatch"}</span></div>
          </div>
          <div>
            <div style="color:var(--text-muted)">Sanitized / capped</div>
            <div class="mono">${diag.totalCorruptedToolNamesDropped} bad tools · ${diag.totalCappedStepGaps} &gt;4h gaps</div>
          </div>
          <div>
            <div style="color:var(--text-muted)">Local snapshot runs</div>
            <div class="mono">${diag.snapshotRuns} recorded</div>
          </div>
        </div>
      </div>

      <div>
        <button type="button" class="btn-secondary" id="ds-add-custom">
          ${icons.plus(14)}
          <span>Add custom brain folder</span>
        </button>
      </div>
    </div>
  `;

  container.querySelectorAll<HTMLInputElement>(".ds-enable-chk").forEach((chk) => {
    chk.addEventListener("change", () => {
      const kind = chk.dataset.kind as "app" | "cli";
      cb.onToggleSource(kind, chk.checked);
    });
  });

  container.querySelectorAll<HTMLButtonElement>(".ds-open-folder").forEach((btn) => {
    btn.addEventListener("click", () => {
      const p = btn.dataset.path;
      if (p) cb.onOpenFolder(p);
    });
  });

  container.querySelector("#ds-pb-toggle")?.addEventListener("click", onTogglePb);
  container.querySelector("#ds-rescan-btn")?.addEventListener("click", cb.onRescan);
  container.querySelector("#ds-add-custom")?.addEventListener("click", cb.onOpenSettingsSources);
}

function renderSourceCard(
  src: SourceDiagnostics | undefined,
  kind: "app" | "cli",
  enabled: boolean,
  numberFormat: "compact" | "full"
): string {
  const isCli = kind === "cli";
  const headerBrand = isCli
    ? `<div style="display:flex;align-items:center;gap:8px;font-family:var(--font-mono);font-weight:600;color:var(--cli-blue)">${pixelASvg(18)}<span>Antigravity CLI</span></div>`
    : `<div style="display:flex;align-items:center;gap:8px;font-weight:500">${appLogoSvg(18)}<span>Antigravity App</span></div>`;

  const statusChip = !enabled
    ? `<span class="status-chip">Disabled</span>`
    : !src?.exists
    ? `<span class="status-chip status-chip-warn">● Missing</span>`
    : (src.parseErrors ?? 0) > 0
    ? `<span class="status-chip status-chip-warn">● ${src.parseErrors} warn</span>`
    : `<span class="status-chip status-chip-ok">● OK</span>`;

  const rows: Array<[string, string]> = src
    ? [
        ["Folder", `<span class="code-chip">${escapeHtml(src.rootPath)}</span>`],
        ["Transcript files", `<span class="mono">${src.transcriptFilesFound}</span>`],
        ["With token data", `<span class="mono" style="color:var(--status-ok)">${src.sessionsWithTokens}</span>`],
        ["Without token data", `<span class="mono" style="color:var(--text-muted)">${src.sessionsWithoutTokens}</span>`],
        [
          "Dates",
          `<span class="mono">${src.minDate ? `${escapeHtml(formatDate(src.minDate))} – ${escapeHtml(formatDate(src.maxDate))}` : "—"}</span>`,
        ],
        [
          "New / Cached / Output",
          `<span class="mono">${formatTokens(src.freshIn, numberFormat)} / ${formatTokens(src.cached, numberFormat)} / ${formatTokens(src.output, numberFormat)}</span>`,
        ],
        ["Titles & projects from", `<span class="code-chip">${escapeHtml(src.metadataSource)}</span>`],
        ["Titles matched", `<span class="mono">${src.titlesMatched} of ${src.sessionsWithTokens}</span>`],
        ["Projects matched", `<span class="mono">${src.projectsMatched} of ${src.sessionsWithTokens}</span>`],
      ]
    : [["Folder", `<span class="code-chip">Not configured</span>`]];

  return `
    <div class="card">
      <div class="card-header">
        ${headerBrand}
        <div style="display:flex;align-items:center;gap:10px">
          ${statusChip}
          <label class="switch">
            <input type="checkbox" class="ds-enable-chk" data-kind="${kind}" ${enabled ? "checked" : ""} />
            <span class="switch-slider"></span>
          </label>
        </div>
      </div>
      <div style="display:flex;flex-direction:column;gap:8px;font-size:13px">
        ${rows
          .map(
            ([k, v]) => `
          <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;padding:4px 0;border-bottom:1px solid var(--border-subtle)">
            <span style="color:var(--text-muted)">${k}</span>
            <span>${v}</span>
          </div>`
          )
          .join("")}
      </div>
      ${
        src?.rootPath
          ? `<div style="margin-top:12px">
              <button type="button" class="link-btn ds-open-folder" data-path="${escapeHtml(src.rootPath)}">Open folder in Explorer ${icons.external(12)}</button>
            </div>`
          : ""
      }
    </div>
  `;
}
