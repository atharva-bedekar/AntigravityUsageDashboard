#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

use antigravity_usage_lib::config::load_config;
use antigravity_usage_lib::metrics::{build_dashboard, verify_consistency};
use antigravity_usage_lib::models::FilterState;
use antigravity_usage_lib::pricing::Catalog;
use antigravity_usage_lib::scanner::scan_all_sources;

fn run_smoke_test() -> i32 {
    let cfg = load_config();
    let scan = scan_all_sources(&cfg);
    let catalog = Catalog::load(cfg.pricing_path.as_deref());
    let filter = FilterState {
        date_preset: "all".to_string(),
        custom_start: None,
        custom_end: None,
        source_filter: "all".to_string(),
        project_filter: None,
        model_id: cfg.default_model_id.clone(),
        currency: cfg.reporting_currency.clone(),
    };
    let dashboard = build_dashboard(&scan, &cfg, &catalog, &filter);
    let refs: Vec<_> = scan
        .sessions
        .iter()
        .filter(|s| s.calls > 0)
        .cloned()
        .collect();
    let consistency = verify_consistency(&refs, &dashboard.daily);

    println!("=== Antigravity Usage Smoke Test ===");
    println!("Scan duration: {} ms", scan.diagnostics.duration_ms);
    for src in &scan.diagnostics.sources {
        println!(
            "Source [{}]: exists={} enabled={} transcripts={} with_tokens={} without_tokens={} pb_only={} parse_errors={} titles_matched={}/{} projects_matched={}/{}",
            src.label,
            src.exists,
            src.enabled,
            src.transcript_files_found,
            src.sessions_with_tokens,
            src.sessions_without_tokens,
            src.pb_only_stems.len(),
            src.parse_errors,
            src.titles_matched,
            src.sessions_with_tokens,
            src.projects_matched,
            src.sessions_with_tokens,
        );
    }
    println!(
        "Totals: sessions={} (CLI={}, App={}), fresh_in={}, cached={}, output={}, total={}, cache_hit={:.1}%",
        dashboard.totals.sessions,
        dashboard.cli_totals.sessions,
        dashboard.app_totals.sessions,
        dashboard.totals.fresh_in,
        dashboard.totals.cached,
        dashboard.totals.output,
        dashboard.totals.total,
        dashboard.totals.cache_hit_rate * 100.0
    );
    println!(
        "Estimated cost ({}, {}): ${:.2} USD / {:.2} {}",
        dashboard.active_model.name,
        dashboard.cost.currency,
        dashboard.cost.total_usd,
        dashboard.cost.total_currency,
        dashboard.cost.currency
    );
    println!("Consistency: ok={} ({})", consistency.ok, consistency.message);

    if consistency.ok {
        0
    } else {
        1
    }
}

fn main() {
    if std::env::args().any(|a| a == "--smoke-test") {
        std::process::exit(run_smoke_test());
    }
    antigravity_usage_lib::run()
}
