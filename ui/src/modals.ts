import { DashboardPayload, ScreenId } from "./types.ts";
import { escapeHtml, formatMoney } from "./format.ts";
import { GLOSSARY_ITEMS } from "./glossary.ts";
import { appLogoSvg, icons, pixelALoaderSvg, sourceBadgeHtml } from "./icons.ts";

export interface QuickSearchItem {
  group: "Screens" | "Projects" | "Sessions";
  label: string;
  sublabel?: string;
  badgeHtml?: string;
  action: () => void;
}

export function renderQuickSearchModal(
  host: HTMLElement,
  data: DashboardPayload | null,
  query: string,
  selectedIdx: number,
  onQueryChange: (q: string) => void,
  onClose: () => void,
  onNavigate: (screen: ScreenId, sessionId?: string) => void,
  onFilterProject: (project: string) => void
): void {
  const q = query.trim().toLowerCase();
  const items: QuickSearchItem[] = [];

  const screens: Array<{ id: ScreenId; label: string }> = [
    { id: "token-usage", label: "Token Usage" },
    { id: "sessions", label: "Sessions" },
    { id: "data-sources", label: "Data Sources" },
    { id: "settings", label: "Settings" },
  ];

  screens
    .filter((s) => !q || s.label.toLowerCase().includes(q))
    .forEach((s) => {
      items.push({
        group: "Screens",
        label: s.label,
        sublabel: "Screen",
        action: () => {
          onNavigate(s.id);
          onClose();
        },
      });
    });

  if (data) {
    data.projects
      .filter((p) => !q || p.project.toLowerCase().includes(q))
      .slice(0, 5)
      .forEach((p) => {
        items.push({
          group: "Projects",
          label: p.project,
          sublabel: `${p.sessionCount} sessions · ≈ ${formatMoney(p.costCurrency, data.filter.currency)}`,
          action: () => {
            onFilterProject(p.project);
            onClose();
          },
        });
      });

    data.sessions
      .filter(
        (s) =>
          !q ||
          s.title.toLowerCase().includes(q) ||
          s.shortId.toLowerCase().includes(q) ||
          s.project.toLowerCase().includes(q)
      )
      .slice(0, 8)
      .forEach((s) => {
        items.push({
          group: "Sessions",
          label: s.title,
          sublabel: `${s.project} · ${s.shortId}`,
          badgeHtml: sourceBadgeHtml(s.source),
          action: () => {
            onNavigate("session-detail", s.sessionId);
            onClose();
          },
        });
      });
  }

  const clampedIdx = Math.max(0, Math.min(selectedIdx, Math.max(0, items.length - 1)));
  const groups: Array<"Screens" | "Projects" | "Sessions"> = ["Screens", "Projects", "Sessions"];

  let runningIdx = 0;
  const listHtml = groups
    .map((grp) => {
      const grpItems = items.filter((i) => i.group === grp);
      if (grpItems.length === 0) return "";
      const rows = grpItems
        .map((it) => {
          const idx = runningIdx++;
          return `
            <button type="button" class="quick-search-item ${idx === clampedIdx ? "selected" : ""}" data-idx="${idx}">
              <div style="display:flex;align-items:center;gap:8px;min-width:0">
                ${it.badgeHtml ?? ""}
                <span style="font-weight:500;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(it.label)}</span>
              </div>
              <span class="mono" style="font-size:11.5px;color:var(--text-muted);flex-shrink:0">${escapeHtml(it.sublabel ?? "")}</span>
            </button>`;
        })
        .join("");
      return `<div class="quick-search-group">${grp}</div>${rows}`;
    })
    .join("");

  host.innerHTML = `
    <div class="modal-backdrop" id="qs-backdrop">
      <div class="quick-search-modal" role="dialog" aria-label="Quick search">
        <div class="quick-search-input-row">
          <span style="color:var(--text-muted);display:flex">${icons.search(16)}</span>
          <input id="qs-input" class="quick-search-input" type="text" placeholder="Jump to session, project, or screen…" value="${escapeHtml(query)}" />
          <button type="button" class="icon-btn" id="qs-close" aria-label="Close">${icons.close(15)}</button>
        </div>
        <div class="quick-search-results">
          ${items.length === 0 ? `<div style="padding:20px;text-align:center;color:var(--text-muted)">No matching results</div>` : listHtml}
        </div>
        <div class="quick-search-footer">
          <span>↑↓ Navigate</span>
          <span>Enter Open</span>
          <span>Esc Close</span>
        </div>
      </div>
    </div>
  `;

  const input = host.querySelector("#qs-input") as HTMLInputElement | null;
  input?.focus();
  input?.setSelectionRange(input.value.length, input.value.length);

  input?.addEventListener("input", () => onQueryChange(input.value));
  input?.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      e.preventDefault();
      onClose();
    } else if (e.key === "Enter" && items[clampedIdx]) {
      e.preventDefault();
      items[clampedIdx].action();
    }
  });

  host.querySelector("#qs-backdrop")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) onClose();
  });
  host.querySelector("#qs-close")?.addEventListener("click", onClose);
  host.querySelectorAll<HTMLButtonElement>(".quick-search-item").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      items[idx]?.action();
    });
  });
}

export function renderGlossaryDrawer(
  host: HTMLElement,
  highlightKey: string | null,
  onClose: () => void
): void {
  host.innerHTML = `
    <div class="drawer-scrim" id="gloss-scrim">
      <div class="drawer-panel" role="dialog" aria-label="Glossary">
        <div class="drawer-header">
          <div>
            <h3 style="margin:0;font-size:17px;font-weight:500">About these numbers</h3>
            <div class="card-subtitle">Plain-English definitions for every metric</div>
          </div>
          <button type="button" class="icon-btn" id="gloss-close" aria-label="Close glossary">${icons.close(16)}</button>
        </div>
        <div class="drawer-body stack-gap">
          ${GLOSSARY_ITEMS.map(
            (g) => `
            <div class="card" style="padding:14px;${highlightKey === g.key ? "border-color:var(--focus-ring);background:var(--bg-subtle)" : ""}">
              <div style="font-weight:600;margin-bottom:4px">${escapeHtml(g.term)}</div>
              <div style="font-size:13px;color:var(--text-standard);line-height:1.5">${escapeHtml(g.definition)}</div>
            </div>`
          ).join("")}
        </div>
      </div>
    </div>
  `;

  host.querySelector("#gloss-close")?.addEventListener("click", onClose);
  host.querySelector("#gloss-scrim")?.addEventListener("click", (e) => {
    if (e.target === e.currentTarget) onClose();
  });
}

export function renderFirstScanLoader(container: HTMLElement, fileCountHint: number): void {
  container.innerHTML = `
    <div class="loader-overlay">
      ${pixelALoaderSvg(84)}
      <div style="font-size:16px;font-weight:500">Reading ${fileCountHint > 0 ? fileCountHint : ""} log files…</div>
      <div class="card-subtitle">Scanning local Antigravity App & CLI transcripts (read-only)</div>
      <div class="skeleton-grid">
        <div class="skeleton-box"></div>
        <div class="skeleton-box"></div>
        <div class="skeleton-box"></div>
        <div class="skeleton-box"></div>
      </div>
    </div>
  `;
}

export function renderFirstRunEmpty(
  container: HTMLElement,
  appPath: string,
  cliPath: string,
  onOpenSettings: () => void
): void {
  container.innerHTML = `
    <div class="loader-overlay">
      <div style="width:48px;height:48px;border-radius:12px;background:var(--bg-subtle);display:flex;align-items:center;justify-content:center">
        ${appLogoSvg(28)}
      </div>
      <div style="font-size:18px;font-weight:500">No Antigravity data found</div>
      <div style="font-size:13px;color:var(--text-muted);max-width:460px">
        Looked in <span class="code-chip">${escapeHtml(appPath)}</span> and <span class="code-chip">${escapeHtml(cliPath)}</span>.
      </div>
      <div style="display:flex;align-items:center;gap:12px;margin-top:6px">
        <button type="button" class="btn-primary" id="empty-choose-folder">Choose folder…</button>
        <button type="button" class="link-btn" id="empty-open-settings">Open Settings</button>
      </div>
    </div>
  `;
  container.querySelector("#empty-choose-folder")?.addEventListener("click", onOpenSettings);
  container.querySelector("#empty-open-settings")?.addEventListener("click", onOpenSettings);
}
