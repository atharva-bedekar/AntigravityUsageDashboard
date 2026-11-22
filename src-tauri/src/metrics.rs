use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, Timelike, Utc};

use crate::models::{
    AgentFilter, AppConfig, ConsistencyReport, CostBreakdown, DailyBucket, DashboardPayload,
    FilterState, McpStatRow, ModelCatalogItem, ModelSwitchRecord, ModelUsageRow, ProjectSummary,
    ScanResult, SessionDetailPayload, SessionKind, SessionRecord, SessionSummary,
    SourceComparisonRow, SourceKind, StepPricedRow, StepRecord, SubscriptionComparison,
    TimeGranularity, TimePeriod, TimeUsageBucket, TokenTotals, TokenUsageFilter, TokenUsagePayload,
    TokenUsageTotals, ToolStatRow,
};
use crate::pricing::Catalog;
use crate::scanner::transcript::parse_iso_ts;

/// Maximum gap (in seconds) between consecutive steps attributed to active wall time (30 minutes).
pub const WALL_TIME_GAP_CAP_SECS: i64 = 1800;

/// Safe division that never returns NaN or Inf.
pub fn safe_div(num: f64, den: f64, default: f64) -> f64 {
    if den == 0.0 || !num.is_finite() || !den.is_finite() {
        return default;
    }
    let res = num / den;
    if res.is_finite() {
        res
    } else {
        default
    }
}

pub fn token_totals_from_counts(
    fresh_in: u64,
    cached: u64,
    output: u64,
    calls: u64,
    sessions: u64,
) -> TokenTotals {
    let total = fresh_in + cached + output;
    let total_f = total as f64;
    TokenTotals {
        fresh_in,
        cached,
        output,
        total,
        calls,
        sessions,
        cache_hit_rate: safe_div(cached as f64, (fresh_in + cached) as f64, 0.0),
        fresh_share: safe_div(fresh_in as f64, total_f, 0.0),
        cached_share: safe_div(cached as f64, total_f, 0.0),
        output_share: safe_div(output as f64, total_f, 0.0),
    }
}

pub fn cost_breakdown_from_usd(
    fresh_usd: f64,
    cached_usd: f64,
    output_usd: f64,
    currency: &str,
    usd_inr: f64,
    has_date_estimates: bool,
    estimate_dates: &[String],
) -> CostBreakdown {
    let total_usd = fresh_usd + cached_usd + output_usd;
    let mult = if currency == "INR" { usd_inr } else { 1.0 };
    let fresh_currency = fresh_usd * mult;
    let cached_currency = cached_usd * mult;
    let output_currency = output_usd * mult;
    let total_currency = total_usd * mult;

    let date_estimate_warning = if has_date_estimates && !estimate_dates.is_empty() {
        Some(format!(
            "Some observed dates ({}) fall outside the selected model's published effective range; closest version rates were used as an estimate.",
            if estimate_dates.len() <= 3 {
                estimate_dates.join(", ")
            } else {
                format!("{} days, e.g. {}..{}", estimate_dates.len(), estimate_dates[0], estimate_dates[estimate_dates.len() - 1])
            }
        ))
    } else {
        None
    };

    CostBreakdown {
        fresh_usd,
        cached_usd,
        output_usd,
        total_usd,
        fresh_currency,
        cached_currency,
        output_currency,
        total_currency,
        fresh_share: safe_div(fresh_usd, total_usd, 0.0),
        cached_share: safe_div(cached_usd, total_usd, 0.0),
        output_share: safe_div(output_usd, total_usd, 0.0),
        currency: currency.to_string(),
        usd_inr,
        has_date_estimates,
        date_estimate_warning,
    }
}

/// Verify that every session and daily row satisfies `total == fresh_in + cached + output`
/// and that `sum(sessions.total) == sum(daily.total)`.
pub fn verify_consistency(sessions: &[SessionRecord], daily: &[DailyBucket]) -> ConsistencyReport {
    let mut session_row_mismatches = 0u64;
    let mut session_total = 0u64;
    for s in sessions {
        if s.total != s.fresh_in + s.cached + s.output {
            session_row_mismatches += 1;
        }
        session_total += s.total;
    }

    let mut daily_row_mismatches = 0u64;
    let mut daily_total = 0u64;
    for d in daily {
        if d.total != d.fresh_in + d.cached + d.output {
            daily_row_mismatches += 1;
        }
        daily_total += d.total;
    }

    let discrepancy = session_total as i64 - daily_total as i64;
    let ok = session_row_mismatches == 0 && daily_row_mismatches == 0 && discrepancy == 0;
    let message = if ok {
        format!("Consistent: {session_total} tokens across {} sessions and {} calendar days.", sessions.len(), daily.len())
    } else {
        format!(
            "Discrepancy detected: session_mismatches={session_row_mismatches}, daily_mismatches={daily_row_mismatches}, session_total={session_total}, daily_total={daily_total}."
        )
    };

    ConsistencyReport {
        ok,
        session_row_mismatches,
        daily_row_mismatches,
        session_total,
        daily_total,
        discrepancy,
        message,
    }
}

pub fn resolve_date_bounds(filter: &FilterState) -> (Option<String>, Option<String>) {
    let today = Local::now().date_naive();
    match filter.date_preset.as_str() {
        "today" => {
            let s = today.format("%Y-%m-%d").to_string();
            (Some(s.clone()), Some(s))
        }
        "7d" => {
            let start = (today - Duration::days(6)).format("%Y-%m-%d").to_string();
            let end = today.format("%Y-%m-%d").to_string();
            (Some(start), Some(end))
        }
        "30d" => {
            let start = (today - Duration::days(29)).format("%Y-%m-%d").to_string();
            let end = today.format("%Y-%m-%d").to_string();
            (Some(start), Some(end))
        }
        "custom" => (filter.custom_start.clone(), filter.custom_end.clone()),
        _ => (None, None),
    }
}

fn date_in_bounds(date: Option<&str>, start: Option<&str>, end: Option<&str>) -> bool {
    if start.is_none() && end.is_none() {
        return true;
    }
    let Some(d) = date else {
        return false;
    };
    if let Some(s) = start {
        if d < s {
            return false;
        }
    }
    if let Some(e) = end {
        if d > e {
            return false;
        }
    }
    true
}

fn source_matches(source: &SourceKind, filter_key: &str) -> bool {
    if filter_key == "all" || filter_key.is_empty() {
        return true;
    }
    source.key() == filter_key
}

pub fn build_daily_series(
    sessions: &[&SessionRecord],
    date_start: Option<&str>,
    date_end: Option<&str>,
    catalog: &Catalog,
    model_id: &str,
    currency: &str,
    usd_inr: f64,
) -> Vec<DailyBucket> {
    #[derive(Default)]
    struct DayAcc {
        calls: u64,
        sessions: BTreeSet<String>,
        app_sessions: BTreeSet<String>,
        cli_sessions: BTreeSet<String>,
        fresh_in: u64,
        cached: u64,
        output: u64,
        app_fresh_in: u64,
        app_cached: u64,
        app_output: u64,
        cli_fresh_in: u64,
        cli_cached: u64,
        cli_output: u64,
    }

    let mut map: BTreeMap<String, DayAcc> = BTreeMap::new();

    for s in sessions {
        for st in &s.steps {
            if !st.has_tokens {
                continue;
            }
            let date = st
                .local_date
                .as_deref()
                .or(s.first_local_date.as_deref());
            if !date_in_bounds(date, date_start, date_end) {
                continue;
            }
            let Some(d_str) = date else { continue };
            let acc = map.entry(d_str.to_string()).or_default();
            acc.calls += 1;
            acc.sessions.insert(s.session_id.clone());
            acc.fresh_in += st.fresh_in;
            acc.cached += st.cached;
            acc.output += st.output;

            match s.source {
                SourceKind::App => {
                    acc.app_sessions.insert(s.session_id.clone());
                    acc.app_fresh_in += st.fresh_in;
                    acc.app_cached += st.cached;
                    acc.app_output += st.output;
                }
                SourceKind::Cli => {
                    acc.cli_sessions.insert(s.session_id.clone());
                    acc.cli_fresh_in += st.fresh_in;
                    acc.cli_cached += st.cached;
                    acc.cli_output += st.output;
                }
                SourceKind::Custom(_) => {}
            }
        }
    }

    if map.is_empty() {
        return Vec::new();
    }

    let min_str = map.keys().next().unwrap().clone();
    let max_str = map.keys().next_back().unwrap().clone();
    let Ok(min_d) = NaiveDate::parse_from_str(&min_str, "%Y-%m-%d") else {
        return Vec::new();
    };
    let Ok(max_d) = NaiveDate::parse_from_str(&max_str, "%Y-%m-%d") else {
        return Vec::new();
    };

    let mut out = Vec::new();
    let mut cur = min_d;
    let mult = if currency == "INR" { usd_inr } else { 1.0 };

    while cur <= max_d {
        let d_str = cur.format("%Y-%m-%d").to_string();
        let (price_opt, is_est) = catalog.price_on(model_id, &d_str);
        if let Some(acc) = map.get(&d_str) {
            let total = acc.fresh_in + acc.cached + acc.output;
            let app_total = acc.app_fresh_in + acc.app_cached + acc.app_output;
            let cli_total = acc.cli_fresh_in + acc.cli_cached + acc.cli_output;
            let cost_usd = if let Some(p) = price_opt {
                (acc.fresh_in as f64 * p.input_usd
                    + acc.cached as f64 * p.cached_usd
                    + acc.output as f64 * p.output_usd)
                    / 1_000_000.0
            } else {
                0.0
            };
            out.push(DailyBucket {
                date: d_str,
                calls: acc.calls,
                sessions: acc.sessions.len() as u64,
                app_sessions: acc.app_sessions.len() as u64,
                cli_sessions: acc.cli_sessions.len() as u64,
                fresh_in: acc.fresh_in,
                cached: acc.cached,
                output: acc.output,
                total,
                app_fresh_in: acc.app_fresh_in,
                app_cached: acc.app_cached,
                app_output: acc.app_output,
                app_total,
                cli_fresh_in: acc.cli_fresh_in,
                cli_cached: acc.cli_cached,
                cli_output: acc.cli_output,
                cli_total,
                cost_usd,
                cost_currency: cost_usd * mult,
                is_date_estimate: is_est,
            });
        } else {
            // Calendar completeness: explicit 0 bar
            out.push(DailyBucket {
                date: d_str,
                calls: 0,
                sessions: 0,
                app_sessions: 0,
                cli_sessions: 0,
                fresh_in: 0,
                cached: 0,
                output: 0,
                total: 0,
                app_fresh_in: 0,
                app_cached: 0,
                app_output: 0,
                app_total: 0,
                cli_fresh_in: 0,
                cli_cached: 0,
                cli_output: 0,
                cli_total: 0,
                cost_usd: 0.0,
                cost_currency: 0.0,
                is_date_estimate: is_est,
            });
        }
        cur += Duration::days(1);
    }

    out
}

pub fn build_dashboard(
    scan: &ScanResult,
    config: &AppConfig,
    catalog: &Catalog,
    filter: &FilterState,
) -> DashboardPayload {
    let (date_start, date_end) = resolve_date_bounds(filter);
    let usd_inr = config.fx.usd_inr;
    let currency = if filter.currency == "USD" { "USD" } else { "INR" };
    let mult = if currency == "INR" { usd_inr } else { 1.0 };

    // Collect all distinct project names from unfiltered sessions for dropdown
    let mut all_projects_set = BTreeSet::new();
    for s in &scan.sessions {
        if s.calls > 0 {
            all_projects_set.insert(s.project.clone());
        }
    }
    let all_projects: Vec<String> = all_projects_set.into_iter().collect();

    // Filter sessions by source & project (and require calls > 0 for token views)
    let matching_sessions: Vec<&SessionRecord> = scan
        .sessions
        .iter()
        .filter(|s| {
            s.calls > 0
                && source_matches(&s.source, &filter.source_filter)
                && filter
                    .project_filter
                    .as_deref()
                    .map(|p| p.is_empty() || s.project == p)
                    .unwrap_or(true)
        })
        .collect();

    // Build child map for parent/subagent grouping
    let mut children_map: HashMap<String, Vec<String>> = HashMap::new();
    for s in &matching_sessions {
        if let Some(pid) = &s.parent_id {
            children_map
                .entry(pid.clone())
                .or_default()
                .push(s.session_id.clone());
        }
    }

    // Aggregate per-session in-range token & cost numbers
    let mut session_summaries = Vec::new();
    let mut total_fresh = 0u64;
    let mut total_cached = 0u64;
    let mut total_output = 0u64;
    let mut total_calls = 0u64;
    let mut cost_fresh_usd = 0.0;
    let mut cost_cached_usd = 0.0;
    let mut cost_output_usd = 0.0;

    let mut cli_fresh = 0u64;
    let mut cli_cached = 0u64;
    let mut cli_output = 0u64;
    let mut cli_calls = 0u64;
    let mut cli_sessions = 0u64;
    let mut cli_cost_fresh = 0.0;
    let mut cli_cost_cached = 0.0;
    let mut cli_cost_output = 0.0;
    let mut cli_min_date: Option<String> = None;
    let mut cli_max_date: Option<String> = None;

    let mut app_fresh = 0u64;
    let mut app_cached = 0u64;
    let mut app_output = 0u64;
    let mut app_calls = 0u64;
    let mut app_sessions = 0u64;
    let mut app_cost_fresh = 0.0;
    let mut app_cost_cached = 0.0;
    let mut app_cost_output = 0.0;
    let mut app_min_date: Option<String> = None;
    let mut app_max_date: Option<String> = None;

    let mut estimate_dates_set = BTreeSet::new();
    let mut active_sessions_refs: Vec<&SessionRecord> = Vec::new();

    for s in &matching_sessions {
        let mut s_fresh = 0u64;
        let mut s_cached = 0u64;
        let mut s_output = 0u64;
        let mut s_calls = 0u64;
        let mut s_cost_fresh = 0.0;
        let mut s_cost_cached = 0.0;
        let mut s_cost_output = 0.0;

        for st in &s.steps {
            if !st.has_tokens {
                continue;
            }
            let d = st
                .local_date
                .as_deref()
                .or(s.first_local_date.as_deref());
            if !date_in_bounds(d, date_start.as_deref(), date_end.as_deref()) {
                continue;
            }
            s_calls += 1;
            s_fresh += st.fresh_in;
            s_cached += st.cached;
            s_output += st.output;

            let date_key = d.unwrap_or("2026-11-15");
            let (p_opt, is_est) = catalog.price_on(&filter.model_id, date_key);
            if is_est {
                estimate_dates_set.insert(date_key.to_string());
            }
            if let Some(p) = p_opt {
                s_cost_fresh += (st.fresh_in as f64 * p.input_usd) / 1_000_000.0;
                s_cost_cached += (st.cached as f64 * p.cached_usd) / 1_000_000.0;
                s_cost_output += (st.output as f64 * p.output_usd) / 1_000_000.0;
            }
        }

        if s_calls == 0 {
            continue;
        }
        active_sessions_refs.push(*s);

        let s_total = s_fresh + s_cached + s_output;
        let s_cost_usd = s_cost_fresh + s_cost_cached + s_cost_output;

        total_fresh += s_fresh;
        total_cached += s_cached;
        total_output += s_output;
        total_calls += s_calls;
        cost_fresh_usd += s_cost_fresh;
        cost_cached_usd += s_cost_cached;
        cost_output_usd += s_cost_output;

        match s.source {
            SourceKind::Cli => {
                cli_sessions += 1;
                cli_calls += s_calls;
                cli_fresh += s_fresh;
                cli_cached += s_cached;
                cli_output += s_output;
                cli_cost_fresh += s_cost_fresh;
                cli_cost_cached += s_cost_cached;
                cli_cost_output += s_cost_output;
                if let Some(d) = &s.first_local_date {
                    cli_min_date = Some(cli_min_date.map_or(d.clone(), |m| m.min(d.clone())));
                }
                if let Some(d) = &s.last_local_date {
                    cli_max_date = Some(cli_max_date.map_or(d.clone(), |m| m.max(d.clone())));
                }
            }
            SourceKind::App => {
                app_sessions += 1;
                app_calls += s_calls;
                app_fresh += s_fresh;
                app_cached += s_cached;
                app_output += s_output;
                app_cost_fresh += s_cost_fresh;
                app_cost_cached += s_cost_cached;
                app_cost_output += s_cost_output;
                if let Some(d) = &s.first_local_date {
                    app_min_date = Some(app_min_date.map_or(d.clone(), |m| m.min(d.clone())));
                }
                if let Some(d) = &s.last_local_date {
                    app_max_date = Some(app_max_date.map_or(d.clone(), |m| m.max(d.clone())));
                }
            }
            SourceKind::Custom(_) => {}
        }

        session_summaries.push(SessionSummary {
            session_id: s.session_id.clone(),
            short_id: s.short_id.clone(),
            source: s.source.clone(),
            kind: s.kind,
            title: s.title.clone(),
            is_untitled: s.is_untitled,
            label_source: s.label_source.clone(),
            project: s.project.clone(),
            workspace: s.workspace.clone(),
            parent_id: s.parent_id.clone(),
            agent_type: s.agent_type.clone(),
            role: s.role.clone(),
            first_utc: s.first_utc.clone(),
            last_utc: s.last_utc.clone(),
            first_local_date: s.first_local_date.clone(),
            duration_secs: s.duration_secs,
            calls: s_calls,
            step_count: s.step_count,
            fresh_in: s_fresh,
            cached: s_cached,
            output: s_output,
            total: s_total,
            cost_usd: s_cost_usd,
            cost_currency: s_cost_usd * mult,
            cache_hit_rate: safe_div(s_cached as f64, (s_fresh + s_cached) as f64, 0.0),
            tool_names: s.tool_names.clone(),
            child_ids: children_map.get(&s.session_id).cloned().unwrap_or_default(),
        });
    }

    session_summaries.sort_by(|a, b| {
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let daily = build_daily_series(
        &active_sessions_refs,
        date_start.as_deref(),
        date_end.as_deref(),
        catalog,
        &filter.model_id,
        currency,
        usd_inr,
    );

    let active_days = daily.iter().filter(|d| d.calls > 0).count() as u64;
    let observed_days = daily.len() as u64;
    let min_date = daily.first().map(|d| d.date.clone());
    let max_date = daily.last().map(|d| d.date.clone());

    let estimate_dates: Vec<String> = estimate_dates_set.into_iter().collect();
    let has_date_estimates = !estimate_dates.is_empty();

    let totals = token_totals_from_counts(
        total_fresh,
        total_cached,
        total_output,
        total_calls,
        session_summaries.len() as u64,
    );
    let cli_totals =
        token_totals_from_counts(cli_fresh, cli_cached, cli_output, cli_calls, cli_sessions);
    let app_totals =
        token_totals_from_counts(app_fresh, app_cached, app_output, app_calls, app_sessions);

    let cost = cost_breakdown_from_usd(
        cost_fresh_usd,
        cost_cached_usd,
        cost_output_usd,
        currency,
        usd_inr,
        has_date_estimates,
        &estimate_dates,
    );
    let cli_cost = cost_breakdown_from_usd(
        cli_cost_fresh,
        cli_cost_cached,
        cli_cost_output,
        currency,
        usd_inr,
        has_date_estimates,
        &estimate_dates,
    );
    let app_cost = cost_breakdown_from_usd(
        app_cost_fresh,
        app_cost_cached,
        app_cost_output,
        currency,
        usd_inr,
        has_date_estimates,
        &estimate_dates,
    );

    // Projects aggregation
    let mut proj_map: HashMap<String, ProjectSummary> = HashMap::new();
    for ss in &session_summaries {
        let entry = proj_map.entry(ss.project.clone()).or_insert_with(|| ProjectSummary {
            project: ss.project.clone(),
            workspace: ss.workspace.clone(),
            is_unattributed: ss.project == "Unattributed",
            session_count: 0,
            app_sessions: 0,
            cli_sessions: 0,
            fresh_in: 0,
            cached: 0,
            output: 0,
            total: 0,
            app_total: 0,
            cli_total: 0,
            cost_usd: 0.0,
            cost_currency: 0.0,
            app_cost_currency: 0.0,
            cli_cost_currency: 0.0,
            daily_totals: Vec::new(),
        });
        if entry.workspace.is_empty() && !ss.workspace.is_empty() {
            entry.workspace = ss.workspace.clone();
        }
        entry.session_count += 1;
        entry.fresh_in += ss.fresh_in;
        entry.cached += ss.cached;
        entry.output += ss.output;
        entry.total += ss.total;
        entry.cost_usd += ss.cost_usd;
        entry.cost_currency += ss.cost_currency;
        match ss.source {
            SourceKind::App => {
                entry.app_sessions += 1;
                entry.app_total += ss.total;
                entry.app_cost_currency += ss.cost_currency;
            }
            SourceKind::Cli => {
                entry.cli_sessions += 1;
                entry.cli_total += ss.total;
                entry.cli_cost_currency += ss.cost_currency;
            }
            SourceKind::Custom(_) => {}
        }
    }

    // Build daily sparkline per project aligned with `daily` dates
    if !daily.is_empty() {
        let date_index: HashMap<&str, usize> = daily
            .iter()
            .enumerate()
            .map(|(i, d)| (d.date.as_str(), i))
            .collect();
        for p in proj_map.values_mut() {
            p.daily_totals = vec![0; daily.len()];
        }
        for s in active_sessions_refs {
            if let Some(proj) = proj_map.get_mut(&s.project) {
                for st in &s.steps {
                    if !st.has_tokens {
                        continue;
                    }
                    if let Some(d) = st.local_date.as_deref() {
                        if let Some(&idx) = date_index.get(d) {
                            proj.daily_totals[idx] += st.total;
                        }
                    }
                }
            }
        }
    }

    let mut projects: Vec<ProjectSummary> = proj_map.into_values().collect();
    projects.sort_by(|a, b| {
        if a.is_unattributed != b.is_unattributed {
            return a.is_unattributed.cmp(&b.is_unattributed);
        }
        b.cost_usd
            .partial_cmp(&a.cost_usd)
            .unwrap_or(std::cmp::Ordering::Equal)
    });

    let source_comparison = vec![
        SourceComparisonRow {
            source_key: "app".to_string(),
            label: "Antigravity App".to_string(),
            sessions: app_totals.sessions,
            fresh_in: app_totals.fresh_in,
            cached: app_totals.cached,
            output: app_totals.output,
            total: app_totals.total,
            cache_hit_rate: app_totals.cache_hit_rate,
            avg_tokens_per_session: safe_div(app_totals.total as f64, app_totals.sessions as f64, 0.0),
            min_date: app_min_date,
            max_date: app_max_date,
            cost_usd: app_cost.total_usd,
            cost_currency: app_cost.total_currency,
        },
        SourceComparisonRow {
            source_key: "cli".to_string(),
            label: "Antigravity CLI".to_string(),
            sessions: cli_totals.sessions,
            fresh_in: cli_totals.fresh_in,
            cached: cli_totals.cached,
            output: cli_totals.output,
            total: cli_totals.total,
            cache_hit_rate: cli_totals.cache_hit_rate,
            avg_tokens_per_session: safe_div(cli_totals.total as f64, cli_totals.sessions as f64, 0.0),
            min_date: cli_min_date,
            max_date: cli_max_date,
            cost_usd: cli_cost.total_usd,
            cost_currency: cli_cost.total_currency,
        },
    ];

    let ref_date = max_date
        .clone()
        .unwrap_or_else(|| Local::now().format("%Y-%m-%d").to_string());
    let catalog_items = catalog.catalog_items(Some(&ref_date));
    let active_model = catalog_items
        .iter()
        .find(|m| m.model_id == filter.model_id)
        .cloned()
        .unwrap_or_else(|| {
            catalog_items.first().cloned().unwrap_or(ModelCatalogItem {
                model_id: filter.model_id.clone(),
                name: filter.model_id.clone(),
                vendor: "Unknown".to_string(),
                latest_input_usd: 0.0,
                latest_cached_usd: 0.0,
                latest_output_usd: 0.0,
                effective_from: "2026-01-01".to_string(),
                effective_until: None,
                verified: false,
                source: String::new(),
            })
        });

    let benchmark = catalog.benchmark(
        totals.fresh_in,
        totals.cached,
        totals.output,
        &filter.model_id,
        &ref_date,
        currency,
        usd_inr,
    );

    let sub_amount = config.subscription.amount;
    let subscription_comparison = SubscriptionComparison {
        configured: sub_amount > 0.0,
        plan_amount: sub_amount,
        plan_currency: config.subscription.currency.clone(),
        period_days: config.subscription.period_days,
        plan_label: config.subscription.label.clone(),
        api_cost_currency: cost.total_currency,
        tokens_per_unit: safe_div(totals.total as f64, sub_amount, 0.0),
    };

    DashboardPayload {
        filter: filter.clone(),
        active_model,
        catalog: catalog_items,
        all_entries: catalog.entries.clone(),
        all_projects,
        totals,
        cli_totals,
        app_totals,
        cost,
        cli_cost,
        app_cost,
        daily,
        sessions: session_summaries,
        projects,
        source_comparison,
        benchmark,
        subscription_comparison,
        active_days,
        observed_days,
        min_date,
        max_date,
        diagnostics: scan.diagnostics.clone(),
    }
}

pub fn build_session_detail(
    scan: &ScanResult,
    session_id: &str,
    model_id: &str,
    currency: &str,
    usd_inr: f64,
    catalog: &Catalog,
) -> Result<SessionDetailPayload, String> {
    let session = scan
        .sessions
        .iter()
        .find(|s| s.session_id == session_id)
        .ok_or_else(|| format!("Session '{session_id}' not found"))?;

    let mult = if currency == "INR" { usd_inr } else { 1.0 };
    let parent_title = session.parent_id.as_ref().and_then(|pid| {
        scan.sessions
            .iter()
            .find(|s| &s.session_id == pid)
            .map(|p| p.title.clone())
    });

    let child_ids: Vec<String> = scan
        .sessions
        .iter()
        .filter(|s| s.parent_id.as_deref() == Some(&session.session_id))
        .map(|s| s.session_id.clone())
        .collect();

    let mut cum_fresh = 0u64;
    let mut cum_cached = 0u64;
    let mut cum_output = 0u64;
    let mut total_cost_usd = 0.0;

    let mut priced_steps = Vec::with_capacity(session.steps.len());
    let mut tool_map: HashMap<String, (u64, u64)> = HashMap::new();
    let mut mcp_map: HashMap<String, u64> = HashMap::new();
    let mut model_switches: Vec<ModelSwitchRecord> = Vec::new();
    let mut permission_denials = 0u64;

    for st in &session.steps {
        let date_key = st
            .local_date
            .as_deref()
            .or(session.first_local_date.as_deref())
            .unwrap_or("2026-11-15");
        let step_cost_usd = if st.has_tokens {
            if let (Some(p), _) = catalog.price_on(model_id, date_key) {
                (st.fresh_in as f64 * p.input_usd
                    + st.cached as f64 * p.cached_usd
                    + st.output as f64 * p.output_usd)
                    / 1_000_000.0
            } else {
                0.0
            }
        } else {
            0.0
        };

        cum_fresh += st.fresh_in;
        cum_cached += st.cached;
        cum_output += st.output;
        total_cost_usd += step_cost_usd;

        for tc in &st.tool_calls {
            let entry = tool_map.entry(tc.name.clone()).or_insert((0, 0));
            entry.0 += 1;
            entry.1 += st.total;
            if tc.name == "call_mcp_tool" {
                if let Some(srv) = &tc.server_name {
                    *mcp_map.entry(srv.clone()).or_insert(0) += 1;
                }
            }
        }
        if let Some(ms) = &st.model_switch {
            model_switches.push(ms.clone());
        }
        if st.permission_denied {
            permission_denials += 1;
        }

        priced_steps.push(StepPricedRow {
            step: st.clone(),
            cost_usd: step_cost_usd,
            cost_currency: step_cost_usd * mult,
            cumulative_fresh_in: cum_fresh,
            cumulative_cached: cum_cached,
            cumulative_output: cum_output,
            cumulative_total: cum_fresh + cum_cached + cum_output,
        });
    }

    // Identify top 3 cost-spike steps
    let mut cost_ranked: Vec<(i64, f64)> = priced_steps
        .iter()
        .filter(|s| s.cost_usd > 0.0)
        .map(|s| (s.step.step_index, s.cost_usd))
        .collect();
    cost_ranked.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));
    let top_n: Vec<(i64, f64)> = cost_ranked.into_iter().take(3).collect();
    let top_spike_steps: Vec<i64> = top_n.iter().map(|(idx, _)| *idx).collect();
    let top_spike_cost: f64 = top_n.iter().map(|(_, c)| *c).sum();
    let top_spike_share = safe_div(top_spike_cost, total_cost_usd, 0.0);

    let mut tool_stats: Vec<ToolStatRow> = tool_map
        .into_iter()
        .map(|(name, (call_count, token_total))| ToolStatRow {
            name,
            call_count,
            token_total,
        })
        .collect();
    tool_stats.sort_by(|a, b| b.call_count.cmp(&a.call_count));

    let mut mcp_stats: Vec<McpStatRow> = mcp_map
        .into_iter()
        .map(|(server_name, call_count)| McpStatRow {
            server_name,
            call_count,
        })
        .collect();
    mcp_stats.sort_by(|a, b| b.call_count.cmp(&a.call_count));

    let subagents: Vec<SessionSummary> = scan
        .sessions
        .iter()
        .filter(|s| s.parent_id.as_deref() == Some(&session.session_id))
        .map(|s| {
            let sub_cost_usd = if let (Some(p), _) = catalog.price_on(
                model_id,
                s.first_local_date.as_deref().unwrap_or("2026-11-15"),
            ) {
                (s.fresh_in as f64 * p.input_usd
                    + s.cached as f64 * p.cached_usd
                    + s.output as f64 * p.output_usd)
                    / 1_000_000.0
            } else {
                0.0
            };
            SessionSummary {
                session_id: s.session_id.clone(),
                short_id: s.short_id.clone(),
                source: s.source.clone(),
                kind: s.kind,
                title: s.title.clone(),
                is_untitled: s.is_untitled,
                label_source: s.label_source.clone(),
                project: s.project.clone(),
                workspace: s.workspace.clone(),
                parent_id: s.parent_id.clone(),
                agent_type: s.agent_type.clone(),
                role: s.role.clone(),
                first_utc: s.first_utc.clone(),
                last_utc: s.last_utc.clone(),
                first_local_date: s.first_local_date.clone(),
                duration_secs: s.duration_secs,
                calls: s.calls,
                step_count: s.step_count,
                fresh_in: s.fresh_in,
                cached: s.cached,
                output: s.output,
                total: s.total,
                cost_usd: sub_cost_usd,
                cost_currency: sub_cost_usd * mult,
                cache_hit_rate: safe_div(s.cached as f64, (s.fresh_in + s.cached) as f64, 0.0),
                tool_names: s.tool_names.clone(),
                child_ids: Vec::new(),
            }
        })
        .collect();

    let summary = SessionSummary {
        session_id: session.session_id.clone(),
        short_id: session.short_id.clone(),
        source: session.source.clone(),
        kind: session.kind,
        title: session.title.clone(),
        is_untitled: session.is_untitled,
        label_source: session.label_source.clone(),
        project: session.project.clone(),
        workspace: session.workspace.clone(),
        parent_id: session.parent_id.clone(),
        agent_type: session.agent_type.clone(),
        role: session.role.clone(),
        first_utc: session.first_utc.clone(),
        last_utc: session.last_utc.clone(),
        first_local_date: session.first_local_date.clone(),
        duration_secs: session.duration_secs,
        calls: session.calls,
        step_count: session.step_count,
        fresh_in: session.fresh_in,
        cached: session.cached,
        output: session.output,
        total: session.total,
        cost_usd: total_cost_usd,
        cost_currency: total_cost_usd * mult,
        cache_hit_rate: safe_div(
            session.cached as f64,
            (session.fresh_in + session.cached) as f64,
            0.0,
        ),
        tool_names: session.tool_names.clone(),
        child_ids,
    };

    Ok(SessionDetailPayload {
        summary,
        parent_title,
        thinking_steps: session.thinking_steps,
        error_steps: session.error_steps,
        tool_call_count: session.tool_call_count,
        transcript_path: session.transcript_path.clone(),
        metadata_source: session.metadata_source.clone(),
        top_spike_steps,
        top_spike_share,
        steps: priced_steps,
        tool_stats,
        mcp_stats,
        command_execs: session.command_execs.clone(),
        subagents,
        model_switches,
        permission_denials,
    })
}

// ---------------------------------------------------------------------------
// Token Usage Dashboard Aggregation
// ---------------------------------------------------------------------------

fn effective_model_label(raw: &str) -> &str {
    if raw.is_empty() {
        "Unrecorded"
    } else {
        raw
    }
}

fn session_matches_token_filter(session: &SessionRecord, filter: &TokenUsageFilter) -> bool {
    if let Some(proj) = &filter.project {
        if &session.project != proj {
            return false;
        }
    }
    match &filter.agent {
        AgentFilter::All => true,
        AgentFilter::MainOnly => session.kind == SessionKind::Main,
        AgentFilter::SubagentsOnly => session.kind == SessionKind::Subagent,
        AgentFilter::AgentType(agent_type) => {
            session.kind == SessionKind::Subagent
                && session.agent_type.as_deref() == Some(agent_type.as_str())
        }
    }
}

fn resolve_step_date(
    st: &StepRecord,
    session: &SessionRecord,
    step_ts: Option<DateTime<Utc>>,
) -> Option<NaiveDate> {
    step_ts
        .map(|ts| ts.with_timezone(&Local).date_naive())
        .or_else(|| {
            st.local_date
                .as_deref()
                .or(session.first_local_date.as_deref())
                .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        })
}

fn format_week_range_label(mon: NaiveDate) -> String {
    let sun = mon + Duration::days(6);
    if mon.year() == sun.year() && mon.month() == sun.month() {
        format!(
            "{}\u{2013}{}, {}",
            mon.format("%b %-d"),
            sun.format("%-d"),
            mon.year()
        )
    } else if mon.year() == sun.year() {
        format!(
            "{} \u{2013} {}, {}",
            mon.format("%b %-d"),
            sun.format("%b %-d"),
            mon.year()
        )
    } else {
        format!(
            "{} \u{2013} {}",
            mon.format("%b %-d, %Y"),
            sun.format("%b %-d, %Y")
        )
    }
}

struct WindowScaffold {
    granularity: TimeGranularity,
    window_start: Option<String>,
    window_end: String,
    buckets: Vec<TimeUsageBucket>,
    bucket_index: HashMap<String, usize>,
    hour_bounds: Option<(DateTime<Local>, DateTime<Local>)>,
    date_bounds: Option<(NaiveDate, NaiveDate)>,
}

fn push_bucket(
    buckets: &mut Vec<TimeUsageBucket>,
    bucket_index: &mut HashMap<String, usize>,
    key: String,
    axis_label: String,
    range_label: String,
) {
    let idx = buckets.len();
    bucket_index.insert(key.clone(), idx);
    buckets.push(TimeUsageBucket {
        key,
        axis_label,
        range_label,
        fresh_in: 0,
        cached: 0,
        output: 0,
        total: 0,
    });
}

fn build_window_scaffold(
    period: TimePeriod,
    now: DateTime<Local>,
    matching_sessions: &[&SessionRecord],
) -> WindowScaffold {
    let mut buckets = Vec::new();
    let mut bucket_index = HashMap::new();
    let today = now.date_naive();

    match period {
        TimePeriod::OneDay => {
            let end_hour = now
                - Duration::seconds(now.minute() as i64 * 60 + now.second() as i64)
                - Duration::nanoseconds(now.nanosecond() as i64);
            let start_hour = end_hour - Duration::hours(23);
            let end_exclusive = end_hour + Duration::hours(1);

            for i in 0..24i64 {
                let h = start_hour + Duration::hours(i);
                let h_next = h + Duration::hours(1);
                push_bucket(
                    &mut buckets,
                    &mut bucket_index,
                    h.format("%Y-%m-%dT%H:00").to_string(),
                    h.format("%H:00").to_string(),
                    format!(
                        "{}\u{2013}{}",
                        h.format("%b %-d, %H:00"),
                        h_next.format("%H:00")
                    ),
                );
            }

            WindowScaffold {
                granularity: TimeGranularity::Hourly,
                window_start: Some(start_hour.format("%b %-d, %H:00").to_string()),
                window_end: end_hour.format("%b %-d, %H:00").to_string(),
                buckets,
                bucket_index,
                hour_bounds: Some((start_hour, end_exclusive)),
                date_bounds: None,
            }
        }
        TimePeriod::OneWeek | TimePeriod::OneMonth => {
            let days_back = if period == TimePeriod::OneWeek { 6 } else { 29 };
            let start_date = today - Duration::days(days_back);
            let mut d = start_date;
            while d <= today {
                push_bucket(
                    &mut buckets,
                    &mut bucket_index,
                    d.format("%Y-%m-%d").to_string(),
                    d.format("%b %-d").to_string(),
                    d.format("%b %-d, %Y").to_string(),
                );
                d += Duration::days(1);
            }

            WindowScaffold {
                granularity: TimeGranularity::Daily,
                window_start: Some(start_date.format("%b %-d, %Y").to_string()),
                window_end: today.format("%b %-d, %Y").to_string(),
                buckets,
                bucket_index,
                hour_bounds: None,
                date_bounds: Some((start_date, today)),
            }
        }
        TimePeriod::SixMonths => {
            let raw_start = today - Duration::days(182);
            let first_monday =
                raw_start - Duration::days(raw_start.weekday().num_days_from_monday() as i64);
            let last_monday =
                today - Duration::days(today.weekday().num_days_from_monday() as i64);

            let mut mon = first_monday;
            while mon <= last_monday {
                push_bucket(
                    &mut buckets,
                    &mut bucket_index,
                    mon.format("%Y-%m-%d").to_string(),
                    mon.format("%b %-d").to_string(),
                    format_week_range_label(mon),
                );
                mon += Duration::days(7);
            }

            WindowScaffold {
                granularity: TimeGranularity::Weekly,
                window_start: Some(first_monday.format("%b %-d, %Y").to_string()),
                window_end: today.format("%b %-d, %Y").to_string(),
                buckets,
                bucket_index,
                hour_bounds: None,
                date_bounds: Some((first_monday, today)),
            }
        }
        TimePeriod::Lifetime => {
            let mut earliest: Option<NaiveDate> = None;
            for session in matching_sessions {
                for st in &session.steps {
                    let step_ts = st
                        .created_at
                        .as_deref()
                        .and_then(parse_iso_ts)
                        .map(|dt| dt.with_timezone(&Utc));
                    if let Some(d) = resolve_step_date(st, session, step_ts) {
                        if d <= today {
                            earliest = Some(earliest.map_or(d, |cur| cur.min(d)));
                        }
                    }
                }
            }

            let today_month_first =
                NaiveDate::from_ymd_opt(today.year(), today.month(), 1).unwrap();
            let (start_month_first, window_start) = match earliest {
                Some(d) => {
                    let mf = NaiveDate::from_ymd_opt(d.year(), d.month(), 1).unwrap();
                    (mf, Some(mf.format("%b %Y").to_string()))
                }
                None => (today_month_first, None),
            };

            let mut y = start_month_first.year();
            let mut m = start_month_first.month();
            let end_y = today.year();
            let end_m = today.month();
            loop {
                let d = NaiveDate::from_ymd_opt(y, m, 1).unwrap();
                push_bucket(
                    &mut buckets,
                    &mut bucket_index,
                    d.format("%Y-%m").to_string(),
                    d.format("%b '%y").to_string(),
                    d.format("%b %Y").to_string(),
                );
                if y == end_y && m == end_m {
                    break;
                }
                if m == 12 {
                    y += 1;
                    m = 1;
                } else {
                    m += 1;
                }
            }

            WindowScaffold {
                granularity: TimeGranularity::Monthly,
                window_start,
                window_end: today_month_first.format("%b %Y").to_string(),
                buckets,
                bucket_index,
                hour_bounds: None,
                date_bounds: Some((start_month_first, today)),
            }
        }
    }
}

fn step_bucket_key(
    period: TimePeriod,
    scaffold: &WindowScaffold,
    st: &StepRecord,
    session: &SessionRecord,
    step_ts: Option<DateTime<Utc>>,
) -> Option<String> {
    match period {
        TimePeriod::OneDay => {
            let ts = step_ts?;
            let local_dt = ts.with_timezone(&Local);
            let (start_h, end_excl) = scaffold.hour_bounds?;
            if local_dt < start_h || local_dt >= end_excl {
                return None;
            }
            Some(local_dt.format("%Y-%m-%dT%H:00").to_string())
        }
        TimePeriod::OneWeek | TimePeriod::OneMonth => {
            let d = resolve_step_date(st, session, step_ts)?;
            let (min_d, max_d) = scaffold.date_bounds?;
            if d < min_d || d > max_d {
                return None;
            }
            Some(d.format("%Y-%m-%d").to_string())
        }
        TimePeriod::SixMonths => {
            let d = resolve_step_date(st, session, step_ts)?;
            let (min_d, max_d) = scaffold.date_bounds?;
            if d < min_d || d > max_d {
                return None;
            }
            let mon = d - Duration::days(d.weekday().num_days_from_monday() as i64);
            Some(mon.format("%Y-%m-%d").to_string())
        }
        TimePeriod::Lifetime => {
            let d = resolve_step_date(st, session, step_ts)?;
            let (min_d, max_d) = scaffold.date_bounds?;
            if d < min_d || d > max_d {
                return None;
            }
            Some(d.format("%Y-%m").to_string())
        }
    }
}

/// Build the Token Usage dashboard payload using the current local time.
pub fn build_token_usage(scan: &ScanResult, filter: &TokenUsageFilter) -> TokenUsagePayload {
    build_token_usage_at(scan, filter, Local::now())
}

/// Build the Token Usage dashboard payload evaluated at a specific local timestamp.
pub fn build_token_usage_at(
    scan: &ScanResult,
    filter: &TokenUsageFilter,
    now: DateTime<Local>,
) -> TokenUsagePayload {
    let mut projects_set: BTreeSet<String> = BTreeSet::new();
    let mut models_set: BTreeSet<String> = BTreeSet::new();
    let mut agent_types_set: BTreeSet<String> = BTreeSet::new();

    for session in &scan.sessions {
        if !session.project.is_empty() {
            projects_set.insert(session.project.clone());
        }
        if session.kind == SessionKind::Subagent {
            if let Some(agent_type) = &session.agent_type {
                if !agent_type.is_empty() {
                    agent_types_set.insert(agent_type.clone());
                }
            }
        }
        for st in &session.steps {
            models_set.insert(effective_model_label(&st.observed_model).to_string());
        }
    }

    let has_unrecorded = models_set.remove("Unrecorded");
    let mut available_models: Vec<String> = models_set.into_iter().collect();
    if has_unrecorded {
        available_models.push("Unrecorded".to_string());
    }
    let available_projects: Vec<String> = projects_set.into_iter().collect();
    let available_agent_types: Vec<String> = agent_types_set.into_iter().collect();

    let matching_sessions: Vec<&SessionRecord> = scan
        .sessions
        .iter()
        .filter(|s| session_matches_token_filter(s, filter))
        .collect();

    let mut scaffold = build_window_scaffold(filter.period, now, &matching_sessions);

    #[derive(Default)]
    struct ModelAcc {
        fresh_in: u64,
        cached: u64,
        output: u64,
        wall_time_secs: u64,
        calls: u64,
        sessions: u64,
    }

    let mut model_map: HashMap<String, ModelAcc> = HashMap::new();
    let mut total_fresh_in = 0u64;
    let mut total_cached = 0u64;
    let mut total_output = 0u64;
    let mut total_wall_time_secs = 0u64;
    let mut total_calls = 0u64;
    let mut total_sessions = 0u64;

    for session in &matching_sessions {
        let mut prev_ts: Option<DateTime<Utc>> = None;
        let mut session_counted_in_totals = false;
        let mut session_models: HashSet<String> = HashSet::new();

        for st in &session.steps {
            let step_ts = st
                .created_at
                .as_deref()
                .and_then(parse_iso_ts)
                .map(|dt| dt.with_timezone(&Utc));

            let wall = match (prev_ts, step_ts) {
                (Some(prev), Some(cur)) if cur >= prev => {
                    let delta = (cur - prev).num_seconds();
                    if delta <= WALL_TIME_GAP_CAP_SECS {
                        delta as u64
                    } else {
                        0
                    }
                }
                _ => 0,
            };
            prev_ts = step_ts;

            let Some(bucket_key) = step_bucket_key(filter.period, &scaffold, st, session, step_ts)
            else {
                continue;
            };
            let Some(&bucket_idx) = scaffold.bucket_index.get(&bucket_key) else {
                continue;
            };

            let model = effective_model_label(&st.observed_model);
            let m_acc = model_map.entry(model.to_string()).or_default();
            m_acc.wall_time_secs += wall;
            if session_models.insert(model.to_string()) {
                m_acc.sessions += 1;
            }
            if st.has_tokens {
                m_acc.fresh_in += st.fresh_in;
                m_acc.cached += st.cached;
                m_acc.output += st.output;
                m_acc.calls += 1;
            }

            let model_matches = filter
                .model
                .as_deref()
                .map_or(true, |selected| selected == model);
            if model_matches {
                if !session_counted_in_totals {
                    session_counted_in_totals = true;
                    total_sessions += 1;
                }
                total_wall_time_secs += wall;
                if st.has_tokens {
                    let step_total = st.fresh_in + st.cached + st.output;
                    total_fresh_in += st.fresh_in;
                    total_cached += st.cached;
                    total_output += st.output;
                    total_calls += 1;

                    let bucket = &mut scaffold.buckets[bucket_idx];
                    bucket.fresh_in += st.fresh_in;
                    bucket.cached += st.cached;
                    bucket.output += st.output;
                    bucket.total += step_total;
                }
            }
        }
    }

    let mut by_model: Vec<ModelUsageRow> = model_map
        .into_iter()
        .filter(|(_, acc)| acc.calls > 0 || acc.wall_time_secs > 0)
        .map(|(model, acc)| {
            let total = acc.fresh_in + acc.cached + acc.output;
            ModelUsageRow {
                model,
                fresh_in: acc.fresh_in,
                cached: acc.cached,
                output: acc.output,
                total,
                cache_hit_rate: safe_div(acc.cached as f64, (acc.fresh_in + acc.cached) as f64, 0.0),
                wall_time_secs: acc.wall_time_secs,
                calls: acc.calls,
                sessions: acc.sessions,
            }
        })
        .collect();

    by_model.sort_by(|a, b| b.total.cmp(&a.total).then_with(|| a.model.cmp(&b.model)));

    let totals = TokenUsageTotals {
        fresh_in: total_fresh_in,
        cached: total_cached,
        output: total_output,
        total: total_fresh_in + total_cached + total_output,
        cache_hit_rate: safe_div(
            total_cached as f64,
            (total_fresh_in + total_cached) as f64,
            0.0,
        ),
        wall_time_secs: total_wall_time_secs,
        calls: total_calls,
        sessions: total_sessions,
    };

    TokenUsagePayload {
        filter: filter.clone(),
        window_start: scaffold.window_start,
        window_end: scaffold.window_end,
        granularity: scaffold.granularity,
        available_projects,
        available_models,
        available_agent_types,
        totals,
        time_series: scaffold.buckets,
        by_model,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pricing::default_catalog;
    use chrono::TimeZone;

    #[test]
    fn safe_div_guards_zero_and_nonfinite() {
        assert_eq!(safe_div(10.0, 0.0, 0.0), 0.0);
        assert_eq!(safe_div(f64::NAN, 5.0, 0.0), 0.0);
        assert_eq!(safe_div(5.0, f64::INFINITY, 0.0), 0.0);
        assert!((safe_div(9.0, 10.0, 0.0) - 0.9).abs() < 1e-12);
    }

    #[test]
    fn reference_pricing_and_shares_match_spec() {
        // 28.30M new + 276.31M cached + 3.08M output at Gemini 3.8 Flash ($0.75 / $0.075 / $3.75), USD_INR = 88.0
        let cat = Catalog::new(default_catalog());
        let (p, est) = cat.price_on("gemini-3.8-flash", "2026-11-15");
        let p = p.unwrap();
        assert!(!est);

        let fresh = 28_300_000u64;
        let cached = 276_310_000u64;
        let output = 3_080_000u64;

        let totals = token_totals_from_counts(fresh, cached, output, 1000, 120);
        assert_eq!(totals.total, 307_690_000);
        assert!((totals.cached_share * 100.0 - 89.8).abs() < 0.1);
        assert!((totals.fresh_share * 100.0 - 9.2).abs() < 0.1);
        assert!((totals.output_share * 100.0 - 1.0).abs() < 0.1);
        assert!((totals.cache_hit_rate * 100.0 - 90.7).abs() < 0.1);

        let fresh_usd = fresh as f64 * p.input_usd / 1_000_000.0;
        let cached_usd = cached as f64 * p.cached_usd / 1_000_000.0;
        let output_usd = output as f64 * p.output_usd / 1_000_000.0;
        let cost = cost_breakdown_from_usd(
            fresh_usd,
            cached_usd,
            output_usd,
            "INR",
            88.0,
            false,
            &[],
        );

        // ~$53.50 / ~₹4,708 (exact: 21.225 + 20.72325 + 11.55 = 53.49825 -> $53.50, ₹4,707.85)
        assert!((cost.total_usd - 53.49825).abs() < 0.01);
        assert!((cost.total_currency - 4707.846).abs() < 1.0);
        assert!((cost.fresh_share * 100.0 - 39.7).abs() < 0.1);
        assert!((cost.cached_share * 100.0 - 38.7).abs() < 0.1);
        assert!((cost.output_share * 100.0 - 21.6).abs() < 0.1);
    }

    fn make_test_scan(sessions: Vec<SessionRecord>) -> ScanResult {
        use crate::models::ScanDiagnostics;
        ScanResult {
            sessions,
            diagnostics: ScanDiagnostics {
                scanned_at: String::new(),
                scanned_at_local_hm: String::new(),
                duration_ms: 0,
                sources: Vec::new(),
                total_transcripts: 0,
                total_with_tokens: 0,
                total_without_tokens: 0,
                total_parse_errors: 0,
                total_pb_only: 0,
                total_corrupted_tool_names_dropped: 0,
                total_capped_step_gaps: 0,
                consistency: ConsistencyReport {
                    ok: true,
                    session_row_mismatches: 0,
                    daily_row_mismatches: 0,
                    session_total: 0,
                    daily_total: 0,
                    discrepancy: 0,
                    message: String::new(),
                },
                snapshot_runs: 0,
                warnings: Vec::new(),
            },
        }
    }

    fn make_test_step(
        step_index: i64,
        created_at: Option<String>,
        local_date: Option<&str>,
        observed_model: &str,
        fresh_in: u64,
        cached: u64,
        output: u64,
        has_tokens: bool,
    ) -> crate::models::StepRecord {
        crate::models::StepRecord {
            step_index,
            created_at,
            local_date: local_date.map(str::to_string),
            local_time: None,
            step_type: "plannerResponse".to_string(),
            source: "app".to_string(),
            status: "done".to_string(),
            fresh_in,
            cached,
            output,
            total: fresh_in + cached + output,
            has_tokens,
            thinking_preview: None,
            thinking_full: None,
            content_preview: None,
            tool_calls: Vec::new(),
            is_error: false,
            permission_denied: false,
            model_switch: None,
            observed_model: observed_model.to_string(),
            command_duration_secs: None,
            command_exit_code: None,
        }
    }

    fn make_test_session(
        session_id: &str,
        kind: SessionKind,
        project: &str,
        agent_type: Option<&str>,
        first_local_date: Option<&str>,
        steps: Vec<crate::models::StepRecord>,
    ) -> SessionRecord {
        SessionRecord {
            session_id: session_id.to_string(),
            short_id: session_id.chars().take(8).collect(),
            source: SourceKind::App,
            kind,
            title: session_id.to_string(),
            is_untitled: false,
            label_source: "test".to_string(),
            project: project.to_string(),
            workspace: String::new(),
            parent_id: None,
            agent_type: agent_type.map(str::to_string),
            role: None,
            first_utc: None,
            last_utc: None,
            first_local_date: first_local_date.map(str::to_string),
            last_local_date: first_local_date.map(str::to_string),
            duration_secs: 0,
            calls: steps.iter().filter(|s| s.has_tokens).count() as u64,
            step_count: steps.len() as u64,
            fresh_in: steps.iter().map(|s| s.fresh_in).sum(),
            cached: steps.iter().map(|s| s.cached).sum(),
            output: steps.iter().map(|s| s.output).sum(),
            total: steps.iter().map(|s| s.total).sum(),
            thinking_steps: 0,
            error_steps: 0,
            tool_call_count: 0,
            tool_names: Vec::new(),
            transcript_path: String::new(),
            metadata_source: "test".to_string(),
            steps,
            command_execs: Vec::new(),
            spawn_step_index: None,
            written_plan_paths: Vec::new(),
            referenced_plan_paths: Vec::new(),
            message_turns: std::collections::HashMap::new(),
        }
    }

    #[test]
    fn token_usage_1d_hourly_buckets_and_hover_labels() {
        let now = Local.with_ymd_and_hms(2026, 11, 22, 17, 25, 0).unwrap();
        let ts_14_15 = Local
            .with_ymd_and_hms(2026, 11, 22, 14, 15, 0)
            .unwrap()
            .to_rfc3339();
        let ts_prev_day_out = Local
            .with_ymd_and_hms(2026, 11, 21, 17, 59, 0)
            .unwrap()
            .to_rfc3339();

        let scan = make_test_scan(vec![make_test_session(
            "s1",
            SessionKind::Main,
            "proj-a",
            None,
            Some("2026-11-22"),
            vec![
                make_test_step(0, Some(ts_prev_day_out), Some("2026-11-21"), "gemini-3.8-flash", 999, 0, 0, true),
                make_test_step(1, Some(ts_14_15), Some("2026-11-22"), "gemini-3.8-flash", 100, 200, 50, true),
                // Undated step must be excluded in 1D
                make_test_step(2, None, Some("2026-11-22"), "gemini-3.8-flash", 500, 0, 0, true),
            ],
        )]);

        let filter = TokenUsageFilter {
            period: TimePeriod::OneDay,
            project: None,
            model: None,
            agent: AgentFilter::All,
        };
        let payload = build_token_usage_at(&scan, &filter, now);

        assert_eq!(payload.granularity, TimeGranularity::Hourly);
        assert_eq!(payload.window_start.as_deref(), Some("Nov 21, 18:00"));
        assert_eq!(payload.window_end, "Nov 22, 17:00");
        assert_eq!(payload.time_series.len(), 24);
        assert_eq!(payload.totals.fresh_in, 100);
        assert_eq!(payload.totals.cached, 200);
        assert_eq!(payload.totals.output, 50);
        assert_eq!(payload.totals.total, 350);
        assert_eq!(payload.totals.calls, 1);
        assert_eq!(payload.totals.sessions, 1);

        let b14 = payload
            .time_series
            .iter()
            .find(|b| b.key == "2026-11-22T14:00")
            .expect("14:00 bucket");
        assert_eq!(b14.axis_label, "14:00");
        assert_eq!(b14.range_label, "Nov 22, 14:00\u{2013}15:00");
        assert_eq!(b14.fresh_in, 100);
        assert_eq!(b14.cached, 200);
        assert_eq!(b14.output, 50);
        assert_eq!(b14.total, 350);
    }

    #[test]
    fn token_usage_caps_wall_time_gaps_over_30_minutes() {
        let now = Local.with_ymd_and_hms(2026, 11, 22, 17, 0, 0).unwrap();
        let t0 = Local.with_ymd_and_hms(2026, 11, 22, 10, 0, 0).unwrap().to_rfc3339();
        let t1 = Local.with_ymd_and_hms(2026, 11, 22, 10, 10, 0).unwrap().to_rfc3339(); // +600s
        let t2 = Local.with_ymd_and_hms(2026, 11, 22, 10, 55, 0).unwrap().to_rfc3339(); // +2700s -> capped to 0
        let t3 = Local.with_ymd_and_hms(2026, 11, 22, 11, 5, 0).unwrap().to_rfc3339(); // +600s

        let scan = make_test_scan(vec![make_test_session(
            "s-wall",
            SessionKind::Main,
            "proj-a",
            None,
            Some("2026-11-22"),
            vec![
                make_test_step(0, Some(t0), Some("2026-11-22"), "model-a", 100, 0, 10, true),
                make_test_step(1, Some(t1), Some("2026-11-22"), "model-a", 0, 0, 0, false),
                make_test_step(2, Some(t2), Some("2026-11-22"), "model-b", 200, 0, 20, true),
                make_test_step(3, Some(t3), Some("2026-11-22"), "model-b", 50, 0, 5, true),
            ],
        )]);

        let filter = TokenUsageFilter {
            period: TimePeriod::OneWeek,
            project: None,
            model: None,
            agent: AgentFilter::All,
        };
        let payload = build_token_usage_at(&scan, &filter, now);

        assert_eq!(payload.totals.wall_time_secs, 1200);
        assert_eq!(payload.totals.calls, 3);
        assert_eq!(payload.totals.sessions, 1);

        let row_b = payload.by_model.iter().find(|r| r.model == "model-b").unwrap();
        let row_a = payload.by_model.iter().find(|r| r.model == "model-a").unwrap();
        assert_eq!(row_a.wall_time_secs, 600);
        assert_eq!(row_a.total, 110);
        assert_eq!(row_a.calls, 1);
        assert_eq!(row_b.wall_time_secs, 600);
        assert_eq!(row_b.total, 275);
        assert_eq!(row_b.calls, 2);
    }

    #[test]
    fn token_usage_filters_by_project_agent_and_model() {
        let now = Local.with_ymd_and_hms(2026, 11, 22, 17, 0, 0).unwrap();
        let ts = Local.with_ymd_and_hms(2026, 11, 22, 12, 0, 0).unwrap().to_rfc3339();

        let scan = make_test_scan(vec![
            make_test_session(
                "s-main-alpha",
                SessionKind::Main,
                "alpha",
                None,
                Some("2026-11-22"),
                vec![
                    make_test_step(0, Some(ts.clone()), Some("2026-11-22"), "claude-sonnet", 100, 0, 20, true),
                    make_test_step(1, Some(ts.clone()), Some("2026-11-22"), "gemini-flash", 300, 0, 30, true),
                ],
            ),
            make_test_session(
                "s-sub-alpha-res",
                SessionKind::Subagent,
                "alpha",
                Some("researcher"),
                Some("2026-11-22"),
                vec![
                    make_test_step(0, Some(ts.clone()), Some("2026-11-22"), "", 50, 50, 10, true),
                    make_test_step(1, Some(ts.clone()), Some("2026-11-22"), "claude-sonnet", 200, 0, 40, true),
                ],
            ),
            make_test_session(
                "s-sub-beta-impl",
                SessionKind::Subagent,
                "beta",
                Some("implementer"),
                Some("2026-11-22"),
                vec![make_test_step(0, Some(ts), Some("2026-11-22"), "gemini-flash", 500, 0, 50, true)],
            ),
        ]);

        // Dropdowns never collapse and Unrecorded is sorted last
        let f_main = TokenUsageFilter {
            period: TimePeriod::OneWeek,
            project: Some("alpha".to_string()),
            model: Some("claude-sonnet".to_string()),
            agent: AgentFilter::MainOnly,
        };
        let p_main = build_token_usage_at(&scan, &f_main, now);
        assert_eq!(p_main.available_projects, vec!["alpha", "beta"]);
        assert_eq!(p_main.available_models, vec!["claude-sonnet", "gemini-flash", "Unrecorded"]);
        assert_eq!(p_main.available_agent_types, vec!["implementer", "researcher"]);
        // totals & time_series reflect model filter
        assert_eq!(p_main.totals.total, 120);
        assert_eq!(p_main.totals.sessions, 1);
        let bucket_sum: u64 = p_main.time_series.iter().map(|b| b.total).sum();
        assert_eq!(bucket_sum, 120);
        // by_model ignores filter.model so both models in alpha/MainOnly remain
        assert_eq!(p_main.by_model.len(), 2);
        assert_eq!(p_main.by_model[0].model, "gemini-flash");
        assert_eq!(p_main.by_model[0].total, 330);
        assert_eq!(p_main.by_model[1].model, "claude-sonnet");
        assert_eq!(p_main.by_model[1].total, 120);

        // SubagentsOnly across all projects/models
        let f_subs = TokenUsageFilter {
            period: TimePeriod::OneWeek,
            project: None,
            model: None,
            agent: AgentFilter::SubagentsOnly,
        };
        let p_subs = build_token_usage_at(&scan, &f_subs, now);
        assert_eq!(p_subs.totals.sessions, 2);
        assert_eq!(p_subs.totals.total, 110 + 240 + 550);

        // AgentType("researcher")
        let f_res = TokenUsageFilter {
            period: TimePeriod::OneWeek,
            project: None,
            model: None,
            agent: AgentFilter::AgentType("researcher".to_string()),
        };
        let p_res = build_token_usage_at(&scan, &f_res, now);
        assert_eq!(p_res.totals.sessions, 1);
        assert_eq!(p_res.totals.total, 350);
    }

    #[test]
    fn token_usage_cache_hit_rate_and_empty_window() {
        let now = Local.with_ymd_and_hms(2026, 11, 22, 17, 0, 0).unwrap();
        let ts = Local.with_ymd_and_hms(2026, 11, 22, 12, 0, 0).unwrap().to_rfc3339();

        let scan = make_test_scan(vec![make_test_session(
            "s-cache",
            SessionKind::Main,
            "proj",
            None,
            Some("2026-11-22"),
            vec![make_test_step(0, Some(ts), Some("2026-11-22"), "gemini-3.8-flash", 100, 300, 50, true)],
        )]);

        let payload = build_token_usage_at(
            &scan,
            &TokenUsageFilter {
                period: TimePeriod::OneWeek,
                project: None,
                model: None,
                agent: AgentFilter::All,
            },
            now,
        );
        assert!((payload.totals.cache_hit_rate - 0.75).abs() < 1e-12);
        assert!((payload.by_model[0].cache_hit_rate - 0.75).abs() < 1e-12);

        let empty_scan = make_test_scan(Vec::new());
        let empty_payload = build_token_usage_at(
            &empty_scan,
            &TokenUsageFilter {
                period: TimePeriod::Lifetime,
                project: None,
                model: None,
                agent: AgentFilter::All,
            },
            now,
        );
        assert_eq!(empty_payload.granularity, TimeGranularity::Monthly);
        assert_eq!(empty_payload.window_start, None);
        assert_eq!(empty_payload.window_end, "Nov 2026");
        assert_eq!(empty_payload.totals.total, 0);
        assert_eq!(empty_payload.totals.cache_hit_rate, 0.0);
        assert!(empty_payload.by_model.is_empty());
        assert_eq!(empty_payload.time_series.len(), 1);
        assert_eq!(empty_payload.time_series[0].key, "2026-11");
    }

    #[test]
    fn token_usage_1m_6m_weekly_and_lifetime_monthly_labels() {
        let now = Local.with_ymd_and_hms(2026, 11, 22, 17, 0, 0).unwrap();
        let ts_oct_30 = Local.with_ymd_and_hms(2026, 10, 30, 10, 0, 0).unwrap().to_rfc3339();
        let ts_nov_12 = Local.with_ymd_and_hms(2026, 11, 12, 10, 0, 0).unwrap().to_rfc3339();
        let ts_dec_30 = Local.with_ymd_and_hms(2025, 12, 30, 10, 0, 0).unwrap().to_rfc3339();

        let scan = make_test_scan(vec![make_test_session(
            "s-span",
            SessionKind::Main,
            "proj",
            None,
            Some("2025-12-30"),
            vec![
                make_test_step(0, Some(ts_dec_30), Some("2025-12-30"), "gemini-3.8-flash", 10, 0, 5, true),
                make_test_step(1, Some(ts_oct_30), Some("2026-10-30"), "gemini-3.8-flash", 20, 0, 5, true),
                make_test_step(2, Some(ts_nov_12), Some("2026-11-12"), "gemini-3.8-flash", 30, 0, 5, true),
                // Undated step falls back to local_date in non-1D periods
                make_test_step(3, None, Some("2026-11-12"), "gemini-3.8-flash", 40, 0, 5, true),
            ],
        )]);

        // 1M: 30 daily buckets
        let p_1m = build_token_usage_at(
            &scan,
            &TokenUsageFilter {
                period: TimePeriod::OneMonth,
                project: None,
                model: None,
                agent: AgentFilter::All,
            },
            now,
        );
        assert_eq!(p_1m.granularity, TimeGranularity::Daily);
        assert_eq!(p_1m.time_series.len(), 30);
        assert_eq!(p_1m.window_start.as_deref(), Some("Oct 24, 2026"));
        assert_eq!(p_1m.window_end, "Nov 22, 2026");
        assert_eq!(p_1m.totals.total, 25 + 35 + 45);

        // 6M: Monday-anchored weekly buckets covering [today - 182d .. today]
        let p_6m = build_token_usage_at(
            &scan,
            &TokenUsageFilter {
                period: TimePeriod::SixMonths,
                project: None,
                model: None,
                agent: AgentFilter::All,
            },
            now,
        );
        assert_eq!(p_6m.granularity, TimeGranularity::Weekly);
        let w_oct = p_6m.time_series.iter().find(|b| b.key == "2026-10-26").unwrap();
        assert_eq!(w_oct.range_label, "Oct 26 \u{2013} Nov 1, 2026");
        assert_eq!(w_oct.total, 25);
        let w_nov = p_6m.time_series.iter().find(|b| b.key == "2026-11-09").unwrap();
        assert_eq!(w_nov.range_label, "Nov 9\u{2013}15, 2026");
        assert_eq!(w_nov.total, 80);
        assert_eq!(
            format_week_range_label(NaiveDate::from_ymd_opt(2025, 12, 29).unwrap()),
            "Dec 29, 2025 \u{2013} Jan 4, 2026"
        );

        // Lifetime: Dec 2025 .. Nov 2026 (12 monthly buckets)
        let p_life = build_token_usage_at(
            &scan,
            &TokenUsageFilter {
                period: TimePeriod::Lifetime,
                project: None,
                model: None,
                agent: AgentFilter::All,
            },
            now,
        );
        assert_eq!(p_life.granularity, TimeGranularity::Monthly);
        assert_eq!(p_life.window_start.as_deref(), Some("Dec 2025"));
        assert_eq!(p_life.window_end, "Nov 2026");
        assert_eq!(p_life.time_series.len(), 12);
        assert_eq!(p_life.time_series[0].key, "2025-12");
        assert_eq!(p_life.time_series[0].axis_label, "Dec '25");
        assert_eq!(p_life.time_series[0].range_label, "Dec 2025");
        assert_eq!(p_life.time_series[0].total, 15);
        assert_eq!(p_life.totals.total, 15 + 25 + 35 + 45);
    }

    #[test]
    fn token_usage_omits_zero_activity_model_rows() {
        let now = Local.with_ymd_and_hms(2026, 11, 22, 17, 0, 0).unwrap();
        let ts0 = Local
            .with_ymd_and_hms(2026, 11, 22, 12, 0, 0)
            .unwrap()
            .to_rfc3339();
        let ts1 = Local
            .with_ymd_and_hms(2026, 11, 22, 12, 0, 15)
            .unwrap()
            .to_rfc3339();
        let filter = TokenUsageFilter {
            period: TimePeriod::OneWeek,
            project: None,
            model: None,
            agent: AgentFilter::All,
        };

        // Single non-token step with 0 wall time must not emit a ghost model row.
        let single_zero = make_test_scan(vec![make_test_session(
            "s-zero",
            SessionKind::Main,
            "proj",
            None,
            Some("2026-11-22"),
            vec![make_test_step(
                0,
                Some(ts0.clone()),
                Some("2026-11-22"),
                "gemini-3.8-flash",
                0,
                0,
                0,
                false,
            )],
        )]);
        let p_zero = build_token_usage_at(&single_zero, &filter, now);
        assert!(p_zero.by_model.is_empty());
        assert_eq!(p_zero.totals.total, 0);

        // A model with non-zero wall time (even with 0 token calls) or tokens is kept.
        let active = make_test_scan(vec![make_test_session(
            "s-active",
            SessionKind::Main,
            "proj",
            None,
            Some("2026-11-22"),
            vec![
                make_test_step(
                    0,
                    Some(ts0.clone()),
                    Some("2026-11-22"),
                    "wall-only-model",
                    0,
                    0,
                    0,
                    false,
                ),
                make_test_step(
                    1,
                    Some(ts1.clone()),
                    Some("2026-11-22"),
                    "wall-only-model",
                    0,
                    0,
                    0,
                    false,
                ),
                make_test_step(
                    2,
                    Some(ts1),
                    Some("2026-11-22"),
                    "token-model",
                    10,
                    20,
                    5,
                    true,
                ),
            ],
        )]);
        let p_active = build_token_usage_at(&active, &filter, now);
        assert_eq!(p_active.by_model.len(), 2);
        let token_row = p_active
            .by_model
            .iter()
            .find(|r| r.model == "token-model")
            .unwrap();
        assert_eq!(token_row.calls, 1);
        assert_eq!(token_row.total, 35);
        let wall_row = p_active
            .by_model
            .iter()
            .find(|r| r.model == "wall-only-model")
            .unwrap();
        assert_eq!(wall_row.calls, 0);
        assert_eq!(wall_row.wall_time_secs, 15);
    }
}
