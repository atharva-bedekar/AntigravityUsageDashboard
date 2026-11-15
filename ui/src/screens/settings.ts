import { AboutInfo, AppConfig, DashboardPayload } from "../types.ts";
import { escapeHtml } from "../format.ts";
import { icons } from "../icons.ts";

export type SettingsSection =
  | "sources"
  | "pricing"
  | "money"
  | "display"
  | "refresh"
  | "privacy"
  | "about";

export interface SettingsCallbacks {
  onSectionChange: (sec: SettingsSection) => void;
  onSearchChange: (q: string) => void;
  onSaveConfig: (next: AppConfig) => Promise<void>;
  onRestoreDefaults: () => Promise<void>;
  onClearSnapshots: () => Promise<void>;
  onOpenFolder: (path: string) => void;
  onExportDiagnostics: () => Promise<void>;
  onBack: () => void;
}

const SECTIONS: Array<{ id: SettingsSection; label: string }> = [
  { id: "sources", label: "Sources" },
  { id: "pricing", label: "Pricing" },
  { id: "money", label: "Money" },
  { id: "display", label: "Display" },
  { id: "refresh", label: "Refresh" },
  { id: "privacy", label: "Privacy" },
  { id: "about", label: "About" },
];

export function renderSettings(
  container: HTMLElement,
  config: AppConfig,
  data: DashboardPayload | null,
  about: AboutInfo | null,
  activeSection: SettingsSection,
  searchQuery: string,
  fxError: string | null,
  onFxError: (err: string | null) => void,
  cb: SettingsCallbacks
): void {
  const q = searchQuery.trim().toLowerCase();
  const match = (text: string) => !q || text.toLowerCase().includes(q);

  const showAll = q.length > 0;

  container.innerHTML = `
    <div class="page-enter stack-gap">
      <div style="position:relative">
        <span style="position:absolute;left:12px;top:50%;transform:translateY(-50%);color:var(--text-muted);display:flex">${icons.search(15)}</span>
        <input id="set-search" class="text-input" style="width:100%;padding-left:34px" type="text" placeholder="Search settings…" value="${escapeHtml(searchQuery)}" />
      </div>

      <div class="settings-layout">
        <nav class="settings-rail" aria-label="Settings sections">
          ${SECTIONS.map(
            (s) => `
            <button type="button" class="settings-rail-btn ${activeSection === s.id && !showAll ? "active" : ""}" data-sec="${s.id}">
              <span class="settings-rail-marker">${activeSection === s.id && !showAll ? "›" : " "}</span>
              <span>${s.label}</span>
            </button>`
          ).join("")}
        </nav>

        <div class="stack-gap">
          ${
            showAll || activeSection === "sources"
              ? renderSourcesSection(config, match)
              : ""
          }
          ${
            showAll || activeSection === "pricing"
              ? renderPricingSection(config, data, match)
              : ""
          }
          ${
            showAll || activeSection === "money"
              ? renderMoneySection(config, fxError, match)
              : ""
          }
          ${
            showAll || activeSection === "display"
              ? renderDisplaySection(config, match)
              : ""
          }
          ${
            showAll || activeSection === "refresh"
              ? renderRefreshSection(config, match)
              : ""
          }
          ${
            showAll || activeSection === "privacy"
              ? renderPrivacySection(config, match)
              : ""
          }
          ${
            showAll || activeSection === "about"
              ? renderAboutSection(about, match)
              : ""
          }

          <div class="key-hints-bar">
            <span><span class="key-hint-key">↑/↓</span> Navigate</span>
            <span><span class="key-hint-key">Enter</span> Edit</span>
            <span><span class="key-hint-key">Esc</span> Back</span>
          </div>
        </div>
      </div>
    </div>
  `;

  const searchInput = container.querySelector("#set-search") as HTMLInputElement | null;
  searchInput?.addEventListener("input", () => {
    cb.onSearchChange(searchInput.value);
    const el = container.querySelector("#set-search") as HTMLInputElement | null;
    el?.focus();
    el?.setSelectionRange(el.value.length, el.value.length);
  });

  container.querySelectorAll<HTMLButtonElement>(".settings-rail-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const sec = btn.dataset.sec as SettingsSection;
      if (sec) cb.onSectionChange(sec);
    });
  });

  const updateAndSave = (mutator: (draft: AppConfig) => void) => {
    const draft: AppConfig = structuredClone(config);
    mutator(draft);
    void cb.onSaveConfig(draft);
  };

  // Sources events
  container.querySelector("#set-app-path")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.appBrainRoot = (e.target as HTMLInputElement).value.trim();
    });
  });
  container.querySelector("#set-app-enabled")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.appEnabled = (e.target as HTMLInputElement).checked;
    });
  });
  container.querySelector("#set-cli-path")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.cliBrainRoot = (e.target as HTMLInputElement).value.trim();
    });
  });
  container.querySelector("#set-cli-enabled")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.cliEnabled = (e.target as HTMLInputElement).checked;
    });
  });
  container.querySelector("#set-read-sqlite")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.readAppSqlite = (e.target as HTMLInputElement).checked;
    });
  });
  container.querySelector("#set-restore-defaults")?.addEventListener("click", () => {
    void cb.onRestoreDefaults();
  });
  container.querySelector("#set-add-custom")?.addEventListener("click", () => {
    const nameEl = container.querySelector("#set-custom-name") as HTMLInputElement | null;
    const pathEl = container.querySelector("#set-custom-path") as HTMLInputElement | null;
    const name = nameEl?.value.trim() || "";
    const path = pathEl?.value.trim() || "";
    if (!name || !path) return;
    updateAndSave((d) => {
      d.customSources.push({ name, path, enabled: true });
    });
  });
  container.querySelectorAll<HTMLButtonElement>(".set-remove-custom").forEach((btn) => {
    btn.addEventListener("click", () => {
      const idx = Number(btn.dataset.idx);
      updateAndSave((d) => {
        d.customSources.splice(idx, 1);
      });
    });
  });

  // Pricing events
  container.querySelector("#set-default-model")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.defaultModelId = (e.target as HTMLSelectElement).value;
    });
  });
  container.querySelector("#set-pricing-path")?.addEventListener("change", (e) => {
    const val = (e.target as HTMLInputElement).value.trim();
    updateAndSave((d) => {
      d.pricingPath = val ? val : null;
    });
  });

  // Money events
  container.querySelectorAll<HTMLButtonElement>("#set-currency-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const cur = btn.dataset.cur === "USD" ? "USD" : "INR";
      updateAndSave((d) => {
        d.reportingCurrency = cur;
      });
    });
  });

  container.querySelector("#set-usd-inr")?.addEventListener("change", (e) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(val) || val <= 0) {
      onFxError("Enter a number greater than 0");
      return;
    }
    onFxError(null);
    updateAndSave((d) => {
      d.fx.usdInr = val;
    });
  });

  container.querySelector("#set-sub-amount")?.addEventListener("change", (e) => {
    const val = Number((e.target as HTMLInputElement).value);
    if (!Number.isFinite(val) || val < 0) return;
    updateAndSave((d) => {
      d.subscription.amount = val;
    });
  });

  container.querySelector("#set-sub-days")?.addEventListener("change", (e) => {
    const val = Math.round(Number((e.target as HTMLInputElement).value));
    if (!Number.isFinite(val) || val < 1 || val > 365) return;
    updateAndSave((d) => {
      d.subscription.periodDays = val;
    });
  });

  // Display events
  container.querySelectorAll<HTMLButtonElement>(".set-theme-radio").forEach((btn) => {
    btn.addEventListener("click", () => {
      const theme = btn.dataset.theme as "light" | "dark" | "system";
      updateAndSave((d) => {
        d.display.theme = theme;
      });
    });
  });
  container.querySelectorAll<HTMLButtonElement>("#set-density-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const density = btn.dataset.val === "compact" ? "compact" : "comfortable";
      updateAndSave((d) => {
        d.display.density = density;
      });
    });
  });
  container.querySelectorAll<HTMLButtonElement>("#set-numfmt-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const nf = btn.dataset.val === "full" ? "full" : "compact";
      updateAndSave((d) => {
        d.display.numberFormat = nf;
      });
    });
  });
  container.querySelectorAll<HTMLButtonElement>("#set-week-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ws = btn.dataset.val === "sunday" ? "sunday" : "monday";
      updateAndSave((d) => {
        d.display.weekStart = ws;
      });
    });
  });
  container.querySelectorAll<HTMLButtonElement>("#set-motion-seg .segmented-btn").forEach((btn) => {
    btn.addEventListener("click", () => {
      const rm = btn.dataset.val as "system" | "on" | "off";
      updateAndSave((d) => {
        d.display.reducedMotion = rm;
      });
    });
  });

  // Refresh events
  container.querySelector("#set-refresh-interval")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.refresh.intervalMinutes = Number((e.target as HTMLSelectElement).value) || 0;
    });
  });
  container.querySelector("#set-watcher")?.addEventListener("change", (e) => {
    updateAndSave((d) => {
      d.refresh.fileWatcherEnabled = (e.target as HTMLInputElement).checked;
    });
  });
  container.querySelector("#set-clear-snapshots")?.addEventListener("click", () => {
    void cb.onClearSnapshots();
  });

  // Privacy & About
  container.querySelector("#set-open-data")?.addEventListener("click", () => {
    if (about?.configPath) cb.onOpenFolder(about.configPath);
  });
  container.querySelector("#set-export-diag")?.addEventListener("click", () => {
    void cb.onExportDiagnostics();
  });
}

function renderSourcesSection(config: AppConfig, match: (s: string) => boolean): string {
  if (!match("sources app cli folder sqlite custom")) return "";
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">Sources</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Antigravity App folder</div>
          <div class="setting-help">Where the App keeps conversations.</div>
        </div>
        <div class="setting-control">
          <input id="set-app-path" class="text-input mono" style="width:260px" value="${escapeHtml(config.appBrainRoot)}" />
          <label class="switch"><input type="checkbox" id="set-app-enabled" ${config.appEnabled ? "checked" : ""} /><span class="switch-slider"></span></label>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Antigravity CLI folder</div>
          <div class="setting-help">Where the CLI keeps transcripts and history.</div>
        </div>
        <div class="setting-control">
          <input id="set-cli-path" class="text-input mono" style="width:260px" value="${escapeHtml(config.cliBrainRoot)}" />
          <label class="switch"><input type="checkbox" id="set-cli-enabled" ${config.cliEnabled ? "checked" : ""} /><span class="switch-slider"></span></label>
        </div>
      </div>

      <div class="setting-row" style="align-items:flex-start">
        <div>
          <div class="setting-label">Custom brain folders</div>
          <div class="setting-help">Additional local brain directories to scan.</div>
          <div style="display:flex;flex-direction:column;gap:6px;margin-top:8px">
            ${config.customSources
              .map(
                (cs, idx) => `
              <div style="display:flex;align-items:center;gap:8px">
                <span class="code-chip">${escapeHtml(cs.name)}</span>
                <span class="code-chip">${escapeHtml(cs.path)}</span>
                <button type="button" class="icon-btn set-remove-custom" data-idx="${idx}" title="Remove">×</button>
              </div>`
              )
              .join("")}
          </div>
        </div>
        <div class="setting-control">
          <input id="set-custom-name" class="text-input" style="width:90px" placeholder="Name" />
          <input id="set-custom-path" class="text-input mono" style="width:170px" placeholder="Folder path" />
          <button type="button" class="btn-secondary" id="set-add-custom">+ Add</button>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Read App titles & projects from conversation_summaries.db</div>
          <div class="setting-help">Opened read-only. Turn off to show IDs only.</div>
        </div>
        <div class="setting-control">
          <label class="switch"><input type="checkbox" id="set-read-sqlite" ${config.readAppSqlite ? "checked" : ""} /><span class="switch-slider"></span></label>
        </div>
      </div>

      <div style="padding-top:10px">
        <button type="button" class="link-btn" id="set-restore-defaults">Restore default paths</button>
      </div>
    </div>
  `;
}

function renderPricingSection(
  config: AppConfig,
  data: DashboardPayload | null,
  match: (s: string) => boolean
): string {
  if (!match("pricing model catalog rates verified")) return "";
  const catalog = data?.catalog ?? [];
  const entries = data?.allEntries ?? [];
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">Pricing</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Default pricing model</div>
          <div class="setting-help">Applied when opening the dashboard.</div>
        </div>
        <div class="setting-control">
          <select id="set-default-model" class="text-input">
            ${catalog
              .map(
                (m) => `<option value="${escapeHtml(m.modelId)}" ${m.modelId === config.defaultModelId ? "selected" : ""}>${escapeHtml(m.name)}</option>`
              )
              .join("")}
          </select>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Custom price catalog file (optional)</div>
          <div class="setting-help">Local JSON file overriding seeded model tariffs.</div>
        </div>
        <div class="setting-control">
          <input id="set-pricing-path" class="text-input mono" style="width:260px" placeholder="Built-in seeded catalog" value="${escapeHtml(config.pricingPath ?? "")}" />
        </div>
      </div>

      <div style="margin-top:14px">
        <div style="font-size:12.5px;font-weight:500;margin-bottom:8px">Active price catalog (read-only)</div>
        <div class="table-scroll">
          <table class="data-table">
            <thead>
              <tr>
                <th>Model</th>
                <th>Vendor</th>
                <th>From</th>
                <th>Until</th>
                <th class="num">New $/1M</th>
                <th class="num">Cached $/1M</th>
                <th class="num">Output $/1M</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              ${entries
                .map(
                  (e) => `
                <tr>
                  <td style="font-weight:500">${escapeHtml(e.name)}</td>
                  <td style="color:var(--text-muted)">${escapeHtml(e.vendor)}</td>
                  <td class="mono" style="font-size:12px">${escapeHtml(e.effectiveFrom)}</td>
                  <td class="mono" style="font-size:12px">${escapeHtml(e.effectiveUntil ?? "present")}</td>
                  <td class="num">$${e.inputUsd.toFixed(3)}</td>
                  <td class="num">$${e.cachedUsd.toFixed(3)}</td>
                  <td class="num">$${e.outputUsd.toFixed(3)}</td>
                  <td><span class="status-chip ${e.verified ? "status-chip-ok" : "status-chip-warn"}">${e.verified ? "Verified" : "Approx."}</span></td>
                </tr>`
                )
                .join("")}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  `;
}

function renderMoneySection(
  config: AppConfig,
  fxError: string | null,
  match: (s: string) => boolean
): string {
  if (!match("money currency inr usd fx rate subscription plan billing")) return "";
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">Money</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Display currency</div>
          <div class="setting-help">Primary currency across KPIs and tables.</div>
        </div>
        <div class="setting-control">
          <div class="segmented" id="set-currency-seg">
            <button type="button" class="segmented-btn ${config.reportingCurrency === "INR" ? "active" : ""}" data-cur="INR">₹ INR</button>
            <button type="button" class="segmented-btn ${config.reportingCurrency === "USD" ? "active" : ""}" data-cur="USD">$ USD</button>
          </div>
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">USD → INR exchange rate</div>
          <div class="setting-help">Used only for display.</div>
        </div>
        <div class="setting-control" style="flex-direction:column;align-items:flex-end">
          <input id="set-usd-inr" type="number" step="0.01" class="text-input mono ${fxError ? "invalid" : ""}" style="width:120px;text-align:right" value="${config.fx.usdInr}" />
          ${fxError ? `<div class="field-error">${escapeHtml(fxError)}</div>` : ""}
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Monthly plan amount</div>
          <div class="setting-help">What you actually pay (0 = not set). Used only for plan comparison.</div>
        </div>
        <div class="setting-control">
          <input id="set-sub-amount" type="number" min="0" step="1" class="text-input mono" style="width:120px;text-align:right" value="${config.subscription.amount}" />
        </div>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Billing period (days)</div>
          <div class="setting-help">Length of your billing cycle (1–365).</div>
        </div>
        <div class="setting-control">
          <input id="set-sub-days" type="number" min="1" max="365" class="text-input mono" style="width:120px;text-align:right" value="${config.subscription.periodDays}" />
        </div>
      </div>
    </div>
  `;
}

function renderDisplaySection(config: AppConfig, match: (s: string) => boolean): string {
  if (!match("display theme light dark density compact numbers week motion")) return "";
  const themes: Array<{ val: "light" | "dark" | "system"; label: string }> = [
    { val: "light", label: "light" },
    { val: "dark", label: "dark" },
    { val: "system", label: "follow Windows" },
  ];
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">Display</h3>
      <div class="setting-row" style="align-items:flex-start">
        <div>
          <div class="setting-label">Theme</div>
          <div class="setting-help">Matches Antigravity App light or dark chrome.</div>
        </div>
        <div class="cli-radio-list">
          ${themes
            .map((t) => {
              const sel = config.display.theme === t.val;
              return `<button type="button" class="cli-radio-item set-theme-radio ${sel ? "selected" : ""}" data-theme="${t.val}">
                ${sel ? "›" : " "} ${t.label}${sel ? " (current)" : ""}
              </button>`;
            })
            .join("")}
        </div>
      </div>

      <div class="setting-row">
        <div><div class="setting-label">Density</div></div>
        <div class="segmented" id="set-density-seg">
          <button type="button" class="segmented-btn ${config.display.density === "comfortable" ? "active" : ""}" data-val="comfortable">Comfortable</button>
          <button type="button" class="segmented-btn ${config.display.density === "compact" ? "active" : ""}" data-val="compact">Compact</button>
        </div>
      </div>

      <div class="setting-row">
        <div><div class="setting-label">Numbers</div></div>
        <div class="segmented" id="set-numfmt-seg">
          <button type="button" class="segmented-btn ${config.display.numberFormat === "compact" ? "active" : ""}" data-val="compact">Compact (307.7M)</button>
          <button type="button" class="segmented-btn ${config.display.numberFormat === "full" ? "active" : ""}" data-val="full">Full (307,693,417)</button>
        </div>
      </div>

      <div class="setting-row">
        <div><div class="setting-label">Week starts</div></div>
        <div class="segmented" id="set-week-seg">
          <button type="button" class="segmented-btn ${config.display.weekStart === "monday" ? "active" : ""}" data-val="monday">Monday</button>
          <button type="button" class="segmented-btn ${config.display.weekStart === "sunday" ? "active" : ""}" data-val="sunday">Sunday</button>
        </div>
      </div>

      <div class="setting-row">
        <div><div class="setting-label">Reduce motion</div></div>
        <div class="segmented" id="set-motion-seg">
          <button type="button" class="segmented-btn ${config.display.reducedMotion === "system" ? "active" : ""}" data-val="system">Follow Windows</button>
          <button type="button" class="segmented-btn ${config.display.reducedMotion === "on" ? "active" : ""}" data-val="on">On</button>
          <button type="button" class="segmented-btn ${config.display.reducedMotion === "off" ? "active" : ""}" data-val="off">Off</button>
        </div>
      </div>
    </div>
  `;
}

function renderRefreshSection(config: AppConfig, match: (s: string) => boolean): string {
  if (!match("refresh rescan interval watch snapshots clear")) return "";
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">Refresh</h3>
      <div class="setting-row">
        <div>
          <div class="setting-label">Rescan automatically</div>
          <div class="setting-help">Periodic background scan interval.</div>
        </div>
        <select id="set-refresh-interval" class="text-input">
          <option value="0" ${config.refresh.intervalMinutes === 0 ? "selected" : ""}>Manual only</option>
          <option value="1" ${config.refresh.intervalMinutes === 1 ? "selected" : ""}>1 min</option>
          <option value="5" ${config.refresh.intervalMinutes === 5 ? "selected" : ""}>5 min</option>
          <option value="15" ${config.refresh.intervalMinutes === 15 ? "selected" : ""}>15 min</option>
        </select>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Watch folders for new sessions</div>
          <div class="setting-help">Updates as soon as Antigravity writes a new log.</div>
        </div>
        <label class="switch"><input type="checkbox" id="set-watcher" ${config.refresh.fileWatcherEnabled ? "checked" : ""} /><span class="switch-slider"></span></label>
      </div>

      <div class="setting-row">
        <div>
          <div class="setting-label">Clear cached snapshots</div>
          <div class="setting-help">Removes local snapshot history in snapshots.db.</div>
        </div>
        <button type="button" class="btn-secondary" id="set-clear-snapshots">Clear snapshots</button>
      </div>
    </div>
  `;
}

function renderPrivacySection(config: AppConfig, match: (s: string) => boolean): string {
  if (!match("privacy local offline telemetry read-only")) return "";
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">Privacy</h3>
      <div class="epistemic-banner" style="margin-bottom:12px">
        <span>Reads local files only. Never uploads, never sends telemetry, never writes to Antigravity's folders.</span>
      </div>
      <div style="font-size:13px;color:var(--text-muted);margin-bottom:10px">Folders read on this machine:</div>
      <div style="display:flex;flex-direction:column;gap:6px;margin-bottom:12px">
        <span class="code-chip">${escapeHtml(config.appBrainRoot)}</span>
        <span class="code-chip">${escapeHtml(config.cliBrainRoot)}</span>
      </div>
      <button type="button" class="btn-secondary" id="set-open-data">Open app config/data folder</button>
    </div>
  `;
}

function renderAboutSection(about: AboutInfo | null, match: (s: string) => boolean): string {
  if (!match("about version diagnostics antigravity")) return "";
  return `
    <div class="card">
      <h3 class="card-title" style="margin-bottom:6px">About</h3>
      <div class="setting-row">
        <div class="setting-label">Antigravity Usage</div>
        <div class="mono" style="font-size:13px">v${escapeHtml(about?.appVersion ?? "0.1.0")} (${escapeHtml(about?.buildDate ?? "2026-11-15")})</div>
      </div>
      <div class="setting-row">
        <div class="setting-label">Detected local runtimes</div>
        <div class="mono" style="font-size:12.5px;color:var(--text-muted)">
          App ${escapeHtml(about?.antigravityAppVersion ?? "Not detected")} · CLI ${escapeHtml(about?.antigravityCliVersion ?? "Not detected")}
        </div>
      </div>
      <div style="padding-top:12px">
        <button type="button" class="btn-secondary" id="set-export-diag">Export diagnostics JSON</button>
      </div>
    </div>
  `;
}
