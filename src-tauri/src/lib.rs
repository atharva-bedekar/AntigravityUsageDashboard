pub mod config;
pub mod export;
pub mod forecast;
pub mod metrics;
pub mod models;
pub mod pricing;
pub mod scanner;
pub mod snapshots;

use std::sync::Mutex;

use crate::config::load_config;
use crate::metrics::{build_daily_series, verify_consistency};
use crate::models::{AppConfig, ScanResult};
use crate::pricing::Catalog;
use crate::scanner::scan_all_sources;
use crate::snapshots::{ingest_snapshot, run_count};

pub struct InnerState {
    pub config: AppConfig,
    pub last_scan: Option<ScanResult>,
}

pub struct AppState(pub Mutex<InnerState>);

impl Default for AppState {
    fn default() -> Self {
        Self(Mutex::new(InnerState {
            config: load_config(),
            last_scan: None,
        }))
    }
}

fn perform_scan(cfg: &AppConfig) -> ScanResult {
    let mut scan = scan_all_sources(cfg);
    let catalog = Catalog::load(cfg.pricing_path.as_deref());
    let refs: Vec<&_> = scan.sessions.iter().filter(|s| s.calls > 0).collect();
    let daily = build_daily_series(
        &refs,
        None,
        None,
        &catalog,
        &cfg.default_model_id,
        &cfg.reporting_currency,
        cfg.fx.usd_inr,
    );

    scan.diagnostics.consistency = verify_consistency(
        &refs.iter().map(|s| (*s).clone()).collect::<Vec<_>>(),
        &daily,
    );

    let db_path = crate::config::expand_tilde(&cfg.db_path);
    match ingest_snapshot(&db_path, &scan, &daily) {
        Ok(runs) => scan.diagnostics.snapshot_runs = runs,
        Err(e) => {
            scan.diagnostics
                .warnings
                .push(format!("Snapshot DB warning: {e}"));
            scan.diagnostics.snapshot_runs = run_count(&db_path);
        }
    }
    scan
}

fn ensure_scan<'a>(state: &'a mut InnerState) -> &'a ScanResult {
    if state.last_scan.is_none() {
        state.last_scan = Some(perform_scan(&state.config));
    }
    state.last_scan.as_ref().unwrap()
}

pub mod commands {
    use std::path::PathBuf;
    use std::process::Command;

    use tauri::State;

    use crate::config::{
        config_file_path, expand_tilde, restore_default_paths as reset_paths, save_config,
    };
    use crate::export::{
        export_diagnostics_json as write_diagnostics_json, export_sessions_csv,
        generate_plain_english_summary,
    };
    use crate::forecast::compute_forecast as run_forecast_engine;
    use crate::metrics::{build_dashboard, build_session_detail};
    use crate::models::{
        AboutInfo, AppConfig, DashboardPayload, ExportResult, FilterState, ForecastMethod,
        ForecastResult, ScanDiagnostics, SessionDetailPayload,
    };
    use crate::pricing::Catalog;
    use crate::snapshots::clear_snapshots as clear_db_snapshots;
    use crate::{ensure_scan, perform_scan, AppState};

    #[tauri::command]
    pub fn scan_all(state: State<'_, AppState>) -> Result<ScanDiagnostics, String> {
        let cfg = {
            let guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
            guard.config.clone()
        };
        let scan = perform_scan(&cfg);
        let diag = scan.diagnostics.clone();
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        guard.last_scan = Some(scan);
        Ok(diag)
    }

    #[tauri::command]
    pub fn get_dashboard(
        filter: FilterState,
        state: State<'_, AppState>,
    ) -> Result<DashboardPayload, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let cfg = guard.config.clone();
        let catalog = Catalog::load(cfg.pricing_path.as_deref());
        let scan = ensure_scan(&mut guard);
        Ok(build_dashboard(scan, &cfg, &catalog, &filter))
    }

    #[tauri::command]
    pub fn get_session_detail(
        session_id: String,
        model_id: String,
        currency: String,
        state: State<'_, AppState>,
    ) -> Result<SessionDetailPayload, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let cfg = guard.config.clone();
        let catalog = Catalog::load(cfg.pricing_path.as_deref());
        let scan = ensure_scan(&mut guard);
        build_session_detail(scan, &session_id, &model_id, &currency, cfg.fx.usd_inr, &catalog)
    }

    #[tauri::command]
    pub fn get_settings(state: State<'_, AppState>) -> Result<AppConfig, String> {
        let guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        Ok(guard.config.clone())
    }

    #[tauri::command]
    pub fn save_settings(
        config: AppConfig,
        state: State<'_, AppState>,
    ) -> Result<AppConfig, String> {
        save_config(&config)?;
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        guard.config = config.clone();
        Ok(config)
    }

    #[tauri::command]
    pub fn restore_default_paths(state: State<'_, AppState>) -> Result<AppConfig, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        reset_paths(&mut guard.config);
        save_config(&guard.config)?;
        Ok(guard.config.clone())
    }

    #[tauri::command]
    pub fn compute_forecast(
        filter: FilterState,
        method: ForecastMethod,
        horizon_days: u64,
        metric: String,
        state: State<'_, AppState>,
    ) -> Result<ForecastResult, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let cfg = guard.config.clone();
        let catalog = Catalog::load(cfg.pricing_path.as_deref());
        let scan = ensure_scan(&mut guard);
        let payload = build_dashboard(scan, &cfg, &catalog, &filter);
        Ok(run_forecast_engine(&payload.daily, method, horizon_days, &metric))
    }

    #[tauri::command]
    pub fn export_csv(
        filter: FilterState,
        target_path: Option<String>,
        state: State<'_, AppState>,
    ) -> Result<ExportResult, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let cfg = guard.config.clone();
        let catalog = Catalog::load(cfg.pricing_path.as_deref());
        let scan = ensure_scan(&mut guard);
        let payload = build_dashboard(scan, &cfg, &catalog, &filter);
        export_sessions_csv(&payload, target_path.as_deref())
    }

    #[tauri::command]
    pub fn copy_summary(
        filter: FilterState,
        state: State<'_, AppState>,
    ) -> Result<String, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let cfg = guard.config.clone();
        let catalog = Catalog::load(cfg.pricing_path.as_deref());
        let scan = ensure_scan(&mut guard);
        let payload = build_dashboard(scan, &cfg, &catalog, &filter);
        Ok(generate_plain_english_summary(&payload))
    }

    #[tauri::command]
    pub fn open_in_explorer(path: String) -> Result<(), String> {
        let expanded = expand_tilde(&path);
        if !expanded.exists() {
            return Err(format!("Path does not exist: {}", expanded.display()));
        }
        #[cfg(target_os = "windows")]
        {
            if expanded.is_file() {
                Command::new("explorer")
                    .args(["/select,", &expanded.to_string_lossy()])
                    .spawn()
                    .map_err(|e| format!("Failed to open Explorer: {e}"))?;
            } else {
                Command::new("explorer")
                    .arg(&expanded)
                    .spawn()
                    .map_err(|e| format!("Failed to open Explorer: {e}"))?;
            }
        }
        #[cfg(not(target_os = "windows"))]
        {
            let _ = expanded;
        }
        Ok(())
    }

    #[tauri::command]
    pub fn clear_snapshots(state: State<'_, AppState>) -> Result<u64, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let db_path = expand_tilde(&guard.config.db_path);
        let res = clear_db_snapshots(&db_path)?;
        if let Some(scan) = &mut guard.last_scan {
            scan.diagnostics.snapshot_runs = 0;
        }
        Ok(res)
    }

    #[tauri::command]
    pub fn get_about_info(state: State<'_, AppState>) -> Result<AboutInfo, String> {
        let guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let app_version_file = std::env::var_os("LOCALAPPDATA").map(|p| {
            PathBuf::from(p)
                .join("Programs")
                .join("antigravity")
                .join("version")
        });
        let antigravity_app_version = app_version_file
            .and_then(|p| std::fs::read_to_string(p).ok())
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty());

        Ok(AboutInfo {
            app_version: env!("CARGO_PKG_VERSION").to_string(),
            build_date: "2026-11-15".to_string(),
            antigravity_app_version,
            antigravity_cli_version: None,
            config_path: config_file_path().to_string_lossy().into_owned(),
            db_path: expand_tilde(&guard.config.db_path)
                .to_string_lossy()
                .into_owned(),
        })
    }

    #[tauri::command]
    pub fn export_diagnostics_json(
        target_path: Option<String>,
        state: State<'_, AppState>,
    ) -> Result<ExportResult, String> {
        let mut guard = state.0.lock().map_err(|e| format!("State lock error: {e}"))?;
        let scan = ensure_scan(&mut guard);
        write_diagnostics_json(&scan.diagnostics, target_path.as_deref())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .manage(AppState::default())
        .invoke_handler(tauri::generate_handler![
            commands::scan_all,
            commands::get_dashboard,
            commands::get_session_detail,
            commands::get_settings,
            commands::save_settings,
            commands::restore_default_paths,
            commands::compute_forecast,
            commands::export_csv,
            commands::copy_summary,
            commands::open_in_explorer,
            commands::clear_snapshots,
            commands::get_about_info,
            commands::export_diagnostics_json,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Antigravity Usage");
}
