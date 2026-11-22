import "./styles/tokens.css";
import "./styles/app.css";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api.ts";
import {
  AboutInfo,
  AppConfig,
  DashboardPayload,
  FilterState,
  NavHistoryEntry,
  ScreenId,
  TokenUsageFilter,
  TokenUsagePayload,
} from "./types.ts";
import { escapeHtml } from "./format.ts";
import { appLogoSvg, icons } from "./icons.ts";
import { ModelSortState, renderTokenUsage } from "./screens/tokenUsage.ts";
import { renderSettings, SettingsSection } from "./screens/settings.ts";
import {
  renderFirstRunEmpty,
  renderFirstScanLoader,
  renderGlossaryDrawer,
  renderQuickSearchModal,
} from "./modals.ts";

function readShowTimeChart(): boolean {
  try {
    return localStorage.getItem("agy_show_time_chart") !== "false";
  } catch {
    return true;
  }
}

function writeShowTimeChart(visible: boolean): void {
  try {
    localStorage.setItem("agy_show_time_chart", String(visible));
  } catch {
    // ignore storage failures
  }
}

interface AppState {
  screen: ScreenId;
  history: NavHistoryEntry[];
  historyIdx: number;
  openMenu: "usage" | "view" | "help" | null;
  glossaryOpen: boolean;
  glossaryHighlight: string | null;
  quickSearchOpen: boolean;
  quickSearchQuery: string;
  quickSearchIdx: number;
  scanning: boolean;
  initialLoading: boolean;
  config: AppConfig | null;
  about: AboutInfo | null;
  dashboard: DashboardPayload | null;
  filter: FilterState;
  tokenUsageFilter: TokenUsageFilter;
  tokenUsage: TokenUsagePayload | null;
  tokenUsageLoading: boolean;
  tokenUsageError: string | null;
  modelSort: ModelSortState;
  showTimeChart: boolean;
  settingsSection: SettingsSection;
  settingsSearch: string;
  fxError: string | null;
  toasts: Array<{ id: number; text: string }>;
}

const state: AppState = {
  screen: "token-usage",
  history: [{ screen: "token-usage" }],
  historyIdx: 0,
  openMenu: null,
  glossaryOpen: false,
  glossaryHighlight: null,
  quickSearchOpen: false,
  quickSearchQuery: "",
  quickSearchIdx: 0,
  scanning: false,
  initialLoading: true,
  config: null,
  about: null,
  dashboard: null,
  filter: {
    datePreset: "all",
    customStart: null,
    customEnd: null,
    sourceFilter: "all",
    projectFilter: null,
    modelId: "gemini-3.8-flash",
    currency: "INR",
  },
  tokenUsageFilter: {
    period: "1w",
    project: null,
    model: null,
    agent: { kind: "all" },
  },
  tokenUsage: null,
  tokenUsageLoading: false,
  tokenUsageError: null,
  modelSort: { column: "total", direction: "desc" },
  showTimeChart: readShowTimeChart(),
  settingsSection: "pricing",
  settingsSearch: "",
  fxError: null,
  toasts: [],
};

let toastSeq = 1;
let refreshTimer: number | null = null;
let tokenUsageSeq = 0;

type TokenUsageFocusTarget =
  | { kind: "id"; id: string; fallbackId?: string }
  | { kind: "sort"; col: string }
  | { kind: "row"; model: string };

let pendingTokenUsageFocus: TokenUsageFocusTarget | null = null;

function captureTokenUsageFocus(host: HTMLElement): TokenUsageFocusTarget | null {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement) || !host.contains(active)) {
    return null;
  }
  if (
    active.id === "tu-reset-filters" ||
    active.id === "tu-hero-reset" ||
    active.id === "tu-retry-btn"
  ) {
    return { kind: "id", id: active.id, fallbackId: "tu-filter-period" };
  }
  if (active.id) {
    return { kind: "id", id: active.id };
  }
  const sortBtn = active.closest<HTMLElement>(".tu-sort-btn[data-col]");
  if (sortBtn && host.contains(sortBtn) && sortBtn.dataset.col) {
    return { kind: "sort", col: sortBtn.dataset.col };
  }
  const modelRow = active.closest<HTMLElement>(".tu-model-row[data-model]");
  if (modelRow && host.contains(modelRow) && modelRow.dataset.model !== undefined) {
    return { kind: "row", model: modelRow.dataset.model };
  }
  return null;
}

function restoreTokenUsageFocus(
  host: HTMLElement,
  target: TokenUsageFocusTarget | null
): void {
  if (!target) return;
  let el: HTMLElement | null = null;
  if (target.kind === "id") {
    el = host.querySelector<HTMLElement>(`#${CSS.escape(target.id)}`);
    if (!el && target.fallbackId) {
      el = host.querySelector<HTMLElement>(`#${CSS.escape(target.fallbackId)}`);
    }
  } else if (target.kind === "sort") {
    el =
      Array.from(host.querySelectorAll<HTMLElement>(".tu-sort-btn[data-col]")).find(
        (candidate) => candidate.dataset.col === target.col
      ) ?? null;
  } else if (target.kind === "row") {
    el =
      Array.from(host.querySelectorAll<HTMLElement>(".tu-model-row")).find(
        (candidate) => candidate.dataset.model === target.model
      ) ?? null;
  }
  el?.focus({ preventScroll: true });
}

function showToast(text: string): void {
  const id = toastSeq++;
  state.toasts.push({ id, text });
  renderToasts();
  window.setTimeout(() => {
    state.toasts = state.toasts.filter((t) => t.id !== id);
    renderToasts();
  }, 4000);
}

function renderToasts(): void {
  let host = document.getElementById("toast-host");
  if (!host) {
    host = document.createElement("div");
    host.id = "toast-host";
    host.className = "toast-container";
    document.body.appendChild(host);
  }
  host.innerHTML = state.toasts
    .map((t) => `<div class="toast">${escapeHtml(t.text)}</div>`)
    .join("");
}

function applyDisplayPreferences(cfg: AppConfig): void {
  const root = document.documentElement;
  let theme = cfg.display.theme;
  if (theme === "system") {
    theme = window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
  root.setAttribute("data-theme", theme);
  root.setAttribute("data-density", cfg.display.density);
  root.setAttribute("data-reduced-motion", cfg.display.reducedMotion);
}

function navigate(screen: ScreenId, pushHistory = true): void {
  state.screen = screen;
  state.openMenu = null;
  pendingTokenUsageFocus = null;
  if (pushHistory) {
    state.history = state.history.slice(0, state.historyIdx + 1);
    state.history.push({ screen });
    state.historyIdx = state.history.length - 1;
  }
  renderApp();
}

function goBack(): void {
  if (state.historyIdx <= 0) {
    if (state.screen !== "token-usage") {
      navigate("token-usage");
    }
    return;
  }
  state.historyIdx -= 1;
  const entry = state.history[state.historyIdx];
  navigate(entry.screen, false);
}

async function refreshTokenUsage(): Promise<void> {
  const reqId = ++tokenUsageSeq;
  const host = document.getElementById("screen-host");
  if (state.screen === "token-usage" && !state.initialLoading && host) {
    const captured = captureTokenUsageFocus(host);
    if (captured) {
      pendingTokenUsageFocus = captured;
    }
  }
  state.tokenUsageLoading = true;
  state.tokenUsageError = null;
  if (state.screen === "token-usage" && !state.initialLoading) {
    renderBodyOnly();
  }
  try {
    const payload = await api.getTokenUsage(state.tokenUsageFilter);
    if (reqId !== tokenUsageSeq) return;
    state.tokenUsage = payload;
    state.tokenUsageLoading = false;
  } catch (err) {
    if (reqId !== tokenUsageSeq) return;
    state.tokenUsageError = String(err);
    state.tokenUsageLoading = false;
  }
  if (state.screen === "token-usage" && !state.initialLoading) {
    renderBodyOnly();
  }
}

async function refreshDashboard(): Promise<void> {
  try {
    state.dashboard = await api.getDashboard(state.filter);
  } catch (err) {
    showToast(`Failed to load dashboard: ${String(err)}`);
  }
  renderApp();
}

async function runRescan(): Promise<void> {
  if (state.scanning) return;
  state.scanning = true;
  renderApp();
  try {
    await api.scanAll();
    state.dashboard = await api.getDashboard(state.filter);
    await refreshTokenUsage();
    showToast("Scan complete");
  } catch (err) {
    showToast(`Scan failed: ${String(err)}`);
  } finally {
    state.scanning = false;
    state.initialLoading = false;
    renderApp();
  }
}

function setupAutoRefresh(cfg: AppConfig): void {
  if (refreshTimer !== null) {
    window.clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (cfg.refresh.intervalMinutes > 0) {
    refreshTimer = window.setInterval(() => {
      void runRescan();
    }, cfg.refresh.intervalMinutes * 60_000);
  }
}

async function init(): Promise<void> {
  renderApp();
  try {
    const [cfg, about] = await Promise.all([api.getSettings(), api.getAboutInfo()]);
    state.config = cfg;
    state.about = about;
    state.filter.modelId = cfg.defaultModelId;
    state.filter.currency = cfg.reportingCurrency;
    applyDisplayPreferences(cfg);
    setupAutoRefresh(cfg);

    await api.scanAll();
    state.dashboard = await api.getDashboard(state.filter);
    await refreshTokenUsage();
  } catch (err) {
    showToast(`Startup error: ${String(err)}`);
  } finally {
    state.initialLoading = false;
    renderApp();
  }
}

function renderApp(): void {
  const root = document.getElementById("app");
  if (!root) return;

  const dash = state.dashboard;
  const diag = dash?.diagnostics;
  const appSrc = diag?.sources.find((s) => s.source.kind === "app");
  const cliSrc = diag?.sources.find((s) => s.source.kind === "cli");
  const missingFolder = (appSrc && !appSrc.exists) || (cliSrc && !cliSrc.exists);
  const hasWarnings =
    (diag?.totalParseErrors ?? 0) > 0 ||
    (diag?.warnings.length ?? 0) > 0 ||
    Boolean(missingFolder);

  root.innerHTML = `
    <div class="app-shell">
      <header class="menu-bar" data-tauri-drag-region>
        <div class="menu-bar-left" data-tauri-drag-region>
          <button type="button" class="menu-home-btn" id="tb-home" title="Token Usage">
            ${appLogoSvg(15)}
            <span class="menu-app-label">Antigravity Usage</span>
          </button>
          ${renderMenuButton("usage", "Usage")}
          ${renderMenuButton("view", "View")}
          ${renderMenuButton("help", "Help")}
        </div>
        <div class="menu-bar-right">
          <div class="top-bar-actions">
            <button
              type="button"
              class="top-bar-btn"
              id="tb-rescan"
              title="${state.scanning ? "Scanning local logs…" : `Rescan logs${diag?.scannedAtLocalHm ? ` (last scan ${escapeHtml(diag.scannedAtLocalHm)})` : ""}`}"
              ${state.scanning ? "disabled" : ""}
            >
              ${state.scanning ? `<span class="ring-spinner"></span>` : icons.refresh(14)}
              <span class="tb-rescan-label">${state.scanning ? "Scanning…" : "Rescan"}</span>
              ${diag?.scannedAtLocalHm ? `<span class="tb-rescan-time mono">${escapeHtml(diag.scannedAtLocalHm)}</span>` : ""}
            </button>
            <button
              type="button"
              class="top-bar-btn top-bar-icon-btn"
              id="tb-search"
              title="Quick search (Ctrl+K)"
              aria-label="Quick search (Ctrl+K)"
            >
              ${icons.search(14)}
            </button>
            <button
              type="button"
              class="top-bar-btn top-bar-icon-btn ${state.screen === "settings" ? "active" : ""}"
              id="tb-settings"
              title="Settings"
              aria-label="Settings"
              aria-pressed="${state.screen === "settings" ? "true" : "false"}"
            >
              ${icons.settings(14)}
            </button>
          </div>
          <div class="window-controls">
            <button type="button" class="win-btn" id="win-min" title="Minimize" aria-label="Minimize">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M1 5h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
            </button>
            <button type="button" class="win-btn" id="win-max" title="Maximize" aria-label="Maximize">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>
            </button>
            <button type="button" class="win-btn win-btn-close" id="win-close" title="Close" aria-label="Close">
              <svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/></svg>
            </button>
          </div>
        </div>
      </header>

      <main class="workspace-main">
        <section class="content-panel">
          <div class="panel-scroll" id="panel-scroll">
            <div id="screen-host" class="workspace-container"></div>
          </div>
          <button type="button" class="scroll-down-fab" id="scroll-down-fab" title="Scroll down" style="display:none">${icons.arrowDown(15)}</button>
          <div class="status-line ${hasWarnings ? "has-warnings" : ""}" id="status-line">
            <span>
              [ last scan ${escapeHtml(diag?.scannedAtLocalHm ?? "--:--")} · ${diag?.totalTranscripts ?? 0} files · ${diag?.totalWithTokens ?? 0} with tokens · ${diag?.totalParseErrors ?? 0} warnings${missingFolder ? " · log folder missing" : ""} ]
            </span>
            ${state.screen === "token-usage" ? "" : `<span>${state.filter.currency} · ${escapeHtml(dash?.activeModel.name ?? state.filter.modelId)}</span>`}
          </div>
        </section>
      </main>
    </div>
    <div id="modal-host"></div>
    <div id="drawer-host"></div>
  `;

  attachShellListeners();
  renderBodyOnly();
  renderOverlays();
}

function renderMenuButton(id: "usage" | "view" | "help", label: string): string {
  const open = state.openMenu === id;
  let dropdown = "";
  if (open) {
    if (id === "usage") {
      dropdown = `
        <div class="menu-dropdown">
          <button type="button" class="menu-dropdown-item" id="m-rescan"><span>Rescan now</span><span class="menu-shortcut">F5</span></button>
          <button type="button" class="menu-dropdown-item" id="m-export"><span>Export CSV</span></button>
          <button type="button" class="menu-dropdown-item" id="m-copy"><span>Copy summary</span></button>
        </div>`;
    } else if (id === "view") {
      dropdown = `
        <div class="menu-dropdown">
          <button type="button" class="menu-dropdown-item" data-nav="token-usage">Token Usage</button>
          <button type="button" class="menu-dropdown-item" data-nav="settings">Settings</button>
          <div class="menu-dropdown-sep"></div>
          <button type="button" class="menu-dropdown-item" id="m-toggle-theme">Toggle Light / Dark theme</button>
        </div>`;
    } else if (id === "help") {
      dropdown = `
        <div class="menu-dropdown">
          <button type="button" class="menu-dropdown-item" id="m-glossary">Glossary ("About these numbers")</button>
          <button type="button" class="menu-dropdown-item" id="m-about">About Antigravity Usage</button>
        </div>`;
    }
  }
  return `
    <div class="menu-item-wrap">
      <button type="button" class="menu-trigger ${open ? "open" : ""}" data-menu="${id}">${label}</button>
      ${dropdown}
    </div>
  `;
}

function renderBodyOnly(): void {
  const host = document.getElementById("screen-host");
  if (!host) return;

  if (state.initialLoading) {
    renderFirstScanLoader(host, state.dashboard?.diagnostics.totalTranscripts ?? 236);
    return;
  }

  const dash = state.dashboard;
  const cfg = state.config;
  const numFmt = cfg?.display.numberFormat ?? "compact";

  // Check first-run empty state
  if (
    dash &&
    dash.diagnostics.sources.every((s) => !s.exists) &&
    state.screen !== "settings"
  ) {
    renderFirstRunEmpty(host, () => void runRescan());
    return;
  }

  // Parse warning banner
  let warningHtml = "";
  if (dash && dash.diagnostics.totalParseErrors > 0) {
    warningHtml = `
      <div class="warning-banner">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--status-warn-icon)">${icons.warning(16)}</span>
          <span>${dash.diagnostics.totalParseErrors} transcript log lines couldn't be parsed.</span>
        </div>
      </div>
    `;
  }

  const activeEl = document.activeElement;
  const focusInsideOrBody =
    activeEl === document.body ||
    activeEl === null ||
    (activeEl instanceof HTMLElement && host.contains(activeEl));
  const tuFocusTarget =
    state.screen === "token-usage"
      ? captureTokenUsageFocus(host) ?? (focusInsideOrBody ? pendingTokenUsageFocus : null)
      : null;

  const contentWrap = document.createElement("div");
  if (warningHtml) {
    host.innerHTML = warningHtml;
    host.appendChild(contentWrap);
  } else {
    host.innerHTML = "";
    host.appendChild(contentWrap);
  }

  if (state.screen === "token-usage") {
    if (state.tokenUsageLoading && !state.tokenUsage) {
      contentWrap.setAttribute("aria-busy", "true");
      contentWrap.innerHTML = `<div class="loader-overlay"><div class="ring-spinner"></div><div>Loading token usage…</div></div>`;
    } else {
      if (state.tokenUsageLoading) {
        contentWrap.setAttribute("aria-busy", "true");
      }
      if (state.tokenUsageError) {
        const errBanner = document.createElement("div");
        errBanner.className = "tu-error-banner";
        errBanner.setAttribute("role", "alert");
        if (state.tokenUsage) {
          errBanner.style.marginBottom = "var(--card-gap)";
        }
        errBanner.innerHTML = `
          <span>Failed to load token usage: ${escapeHtml(state.tokenUsageError)}</span>
          <button type="button" class="tu-reset-btn" id="tu-retry-btn">Retry</button>
        `;
        errBanner.querySelector("#tu-retry-btn")?.addEventListener("click", () => {
          void refreshTokenUsage();
        });
        contentWrap.appendChild(errBanner);
      }
      if (state.tokenUsage) {
        const tuHost = document.createElement("div");
        contentWrap.appendChild(tuHost);
        renderTokenUsage(
          tuHost,
          state.tokenUsage,
          state.modelSort,
          state.showTimeChart,
          numFmt,
          {
            onFilterChange: (patch) => {
              state.tokenUsageFilter = { ...state.tokenUsageFilter, ...patch };
              void refreshTokenUsage();
            },
            onResetFilters: () => {
              state.tokenUsageFilter = {
                period: "1w",
                project: null,
                model: null,
                agent: { kind: "all" },
              };
              void refreshTokenUsage();
            },
            onSortChange: (next) => {
              state.modelSort = next;
              renderBodyOnly();
            },
            onToggleChart: (visible) => {
              state.showTimeChart = visible;
              writeShowTimeChart(visible);
              renderBodyOnly();
            },
          }
        );
      } else if (!state.tokenUsageError) {
        const emptyBanner = document.createElement("div");
        emptyBanner.className = "tu-error-banner";
        emptyBanner.setAttribute("role", "alert");
        emptyBanner.innerHTML = `
          <span>Token usage data is not loaded yet.</span>
          <button type="button" class="tu-reset-btn" id="tu-retry-btn">Load</button>
        `;
        emptyBanner.querySelector("#tu-retry-btn")?.addEventListener("click", () => {
          void refreshTokenUsage();
        });
        contentWrap.appendChild(emptyBanner);
      }
      restoreTokenUsageFocus(host, tuFocusTarget);
      if (!state.tokenUsageLoading) {
        pendingTokenUsageFocus = null;
      }
    }
  } else if (state.screen === "settings" && cfg) {
    renderSettings(
      contentWrap,
      cfg,
      dash,
      state.about,
      state.settingsSection,
      state.settingsSearch,
      state.fxError,
      (err) => {
        state.fxError = err;
        renderBodyOnly();
      },
      {
        onSectionChange: (sec) => {
          state.settingsSection = sec;
          renderBodyOnly();
        },
        onSearchChange: (q) => {
          state.settingsSearch = q;
          renderBodyOnly();
        },
        onSaveConfig: async (next) => {
          const saved = await api.saveSettings(next);
          state.config = saved;
          state.filter.currency = saved.reportingCurrency;
          state.filter.modelId = saved.defaultModelId;
          applyDisplayPreferences(saved);
          setupAutoRefresh(saved);
          showToast("Saved");
          await refreshDashboard();
        },
        onClearSnapshots: async () => {
          const count = await api.clearSnapshots();
          showToast(`Cleared ${count} snapshot records`);
        },
        onOpenFolder: (p) => void api.openInExplorer(p),
        onExportDiagnostics: async () => {
          const res = await api.exportDiagnosticsJson();
          showToast(`Exported diagnostics (${res.path})`);
        },
        onBack: () => goBack(),
      }
    );
  }

  // Bind glossary info buttons inside rendered screen
  host.querySelectorAll<HTMLButtonElement>(".info-btn[data-glossary]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      state.glossaryHighlight = btn.dataset.glossary ?? null;
      state.glossaryOpen = true;
      renderOverlays();
    });
  });

  updateScrollFab();
}

function renderOverlays(): void {
  const modalHost = document.getElementById("modal-host");
  const drawerHost = document.getElementById("drawer-host");
  if (modalHost) {
    if (state.quickSearchOpen) {
      renderQuickSearchModal(
        modalHost,
        state.dashboard,
        state.quickSearchQuery,
        state.quickSearchIdx,
        (q) => {
          state.quickSearchQuery = q;
          state.quickSearchIdx = 0;
          renderOverlays();
        },
        () => {
          state.quickSearchOpen = false;
          renderOverlays();
        },
        (scr) => navigate(scr),
        (proj) => {
          state.tokenUsageFilter = { ...state.tokenUsageFilter, project: proj };
          navigate("token-usage");
          void refreshTokenUsage();
        }
      );
    } else {
      modalHost.innerHTML = "";
    }
  }

  if (drawerHost) {
    if (state.glossaryOpen) {
      renderGlossaryDrawer(drawerHost, state.glossaryHighlight, () => {
        state.glossaryOpen = false;
        renderOverlays();
      });
    } else {
      drawerHost.innerHTML = "";
    }
  }
}

function updateScrollFab(): void {
  const scroller = document.getElementById("panel-scroll");
  const fab = document.getElementById("scroll-down-fab");
  if (!scroller || !fab) return;
  const hasMore = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight > 60;
  fab.style.display = hasMore ? "flex" : "none";
}

function attachShellListeners(): void {
  // Window controls & seamless drag region
  const syncMaxIcon = async () => {
    try {
      const win = getCurrentWindow();
      const maxed = await win.isMaximized();
      const btn = document.getElementById("win-max");
      const shell = document.querySelector<HTMLElement>(".app-shell");
      if (shell) shell.classList.toggle("is-maximized", maxed);
      if (btn) {
        btn.title = maxed ? "Restore" : "Maximize";
        btn.setAttribute("aria-label", maxed ? "Restore" : "Maximize");
        btn.innerHTML = maxed
          ? `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><path d="M3 3V1.8c0-.4.3-.8.8-.8h4.4c.4 0 .8.4.8.8v4.4c0 .5-.4.8-.8.8H7" stroke="currentColor" stroke-width="1.15"/><rect x="1" y="3" width="6" height="6" rx="1" stroke="currentColor" stroke-width="1.15"/></svg>`
          : `<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true"><rect x="1.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.2"/></svg>`;
      }
    } catch {}
  };
  void syncMaxIcon();

  document.getElementById("win-min")?.addEventListener("click", () => {
    try { void getCurrentWindow().minimize(); } catch {}
  });
  document.getElementById("win-max")?.addEventListener("click", async () => {
    try {
      await getCurrentWindow().toggleMaximize();
      await syncMaxIcon();
    } catch {}
  });
  document.getElementById("win-close")?.addEventListener("click", () => {
    try { void getCurrentWindow().close(); } catch {}
  });
  document.querySelector(".menu-bar")?.addEventListener("dblclick", async (e) => {
    const target = e.target as HTMLElement;
    if (target.closest("button, .menu-dropdown")) return;
    try {
      await getCurrentWindow().toggleMaximize();
      await syncMaxIcon();
    } catch {}
  });

  // Top menu triggers
  document.querySelectorAll<HTMLButtonElement>(".menu-trigger").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      const id = btn.dataset.menu as AppState["openMenu"];
      state.openMenu = state.openMenu === id ? null : id;
      renderApp();
    });
  });

  document.getElementById("m-rescan")?.addEventListener("click", () => {
    state.openMenu = null;
    void runRescan();
  });
  document.getElementById("m-export")?.addEventListener("click", async () => {
    state.openMenu = null;
    const res = await api.exportCsv(state.filter);
    showToast(`Exported ${res.rowCount} rows to ${res.path}`);
  });
  document.getElementById("m-copy")?.addEventListener("click", async () => {
    state.openMenu = null;
    const summary = await api.copySummary(state.filter);
    void navigator.clipboard?.writeText(summary);
    showToast("Summary copied to clipboard");
  });
  document.getElementById("m-toggle-theme")?.addEventListener("click", async () => {
    state.openMenu = null;
    if (!state.config) return;
    const next = structuredClone(state.config);
    next.display.theme = next.display.theme === "dark" ? "light" : "dark";
    state.config = await api.saveSettings(next);
    applyDisplayPreferences(state.config);
    renderApp();
  });
  document.getElementById("m-glossary")?.addEventListener("click", () => {
    state.openMenu = null;
    state.glossaryOpen = true;
    renderOverlays();
  });
  document.getElementById("m-about")?.addEventListener("click", () => {
    state.settingsSection = "about";
    navigate("settings");
  });

  // Top bar actions
  document.getElementById("tb-home")?.addEventListener("click", () => navigate("token-usage"));
  document.getElementById("tb-rescan")?.addEventListener("click", () => void runRescan());
  document.getElementById("tb-search")?.addEventListener("click", () => {
    state.openMenu = null;
    state.quickSearchOpen = true;
    state.quickSearchQuery = "";
    state.quickSearchIdx = 0;
    renderOverlays();
  });
  document.getElementById("tb-settings")?.addEventListener("click", () => {
    navigate(state.screen === "settings" ? "token-usage" : "settings");
  });

  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.dataset.nav as ScreenId;
      if (target) navigate(target);
    });
  });

  // Scroll
  const scroller = document.getElementById("panel-scroll");
  scroller?.addEventListener("scroll", updateScrollFab);
  document.getElementById("scroll-down-fab")?.addEventListener("click", () => {
    scroller?.scrollBy({ top: 320, behavior: "smooth" });
  });
}

// Global keyboard shortcuts & click-outside menu closing
window.addEventListener("click", () => {
  if (state.openMenu !== null) {
    state.openMenu = null;
    renderApp();
  }
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    state.quickSearchOpen = !state.quickSearchOpen;
    state.quickSearchQuery = "";
    state.quickSearchIdx = 0;
    renderOverlays();
  } else if (e.key === "Escape") {
    if (state.quickSearchOpen) {
      state.quickSearchOpen = false;
      renderOverlays();
    } else if (state.glossaryOpen) {
      state.glossaryOpen = false;
      renderOverlays();
    } else if (state.openMenu) {
      state.openMenu = null;
      renderApp();
    } else if (state.screen === "settings") {
      goBack();
    }
  } else if (state.quickSearchOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    state.quickSearchIdx = Math.max(0, state.quickSearchIdx + (e.key === "ArrowDown" ? 1 : -1));
    renderOverlays();
  }
});

void init();
