import { invoke } from "@tauri-apps/api/core";
import {
  AboutInfo,
  AppConfig,
  DashboardPayload,
  ExportResult,
  FilterState,
  ForecastMethod,
  ForecastResult,
  ModelUsageRow,
  ScanDiagnostics,
  SessionDetailPayload,
  TimeGranularity,
  TimePeriod,
  TimeUsageBucket,
  TokenUsageFilter,
  TokenUsagePayload,
  TokenUsageTotals,
} from "./types.ts";

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const api = {
  async scanAll(): Promise<ScanDiagnostics> {
    if (isTauri()) {
      return invoke<ScanDiagnostics>("scan_all");
    }
    return mockDiagnostics();
  },

  async getDashboard(filter: FilterState): Promise<DashboardPayload> {
    if (isTauri()) {
      return invoke<DashboardPayload>("get_dashboard", { filter });
    }
    return mockDashboard(filter);
  },

  async getTokenUsage(filter: TokenUsageFilter): Promise<TokenUsagePayload> {
    if (isTauri()) {
      return invoke<TokenUsagePayload>("get_token_usage", { filter });
    }
    return mockTokenUsage(filter);
  },

  async getSessionDetail(
    sessionId: string,
    modelId: string,
    currency: "INR" | "USD"
  ): Promise<SessionDetailPayload> {
    if (isTauri()) {
      return invoke<SessionDetailPayload>("get_session_detail", {
        sessionId,
        modelId,
        currency,
      });
    }
    return mockSessionDetail(sessionId, currency);
  },

  async getSettings(): Promise<AppConfig> {
    if (isTauri()) {
      return invoke<AppConfig>("get_settings");
    }
    return mockConfig();
  },

  async saveSettings(config: AppConfig): Promise<AppConfig> {
    if (isTauri()) {
      return invoke<AppConfig>("save_settings", { config });
    }
    return config;
  },

  async restoreDefaultPaths(): Promise<AppConfig> {
    if (isTauri()) {
      return invoke<AppConfig>("restore_default_paths");
    }
    return mockConfig();
  },

  async computeForecast(
    filter: FilterState,
    method: ForecastMethod,
    horizonDays: number,
    metric: "cost" | "tokens"
  ): Promise<ForecastResult> {
    if (isTauri()) {
      return invoke<ForecastResult>("compute_forecast", {
        filter,
        method,
        horizonDays,
        metric,
      });
    }
    return mockForecast(method, horizonDays, metric);
  },

  async exportCsv(filter: FilterState, targetPath?: string): Promise<ExportResult> {
    if (isTauri()) {
      return invoke<ExportResult>("export_csv", { filter, targetPath });
    }
    return { path: "antigravity-usage-export.csv", rowCount: 120 };
  },

  async copySummary(filter: FilterState): Promise<string> {
    if (isTauri()) {
      return invoke<string>("copy_summary", { filter });
    }
    return "From 17 Oct to 15 Nov you used 307.7M tokens across 3 projects (88% cached). At Gemini 3.8 Flash prices that's about ≈ ₹4,707.";
  },

  async openInExplorer(path: string): Promise<void> {
    if (isTauri()) {
      return invoke<void>("open_in_explorer", { path });
    }
    console.info("[browser dev] openInExplorer:", path);
  },

  async clearSnapshots(): Promise<number> {
    if (isTauri()) {
      return invoke<number>("clear_snapshots");
    }
    return 0;
  },

  async getAboutInfo(): Promise<AboutInfo> {
    if (isTauri()) {
      return invoke<AboutInfo>("get_about_info");
    }
    return {
      appVersion: "0.1.0",
      buildDate: "2026-11-15",
      antigravityAppVersion: "44.9.1",
      antigravityCliVersion: "1.5.4",
      configPath: "config/config.json",
      dbPath: "data/snapshots.db",
    };
  },

  async exportDiagnosticsJson(targetPath?: string): Promise<ExportResult> {
    if (isTauri()) {
      return invoke<ExportResult>("export_diagnostics_json", { targetPath });
    }
    return { path: "diagnostics.json", rowCount: 2 };
  },
};

// ---------------------------------------------------------------------------
// Browser-only dev fallback (never used inside Tauri desktop app)
// ---------------------------------------------------------------------------

function mockConfig(): AppConfig {
  return {
    appBrainRoot: "~/.gemini/antigravity/brain",
    appEnabled: true,
    readAppSqlite: true,
    cliBrainRoot: "~/.gemini/antigravity-cli/brain",
    cliEnabled: true,
    customSources: [],
    dbPath: "data/snapshots.db",
    pricingPath: null,
    defaultModelId: "gemini-3.8-flash",
    reportingCurrency: "INR",
    fx: { usdInr: 88.0 },
    subscription: { amount: 0, currency: "INR", periodDays: 30, label: "Google AI Pro" },
    display: {
      theme: "light",
      density: "comfortable",
      numberFormat: "compact",
      weekStart: "monday",
      reducedMotion: "system",
    },
    refresh: { intervalMinutes: 5, fileWatcherEnabled: true },
  };
}

function mockDiagnostics(): ScanDiagnostics {
  return {
    scannedAt: "2026-11-15T14:55:00Z",
    scannedAtLocalHm: "20:25",
    durationMs: 1420,
    sources: [
      {
        source: { kind: "app" },
        label: "Antigravity App",
        rootPath: "~/.gemini/antigravity/brain",
        exists: true,
        enabled: true,
        transcriptFilesFound: 8,
        sessionsWithTokens: 6,
        sessionsWithoutTokens: 2,
        pbOnlyStems: ["3163d2d4", "7a90e112"],
        parseErrors: 0,
        corruptedToolNamesDropped: 0,
        cappedStepGaps: 0,
        minDate: "2026-10-28",
        maxDate: "2026-11-15",
        freshIn: 2_680_000,
        cached: 15_720_000,
        output: 116_900,
        total: 18_516_900,
        metadataSource: "conversation_summaries.db (read-only)",
        titlesMatched: 5,
        projectsMatched: 6,
        warnings: [],
      },
      {
        source: { kind: "cli" },
        label: "Antigravity CLI",
        rootPath: "~/.gemini/antigravity-cli/brain",
        exists: true,
        enabled: true,
        transcriptFilesFound: 228,
        sessionsWithTokens: 114,
        sessionsWithoutTokens: 114,
        pbOnlyStems: [],
        parseErrors: 0,
        corruptedToolNamesDropped: 1,
        cappedStepGaps: 0,
        minDate: "2026-10-17",
        maxDate: "2026-10-24",
        freshIn: 25_620_000,
        cached: 260_590_000,
        output: 2_960_000,
        total: 289_170_000,
        metadataSource: "history.jsonl",
        titlesMatched: 110,
        projectsMatched: 110,
        warnings: [],
      },
    ],
    totalTranscripts: 236,
    totalWithTokens: 120,
    totalWithoutTokens: 116,
    totalParseErrors: 0,
    totalPbOnly: 2,
    totalCorruptedToolNamesDropped: 1,
    totalCappedStepGaps: 0,
    consistency: {
      ok: true,
      sessionRowMismatches: 0,
      dailyRowMismatches: 0,
      sessionTotal: 307_686_900,
      dailyTotal: 307_686_900,
      discrepancy: 0,
      message: "All session and daily totals match.",
    },
    snapshotRuns: 4,
    warnings: [],
  };
}

function mockDashboard(filter: FilterState): DashboardPayload {
  const mult = filter.currency === "USD" ? 1 : 88;
  const catalog = [
    {
      modelId: "gemini-3.8-flash",
      name: "Gemini 3.8 Flash",
      vendor: "Google",
      latestInputUsd: 0.75,
      latestCachedUsd: 0.075,
      latestOutputUsd: 3.75,
      effectiveFrom: "2026-10-01",
      effectiveUntil: "2026-12-31",
      verified: true,
      source: "Google AI Pricing",
    },
    {
      modelId: "gemini-3.5-flash-lite",
      name: "Gemini 3.5 Flash-Lite",
      vendor: "Google",
      latestInputUsd: 0.25,
      latestCachedUsd: 0.025,
      latestOutputUsd: 1.25,
      effectiveFrom: "2026-09-01",
      effectiveUntil: null,
      verified: true,
      source: "Google AI Pricing",
    },
    {
      modelId: "gemini-3.8-pro",
      name: "Gemini 3.8 Pro",
      vendor: "Google",
      latestInputUsd: 1.75,
      latestCachedUsd: 0.175,
      latestOutputUsd: 10.5,
      effectiveFrom: "2026-10-01",
      effectiveUntil: null,
      verified: false,
      source: "Estimated",
    },
    {
      modelId: "claude-opus-5.5",
      name: "Claude Opus 5.5",
      vendor: "Anthropic",
      latestInputUsd: 5.0,
      latestCachedUsd: 0.5,
      latestOutputUsd: 25.0,
      effectiveFrom: "2026-09-01",
      effectiveUntil: null,
      verified: true,
      source: "Anthropic Pricing",
    },
  ];
  const activeModel = catalog.find((m) => m.modelId === filter.modelId) ?? catalog[0];

  const dates = [
    "2026-10-17","2026-10-18","2026-10-19","2026-10-20","2026-10-21","2026-10-22","2026-10-23","2026-10-24",
    "2026-10-25","2026-10-26","2026-10-27",
    "2026-10-28","2026-10-29","2026-10-30","2026-10-31","2026-11-01","2026-11-02","2026-11-03","2026-11-04",
    "2026-11-05","2026-11-06","2026-11-07","2026-11-08","2026-11-09","2026-11-10","2026-11-11","2026-11-12",
    "2026-11-13","2026-11-14","2026-11-15",
  ];
  const daily = dates.map((d, idx) => {
    if (idx <= 7) {
      const cliTot = 26_000_000 + ((idx * 7) % 18) * 1_000_000;
      const fresh = Math.round(cliTot * 0.088);
      const cached = Math.round(cliTot * 0.901);
      const output = cliTot - fresh - cached;
      return {
        date: d,
        calls: 120 + idx * 14,
        sessions: 14,
        appSessions: 0,
        cliSessions: 14,
        freshIn: fresh,
        cached,
        output,
        total: cliTot,
        appFreshIn: 0,
        appCached: 0,
        appOutput: 0,
        appTotal: 0,
        cliFreshIn: fresh,
        cliCached: cached,
        cliOutput: output,
        cliTotal: cliTot,
        costUsd: 6.2,
        costCurrency: 6.2 * mult,
        isDateEstimate: false,
      };
    }
    if (idx <= 10) {
      return {
        date: d, calls: 0, sessions: 0, appSessions: 0, cliSessions: 0,
        freshIn: 0, cached: 0, output: 0, total: 0,
        appFreshIn: 0, appCached: 0, appOutput: 0, appTotal: 0,
        cliFreshIn: 0, cliCached: 0, cliOutput: 0, cliTotal: 0,
        costUsd: 0, costCurrency: 0, isDateEstimate: false,
      };
    }
    const activeApp = idx === 11 || idx === 16 || idx === 22 || idx === 27 || idx === 29;
    const appTot = activeApp ? 3_700_000 : 0;
    const fresh = Math.round(appTot * 0.145);
    const cached = Math.round(appTot * 0.848);
    const output = appTot - fresh - cached;
    return {
      date: d,
      calls: activeApp ? 34 : 0,
      sessions: activeApp ? 1 : 0,
      appSessions: activeApp ? 1 : 0,
      cliSessions: 0,
      freshIn: fresh,
      cached,
      output,
      total: appTot,
      appFreshIn: fresh,
      appCached: cached,
      appOutput: output,
      appTotal: appTot,
      cliFreshIn: 0, cliCached: 0, cliOutput: 0, cliTotal: 0,
      costUsd: activeApp ? 0.72 : 0,
      costCurrency: (activeApp ? 0.72 : 0) * mult,
      isDateEstimate: false,
    };
  });

  const sessions = [
    {
      sessionId: "8f2c91a4-7b3e-4c12-901a-1234567890ab",
      shortId: "8f2c91a4",
      source: { kind: "cli" as const },
      kind: "main" as const,
      title: "Refactor pricing catalog",
      isUntitled: false,
      labelSource: "history.jsonl",
      project: "AntigravityUsageDashboard",
      workspace: "D:\\Code\\AntigravityUsageDashboard",
      parentId: null,
      agentType: null,
      role: null,
      firstUtc: "2026-10-24T08:42:00Z",
      lastUtc: "2026-10-24T09:54:00Z",
      firstLocalDate: "2026-10-24",
      durationSecs: 4320,
      calls: 84,
      stepCount: 84,
      freshIn: 1_420_000,
      cached: 12_800_000,
      output: 184_200,
      total: 14_404_200,
      costUsd: 2.54,
      costCurrency: 2.54 * mult,
      cacheHitRate: 90.0,
      toolNames: ["read_file", "edit_file", "run_command"],
      childIds: ["sub-1", "sub-2"],
    },
    {
      sessionId: "sub-1",
      shortId: "a19b2c3d",
      source: { kind: "cli" as const },
      kind: "subagent" as const,
      title: "Audit currency rounding rules",
      isUntitled: false,
      labelSource: "subagent.json",
      project: "AntigravityUsageDashboard",
      workspace: "D:\\Code\\AntigravityUsageDashboard",
      parentId: "8f2c91a4-7b3e-4c12-901a-1234567890ab",
      agentType: "researcher",
      role: "Pricing audit",
      firstUtc: "2026-10-24T08:45:00Z",
      lastUtc: "2026-10-24T08:57:00Z",
      firstLocalDate: "2026-10-24",
      durationSecs: 720,
      calls: 18,
      stepCount: 18,
      freshIn: 210_400,
      cached: 2_150_000,
      output: 24_100,
      total: 2_384_500,
      costUsd: 0.4,
      costCurrency: 0.4 * mult,
      cacheHitRate: 91.1,
      toolNames: ["read_file"],
      childIds: [],
    },
    {
      sessionId: "app-1",
      shortId: "4d5e6f7a",
      source: { kind: "app" as const },
      kind: "main" as const,
      title: "Rust Windows App UI Design",
      isUntitled: false,
      labelSource: "conversation_summaries.db",
      project: "AntigravityUsageDashboard",
      workspace: "D:\\Code\\AntigravityUsageDashboard",
      parentId: null,
      agentType: null,
      role: null,
      firstUtc: "2026-11-15T15:17:00Z",
      lastUtc: "2026-11-15T15:55:00Z",
      firstLocalDate: "2026-11-15",
      durationSecs: 2280,
      calls: 42,
      stepCount: 42,
      freshIn: 640_500,
      cached: 4_120_000,
      output: 38_400,
      total: 4_798_900,
      costUsd: 1.07,
      costCurrency: 1.07 * mult,
      cacheHitRate: 86.5,
      toolNames: ["read_file", "write_file"],
      childIds: [],
    },
    {
      sessionId: "3163d2d4-0000-0000-0000-000000000000",
      shortId: "3163d2d4",
      source: { kind: "cli" as const },
      kind: "main" as const,
      title: "Untitled session",
      isUntitled: true,
      labelSource: "fallback",
      project: "Unattributed",
      workspace: "",
      parentId: null,
      agentType: null,
      role: null,
      firstUtc: "2026-10-21T05:50:00Z",
      lastUtc: "2026-10-21T06:19:00Z",
      firstLocalDate: "2026-10-21",
      durationSecs: 1740,
      calls: 33,
      stepCount: 33,
      freshIn: 412_000,
      cached: 3_850_000,
      output: 49_200,
      total: 4_311_200,
      costUsd: 0.77,
      costCurrency: 0.77 * mult,
      cacheHitRate: 90.3,
      toolNames: ["run_command"],
      childIds: [],
    },
  ];

  return {
    filter,
    activeModel,
    catalog,
    allEntries: catalog.map((c) => ({
      modelId: c.modelId,
      name: c.name,
      vendor: c.vendor,
      effectiveFrom: c.effectiveFrom,
      effectiveUntil: c.effectiveUntil,
      inputUsd: c.latestInputUsd,
      cachedUsd: c.latestCachedUsd,
      outputUsd: c.latestOutputUsd,
      source: c.source,
      verified: c.verified,
    })),
    allProjects: ["AntigravityUsageDashboard", "SLMRetraining", "Learning", "Unattributed"],
    totals: {
      freshIn: 28_300_000,
      cached: 276_310_000,
      output: 3_080_000,
      total: 307_690_000,
      calls: 3200,
      sessions: 120,
      cacheHitRate: 90.7,
      freshShare: 9.2,
      cachedShare: 89.8,
      outputShare: 1.0,
    },
    cliTotals: {
      freshIn: 25_620_000,
      cached: 260_590_000,
      output: 2_960_000,
      total: 289_170_000,
      calls: 2950,
      sessions: 114,
      cacheHitRate: 91.0,
      freshShare: 8.9,
      cachedShare: 90.1,
      outputShare: 1.0,
    },
    appTotals: {
      freshIn: 2_680_000,
      cached: 15_720_000,
      output: 116_900,
      total: 18_516_900,
      calls: 250,
      sessions: 6,
      cacheHitRate: 85.4,
      freshShare: 14.5,
      cachedShare: 84.9,
      outputShare: 0.6,
    },
    cost: {
      freshUsd: 21.23,
      cachedUsd: 20.72,
      outputUsd: 11.54,
      totalUsd: 53.49,
      freshCurrency: 21.23 * mult,
      cachedCurrency: 20.72 * mult,
      outputCurrency: 11.54 * mult,
      totalCurrency: 53.49 * mult,
      freshShare: 39.7,
      cachedShare: 38.7,
      outputShare: 21.6,
      currency: filter.currency,
      usdInr: 88,
      hasDateEstimates: false,
      dateEstimateWarning: null,
    },
    cliCost: {
      freshUsd: 19.22,
      cachedUsd: 19.54,
      outputUsd: 11.1,
      totalUsd: 49.86,
      freshCurrency: 19.22 * mult,
      cachedCurrency: 19.54 * mult,
      outputCurrency: 11.1 * mult,
      totalCurrency: 49.86 * mult,
      freshShare: 38.5,
      cachedShare: 39.2,
      outputShare: 22.3,
      currency: filter.currency,
      usdInr: 88,
      hasDateEstimates: false,
      dateEstimateWarning: null,
    },
    appCost: {
      freshUsd: 2.01,
      cachedUsd: 1.18,
      outputUsd: 0.44,
      totalUsd: 3.63,
      freshCurrency: 2.01 * mult,
      cachedCurrency: 1.18 * mult,
      outputCurrency: 0.44 * mult,
      totalCurrency: 3.63 * mult,
      freshShare: 55.4,
      cachedShare: 32.5,
      outputShare: 12.1,
      currency: filter.currency,
      usdInr: 88,
      hasDateEstimates: false,
      dateEstimateWarning: null,
    },
    daily,
    sessions,
    projects: [
      {
        project: "AntigravityUsageDashboard",
        workspace: "D:\\Code\\AntigravityUsageDashboard",
        isUnattributed: false,
        sessionCount: 48,
        appSessions: 6,
        cliSessions: 42,
        freshIn: 14_800_000,
        cached: 137_200_000,
        output: 2_200_000,
        total: 154_200_000,
        appTotal: 18_516_900,
        cliTotal: 135_683_100,
        costUsd: 27.39,
        costCurrency: 27.39 * mult,
        appCostCurrency: 3.63 * mult,
        cliCostCurrency: 23.76 * mult,
        dailyTotals: [12e6, 18e6, 22e6, 15e6, 19e6, 8e6, 4e6],
      },
      {
        project: "SLMRetraining",
        workspace: "D:\\Code\\SLMRetraining",
        isUnattributed: false,
        sessionCount: 36,
        appSessions: 0,
        cliSessions: 36,
        freshIn: 8_100_000,
        cached: 75_200_000,
        output: 800_000,
        total: 84_100_000,
        appTotal: 0,
        cliTotal: 84_100_000,
        costUsd: 14.32,
        costCurrency: 14.32 * mult,
        appCostCurrency: 0,
        cliCostCurrency: 14.32 * mult,
        dailyTotals: [8e6, 12e6, 10e6, 6e6],
      },
      {
        project: "Unattributed",
        workspace: "",
        isUnattributed: true,
        sessionCount: 4,
        appSessions: 0,
        cliSessions: 4,
        freshIn: 800_000,
        cached: 8_200_000,
        output: 200_000,
        total: 9_200_000,
        appTotal: 0,
        cliTotal: 9_200_000,
        costUsd: 1.6,
        costCurrency: 1.6 * mult,
        appCostCurrency: 0,
        cliCostCurrency: 1.6 * mult,
        dailyTotals: [2e6, 3e6, 4.2e6],
      },
    ],
    sourceComparison: [
      {
        sourceKey: "app",
        label: "Antigravity App",
        sessions: 6,
        freshIn: 2_680_000,
        cached: 15_720_000,
        output: 116_900,
        total: 18_516_900,
        cacheHitRate: 85.4,
        avgTokensPerSession: 3_086_150,
        minDate: "2026-10-28",
        maxDate: "2026-11-15",
        costUsd: 3.63,
        costCurrency: 3.63 * mult,
      },
      {
        sourceKey: "cli",
        label: "Antigravity CLI",
        sessions: 114,
        freshIn: 25_620_000,
        cached: 260_590_000,
        output: 2_960_000,
        total: 289_170_000,
        cacheHitRate: 91.0,
        avgTokensPerSession: 2_536_578,
        minDate: "2026-10-17",
        maxDate: "2026-10-24",
        costUsd: 49.86,
        costCurrency: 49.86 * mult,
      },
    ],
    benchmark: catalog.map((c) => {
      const costUsd =
        (28.3 * c.latestInputUsd + 276.31 * c.latestCachedUsd + 3.08 * c.latestOutputUsd);
      return {
        modelId: c.modelId,
        name: c.name,
        vendor: c.vendor,
        inputUsd: c.latestInputUsd,
        cachedUsd: c.latestCachedUsd,
        outputUsd: c.latestOutputUsd,
        verified: c.verified,
        isCurrent: c.modelId === activeModel.modelId,
        costUsd,
        costCurrency: costUsd * mult,
        ratioToCheapest: costUsd / 17.83,
        relativeBar: Math.min(1, costUsd / 356.0),
      };
    }),
    subscriptionComparison: {
      configured: false,
      planAmount: 0,
      planCurrency: filter.currency,
      periodDays: 30,
      planLabel: "Google AI Pro",
      apiCostCurrency: 53.49 * mult,
      tokensPerUnit: 0,
    },
    activeDays: 13,
    observedDays: 30,
    minDate: "2026-10-17",
    maxDate: "2026-11-15",
    diagnostics: mockDiagnostics(),
  };
}

function mockSessionDetail(sessionId: string, currency: "INR" | "USD"): SessionDetailPayload {
  const dash = mockDashboard({
    datePreset: "all",
    customStart: null,
    customEnd: null,
    sourceFilter: "all",
    projectFilter: null,
    modelId: "gemini-3.8-flash",
    currency,
  });
  const summary = dash.sessions.find((s) => s.sessionId === sessionId) ?? dash.sessions[0];
  return {
    summary,
    parentTitle: null,
    thinkingSteps: 14,
    errorSteps: 1,
    toolCallCount: 28,
    transcriptPath: "~/.gemini/antigravity-cli/brain/8f2c91a4/.system_generated/logs/transcript.jsonl",
    metadataSource: "history.jsonl",
    topSpikeSteps: [14],
    topSpikeShare: 71,
    steps: [
      {
        stepIndex: 12,
        createdAt: "2026-10-24T08:48:04Z",
        localDate: "2026-10-24",
        localTime: "14:18:04",
        stepType: "tool",
        source: "MODEL",
        status: "DONE",
        freshIn: 12_400,
        cached: 98_200,
        output: 1_100,
        total: 111_700,
        hasTokens: true,
        thinkingPreview: "Checking currency conversion rounding rules in pricing.rs...",
        thinkingFull: "Checking currency conversion rounding rules in pricing.rs before refactoring the catalog loader.",
        contentPreview: "read_file src/pricing.rs",
        toolCalls: [{ name: "read_file", serverName: null, commandLine: null, toolSummary: null }],
        isError: false,
        permissionDenied: false,
        modelSwitch: null,
        commandDurationSecs: null,
        commandExitCode: null,
        costUsd: 0.02,
        costCurrency: currency === "USD" ? 0.02 : 1.76,
        cumulativeFreshIn: 12_400,
        cumulativeCached: 98_200,
        cumulativeOutput: 1_100,
        cumulativeTotal: 111_700,
      },
      {
        stepIndex: 14,
        createdAt: "2026-10-24T08:50:19Z",
        localDate: "2026-10-24",
        localTime: "14:20:19",
        stepType: "error",
        source: "MODEL",
        status: "ERROR",
        freshIn: 380_000,
        cached: 1_120_000,
        output: 14_200,
        total: 1_514_200,
        hasTokens: true,
        thinkingPreview: null,
        thinkingFull: null,
        contentPreview: "cargo test failed on pricing_test",
        toolCalls: [{ name: "run_command", serverName: null, commandLine: "cargo test", toolSummary: "Run unit tests" }],
        isError: true,
        permissionDenied: false,
        modelSwitch: null,
        commandDurationSecs: 4.2,
        commandExitCode: 101,
        costUsd: 0.42,
        costCurrency: currency === "USD" ? 0.42 : 36.96,
        cumulativeFreshIn: 392_400,
        cumulativeCached: 1_218_200,
        cumulativeOutput: 15_300,
        cumulativeTotal: 1_625_900,
      },
    ],
    toolStats: [
      { name: "read_file", callCount: 16, tokenTotal: 1_820_000 },
      { name: "edit_file", callCount: 8, tokenTotal: 940_000 },
      { name: "run_command", callCount: 4, tokenTotal: 610_000 },
    ],
    mcpStats: [],
    commandExecs: [
      {
        stepIndex: 14,
        commandLine: "cargo test",
        toolSummary: "Run unit tests",
        durationSecs: 4.2,
        exitCode: 101,
        cancelled: false,
      },
    ],
    subagents: dash.sessions.filter((s) => s.parentId === summary.sessionId),
    modelSwitches: [],
    permissionDenials: 0,
  };
}

// ---------------------------------------------------------------------------
// Token usage mock (browser-only dev fallback)
// ---------------------------------------------------------------------------

const MOCK_PROJECTS = ["AntigravityUsageDashboard", "core-api", "docs-site"];
const MOCK_MODELS = ["Gemini 4 Argon", "Claude Sonnet 4", "Gemini 3.8 Flash", "Unrecorded"];
const MOCK_AGENT_TYPES = ["researcher", "implementer"];

const MONTHS_SHORT = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

// Fixed "now" so browser dev mode renders the same window on every reload.
const MOCK_NOW = new Date(2026, 10, 22, 17, 0, 0);
const HOUR_MS = 3_600_000;

type MockAgentKind = "main" | "researcher" | "implementer";

interface MockBucket {
  key: string;
  axisLabel: string;
  rangeLabel: string;
  startMs: number;
}

interface MockUsageCell {
  bucketIndex: number;
  project: string;
  model: string;
  agentKind: MockAgentKind;
  freshIn: number;
  cached: number;
  output: number;
  calls: number;
  sessions: number;
  wallTimeSecs: number;
}

interface MockAccumulator {
  freshIn: number;
  cached: number;
  output: number;
  calls: number;
  sessions: number;
  wallTimeSecs: number;
}

const MOCK_BUCKET_BASE: Record<TimeGranularity, number> = {
  hourly: 390_000,
  daily: 9_400_000,
  weekly: 65_000_000,
  monthly: 285_000_000,
};

const MOCK_PROJECT_SHARE = [0.62, 0.28, 0.1];
const MOCK_MODEL_SHARE = [0.46, 0.27, 0.21, 0.06];
const MOCK_AGENT_SHARE: Array<[MockAgentKind, number]> = [
  ["main", 0.78],
  ["researcher", 0.14],
  ["implementer", 0.08],
];

const MOCK_HOUR_FACTOR = [
  0.18, 0.12, 0.09, 0.08, 0.12, 0.22, 0.36, 0.55, 0.78, 1.0, 1.12, 1.18,
  1.02, 1.08, 1.2, 1.14, 1.0, 0.9, 0.72, 0.6, 0.5, 0.42, 0.32, 0.24,
];

function pad2(value: number): string {
  return value.toString().padStart(2, "0");
}

function shortMonthDay(date: Date): string {
  return `${MONTHS_SHORT[date.getMonth()]} ${date.getDate()}`;
}

function shortMonthDayYear(date: Date): string {
  return `${shortMonthDay(date)}, ${date.getFullYear()}`;
}

function shortMonthDayHour(date: Date): string {
  return `${shortMonthDay(date)}, ${pad2(date.getHours())}:00`;
}

function isoDateKey(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`;
}

function mockGranularity(period: TimePeriod): TimeGranularity {
  switch (period) {
    case "1d":
      return "hourly";
    case "1w":
    case "1m":
      return "daily";
    case "6m":
      return "weekly";
    case "lifetime":
      return "monthly";
  }
}

function mockBuckets(period: TimePeriod): {
  buckets: MockBucket[];
  windowStart: string;
  windowEnd: string;
} {
  if (period === "1d") {
    const buckets: MockBucket[] = [];
    for (let index = 0; index < 24; index++) {
      const start = new Date(
        MOCK_NOW.getFullYear(),
        MOCK_NOW.getMonth(),
        MOCK_NOW.getDate(),
        MOCK_NOW.getHours() - (23 - index)
      );
      const end = new Date(start.getTime() + HOUR_MS);
      buckets.push({
        key: `${isoDateKey(start)}T${pad2(start.getHours())}:00`,
        axisLabel: `${pad2(start.getHours())}:00`,
        rangeLabel: `${shortMonthDay(start)}, ${pad2(start.getHours())}:00–${pad2(end.getHours())}:00`,
        startMs: start.getTime(),
      });
    }
    return {
      buckets,
      windowStart: shortMonthDayHour(new Date(buckets[0].startMs)),
      windowEnd: shortMonthDayHour(MOCK_NOW),
    };
  }

  if (period === "1w" || period === "1m") {
    const dayCount = period === "1w" ? 7 : 30;
    const buckets: MockBucket[] = [];
    for (let index = 0; index < dayCount; index++) {
      const day = new Date(
        MOCK_NOW.getFullYear(),
        MOCK_NOW.getMonth(),
        MOCK_NOW.getDate() - (dayCount - 1 - index)
      );
      buckets.push({
        key: isoDateKey(day),
        axisLabel: shortMonthDay(day),
        rangeLabel: shortMonthDayYear(day),
        startMs: day.getTime(),
      });
    }
    return {
      buckets,
      windowStart: shortMonthDayYear(new Date(buckets[0].startMs)),
      windowEnd: shortMonthDayYear(new Date(buckets[buckets.length - 1].startMs)),
    };
  }

  if (period === "6m") {
    const currentWeekMonday = new Date(
      MOCK_NOW.getFullYear(),
      MOCK_NOW.getMonth(),
      MOCK_NOW.getDate() - ((MOCK_NOW.getDay() + 6) % 7)
    );
    const buckets: MockBucket[] = [];
    for (let index = 0; index < 26; index++) {
      const start = new Date(
        currentWeekMonday.getFullYear(),
        currentWeekMonday.getMonth(),
        currentWeekMonday.getDate() - (25 - index) * 7
      );
      const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 6);
      const rangeLabel =
        start.getMonth() === end.getMonth()
          ? `${shortMonthDay(start)}–${end.getDate()}, ${end.getFullYear()}`
          : `${shortMonthDay(start)}–${shortMonthDay(end)}, ${end.getFullYear()}`;
      buckets.push({
        key: isoDateKey(start),
        axisLabel: shortMonthDay(start),
        rangeLabel,
        startMs: start.getTime(),
      });
    }
    return {
      buckets,
      windowStart: shortMonthDayYear(new Date(buckets[0].startMs)),
      windowEnd: shortMonthDayYear(MOCK_NOW),
    };
  }

  const buckets: MockBucket[] = [];
  for (let index = 0; index < 6; index++) {
    const start = new Date(MOCK_NOW.getFullYear(), MOCK_NOW.getMonth() - (5 - index), 1);
    buckets.push({
      key: `${start.getFullYear()}-${pad2(start.getMonth() + 1)}`,
      axisLabel: `${MONTHS_SHORT[start.getMonth()]} '${pad2(start.getFullYear() % 100)}`,
      rangeLabel: `${MONTHS_SHORT[start.getMonth()]} ${start.getFullYear()}`,
      startMs: start.getTime(),
    });
  }
  return {
    buckets,
    windowStart: buckets[0].rangeLabel,
    windowEnd: buckets[buckets.length - 1].rangeLabel,
  };
}

function mockNoise(seed: number): number {
  const value = Math.sin(seed * 127.1 + 311.7) * 43758.5453;
  return value - Math.floor(value);
}

function mockBucketVolume(
  granularity: TimeGranularity,
  bucket: MockBucket,
  index: number
): number {
  const base = MOCK_BUCKET_BASE[granularity];
  let shape = 0.62 + 0.76 * mockNoise(index * 3.71 + base / 12_500);

  if (granularity === "hourly") {
    shape *= MOCK_HOUR_FACTOR[new Date(bucket.startMs).getHours()];
  }
  if (granularity === "daily") {
    const weekday = new Date(bucket.startMs).getDay();
    if (weekday === 0 || weekday === 6) {
      shape *= 0.45;
    }
  }
  if (granularity === "monthly") {
    // Later months of the observation window were busier.
    shape *= 0.82 + index * 0.07;
  }
  return base * shape;
}

function mockUsageCells(buckets: MockBucket[], granularity: TimeGranularity): MockUsageCell[] {
  const cells: MockUsageCell[] = [];

  buckets.forEach((bucket, bucketIndex) => {
    const bucketVolume = mockBucketVolume(granularity, bucket, bucketIndex);
    const parts: Array<{ project: number; model: number; agent: number; weight: number }> = [];
    let weightSum = 0;

    for (let project = 0; project < MOCK_PROJECTS.length; project++) {
      for (let model = 0; model < MOCK_MODELS.length; model++) {
        for (let agent = 0; agent < MOCK_AGENT_SHARE.length; agent++) {
          const jitter = 0.72 + 0.56 * mockNoise(bucketIndex * 53 + project * 17 + model * 7 + agent * 3 + 1);
          const weight =
            MOCK_PROJECT_SHARE[project] * MOCK_MODEL_SHARE[model] * MOCK_AGENT_SHARE[agent][1] * jitter;
          parts.push({ project, model, agent, weight });
          weightSum += weight;
        }
      }
    }

    for (const part of parts) {
      const cellTotal = (bucketVolume * part.weight) / weightSum;
      const seed = bucketIndex * 97 + part.project * 31 + part.model * 13 + part.agent * 5;
      const cachedRaw = 0.85 + 0.09 * mockNoise(seed + 2);
      const freshRaw = 0.09 + 0.05 * mockNoise(seed + 4);
      const outputRaw = 0.03 + 0.02 * mockNoise(seed + 6);
      const rawSum = cachedRaw + freshRaw + outputRaw;
      const freshIn = Math.round((cellTotal * freshRaw) / rawSum);
      const cached = Math.round((cellTotal * cachedRaw) / rawSum);
      const output = Math.max(0, Math.round(cellTotal) - freshIn - cached);
      const calls = cellTotal / 11_500;

      cells.push({
        bucketIndex,
        project: MOCK_PROJECTS[part.project],
        model: MOCK_MODELS[part.model],
        agentKind: MOCK_AGENT_SHARE[part.agent][0],
        freshIn,
        cached,
        output,
        calls,
        sessions: calls / 24,
        wallTimeSecs: calls * 6.5,
      });
    }
  });

  return cells;
}

function mockMatchesAgent(
  agentKind: MockAgentKind,
  filter: TokenUsageFilter["agent"]
): boolean {
  switch (filter.kind) {
    case "all":
      return true;
    case "mainOnly":
      return agentKind === "main";
    case "subagentsOnly":
      return agentKind !== "main";
    case "agentType":
      return agentKind === filter.agentType;
  }
}

function mockEmptyAccumulator(): MockAccumulator {
  return { freshIn: 0, cached: 0, output: 0, calls: 0, sessions: 0, wallTimeSecs: 0 };
}

function mockAccumulate(target: MockAccumulator, cell: MockUsageCell): void {
  target.freshIn += cell.freshIn;
  target.cached += cell.cached;
  target.output += cell.output;
  target.calls += cell.calls;
  target.sessions += cell.sessions;
  target.wallTimeSecs += cell.wallTimeSecs;
}

function mockRoundedTotals(accumulator: MockAccumulator): TokenUsageTotals {
  const freshIn = Math.round(accumulator.freshIn);
  const cached = Math.round(accumulator.cached);
  const output = Math.round(accumulator.output);
  const inputTotal = freshIn + cached;
  return {
    freshIn,
    cached,
    output,
    total: freshIn + cached + output,
    cacheHitRate: inputTotal > 0 ? cached / inputTotal : 0,
    wallTimeSecs: Math.round(accumulator.wallTimeSecs),
    calls: Math.round(accumulator.calls),
    sessions: Math.round(accumulator.sessions),
  };
}

function mockTokenUsage(filter: TokenUsageFilter): TokenUsagePayload {
  const granularity = mockGranularity(filter.period);
  const { buckets, windowStart, windowEnd } = mockBuckets(filter.period);
  const cells = mockUsageCells(buckets, granularity).filter(
    (cell) =>
      (filter.project === null || cell.project === filter.project) &&
      mockMatchesAgent(cell.agentKind, filter.agent)
  );

  // Totals and the time series honour all four filters, including the model.
  const totalsAccumulator = mockEmptyAccumulator();
  const bucketAccumulators = buckets.map(() => mockEmptyAccumulator());
  for (const cell of cells) {
    if (filter.model !== null && cell.model !== filter.model) {
      continue;
    }
    mockAccumulate(totalsAccumulator, cell);
    mockAccumulate(bucketAccumulators[cell.bucketIndex], cell);
  }

  const timeSeries: TimeUsageBucket[] = buckets.map((bucket, index) => {
    const accumulator = bucketAccumulators[index];
    const freshIn = Math.round(accumulator.freshIn);
    const cached = Math.round(accumulator.cached);
    const output = Math.round(accumulator.output);
    return {
      key: bucket.key,
      axisLabel: bucket.axisLabel,
      rangeLabel: bucket.rangeLabel,
      freshIn,
      cached,
      output,
      total: freshIn + cached + output,
    };
  });

  // The by-model table deliberately ignores filter.model so selecting a row
  // highlights it instead of collapsing the table to a single entry.
  const modelAccumulators = new Map<string, MockAccumulator>();
  for (const cell of cells) {
    const accumulator = modelAccumulators.get(cell.model) ?? mockEmptyAccumulator();
    mockAccumulate(accumulator, cell);
    modelAccumulators.set(cell.model, accumulator);
  }

  const byModel: ModelUsageRow[] = Array.from(modelAccumulators, ([model, accumulator]) => {
    const totals = mockRoundedTotals(accumulator);
    return {
      model,
      freshIn: totals.freshIn,
      cached: totals.cached,
      output: totals.output,
      total: totals.total,
      cacheHitRate: totals.cacheHitRate,
      wallTimeSecs: totals.wallTimeSecs,
      calls: totals.calls,
      sessions: totals.sessions,
    };
  }).sort((left, right) => right.total - left.total);

  return {
    filter,
    windowStart,
    windowEnd,
    granularity,
    availableProjects: [...MOCK_PROJECTS],
    availableModels: [...MOCK_MODELS],
    availableAgentTypes: [...MOCK_AGENT_TYPES],
    totals: mockRoundedTotals(totalsAccumulator),
    timeSeries,
    byModel,
  };
}

function mockForecast(method: ForecastMethod, horizonDays: number, metric: "cost" | "tokens"): ForecastResult {
  return {
    supported: false,
    activeDays: 13,
    minRequiredDays: 14,
    observedDays: 30,
    maxHorizonDays: 60,
    horizonDays,
    method,
    methodLabel: method,
    metric,
    observedMean: 0,
    cumulativeLow: 0,
    cumulativeMedian: 0,
    cumulativeHigh: 0,
    assumptions: "Forecasts require at least 14 active days.",
    notes: [],
    points: [],
  };
}
