use serde::{Deserialize, Serialize};

/// Origin of a scanned conversation session.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(tag = "kind", content = "name", rename_all = "camelCase")]
pub enum SourceKind {
    App,
    Cli,
    Custom(String),
}

impl SourceKind {
    /// Short stable identifier used in filters and CSS classes ("app", "cli", or "custom:<name>").
    pub fn key(&self) -> String {
        match self {
            SourceKind::App => "app".to_string(),
            SourceKind::Cli => "cli".to_string(),
            SourceKind::Custom(name) => format!("custom:{name}"),
        }
    }

    /// Human-readable display label.
    pub fn label(&self) -> String {
        match self {
            SourceKind::App => "Antigravity App".to_string(),
            SourceKind::Cli => "Antigravity CLI".to_string(),
            SourceKind::Custom(name) => name.clone(),
        }
    }
}

/// Whether a session is a top-level conversation or a spawned subagent.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionKind {
    Main,
    Subagent,
    Unknown,
}

/// A single sanitized tool invocation extracted from a transcript step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCallRecord {
    pub name: String,
    pub server_name: Option<String>,
    pub command_line: Option<String>,
    pub tool_summary: Option<String>,
}

/// A model-selection change notice detected in a transcript step.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelSwitchRecord {
    pub step_index: i64,
    pub from_model: String,
    pub to_model: String,
}

/// A single `run_command` execution with optional completion timing & exit code.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CommandExecRecord {
    pub step_index: i64,
    pub command_line: String,
    pub tool_summary: Option<String>,
    pub duration_secs: Option<f64>,
    pub exit_code: Option<i32>,
    pub cancelled: bool,
}

/// A single step inside a conversation transcript.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepRecord {
    pub step_index: i64,
    pub created_at: Option<String>,
    pub local_date: Option<String>,
    pub local_time: Option<String>,
    pub step_type: String,
    pub source: String,
    pub status: String,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub has_tokens: bool,
    pub thinking_preview: Option<String>,
    pub thinking_full: Option<String>,
    pub content_preview: Option<String>,
    pub tool_calls: Vec<ToolCallRecord>,
    pub is_error: bool,
    pub permission_denied: bool,
    pub model_switch: Option<ModelSwitchRecord>,
    #[serde(default)]
    pub observed_model: String,
    pub command_duration_secs: Option<f64>,
    pub command_exit_code: Option<i32>,
}

/// Full scanned session record (held in backend state and used for Session Detail).
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionRecord {
    pub session_id: String,
    pub short_id: String,
    pub source: SourceKind,
    pub kind: SessionKind,
    pub title: String,
    pub is_untitled: bool,
    pub label_source: String,
    pub project: String,
    pub workspace: String,
    pub parent_id: Option<String>,
    pub agent_type: Option<String>,
    pub role: Option<String>,
    pub first_utc: Option<String>,
    pub last_utc: Option<String>,
    pub first_local_date: Option<String>,
    pub last_local_date: Option<String>,
    pub duration_secs: u64,
    pub calls: u64,
    pub step_count: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub thinking_steps: u64,
    pub error_steps: u64,
    pub tool_call_count: u64,
    pub tool_names: Vec<String>,
    pub transcript_path: String,
    pub metadata_source: String,
    pub steps: Vec<StepRecord>,
    pub command_execs: Vec<CommandExecRecord>,
    #[serde(default)]
    pub spawn_step_index: Option<i64>,
    #[serde(default)]
    pub written_plan_paths: Vec<String>,
    #[serde(default)]
    pub referenced_plan_paths: Vec<String>,
    #[serde(default)]
    pub message_turns: std::collections::HashMap<String, u64>,
}

/// Parent/subagent relationship discovered from `.system_generated/subagents/*.json` or SQLite.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubagentLink {
    pub conversation_id: String,
    pub parent_id: String,
    pub agent_type: String,
    pub role: String,
    #[serde(default)]
    pub spawn_step_index: Option<i64>,
}

/// Per-source scan diagnostics shown on the Data Sources screen.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceDiagnostics {
    pub source: SourceKind,
    pub label: String,
    pub root_path: String,
    pub exists: bool,
    pub enabled: bool,
    pub transcript_files_found: u64,
    pub sessions_with_tokens: u64,
    pub sessions_without_tokens: u64,
    pub pb_only_stems: Vec<String>,
    pub parse_errors: u64,
    pub corrupted_tool_names_dropped: u64,
    pub capped_step_gaps: u64,
    pub min_date: Option<String>,
    pub max_date: Option<String>,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub metadata_source: String,
    pub titles_matched: u64,
    pub projects_matched: u64,
    pub warnings: Vec<String>,
}

/// Consistency verification report comparing session sums and daily sums.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ConsistencyReport {
    pub ok: bool,
    pub session_row_mismatches: u64,
    pub daily_row_mismatches: u64,
    pub session_total: u64,
    pub daily_total: u64,
    pub discrepancy: i64,
    pub message: String,
}

/// Global scan diagnostics across all enabled sources.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanDiagnostics {
    pub scanned_at: String,
    pub scanned_at_local_hm: String,
    pub duration_ms: u64,
    pub sources: Vec<SourceDiagnostics>,
    pub total_transcripts: u64,
    pub total_with_tokens: u64,
    pub total_without_tokens: u64,
    pub total_parse_errors: u64,
    pub total_pb_only: u64,
    pub total_corrupted_tool_names_dropped: u64,
    pub total_capped_step_gaps: u64,
    pub consistency: ConsistencyReport,
    pub snapshot_runs: u64,
    pub warnings: Vec<String>,
}

/// Output of a full multi-source scan before pricing/filtering.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScanResult {
    pub sessions: Vec<SessionRecord>,
    pub diagnostics: ScanDiagnostics,
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CustomSourceConfig {
    pub name: String,
    pub path: String,
    pub enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionConfig {
    pub amount: f64,
    pub currency: String,
    pub period_days: u32,
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FxConfig {
    #[serde(rename = "usdInr")]
    pub usd_inr: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DisplayConfig {
    pub theme: String,         // "light" | "dark" | "system"
    pub density: String,       // "comfortable" | "compact"
    pub number_format: String, // "compact" | "full"
    pub week_start: String,    // "monday" | "sunday"
    pub reduced_motion: String,// "system" | "on" | "off"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RefreshConfig {
    pub interval_minutes: u32, // 0 = manual only, 1, 5, 15
    pub file_watcher_enabled: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AppConfig {
    pub app_brain_root: String,
    pub app_enabled: bool,
    pub read_app_sqlite: bool,
    pub cli_brain_root: String,
    pub cli_enabled: bool,
    pub custom_sources: Vec<CustomSourceConfig>,
    pub db_path: String,
    pub pricing_path: Option<String>,
    pub default_model_id: String,
    pub reporting_currency: String, // "INR" | "USD"
    pub fx: FxConfig,
    pub subscription: SubscriptionConfig,
    pub display: DisplayConfig,
    pub refresh: RefreshConfig,
}

// ---------------------------------------------------------------------------
// Pricing
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PriceEntry {
    pub model_id: String,
    pub name: String,
    pub vendor: String,
    pub effective_from: String,
    pub effective_until: Option<String>,
    pub input_usd: f64,
    pub cached_usd: f64,
    pub output_usd: f64,
    pub source: String,
    pub verified: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogItem {
    pub model_id: String,
    pub name: String,
    pub vendor: String,
    pub latest_input_usd: f64,
    pub latest_cached_usd: f64,
    pub latest_output_usd: f64,
    pub effective_from: String,
    pub effective_until: Option<String>,
    pub verified: bool,
    pub source: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelBenchmarkRow {
    pub model_id: String,
    pub name: String,
    pub vendor: String,
    pub input_usd: f64,
    pub cached_usd: f64,
    pub output_usd: f64,
    pub verified: bool,
    pub is_current: bool,
    pub cost_usd: f64,
    pub cost_currency: f64,
    pub ratio_to_cheapest: f64,
    pub relative_bar: f64,
}

// ---------------------------------------------------------------------------
// Filtering & Dashboard Payloads
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FilterState {
    pub date_preset: String, // "all" | "today" | "7d" | "30d" | "custom"
    pub custom_start: Option<String>,
    pub custom_end: Option<String>,
    pub source_filter: String, // "all" | "app" | "cli" | "custom:<name>"
    pub project_filter: Option<String>,
    pub model_id: String,
    pub currency: String, // "INR" | "USD"
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenTotals {
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub calls: u64,
    pub sessions: u64,
    pub cache_hit_rate: f64,
    pub fresh_share: f64,
    pub cached_share: f64,
    pub output_share: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CostBreakdown {
    pub fresh_usd: f64,
    pub cached_usd: f64,
    pub output_usd: f64,
    pub total_usd: f64,
    pub fresh_currency: f64,
    pub cached_currency: f64,
    pub output_currency: f64,
    pub total_currency: f64,
    pub fresh_share: f64,
    pub cached_share: f64,
    pub output_share: f64,
    pub currency: String,
    pub usd_inr: f64,
    pub has_date_estimates: bool,
    pub date_estimate_warning: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DailyBucket {
    pub date: String, // YYYY-MM-DD (calendar-complete)
    pub calls: u64,
    pub sessions: u64,
    pub app_sessions: u64,
    pub cli_sessions: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub app_fresh_in: u64,
    pub app_cached: u64,
    pub app_output: u64,
    pub app_total: u64,
    pub cli_fresh_in: u64,
    pub cli_cached: u64,
    pub cli_output: u64,
    pub cli_total: u64,
    pub cost_usd: f64,
    pub cost_currency: f64,
    pub is_date_estimate: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionSummary {
    pub session_id: String,
    pub short_id: String,
    pub source: SourceKind,
    pub kind: SessionKind,
    pub title: String,
    pub is_untitled: bool,
    pub label_source: String,
    pub project: String,
    pub workspace: String,
    pub parent_id: Option<String>,
    pub agent_type: Option<String>,
    pub role: Option<String>,
    pub first_utc: Option<String>,
    pub last_utc: Option<String>,
    pub first_local_date: Option<String>,
    pub duration_secs: u64,
    pub calls: u64,
    pub step_count: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cost_usd: f64,
    pub cost_currency: f64,
    pub cache_hit_rate: f64,
    pub tool_names: Vec<String>,
    pub child_ids: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub project: String,
    pub workspace: String,
    pub is_unattributed: bool,
    pub session_count: u64,
    pub app_sessions: u64,
    pub cli_sessions: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub app_total: u64,
    pub cli_total: u64,
    pub cost_usd: f64,
    pub cost_currency: f64,
    pub app_cost_currency: f64,
    pub cli_cost_currency: f64,
    pub daily_totals: Vec<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceComparisonRow {
    pub source_key: String,
    pub label: String,
    pub sessions: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub avg_tokens_per_session: f64,
    pub min_date: Option<String>,
    pub max_date: Option<String>,
    pub cost_usd: f64,
    pub cost_currency: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionComparison {
    pub configured: bool,
    pub plan_amount: f64,
    pub plan_currency: String,
    pub period_days: u32,
    pub plan_label: String,
    pub api_cost_currency: f64,
    pub tokens_per_unit: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardPayload {
    pub filter: FilterState,
    pub active_model: ModelCatalogItem,
    pub catalog: Vec<ModelCatalogItem>,
    pub all_entries: Vec<PriceEntry>,
    pub all_projects: Vec<String>,
    pub totals: TokenTotals,
    pub cli_totals: TokenTotals,
    pub app_totals: TokenTotals,
    pub cost: CostBreakdown,
    pub cli_cost: CostBreakdown,
    pub app_cost: CostBreakdown,
    pub daily: Vec<DailyBucket>,
    pub sessions: Vec<SessionSummary>,
    pub projects: Vec<ProjectSummary>,
    pub source_comparison: Vec<SourceComparisonRow>,
    pub benchmark: Vec<ModelBenchmarkRow>,
    pub subscription_comparison: SubscriptionComparison,
    pub active_days: u64,
    pub observed_days: u64,
    pub min_date: Option<String>,
    pub max_date: Option<String>,
    pub diagnostics: ScanDiagnostics,
}

// ---------------------------------------------------------------------------
// Session Detail
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolStatRow {
    pub name: String,
    pub call_count: u64,
    pub token_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct McpStatRow {
    pub server_name: String,
    pub call_count: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StepPricedRow {
    #[serde(flatten)]
    pub step: StepRecord,
    pub cost_usd: f64,
    pub cost_currency: f64,
    pub cumulative_fresh_in: u64,
    pub cumulative_cached: u64,
    pub cumulative_output: u64,
    pub cumulative_total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetailPayload {
    pub summary: SessionSummary,
    pub parent_title: Option<String>,
    pub thinking_steps: u64,
    pub error_steps: u64,
    pub tool_call_count: u64,
    pub transcript_path: String,
    pub metadata_source: String,
    pub top_spike_steps: Vec<i64>,
    pub top_spike_share: f64,
    pub steps: Vec<StepPricedRow>,
    pub tool_stats: Vec<ToolStatRow>,
    pub mcp_stats: Vec<McpStatRow>,
    pub command_execs: Vec<CommandExecRecord>,
    pub subagents: Vec<SessionSummary>,
    pub model_switches: Vec<ModelSwitchRecord>,
    pub permission_denials: u64,
}

// ---------------------------------------------------------------------------
// Forecasting
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ForecastMethod {
    Linear,
    Bootstrap,
    MonteCarlo,
    Holt,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastPoint {
    pub date: String,
    pub low: f64,
    pub median: f64,
    pub high: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ForecastResult {
    pub supported: bool,
    pub active_days: u64,
    pub min_required_days: u64,
    pub observed_days: u64,
    pub max_horizon_days: u64,
    pub horizon_days: u64,
    pub method: ForecastMethod,
    pub method_label: String,
    pub metric: String, // "cost" | "tokens"
    pub observed_mean: f64,
    pub cumulative_low: f64,
    pub cumulative_median: f64,
    pub cumulative_high: f64,
    pub assumptions: String,
    pub notes: Vec<String>,
    pub points: Vec<ForecastPoint>,
}

// ---------------------------------------------------------------------------
// Export & Diagnostics
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    pub path: String,
    pub row_count: usize,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AboutInfo {
    pub app_version: String,
    pub build_date: String,
    pub antigravity_app_version: Option<String>,
    pub antigravity_cli_version: Option<String>,
    pub config_path: String,
    pub db_path: String,
}

// ---------------------------------------------------------------------------
// Token Usage Dashboard Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum TimePeriod {
    #[serde(rename = "1d")]
    OneDay,
    #[serde(rename = "1w")]
    OneWeek,
    #[serde(rename = "1m")]
    OneMonth,
    #[serde(rename = "6m")]
    SixMonths,
    #[serde(rename = "lifetime")]
    Lifetime,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TimeGranularity {
    Hourly,
    Daily,
    Weekly,
    Monthly,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "kind", content = "agentType", rename_all = "camelCase")]
pub enum AgentFilter {
    All,
    MainOnly,
    SubagentsOnly,
    AgentType(String),
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageFilter {
    pub period: TimePeriod,
    pub project: Option<String>,
    pub model: Option<String>,
    pub agent: AgentFilter,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsageTotals {
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub wall_time_secs: u64,
    pub calls: u64,
    pub sessions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TimeUsageBucket {
    pub key: String,
    pub axis_label: String,
    pub range_label: String,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelUsageRow {
    pub model: String,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub wall_time_secs: u64,
    pub calls: u64,
    pub sessions: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenUsagePayload {
    pub filter: TokenUsageFilter,
    pub window_start: Option<String>,
    pub window_end: String,
    pub granularity: TimeGranularity,
    pub available_projects: Vec<String>,
    pub available_models: Vec<String>,
    pub available_agent_types: Vec<String>,
    pub totals: TokenUsageTotals,
    pub time_series: Vec<TimeUsageBucket>,
    pub by_model: Vec<ModelUsageRow>,
}

// ---------------------------------------------------------------------------
// Sessions & Orchestration DAG Models
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionRole {
    Planner,
    Orchestrator,
    Main,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum SessionLinkDirection {
    ToOrchestrator,
    FromPlanner,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsFilter {
    pub period: TimePeriod,
    pub project: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionOverviewRow {
    pub session_id: String,
    pub title: String,
    pub project: String,
    pub source: SourceKind,
    pub role: SessionRole,
    pub subagent_count: u64,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub wall_time_secs: u64,
    pub calls: u64,
    pub first_utc: Option<String>,
    pub last_utc: Option<String>,
    pub linked_session_id: Option<String>,
    pub link_direction: Option<SessionLinkDirection>,
    pub linked_plan_name: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionsOverviewPayload {
    pub filter: SessionsFilter,
    pub window_start: Option<String>,
    pub window_end: String,
    pub available_projects: Vec<String>,
    pub sessions: Vec<SessionOverviewRow>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagNode {
    pub node_id: String,
    pub session_id: String,
    pub parent_node_id: Option<String>,
    pub is_root: bool,
    pub wave_index: u32,
    pub agent_type: String,
    pub role_label: String,
    pub model: String,
    pub fresh_in: u64,
    pub cached: u64,
    pub output: u64,
    pub total: u64,
    pub cache_hit_rate: f64,
    pub wall_time_secs: u64,
    pub calls: u64,
    pub tool_call_count: u64,
    pub message_turns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DagEdge {
    pub from_node_id: String,
    pub to_node_id: String,
    pub kind: String,
    pub message_turns: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDagGraph {
    pub session_id: String,
    pub title: String,
    pub project: String,
    pub role: SessionRole,
    pub wave_count: u32,
    pub nodes: Vec<DagNode>,
    pub edges: Vec<DagEdge>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CrossSessionLink {
    pub planner_session_id: String,
    pub orchestrator_session_id: String,
    pub plan_name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDagPayload {
    pub selected_session_id: String,
    pub primary: SessionDagGraph,
    pub secondary: Option<SessionDagGraph>,
    pub link: Option<CrossSessionLink>,
}
