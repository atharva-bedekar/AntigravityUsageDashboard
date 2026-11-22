export type SourceKind =
  | { kind: "app" }
  | { kind: "cli" }
  | { kind: "custom"; name: string };

export type SessionKind = "main" | "subagent" | "unknown";

export interface ToolCallRecord {
  name: string;
  serverName: string | null;
  commandLine: string | null;
  toolSummary: string | null;
}

export interface ModelSwitchRecord {
  stepIndex: number;
  fromModel: string;
  toModel: string;
}

export interface CommandExecRecord {
  stepIndex: number;
  commandLine: string;
  toolSummary: string | null;
  durationSecs: number | null;
  exitCode: number | null;
  cancelled: boolean;
}

export interface StepRecord {
  stepIndex: number;
  createdAt: string | null;
  localDate: string | null;
  localTime: string | null;
  stepType: string;
  source: string;
  status: string;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  hasTokens: boolean;
  thinkingPreview: string | null;
  thinkingFull: string | null;
  contentPreview: string | null;
  toolCalls: ToolCallRecord[];
  isError: boolean;
  permissionDenied: boolean;
  modelSwitch: ModelSwitchRecord | null;
  commandDurationSecs: number | null;
  commandExitCode: number | null;
  observedModel?: string;
}

export interface SourceDiagnostics {
  source: SourceKind;
  label: string;
  rootPath: string;
  exists: boolean;
  enabled: boolean;
  transcriptFilesFound: number;
  sessionsWithTokens: number;
  sessionsWithoutTokens: number;
  pbOnlyStems: string[];
  parseErrors: number;
  corruptedToolNamesDropped: number;
  cappedStepGaps: number;
  minDate: string | null;
  maxDate: string | null;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  metadataSource: string;
  titlesMatched: number;
  projectsMatched: number;
  warnings: string[];
}

export interface ConsistencyReport {
  ok: boolean;
  sessionRowMismatches: number;
  dailyRowMismatches: number;
  sessionTotal: number;
  dailyTotal: number;
  discrepancy: number;
  message: string;
}

export interface ScanDiagnostics {
  scannedAt: string;
  scannedAtLocalHm: string;
  durationMs: number;
  sources: SourceDiagnostics[];
  totalTranscripts: number;
  totalWithTokens: number;
  totalWithoutTokens: number;
  totalParseErrors: number;
  totalPbOnly: number;
  totalCorruptedToolNamesDropped: number;
  totalCappedStepGaps: number;
  consistency: ConsistencyReport;
  snapshotRuns: number;
  warnings: string[];
}

export interface CustomSourceConfig {
  name: string;
  path: string;
  enabled: boolean;
}

export interface SubscriptionConfig {
  amount: number;
  currency: string;
  periodDays: number;
  label: string;
}

export interface FxConfig {
  usdInr: number;
}

export interface DisplayConfig {
  theme: "light" | "dark" | "system";
  density: "comfortable" | "compact";
  numberFormat: "compact" | "full";
  weekStart: "monday" | "sunday";
  reducedMotion: "system" | "on" | "off";
}

export interface RefreshConfig {
  intervalMinutes: number;
  fileWatcherEnabled: boolean;
}

export interface AppConfig {
  appBrainRoot: string;
  appEnabled: boolean;
  readAppSqlite: boolean;
  cliBrainRoot: string;
  cliEnabled: boolean;
  customSources: CustomSourceConfig[];
  dbPath: string;
  pricingPath: string | null;
  defaultModelId: string;
  reportingCurrency: "INR" | "USD";
  fx: FxConfig;
  subscription: SubscriptionConfig;
  display: DisplayConfig;
  refresh: RefreshConfig;
}

export interface PriceEntry {
  modelId: string;
  name: string;
  vendor: string;
  effectiveFrom: string;
  effectiveUntil: string | null;
  inputUsd: number;
  cachedUsd: number;
  outputUsd: number;
  source: string;
  verified: boolean;
}

export interface ModelCatalogItem {
  modelId: string;
  name: string;
  vendor: string;
  latestInputUsd: number;
  latestCachedUsd: number;
  latestOutputUsd: number;
  effectiveFrom: string;
  effectiveUntil: string | null;
  verified: boolean;
  source: string;
}

export interface ModelBenchmarkRow {
  modelId: string;
  name: string;
  vendor: string;
  inputUsd: number;
  cachedUsd: number;
  outputUsd: number;
  verified: boolean;
  isCurrent: boolean;
  costUsd: number;
  costCurrency: number;
  ratioToCheapest: number;
  relativeBar: number;
}

export interface FilterState {
  datePreset: "all" | "today" | "7d" | "30d" | "custom";
  customStart: string | null;
  customEnd: string | null;
  sourceFilter: string; // "all" | "app" | "cli" | "custom:<name>"
  projectFilter: string | null;
  modelId: string;
  currency: "INR" | "USD";
}

export interface TokenTotals {
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  calls: number;
  sessions: number;
  cacheHitRate: number;
  freshShare: number;
  cachedShare: number;
  outputShare: number;
}

export interface CostBreakdown {
  freshUsd: number;
  cachedUsd: number;
  outputUsd: number;
  totalUsd: number;
  freshCurrency: number;
  cachedCurrency: number;
  outputCurrency: number;
  totalCurrency: number;
  freshShare: number;
  cachedShare: number;
  outputShare: number;
  currency: "INR" | "USD";
  usdInr: number;
  hasDateEstimates: boolean;
  dateEstimateWarning: string | null;
}

export interface DailyBucket {
  date: string;
  calls: number;
  sessions: number;
  appSessions: number;
  cliSessions: number;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  appFreshIn: number;
  appCached: number;
  appOutput: number;
  appTotal: number;
  cliFreshIn: number;
  cliCached: number;
  cliOutput: number;
  cliTotal: number;
  costUsd: number;
  costCurrency: number;
  isDateEstimate: boolean;
}

export interface SessionSummary {
  sessionId: string;
  shortId: string;
  source: SourceKind;
  kind: SessionKind;
  title: string;
  isUntitled: boolean;
  labelSource: string;
  project: string;
  workspace: string;
  parentId: string | null;
  agentType: string | null;
  role: string | null;
  firstUtc: string | null;
  lastUtc: string | null;
  firstLocalDate: string | null;
  durationSecs: number;
  calls: number;
  stepCount: number;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  costUsd: number;
  costCurrency: number;
  cacheHitRate: number;
  toolNames: string[];
  childIds: string[];
}

export interface ProjectSummary {
  project: string;
  workspace: string;
  isUnattributed: boolean;
  sessionCount: number;
  appSessions: number;
  cliSessions: number;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  appTotal: number;
  cliTotal: number;
  costUsd: number;
  costCurrency: number;
  appCostCurrency: number;
  cliCostCurrency: number;
  dailyTotals: number[];
}

export interface SourceComparisonRow {
  sourceKey: string;
  label: string;
  sessions: number;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  cacheHitRate: number;
  avgTokensPerSession: number;
  minDate: string | null;
  maxDate: string | null;
  costUsd: number;
  costCurrency: number;
}

export interface SubscriptionComparison {
  configured: boolean;
  planAmount: number;
  planCurrency: string;
  periodDays: number;
  planLabel: string;
  apiCostCurrency: number;
  tokensPerUnit: number;
}

export interface DashboardPayload {
  filter: FilterState;
  activeModel: ModelCatalogItem;
  catalog: ModelCatalogItem[];
  allEntries: PriceEntry[];
  allProjects: string[];
  totals: TokenTotals;
  cliTotals: TokenTotals;
  appTotals: TokenTotals;
  cost: CostBreakdown;
  cliCost: CostBreakdown;
  appCost: CostBreakdown;
  daily: DailyBucket[];
  sessions: SessionSummary[];
  projects: ProjectSummary[];
  sourceComparison: SourceComparisonRow[];
  benchmark: ModelBenchmarkRow[];
  subscriptionComparison: SubscriptionComparison;
  activeDays: number;
  observedDays: number;
  minDate: string | null;
  maxDate: string | null;
  diagnostics: ScanDiagnostics;
}

export interface ToolStatRow {
  name: string;
  callCount: number;
  tokenTotal: number;
}

export interface McpStatRow {
  serverName: string;
  callCount: number;
}

export interface StepPricedRow extends StepRecord {
  costUsd: number;
  costCurrency: number;
  cumulativeFreshIn: number;
  cumulativeCached: number;
  cumulativeOutput: number;
  cumulativeTotal: number;
}

export interface SessionDetailPayload {
  summary: SessionSummary;
  parentTitle: string | null;
  thinkingSteps: number;
  errorSteps: number;
  toolCallCount: number;
  transcriptPath: string;
  metadataSource: string;
  topSpikeSteps: number[];
  topSpikeShare: number;
  steps: StepPricedRow[];
  toolStats: ToolStatRow[];
  mcpStats: McpStatRow[];
  commandExecs: CommandExecRecord[];
  subagents: SessionSummary[];
  modelSwitches: ModelSwitchRecord[];
  permissionDenials: number;
}

export type ForecastMethod = "linear" | "bootstrap" | "monteCarlo" | "holt";

export interface ForecastPoint {
  date: string;
  low: number;
  median: number;
  high: number;
}

export interface ForecastResult {
  supported: boolean;
  activeDays: number;
  minRequiredDays: number;
  observedDays: number;
  maxHorizonDays: number;
  horizonDays: number;
  method: ForecastMethod;
  methodLabel: string;
  metric: "cost" | "tokens";
  observedMean: number;
  cumulativeLow: number;
  cumulativeMedian: number;
  cumulativeHigh: number;
  assumptions: string;
  notes: string[];
  points: ForecastPoint[];
}

export interface ExportResult {
  path: string;
  rowCount: number;
}

export interface AboutInfo {
  appVersion: string;
  buildDate: string;
  antigravityAppVersion: string | null;
  antigravityCliVersion: string | null;
  configPath: string;
  dbPath: string;
}

export type ScreenId =
  | "overview"
  | "token-usage"
  | "sessions"
  | "session-detail"
  | "projects"
  | "costs"
  | "data-sources"
  | "settings";

export interface NavHistoryEntry {
  screen: ScreenId;
  sessionId?: string;
}

// ---------------------------------------------------------------------------
// Token usage screen (mirrors Rust camelCase serde types)
// ---------------------------------------------------------------------------

export type TimePeriod = "1d" | "1w" | "1m" | "6m" | "lifetime";

export type TimeGranularity = "hourly" | "daily" | "weekly" | "monthly";

export type AgentFilter =
  | { kind: "all" }
  | { kind: "mainOnly" }
  | { kind: "subagentsOnly" }
  | { kind: "agentType"; agentType: string };

export interface TokenUsageFilter {
  period: TimePeriod;
  project: string | null;
  model: string | null;
  agent: AgentFilter;
}

export interface TokenUsageTotals {
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  cacheHitRate: number;
  wallTimeSecs: number;
  calls: number;
  sessions: number;
}

export interface TimeUsageBucket {
  key: string;
  axisLabel: string;
  rangeLabel: string;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
}

export interface ModelUsageRow {
  model: string;
  freshIn: number;
  cached: number;
  output: number;
  total: number;
  cacheHitRate: number;
  wallTimeSecs: number;
  calls: number;
  sessions: number;
}

export interface TokenUsagePayload {
  filter: TokenUsageFilter;
  windowStart: string | null;
  windowEnd: string;
  granularity: TimeGranularity;
  availableProjects: string[];
  availableModels: string[];
  availableAgentTypes: string[];
  totals: TokenUsageTotals;
  timeSeries: TimeUsageBucket[];
  byModel: ModelUsageRow[];
}
