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
  ScanDiagnostics,
  ScreenId,
  SessionDagPayload,
  SessionsFilter,
  SessionsOverviewPayload,
  TokenUsageFilter,
  TokenUsagePayload,
} from "./types.ts";
import { escapeHtml } from "./format.ts";
import { appLogoSvg, icons } from "./icons.ts";
import { ModelSortState, renderTokenUsage } from "./screens/tokenUsage.ts";
import { renderSessions, SessionSortState } from "./screens/sessions.ts";
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
  sidebarCollapsed: boolean;
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
  sessionsFilter: SessionsFilter;
  sessionsOverview: SessionsOverviewPayload | null;
  sessionsLoading: boolean;
  sessionsError: string | null;
  sessionSort: SessionSortState;
  selectedSessionId: string | null;
  sessionDag: SessionDagPayload | null;
  sessionDagLoading: boolean;
  sessionDagError: string | null;
  settingsSection: SettingsSection;
  settingsSearch: string;
  fxError: string | null;
  toasts: Array<{ id: number; text: string }>;
}

const state: AppState = {
  screen: "token-usage",
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
  sessionsFilter: { period: "1w", project: null },
  sessionsOverview: null,
  sessionsLoading: false,
  sessionsError: null,
  sessionSort: { column: "total", direction: "desc" },
  selectedSessionId: null,
  sessionDag: null,
  sessionDagLoading: false,
  sessionDagError: null,
  settingsSection: "pricing",
  settingsSearch: "",
  fxError: null,
  toasts: [],
};

let toastSeq = 1;
let refreshTimer: number | null = null;
let tokenUsageSeq = 0;
let sessionsSeq = 0;
let sessionDagSeq = 0;
let lastOverlayTrigger: HTMLElement | null = null;

const OVERLAY_FOCUSABLE_SELECTOR = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(", ");

function captureOverlayTrigger(): void {
  if (!state.quickSearchOpen && !state.glossaryOpen) {
    lastOverlayTrigger =
      document.activeElement instanceof HTMLElement ? document.activeElement : null;
  }
}

function restoreOverlayTrigger(): void {
  if (!state.quickSearchOpen && !state.glossaryOpen) {
    const trigger = lastOverlayTrigger;
    lastOverlayTrigger = null;
    if (trigger && trigger.isConnected) {
      trigger.focus({ preventScroll: true });
    }
  }
}

function openQuickSearch(): void {
  if (state.openMenu !== null) {
    state.openMenu = null;
    updateMenuDropdowns();
  }
  captureOverlayTrigger();
  state.glossaryOpen = false;
  state.quickSearchOpen = true;
  state.quickSearchQuery = "";
  state.quickSearchIdx = 0;
  renderOverlays();
}

function closeQuickSearch(): void {
  if (!state.quickSearchOpen) return;
  state.quickSearchOpen = false;
  renderOverlays();
  restoreOverlayTrigger();
}

function openGlossary(highlight: string | null): void {
  captureOverlayTrigger();
  state.quickSearchOpen = false;
  state.glossaryHighlight = highlight;
  state.glossaryOpen = true;
  renderOverlays();
}

function closeGlossary(): void {
  if (!state.glossaryOpen) return;
  state.glossaryOpen = false;
  renderOverlays();
  restoreOverlayTrigger();
}

function trapOverlayTab(e: KeyboardEvent): void {
  const selector = state.quickSearchOpen
    ? "#modal-host [role='dialog']"
    : "#drawer-host [role='dialog']";
  const dialog = document.querySelector<HTMLElement>(selector);
  if (!dialog) return;

  const focusables = Array.from(
    dialog.querySelectorAll<HTMLElement>(OVERLAY_FOCUSABLE_SELECTOR)
  ).filter((el) => el.tabIndex !== -1 && !el.hasAttribute("disabled"));

  if (focusables.length === 0) {
    e.preventDefault();
    return;
  }

  const first = focusables[0];
  const last = focusables[focusables.length - 1];
  const active = document.activeElement as HTMLElement | null;

  if (!active || !dialog.contains(active)) {
    e.preventDefault();
    (e.shiftKey ? last : first).focus({ preventScroll: true });
  } else if (e.shiftKey) {
    if (active === first || focusables.length === 1) {
      e.preventDefault();
      last.focus({ preventScroll: true });
    }
  } else if (active === last || focusables.length === 1) {
    e.preventDefault();
    first.focus({ preventScroll: true });
  }
}

type ScreenFocusTarget =
  | { kind: "id"; id: string; fallbackId?: string; fallbackSessionId?: string }
  | { kind: "sort"; col: string }
  | { kind: "row"; model: string }
  | { kind: "sess-sort"; col: string }
  | { kind: "session"; sessionId: string };

let pendingScreenFocus: ScreenFocusTarget | null = null;

function findSessionButton(host: HTMLElement, sessionId: string): HTMLElement | null {
  return (
    Array.from(host.querySelectorAll<HTMLElement>(".sess-name-btn[data-session-id]")).find(
      (candidate) => candidate.dataset.sessionId === sessionId
    ) ?? null
  );
}

function captureScreenFocus(host: HTMLElement): ScreenFocusTarget | null {
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
  if (
    active.id === "sess-reset-filters" ||
    active.id === "sess-empty-reset" ||
    active.id === "sess-retry-btn"
  ) {
    return { kind: "id", id: active.id, fallbackId: "sess-filter-period" };
  }
  if (active.id === "dag-retry-btn") {
    if (state.selectedSessionId !== null) {
      return { kind: "id", id: active.id, fallbackId: "dag-close-btn" };
    }
    return null;
  }
  if (active.id === "dag-close-btn") {
    if (state.selectedSessionId !== null) {
      return {
        kind: "id",
        id: active.id,
        fallbackSessionId: state.selectedSessionId,
      };
    }
    return null;
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
  const sessSortBtn = active.closest<HTMLElement>(".sess-sort-btn[data-col]");
  if (sessSortBtn && host.contains(sessSortBtn) && sessSortBtn.dataset.col) {
    return { kind: "sess-sort", col: sessSortBtn.dataset.col };
  }
  const sessBtn = active.closest<HTMLElement>(".sess-name-btn[data-session-id]");
  if (sessBtn && host.contains(sessBtn) && sessBtn.dataset.sessionId !== undefined) {
    return { kind: "session", sessionId: sessBtn.dataset.sessionId };
  }
  return null;
}

function restoreScreenFocus(
  host: HTMLElement,
  target: ScreenFocusTarget | null
): void {
  if (!target) return;
  let el: HTMLElement | null = null;
  if (target.kind === "id") {
    el = host.querySelector<HTMLElement>(`#${CSS.escape(target.id)}`);
    if (!el && target.fallbackId) {
      el = host.querySelector<HTMLElement>(`#${CSS.escape(target.fallbackId)}`);
    }
    if (!el && target.fallbackSessionId) {
      el = findSessionButton(host, target.fallbackSessionId);
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
  } else if (target.kind === "sess-sort") {
    el =
      Array.from(host.querySelectorAll<HTMLElement>(".sess-sort-btn[data-col]")).find(
        (candidate) => candidate.dataset.col === target.col
      ) ?? null;
  } else if (target.kind === "session") {
    el = findSessionButton(host, target.sessionId);
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
  pendingScreenFocus = null;
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

function clearSelectedSessionDag(): void {
  state.selectedSessionId = null;
  state.sessionDag = null;
  state.sessionDagLoading = false;
  state.sessionDagError = null;
  sessionDagSeq++;
}

function closeSessionDag(): void {
  const prevSessionId = state.selectedSessionId;
  clearSelectedSessionDag();
  if (prevSessionId !== null) {
    pendingScreenFocus = { kind: "session", sessionId: prevSessionId };
  }
  renderBodyOnly();
}

async function refreshTokenUsage(): Promise<void> {
  const reqId = ++tokenUsageSeq;
  const host = document.getElementById("screen-host");
  if (state.screen === "token-usage" && !state.initialLoading && host) {
    const captured = captureScreenFocus(host);
    if (captured) {
      pendingScreenFocus = captured;
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

async function refreshSessionsOverview(): Promise<void> {
  const reqId = ++sessionsSeq;
  const host = document.getElementById("screen-host");
  if (state.screen === "sessions" && !state.initialLoading && host) {
    const captured = captureScreenFocus(host);
    if (captured) {
      pendingScreenFocus = captured;
    }
  }
  state.sessionsLoading = true;
  state.sessionsError = null;
  if (state.screen === "sessions" && !state.initialLoading) {
    renderBodyOnly();
  }
  try {
    const payload = await api.getSessionsOverview(state.sessionsFilter);
    if (reqId !== sessionsSeq) return;
    state.sessionsOverview = payload;
    state.sessionsLoading = false;
    if (
      state.selectedSessionId !== null &&
      !payload.sessions.some((s) => s.sessionId === state.selectedSessionId)
    ) {
      clearSelectedSessionDag();
    }
  } catch (err) {
    if (reqId !== sessionsSeq) return;
    state.sessionsError = String(err);
    state.sessionsLoading = false;
  }
  if (state.screen === "sessions" && !state.initialLoading) {
    renderBodyOnly();
  }
}

async function loadSessionDag(sessionId: string): Promise<void> {
  const reqId = ++sessionDagSeq;
  const host = document.getElementById("screen-host");
  if (state.screen === "sessions" && !state.initialLoading && host) {
    const captured = captureScreenFocus(host);
    if (captured) {
      pendingScreenFocus = captured;
    }
  }
  state.sessionDagLoading = true;
  state.sessionDagError = null;
  if (state.screen === "sessions" && !state.initialLoading) {
    renderBodyOnly();
  }
  try {
    const payload = await api.getSessionDag(sessionId);
    if (reqId !== sessionDagSeq) return;
    state.sessionDag = payload;
    state.sessionDagLoading = false;
  } catch (err) {
    if (reqId !== sessionDagSeq) return;
    state.sessionDagError = String(err);
    state.sessionDagLoading = false;
  }
  if (state.screen === "sessions" && !state.initialLoading) {
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
  updateTopBarAndStatus();
  try {
    await api.scanAll();
    state.dashboard = await api.getDashboard(state.filter);
    await Promise.all([refreshTokenUsage(), refreshSessionsOverview()]);
    if (state.selectedSessionId) {
      await loadSessionDag(state.selectedSessionId);
    }
    showToast("Scan complete");
  } catch (err) {
    showToast(`Scan failed: ${String(err)}`);
  } finally {
    state.scanning = false;
    state.initialLoading = false;
    updateTopBarAndStatus();
    renderBodyOnly();
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
    await Promise.all([refreshTokenUsage(), refreshSessionsOverview()]);
  } catch (err) {
    showToast(`Startup error: ${String(err)}`);
  } finally {
    state.initialLoading = false;
    renderApp();
  }
}

function getDiagnosticsStatus(diag: ScanDiagnostics | undefined): {
  missingFolder: boolean;
  hasWarnings: boolean;
} {
  const missingFolder =
    (diag?.sources.length ?? 0) > 0 && diag!.sources.every((s) => !s.exists);
  const hasWarnings =
    (diag?.totalParseErrors ?? 0) > 0 ||
    (diag?.warnings.length ?? 0) > 0 ||
    missingFolder;
  return { missingFolder, hasWarnings };
}

function getRescanTitle(diag: ScanDiagnostics | undefined): string {
  if (state.scanning) return "Scanning local logs…";
  return `Rescan logs${diag?.scannedAtLocalHm ? ` (last scan ${diag.scannedAtLocalHm})` : ""}`;
}

const navItems: Array<{ id: ScreenId; label: string; icon: (s?: number) => string }> = [
  { id: "token-usage", label: "Token Usage", icon: icons.overview },
  { id: "sessions", label: "Sessions", icon: icons.sessions },
];

function renderRescanButtonInner(diag: ScanDiagnostics | undefined): string {
  return `
    <span class="rescan-btn-left">
      ${state.scanning ? `<span class="ring-spinner"></span>` : icons.refresh(15)}
      <span class="nav-label">${state.scanning ? "Scanning…" : "Rescan"}</span>
    </span>
    ${diag?.scannedAtLocalHm ? `<span class="rescan-time mono">${escapeHtml(diag.scannedAtLocalHm)}</span>` : ""}
  `;
}

function renderStatusLineInner(
  dash: DashboardPayload | null,
  missingFolder: boolean
): string {
  const diag = dash?.diagnostics;
  return `
    <span>
      [ last scan ${escapeHtml(diag?.scannedAtLocalHm ?? "--:--")} · ${diag?.totalTranscripts ?? 0} files · ${diag?.totalWithTokens ?? 0} with tokens · ${diag?.totalParseErrors ?? 0} warnings${missingFolder ? " · log folder missing" : ""} ]
    </span>
    ${state.screen === "token-usage" || state.screen === "sessions" ? "" : `<span>${state.filter.currency} · ${escapeHtml(dash?.activeModel.name ?? state.filter.modelId)}</span>`}
  `;
}

function updateTopBarAndStatus(): void {
  const dash = state.dashboard;
  const diag = dash?.diagnostics;
  const { missingFolder, hasWarnings } = getDiagnosticsStatus(diag);

  const rescanBtn = document.getElementById("sb-rescan") as HTMLButtonElement | null;
  if (rescanBtn) {
    rescanBtn.disabled = state.scanning;
    rescanBtn.title = getRescanTitle(diag);
    rescanBtn.innerHTML = renderRescanButtonInner(diag);
  }

  const statusLine = document.getElementById("status-line");
  if (statusLine) {
    statusLine.classList.toggle("has-warnings", hasWarnings);
    statusLine.innerHTML = renderStatusLineInner(dash, missingFolder);
  }
}

function renderApp(): void {
  const root = document.getElementById("app");
  if (!root) return;

  const activeEl = document.activeElement;
  const prevHost = document.getElementById("screen-host");
  let hostFocus: ScreenFocusTarget | null = null;
  let activeId: string | null = null;
  if (activeEl instanceof HTMLElement) {
    if (prevHost && prevHost.contains(activeEl)) {
      hostFocus = captureScreenFocus(prevHost);
    } else if (activeEl.id) {
      activeId = activeEl.id;
    }
  }

  const dash = state.dashboard;
  const diag = dash?.diagnostics;
  const { missingFolder, hasWarnings } = getDiagnosticsStatus(diag);

  root.innerHTML = `
    <div class="app-shell">
      <header class="menu-bar" data-tauri-drag-region>
        <div class="menu-bar-left" data-tauri-drag-region>
          <button type="button" class="menu-home-btn" id="tb-home" title="Token Usage" aria-label="Token Usage">
            ${appLogoSvg(15)}
            <span class="menu-app-label">Antigravity Usage</span>
          </button>
          ${renderMenuButton("usage", "Usage")}
          ${renderMenuButton("view", "View")}
          ${renderMenuButton("help", "Help")}
        </div>
        <div class="menu-bar-right">
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

      <div class="app-body">
        <aside class="sidebar-col${state.sidebarCollapsed ? " collapsed" : ""}">
          <div class="left-toolbar">
            <button
              type="button"
              class="icon-btn"
              id="tb-toggle-sidebar"
              title="Toggle sidebar"
              aria-label="Toggle sidebar"
              aria-expanded="${!state.sidebarCollapsed}"
            >
              ${icons.sidebar(17)}
            </button>
            <button
              type="button"
              class="icon-btn"
              id="tb-search"
              title="Quick search (Ctrl+K)"
              aria-label="Quick search"
            >
              ${icons.search(16)}
            </button>
          </div>

          <button
            type="button"
            class="rescan-btn"
            id="sb-rescan"
            title="${escapeHtml(getRescanTitle(diag))}"
            aria-label="Rescan usage data"
            ${state.scanning ? "disabled" : ""}
          >
            ${renderRescanButtonInner(diag)}
          </button>

          <nav class="sidebar-nav" aria-label="Primary navigation">
            ${navItems
              .map((item) => {
                const active = state.screen === item.id;
                return `
                  <button
                    type="button"
                    class="nav-row ${active ? "active" : ""}"
                    id="sb-nav-${item.id}"
                    data-nav="${item.id}"
                    title="${escapeHtml(item.label)}"
                    aria-label="${escapeHtml(item.label)}"
                    ${active ? 'aria-current="page"' : ""}
                  >
                    <span class="nav-icon">${item.icon(17)}</span>
                    <span class="nav-label">${escapeHtml(item.label)}</span>
                  </button>
                `;
              })
              .join("")}
          </nav>

          <div class="sidebar-footer">
            <button
              type="button"
              class="nav-row ${state.screen === "settings" ? "active" : ""}"
              id="sb-nav-settings"
              data-nav="settings"
              title="Settings"
              aria-label="Settings"
              ${state.screen === "settings" ? 'aria-current="page"' : ""}
            >
              <span class="nav-icon">${icons.settings(17)}</span>
              <span class="nav-label">Settings</span>
            </button>
          </div>
        </aside>

        <main class="workspace-main">
          <section class="content-panel">
            <div class="panel-scroll" id="panel-scroll">
              <div id="screen-host" class="workspace-container"></div>
            </div>
            <button type="button" class="scroll-down-fab" id="scroll-down-fab" title="Scroll down" style="display:none">${icons.arrowDown(15)}</button>
            <div class="status-line ${hasWarnings ? "has-warnings" : ""}" id="status-line">
              ${renderStatusLineInner(dash, missingFolder)}
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

  if (!state.quickSearchOpen && !state.glossaryOpen) {
    if (hostFocus) {
      const newHost = document.getElementById("screen-host");
      if (newHost) restoreScreenFocus(newHost, hostFocus);
    } else if (activeId) {
      document.getElementById(activeId)?.focus({ preventScroll: true });
    }
  }
}

function renderMenuButton(id: "usage" | "view" | "help", label: string): string {
  const open = state.openMenu === id;
  let dropdownItems = "";
  if (id === "usage") {
    dropdownItems = `
      <button type="button" class="menu-dropdown-item" id="m-rescan"><span>Rescan now</span><span class="menu-shortcut">F5</span></button>
      <button type="button" class="menu-dropdown-item" id="m-export"><span>Export CSV</span></button>
      <button type="button" class="menu-dropdown-item" id="m-copy"><span>Copy summary</span></button>`;
  } else if (id === "view") {
    dropdownItems = `
      <button type="button" class="menu-dropdown-item" data-nav="token-usage">Token Usage</button>
      <button type="button" class="menu-dropdown-item" data-nav="sessions">Sessions</button>
      <button type="button" class="menu-dropdown-item" data-nav="settings">Settings</button>
      <div class="menu-dropdown-sep"></div>
      <button type="button" class="menu-dropdown-item" id="m-toggle-theme">Toggle Light / Dark theme</button>`;
  } else if (id === "help") {
    dropdownItems = `
      <button type="button" class="menu-dropdown-item" id="m-glossary">Glossary ("About these numbers")</button>
      <button type="button" class="menu-dropdown-item" id="m-about">About Antigravity Usage</button>`;
  }
  return `
    <div class="menu-item-wrap">
      <button
        type="button"
        class="menu-trigger menu-item${open ? " open" : ""}"
        data-menu="${id}"
        aria-haspopup="true"
        aria-expanded="${open ? "true" : "false"}"
      >${label}</button>
      <div class="menu-dropdown${open ? " open" : ""}"${open ? "" : " hidden"}>
        ${dropdownItems}
      </div>
    </div>
  `;
}

function updateMenuDropdowns(): void {
  document.querySelectorAll<HTMLElement>(".menu-item-wrap").forEach((wrap) => {
    const trigger = wrap.querySelector<HTMLButtonElement>(".menu-trigger[data-menu]");
    const dropdown = wrap.querySelector<HTMLElement>(".menu-dropdown");
    if (!trigger) return;
    const id = trigger.dataset.menu as AppState["openMenu"];
    const isOpen = state.openMenu === id;
    trigger.classList.toggle("open", isOpen);
    trigger.setAttribute("aria-expanded", isOpen ? "true" : "false");
    if (dropdown) {
      dropdown.hidden = !isOpen;
      dropdown.classList.toggle("open", isOpen);
    }
  });
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
    (activeEl instanceof Element && host.contains(activeEl));
  const screenFocusTarget =
    state.screen === "token-usage" || state.screen === "sessions"
      ? captureScreenFocus(host) ?? (focusInsideOrBody ? pendingScreenFocus : null)
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
      restoreScreenFocus(host, screenFocusTarget);
      if (!state.tokenUsageLoading) {
        pendingScreenFocus = null;
      }
    }
  } else if (state.screen === "sessions") {
    if (state.sessionsLoading && !state.sessionsOverview) {
      contentWrap.setAttribute("aria-busy", "true");
      contentWrap.innerHTML = `<div class="loader-overlay"><div class="ring-spinner"></div><div>Loading sessions…</div></div>`;
    } else {
      if (state.sessionsLoading) {
        contentWrap.setAttribute("aria-busy", "true");
      }
      if (state.sessionsError) {
        const errBanner = document.createElement("div");
        errBanner.className = "tu-error-banner";
        errBanner.setAttribute("role", "alert");
        if (state.sessionsOverview) {
          errBanner.style.marginBottom = "var(--card-gap)";
        }
        errBanner.innerHTML = `
          <span>Failed to load sessions: ${escapeHtml(state.sessionsError)}</span>
          <button type="button" class="tu-reset-btn" id="sess-retry-btn">Retry</button>
        `;
        errBanner.querySelector("#sess-retry-btn")?.addEventListener("click", () => {
          void refreshSessionsOverview();
        });
        contentWrap.appendChild(errBanner);
      }
      if (state.sessionsOverview) {
        const sessHost = document.createElement("div");
        contentWrap.appendChild(sessHost);
        renderSessions(
          sessHost,
          state.sessionsOverview,
          state.sessionSort,
          state.selectedSessionId,
          state.sessionDag,
          state.sessionDagLoading,
          state.sessionDagError,
          numFmt,
          {
            onFilterChange: (patch) => {
              state.sessionsFilter = { ...state.sessionsFilter, ...patch };
              clearSelectedSessionDag();
              void refreshSessionsOverview();
            },
            onResetFilters: () => {
              state.sessionsFilter = { period: "1w", project: null };
              clearSelectedSessionDag();
              void refreshSessionsOverview();
            },
            onSortChange: (next) => {
              state.sessionSort = next;
              renderBodyOnly();
            },
            onSelectSession: (sessionId) => {
              if (sessionId === state.selectedSessionId) {
                clearSelectedSessionDag();
                renderBodyOnly();
              } else {
                state.selectedSessionId = sessionId;
                state.sessionDag = null;
                state.sessionDagError = null;
                state.sessionDagLoading = true;
                renderBodyOnly();
                void loadSessionDag(sessionId);
              }
            },
            onCloseDag: () => {
              closeSessionDag();
            },
            onRetryDag: (sessionId) => {
              void loadSessionDag(sessionId);
            },
          }
        );
      } else if (!state.sessionsError) {
        const emptyBanner = document.createElement("div");
        emptyBanner.className = "tu-error-banner";
        emptyBanner.setAttribute("role", "alert");
        emptyBanner.innerHTML = `
          <span>Sessions data is not loaded yet.</span>
          <button type="button" class="tu-reset-btn" id="sess-retry-btn">Load</button>
        `;
        emptyBanner.querySelector("#sess-retry-btn")?.addEventListener("click", () => {
          void refreshSessionsOverview();
        });
        contentWrap.appendChild(emptyBanner);
      }
      restoreScreenFocus(host, screenFocusTarget);
      if (!state.sessionsLoading && !state.sessionDagLoading) {
        pendingScreenFocus = null;
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
  } else if (state.screen === "settings") {
    const errBanner = document.createElement("div");
    errBanner.className = "tu-error-banner";
    errBanner.setAttribute("role", "alert");
    errBanner.innerHTML = `
      <span>Settings could not be loaded.</span>
      <button type="button" class="tu-reset-btn" id="settings-retry-btn">Retry</button>
    `;
    const retryBtn = errBanner.querySelector<HTMLButtonElement>("#settings-retry-btn");
    retryBtn?.addEventListener("click", async () => {
      retryBtn.disabled = true;
      try {
        const nextCfg = await api.getSettings();
        state.config = nextCfg;
        state.filter.modelId = nextCfg.defaultModelId;
        state.filter.currency = nextCfg.reportingCurrency;
        applyDisplayPreferences(nextCfg);
        setupAutoRefresh(nextCfg);
        renderBodyOnly();
      } catch (err) {
        retryBtn.disabled = false;
        showToast(`Failed to load settings: ${String(err)}`);
      }
    });
    contentWrap.appendChild(errBanner);
  }

  // Bind glossary info buttons inside rendered screen
  host.querySelectorAll<HTMLButtonElement>(".info-btn[data-glossary]").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openGlossary(btn.dataset.glossary ?? null);
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
        () => closeQuickSearch(),
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
      renderGlossaryDrawer(drawerHost, state.glossaryHighlight, () => closeGlossary());
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
      updateMenuDropdowns();
    });
  });

  document.getElementById("m-rescan")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.openMenu = null;
    updateMenuDropdowns();
    void runRescan();
  });
  document.getElementById("m-export")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    state.openMenu = null;
    updateMenuDropdowns();
    const res = await api.exportCsv(state.filter);
    showToast(`Exported ${res.rowCount} rows to ${res.path}`);
  });
  document.getElementById("m-copy")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    state.openMenu = null;
    updateMenuDropdowns();
    const summary = await api.copySummary(state.filter);
    void navigator.clipboard?.writeText(summary);
    showToast("Summary copied to clipboard");
  });
  document.getElementById("m-toggle-theme")?.addEventListener("click", async (e) => {
    e.stopPropagation();
    state.openMenu = null;
    updateMenuDropdowns();
    if (!state.config) return;
    const next = structuredClone(state.config);
    next.display.theme = next.display.theme === "dark" ? "light" : "dark";
    state.config = await api.saveSettings(next);
    applyDisplayPreferences(state.config);
    if (state.screen === "settings") {
      renderBodyOnly();
    }
  });
  document.getElementById("m-glossary")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.openMenu = null;
    updateMenuDropdowns();
    openGlossary(null);
  });
  document.getElementById("m-about")?.addEventListener("click", (e) => {
    e.stopPropagation();
    state.openMenu = null;
    updateMenuDropdowns();
    state.settingsSection = "about";
    if (state.screen === "settings") {
      renderBodyOnly();
    } else {
      navigate("settings");
    }
  });

  // Top bar home & sidebar actions
  document.getElementById("tb-home")?.addEventListener("click", () => {
    if (state.openMenu !== null) {
      state.openMenu = null;
      updateMenuDropdowns();
    }
    if (state.screen === "token-usage") return;
    navigate("token-usage");
  });
  document.getElementById("tb-toggle-sidebar")?.addEventListener("click", () => {
    state.sidebarCollapsed = !state.sidebarCollapsed;
    const sidebar = document.querySelector<HTMLElement>(".sidebar-col");
    sidebar?.classList.toggle("collapsed", state.sidebarCollapsed);
    document
      .getElementById("tb-toggle-sidebar")
      ?.setAttribute("aria-expanded", String(!state.sidebarCollapsed));
  });
  document.getElementById("sb-rescan")?.addEventListener("click", () => void runRescan());
  document.getElementById("tb-search")?.addEventListener("click", () => {
    openQuickSearch();
  });

  document.querySelectorAll<HTMLElement>("[data-nav]").forEach((el) => {
    el.addEventListener("click", (e) => {
      e.stopPropagation();
      const target = el.dataset.nav as ScreenId;
      if (!target) return;
      if (state.openMenu !== null) {
        state.openMenu = null;
        updateMenuDropdowns();
      }
      if (state.screen !== target) {
        navigate(target);
      }
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
window.addEventListener("click", (e) => {
  if (state.openMenu !== null) {
    const target = e.target as HTMLElement | null;
    if (target?.closest(".menu-item-wrap")) return;
    state.openMenu = null;
    updateMenuDropdowns();
  }
});

window.addEventListener("keydown", (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
    e.preventDefault();
    if (state.quickSearchOpen) {
      closeQuickSearch();
    } else {
      openQuickSearch();
    }
  } else if (e.key === "F5") {
    e.preventDefault();
    void runRescan();
  } else if (e.key === "Tab" && (state.quickSearchOpen || state.glossaryOpen)) {
    trapOverlayTab(e);
  } else if (e.key === "Escape") {
    if (state.quickSearchOpen) {
      closeQuickSearch();
    } else if (state.glossaryOpen) {
      closeGlossary();
    } else if (state.openMenu) {
      const prevMenu = state.openMenu;
      state.openMenu = null;
      updateMenuDropdowns();
      document
        .querySelector<HTMLButtonElement>(`.menu-trigger[data-menu="${prevMenu}"]`)
        ?.focus({ preventScroll: true });
    } else if (state.screen === "sessions" && state.selectedSessionId !== null) {
      closeSessionDag();
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
