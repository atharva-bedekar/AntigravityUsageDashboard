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
  SessionDetailPayload,
  TokenUsageFilter,
  TokenUsagePayload,
} from "./types.ts";
import { escapeHtml, formatRelativeTime, middleTruncate } from "./format.ts";
import { appLogoSvg, icons, pixelASvg } from "./icons.ts";
import { ModelSortState, renderTokenUsage } from "./screens/tokenUsage.ts";
import { createDefaultSessionsState, renderSessions, SessionsUiState } from "./screens/sessions.ts";
import { renderSessionDetail } from "./screens/sessionDetail.ts";
import { renderDataSources } from "./screens/dataSources.ts";
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
  activeSessionId: string | null;
  history: NavHistoryEntry[];
  historyIdx: number;
  sidebarCollapsed: boolean;
  openMenu: "usage" | "view" | "window" | "help" | "more" | null;
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
  sessionDetail: SessionDetailPayload | null;
  sessionTab: "steps" | "tools" | "subagents";
  expandedThoughts: Set<number>;
  filter: FilterState;
  tokenUsageFilter: TokenUsageFilter;
  tokenUsage: TokenUsagePayload | null;
  tokenUsageLoading: boolean;
  tokenUsageError: string | null;
  modelSort: ModelSortState;
  showTimeChart: boolean;
  sessionsUi: SessionsUiState;
  pbExpanded: boolean;
  settingsSection: SettingsSection;
  settingsSearch: string;
  fxError: string | null;
  toasts: Array<{ id: number; text: string }>;
}

const state: AppState = {
  screen: "token-usage",
  activeSessionId: null,
  history: [{ screen: "token-usage" }],
  historyIdx: 0,
  sidebarCollapsed: false,
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
  sessionDetail: null,
  sessionTab: "steps",
  expandedThoughts: new Set(),
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
  sessionsUi: createDefaultSessionsState(),
  pbExpanded: false,
  settingsSection: "sources",
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

function isFilterNonDefault(): boolean {
  if (!state.config) return false;
  return (
    state.filter.datePreset !== "all" ||
    state.filter.sourceFilter !== "all" ||
    state.filter.projectFilter !== null ||
    state.filter.modelId !== state.config.defaultModelId ||
    state.filter.currency !== state.config.reportingCurrency
  );
}

function resetFilters(): void {
  if (!state.config) return;
  state.filter = {
    datePreset: "all",
    customStart: null,
    customEnd: null,
    sourceFilter: "all",
    projectFilter: null,
    modelId: state.config.defaultModelId,
    currency: state.config.reportingCurrency,
  };
  void refreshDashboard();
}

function navigate(screen: ScreenId, sessionId?: string, pushHistory = true): void {
  state.screen = screen;
  state.activeSessionId = sessionId ?? null;
  state.openMenu = null;
  pendingTokenUsageFocus = null;
  if (pushHistory) {
    state.history = state.history.slice(0, state.historyIdx + 1);
    state.history.push({ screen, sessionId });
    state.historyIdx = state.history.length - 1;
  }
  if (screen === "session-detail" && sessionId) {
    state.sessionDetail = null;
    state.expandedThoughts.clear();
    void loadSessionDetail(sessionId);
  }
  renderApp();
}

function goBack(): void {
  if (state.historyIdx <= 0) return;
  state.historyIdx -= 1;
  const entry = state.history[state.historyIdx];
  navigate(entry.screen, entry.sessionId, false);
}

function goForward(): void {
  if (state.historyIdx >= state.history.length - 1) return;
  state.historyIdx += 1;
  const entry = state.history[state.historyIdx];
  navigate(entry.screen, entry.sessionId, false);
}

async function loadSessionDetail(sessionId: string): Promise<void> {
  try {
    state.sessionDetail = await api.getSessionDetail(
      sessionId,
      state.filter.modelId,
      state.filter.currency
    );
  } catch (err) {
    showToast(`Failed to load session: ${String(err)}`);
  }
  renderApp();
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
    if (state.screen === "session-detail" && state.activeSessionId) {
      await loadSessionDetail(state.activeSessionId);
    }
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
  const missingSource = (appSrc && !appSrc.exists) || (cliSrc && !cliSrc.exists);
  const hasWarnings = (diag?.totalParseErrors ?? 0) > 0 || (diag?.warnings.length ?? 0) > 0 || Boolean(missingSource);

  const navItems: Array<{ id: ScreenId; label: string; icon: (s?: number) => string }> = [
    { id: "token-usage", label: "Token Usage", icon: icons.overview },
    { id: "sessions", label: "Sessions", icon: icons.sessions },
    { id: "data-sources", label: "Data Sources", icon: icons.sources },
  ];

  // Group recent sessions by project (max 3 projects, max 3 sessions each)
  const recentGroups = new Map<string, typeof dash extends null ? never : NonNullable<typeof dash>["sessions"]>();
  if (dash) {
    const sortedRecent = [...dash.sessions]
      .filter((s) => s.kind !== "subagent")
      .sort((a, b) => (b.lastUtc ?? "").localeCompare(a.lastUtc ?? ""));
    for (const s of sortedRecent) {
      const list = recentGroups.get(s.project) ?? [];
      if (list.length < 3) {
        list.push(s);
        recentGroups.set(s.project, list);
      }
      if (recentGroups.size >= 4 && !recentGroups.has(s.project)) break;
    }
  }

  const screenTitleMap: Record<ScreenId, string> = {
    "token-usage": "Token Usage",
    sessions: "Sessions",
    "session-detail": state.sessionDetail?.summary.title ?? "Session Detail",
    "data-sources": "Data Sources",
    settings: "Settings",
  };

  root.innerHTML = `
    <div class="app-shell">
      <header class="menu-bar" data-tauri-drag-region>
        <div class="menu-bar-left" data-tauri-drag-region>
          <span class="menu-app-title" data-tauri-drag-region>${appLogoSvg(15)}<span>Antigravity Usage</span></span>
          ${renderMenuButton("usage", "Usage")}
          ${renderMenuButton("view", "View")}
          ${renderMenuButton("window", "Window")}
          ${renderMenuButton("help", "Help")}
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
      </header>

      <div class="app-body">
        <aside class="sidebar-col ${state.sidebarCollapsed ? "collapsed" : ""}">
          <div class="left-toolbar">
            <div class="toolbar-brand" id="tb-home" title="Antigravity Usage">
              ${appLogoSvg(20)}
            </div>
            <div class="toolbar-actions">
              <button type="button" class="icon-btn" id="tb-toggle-sidebar" title="Toggle sidebar">${icons.sidebar(17)}</button>
              <button type="button" class="icon-btn nav-hist-btn" id="tb-back" title="Back" ${state.historyIdx <= 0 ? "disabled" : ""}>${icons.back(16)}</button>
              <button type="button" class="icon-btn nav-hist-btn" id="tb-forward" title="Forward" ${state.historyIdx >= state.history.length - 1 ? "disabled" : ""}>${icons.forward(16)}</button>
              <button type="button" class="icon-btn toolbar-search-btn" id="tb-search" title="Quick search (Ctrl+K)">${icons.search(16)}</button>
            </div>
          </div>

          <div class="sidebar-inner">
            <button type="button" class="rescan-btn" id="sb-rescan">
              <span class="rescan-btn-left">
                ${state.scanning ? `<span class="ring-spinner"></span>` : icons.refresh(15)}
                <span class="rescan-label">${state.scanning ? "Scanning…" : "Rescan"}</span>
              </span>
              <span class="rescan-time">${escapeHtml(diag?.scannedAtLocalHm ?? "--:--")}</span>
            </button>

            <nav class="sidebar-nav" aria-label="Primary navigation">
              ${navItems
                .map(
                  (it) => `
                <button type="button" class="nav-row ${state.screen === it.id ? "active" : ""}" data-nav="${it.id}" title="${it.label}">
                  ${it.icon(17)}
                  <span class="nav-row-label">${it.label}</span>
                </button>`
                )
                .join("")}
            </nav>

            <div class="sidebar-section-header">
              <span>Sources</span>
              <span style="color:var(--text-muted)">${icons.filter(12)}</span>
            </div>
            <div class="sidebar-sources">
              <div class="sidebar-source-row ${appSrc && !appSrc.exists ? "missing" : ""}" data-src-filter="app">
                <span class="sidebar-source-left">
                  ${appLogoSvg(13)}
                  <span>Antigravity App</span>
                </span>
                <span class="sidebar-source-count">
                  ${appSrc && (!appSrc.exists || appSrc.parseErrors > 0) ? `<span class="status-dot status-dot-warn" title="Source warning or missing"></span>` : ""}
                  <span>${appSrc?.sessionsWithTokens ?? 0}</span>
                </span>
              </div>
              <div class="sidebar-source-row ${cliSrc && !cliSrc.exists ? "missing" : ""}" data-src-filter="cli">
                <span class="sidebar-source-left">
                  ${pixelASvg(13)}
                  <span>Antigravity CLI</span>
                </span>
                <span class="sidebar-source-count">
                  ${cliSrc && (!cliSrc.exists || cliSrc.parseErrors > 0) ? `<span class="status-dot status-dot-warn" title="Source warning or missing"></span>` : ""}
                  <span>${cliSrc?.sessionsWithTokens ?? 0}</span>
                </span>
              </div>
            </div>

            <div class="sidebar-section-header">
              <span>Recent sessions</span>
            </div>
            <div class="sidebar-recent-wrap">
              ${Array.from(recentGroups.entries())
                .map(
                  ([proj, list]) => `
                <div class="sidebar-project-group">
                  <div class="sidebar-project-title" data-proj="${escapeHtml(proj)}">
                    ${icons.folder(13)}
                    <span style="overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(proj)}</span>
                  </div>
                  ${list
                    .map(
                      (s) => `
                    <button type="button" class="sidebar-session-item ${state.screen === "session-detail" && state.activeSessionId === s.sessionId ? "active" : ""}" data-session="${escapeHtml(s.sessionId)}">
                      <span class="sidebar-session-title">${escapeHtml(s.title)}</span>
                      <span class="sidebar-session-age mono">${escapeHtml(formatRelativeTime(s.lastUtc))}</span>
                    </button>`
                    )
                    .join("")}
                </div>`
                )
                .join("")}
            </div>

            <div class="sidebar-footer">
              <button type="button" class="nav-row ${state.screen === "settings" ? "active" : ""}" data-nav="settings" title="Settings">
                ${icons.settings(17)}
                <span class="nav-row-label">Settings</span>
              </button>
            </div>
          </div>
        </aside>

        <main class="main-col">
          <div class="breadcrumb-bar">
            <div class="breadcrumb-trail">
              ${
                state.screen === "session-detail"
                  ? `<button type="button" class="breadcrumb-link" id="bc-sessions">Sessions</button>
                     <span class="breadcrumb-sep">/</span>
                     <span class="breadcrumb-current">${escapeHtml(screenTitleMap[state.screen])}</span>`
                  : `<span class="breadcrumb-current">${escapeHtml(screenTitleMap[state.screen])}</span>`
              }
            </div>
            <div class="breadcrumb-actions">
              <button type="button" class="icon-btn" id="bc-more-btn" title="More actions">${icons.moreVert(17)}</button>
              ${
                state.openMenu === "more"
                  ? `<div class="menu-dropdown" style="right:36px;left:auto">
                      <button type="button" class="menu-dropdown-item" id="act-export-csv">Export current view to CSV</button>
                      <button type="button" class="menu-dropdown-item" id="act-copy-summary">Copy plain-English summary</button>
                    </div>`
                  : ""
              }
              <button type="button" class="icon-btn" id="bc-glossary-btn" title="Glossary & metric definitions">${icons.panelRight(17)}</button>
            </div>
          </div>

          <section class="content-panel">
            ${state.screen !== "token-usage" && state.screen !== "settings" && state.screen !== "data-sources" ? renderFilterBarHtml(dash) : ""}
            <div class="panel-scroll" id="panel-scroll">
              <div id="screen-host"></div>
            </div>
            <button type="button" class="scroll-down-fab" id="scroll-down-fab" title="Scroll down" style="display:none">${icons.arrowDown(15)}</button>
            <div class="status-line ${hasWarnings ? "has-warnings" : ""}" id="status-line" title="Click to inspect Data Sources">
              <span>
                [ last scan ${escapeHtml(diag?.scannedAtLocalHm ?? "--:--")} · ${diag?.totalTranscripts ?? 0} files · ${diag?.totalWithTokens ?? 0} with tokens · ${diag?.totalParseErrors ?? 0} warnings${missingSource ? " · source missing" : ""} ]
              </span>
              ${state.screen === "token-usage" ? "" : `<span>${state.filter.currency} · ${escapeHtml(dash?.activeModel.name ?? state.filter.modelId)}</span>`}
            </div>
          </section>
        </main>
      </div>
    </div>
    <div id="modal-host"></div>
    <div id="drawer-host"></div>
  `;

  attachShellListeners();
  renderBodyOnly();
  renderOverlays();
}

function renderMenuButton(id: "usage" | "view" | "window" | "help", label: string): string {
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
          <button type="button" class="menu-dropdown-item" data-nav="sessions">Sessions</button>
          <button type="button" class="menu-dropdown-item" data-nav="data-sources">Data Sources</button>
          <button type="button" class="menu-dropdown-item" data-nav="settings">Settings</button>
          <div class="menu-dropdown-sep"></div>
          <button type="button" class="menu-dropdown-item" id="m-toggle-sb">Toggle sidebar</button>
          <button type="button" class="menu-dropdown-item" id="m-toggle-theme">Toggle Light / Dark theme</button>
        </div>`;
    } else if (id === "window") {
      dropdown = `
        <div class="menu-dropdown">
          <button type="button" class="menu-dropdown-item" id="m-back">Back</button>
          <button type="button" class="menu-dropdown-item" id="m-fwd">Forward</button>
          <button type="button" class="menu-dropdown-item" id="m-search"><span>Quick search</span><span class="menu-shortcut">Ctrl+K</span></button>
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

function renderFilterBarHtml(dash: DashboardPayload | null): string {
  const models = dash?.catalog ?? [];
  const projects = dash?.allProjects ?? [];
  const cliCount = dash?.diagnostics.sources.find((s) => s.source.kind === "cli")?.sessionsWithTokens ?? 0;
  const appCount = dash?.diagnostics.sources.find((s) => s.source.kind === "app")?.sessionsWithTokens ?? 0;
  const allCount = cliCount + appCount;

  return `
    <div class="filter-bar-wrap">
      <div class="composer-filter-bar">
        <div class="filter-controls-left">
          <div class="filter-select-wrap">
            <select id="f-date" class="filter-select" aria-label="Date range">
              <option value="all" ${state.filter.datePreset === "all" ? "selected" : ""}>All time</option>
              <option value="today" ${state.filter.datePreset === "today" ? "selected" : ""}>Today</option>
              <option value="7d" ${state.filter.datePreset === "7d" ? "selected" : ""}>Last 7 days</option>
              <option value="30d" ${state.filter.datePreset === "30d" ? "selected" : ""}>Last 30 days</option>
              <option value="custom" ${state.filter.datePreset === "custom" ? "selected" : ""}>Custom range…</option>
            </select>
            <span class="filter-select-chevron">${icons.chevronDown(12)}</span>
          </div>

          ${
            state.filter.datePreset === "custom"
              ? `<div class="custom-date-inputs">
                  <input type="date" id="f-start" value="${escapeHtml(state.filter.customStart ?? "")}" />
                  <span>–</span>
                  <input type="date" id="f-end" value="${escapeHtml(state.filter.customEnd ?? "")}" />
                </div>`
              : ""
          }

          <div class="filter-divider"></div>

          <div class="source-segmented" role="group" aria-label="Source filter">
            <button type="button" class="source-seg-btn ${state.filter.sourceFilter === "all" ? "active" : ""}" data-src="all">All (${allCount})</button>
            <button type="button" class="source-seg-btn ${state.filter.sourceFilter === "app" ? "active" : ""}" data-src="app">APP ${appCount}</button>
            <button type="button" class="source-seg-btn ${state.filter.sourceFilter === "cli" ? "active" : ""}" data-src="cli">CLI ${cliCount}</button>
          </div>

          <div class="filter-divider"></div>

          <div class="filter-select-wrap">
            <select id="f-project" class="filter-select" aria-label="Project filter">
              <option value="" ${!state.filter.projectFilter ? "selected" : ""}>All projects</option>
              ${projects
                .map(
                  (p) => `<option value="${escapeHtml(p)}" ${state.filter.projectFilter === p ? "selected" : ""}>${escapeHtml(middleTruncate(p, 26))}</option>`
                )
                .join("")}
            </select>
            <span class="filter-select-chevron">${icons.chevronDown(12)}</span>
          </div>

          <div class="filter-divider"></div>

          <div class="filter-select-wrap">
            <select id="f-model" class="filter-select" aria-label="Pricing model">
              ${models
                .map(
                  (m) => `<option value="${escapeHtml(m.modelId)}" ${state.filter.modelId === m.modelId ? "selected" : ""}>≈ ${escapeHtml(m.name)} pricing</option>`
                )
                .join("")}
            </select>
            <span class="filter-select-chevron">${icons.chevronDown(12)}</span>
          </div>

          <div class="filter-select-wrap">
            <select id="f-currency" class="filter-select" aria-label="Currency">
              <option value="INR" ${state.filter.currency === "INR" ? "selected" : ""}>₹ INR</option>
              <option value="USD" ${state.filter.currency === "USD" ? "selected" : ""}>$ USD</option>
            </select>
            <span class="filter-select-chevron">${icons.chevronDown(12)}</span>
          </div>
        </div>

        ${
          isFilterNonDefault()
            ? `<button type="button" class="filter-reset-btn" id="f-reset" title="Reset filters">${icons.refresh(13)}</button>`
            : ""
        }
      </div>
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
    state.screen !== "settings" &&
    state.screen !== "data-sources"
  ) {
    renderFirstRunEmpty(
      host,
      cfg?.appBrainRoot ?? "~/.gemini/antigravity/brain",
      cfg?.cliBrainRoot ?? "~/.gemini/antigravity-cli/brain",
      () => navigate("settings")
    );
    return;
  }

  // Parse warning banner
  let warningHtml = "";
  if (dash && dash.diagnostics.totalParseErrors > 0 && state.screen !== "data-sources") {
    warningHtml = `
      <div class="warning-banner">
        <div style="display:flex;align-items:center;gap:8px">
          <span style="color:var(--status-warn-icon)">${icons.warning(16)}</span>
          <span>${dash.diagnostics.totalParseErrors} session log lines couldn't be parsed.</span>
        </div>
        <button type="button" class="link-btn" id="banner-goto-ds">See Data Sources</button>
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
    host.querySelector("#banner-goto-ds")?.addEventListener("click", () => navigate("data-sources"));
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
  } else if (state.screen === "sessions" && dash) {
    renderSessions(
      contentWrap,
      dash,
      state.sessionsUi,
      numFmt,
      (sid) => navigate("session-detail", sid),
      () => renderBodyOnly()
    );
  } else if (state.screen === "session-detail") {
    if (!state.sessionDetail) {
      contentWrap.innerHTML = `<div class="loader-overlay"><div class="ring-spinner"></div><div>Loading session…</div></div>`;
    } else {
      renderSessionDetail(
        contentWrap,
        state.sessionDetail,
        state.filter.currency,
        numFmt,
        state.sessionTab,
        state.expandedThoughts,
        {
          onOpenSession: (sid) => navigate("session-detail", sid),
          onOpenFolder: (p) => void api.openInExplorer(p),
          onCopyText: (txt, lbl) => {
            void navigator.clipboard?.writeText(txt);
            showToast(lbl);
          },
          onTabChange: (tab) => {
            state.sessionTab = tab;
            renderBodyOnly();
          },
        }
      );
    }
  } else if (state.screen === "data-sources" && dash && cfg) {
    renderDataSources(
      contentWrap,
      dash,
      cfg,
      state.scanning,
      state.pbExpanded,
      numFmt,
      () => {
        state.pbExpanded = !state.pbExpanded;
        renderBodyOnly();
      },
      {
        onToggleSource: async (kind, enabled) => {
          const next = structuredClone(cfg);
          if (kind === "app") next.appEnabled = enabled;
          else next.cliEnabled = enabled;
          state.config = await api.saveSettings(next);
          showToast("Saved");
          await runRescan();
        },
        onRescan: () => void runRescan(),
        onOpenFolder: (p) => void api.openInExplorer(p),
        onOpenSettingsSources: () => {
          state.settingsSection = "sources";
          navigate("settings");
        },
      }
    );
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
        onRestoreDefaults: async () => {
          const saved = await api.restoreDefaultPaths();
          state.config = saved;
          showToast("Restored default paths");
          await runRescan();
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
        (scr, sid) => navigate(scr, sid),
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
  document.getElementById("m-toggle-sb")?.addEventListener("click", () => {
    state.openMenu = null;
    state.sidebarCollapsed = !state.sidebarCollapsed;
    renderApp();
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
  document.getElementById("m-back")?.addEventListener("click", goBack);
  document.getElementById("m-fwd")?.addEventListener("click", goForward);
  document.getElementById("m-search")?.addEventListener("click", () => {
    state.openMenu = null;
    state.quickSearchOpen = true;
    renderOverlays();
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

  // Left toolbar & sidebar
  document.getElementById("tb-home")?.addEventListener("click", () => navigate("token-usage"));
  document.getElementById("tb-toggle-sidebar")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    renderApp();
  });
  document.getElementById("tb-back")?.addEventListener("click", goBack);
  document.getElementById("tb-forward")?.addEventListener("click", goForward);
  document.getElementById("tb-search")?.addEventListener("click", () => {
    state.quickSearchOpen = true;
    renderOverlays();
  });
  document.getElementById("sb-rescan")?.addEventListener("click", () => void runRescan());

  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    el.addEventListener("click", () => {
      const target = el.dataset.nav as ScreenId;
      if (target) navigate(target);
    });
  });

  document.querySelectorAll<HTMLElement>("[data-src-filter]").forEach((el) => {
    el.addEventListener("click", () => {
      const sf = el.dataset.srcFilter;
      if (sf) {
        state.filter.sourceFilter = state.filter.sourceFilter === sf ? "all" : sf;
        void refreshDashboard();
      }
    });
  });

  document.querySelectorAll<HTMLElement>("[data-session]").forEach((el) => {
    el.addEventListener("click", () => {
      const sid = el.dataset.session;
      if (sid) navigate("session-detail", sid);
    });
  });

  document.querySelectorAll<HTMLElement>(".sidebar-project-title[data-proj]").forEach((el) => {
    el.addEventListener("click", () => {
      const proj = el.dataset.proj;
      if (proj) {
        state.tokenUsageFilter = { ...state.tokenUsageFilter, project: proj };
        navigate("token-usage");
        void refreshTokenUsage();
      }
    });
  });

  // Breadcrumb & header actions
  document.getElementById("bc-sessions")?.addEventListener("click", () => navigate("sessions"));
  document.getElementById("bc-more-btn")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.openMenu = state.openMenu === "more" ? null : "more";
    renderApp();
  });
  document.getElementById("act-export-csv")?.addEventListener("click", async () => {
    state.openMenu = null;
    const res = await api.exportCsv(state.filter);
    showToast(`Exported ${res.rowCount} rows to ${res.path}`);
    renderApp();
  });
  document.getElementById("act-copy-summary")?.addEventListener("click", async () => {
    state.openMenu = null;
    const summary = await api.copySummary(state.filter);
    void navigator.clipboard?.writeText(summary);
    showToast("Summary copied to clipboard");
    renderApp();
  });
  document.getElementById("bc-glossary-btn")?.addEventListener("click", () => {
    state.glossaryHighlight = null;
    state.glossaryOpen = !state.glossaryOpen;
    renderOverlays();
  });

  // Filter bar
  document.getElementById("f-date")?.addEventListener("change", (e) => {
    state.filter.datePreset = (e.target as HTMLSelectElement).value as FilterState["datePreset"];
    void refreshDashboard();
  });
  document.getElementById("f-start")?.addEventListener("change", (e) => {
    state.filter.customStart = (e.target as HTMLInputElement).value || null;
    void refreshDashboard();
  });
  document.getElementById("f-end")?.addEventListener("change", (e) => {
    state.filter.customEnd = (e.target as HTMLInputElement).value || null;
    void refreshDashboard();
  });
  document.querySelectorAll<HTMLButtonElement>(".source-seg-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      state.filter.sourceFilter = btn.dataset.src || "all";
      void refreshDashboard();
    });
  });
  document.getElementById("f-project")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLSelectElement).value;
    state.filter.projectFilter = val ? val : null;
    void refreshDashboard();
  });
  document.getElementById("f-model")?.addEventListener("change", (e) => {
    state.filter.modelId = (e.target as HTMLSelectElement).value;
    void refreshDashboard();
  });
  document.getElementById("f-currency")?.addEventListener("change", (e) => {
    state.filter.currency = (e.target as HTMLSelectElement).value as "INR" | "USD";
    void refreshDashboard();
  });
  document.getElementById("f-reset")?.addEventListener("click", resetFilters);

  // Scroll & status line
  const scroller = document.getElementById("panel-scroll");
  scroller?.addEventListener("scroll", updateScrollFab);
  document.getElementById("scroll-down-fab")?.addEventListener("click", () => {
    scroller?.scrollBy({ top: 320, behavior: "smooth" });
  });
  document.getElementById("status-line")?.addEventListener("click", () => navigate("data-sources"));
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
    }
  } else if (state.quickSearchOpen && (e.key === "ArrowDown" || e.key === "ArrowUp")) {
    e.preventDefault();
    state.quickSearchIdx = Math.max(0, state.quickSearchIdx + (e.key === "ArrowDown" ? 1 : -1));
    renderOverlays();
  }
});

void init();
