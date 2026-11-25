use std::fs;
use std::path::{Path, PathBuf};

use crate::models::{
    AppConfig, DisplayConfig, FxConfig, RefreshConfig, SubscriptionConfig,
};

/// Resolve the project/data root directory.
/// Uses `CARGO_MANIFEST_DIR`'s parent during dev, or current working directory if `config/` exists there,
/// otherwise falls back to the executable's directory or current dir.
pub fn workspace_root() -> PathBuf {
    if let Ok(cwd) = std::env::current_dir() {
        if cwd.join("config").exists() || cwd.join("src-tauri").exists() {
            return cwd;
        }
        if cwd.file_name().and_then(|n| n.to_str()) == Some("src-tauri") {
            if let Some(parent) = cwd.parent() {
                return parent.to_path_buf();
            }
        }
    }
    if let Ok(exe) = std::env::current_exe() {
        if let Some(dir) = exe.parent() {
            return dir.to_path_buf();
        }
    }
    PathBuf::from(".")
}

/// Expand leading `~` or `~/` / `~\` to the user's home directory.
pub fn expand_tilde(raw: &str) -> PathBuf {
    let trimmed = raw.trim();
    if trimmed == "~" {
        return dirs::home_dir().unwrap_or_else(|| PathBuf::from("~"));
    }
    if let Some(rest) = trimmed.strip_prefix("~/").or_else(|| trimmed.strip_prefix("~\\")) {
        if let Some(home) = dirs::home_dir() {
            return home.join(rest);
        }
    }
    PathBuf::from(trimmed)
}

pub fn default_app_brain_root() -> String {
    dirs::home_dir()
        .map(|h| h.join(".gemini").join("antigravity").join("brain"))
        .unwrap_or_else(|| PathBuf::from("~/.gemini/antigravity/brain"))
        .to_string_lossy()
        .into_owned()
}

pub fn default_cli_brain_root() -> String {
    dirs::home_dir()
        .map(|h| h.join(".gemini").join("antigravity-cli").join("brain"))
        .unwrap_or_else(|| PathBuf::from("~/.gemini/antigravity-cli/brain"))
        .to_string_lossy()
        .into_owned()
}

pub fn default_config() -> AppConfig {
    let root = workspace_root();
    AppConfig {
        app_brain_root: default_app_brain_root(),
        app_enabled: true,
        read_app_sqlite: true,
        cli_brain_root: default_cli_brain_root(),
        cli_enabled: true,
        custom_sources: Vec::new(),
        db_path: root.join("data").join("snapshots.db").to_string_lossy().into_owned(),
        pricing_path: None,
        default_model_id: "gemini-3.8-flash".to_string(),
        reporting_currency: "INR".to_string(),
        fx: FxConfig { usd_inr: 88.0 },
        subscription: SubscriptionConfig {
            amount: 0.0,
            currency: "INR".to_string(),
            period_days: 30,
            label: "Antigravity plan".to_string(),
        },
        display: DisplayConfig {
            theme: "light".to_string(),
            density: "comfortable".to_string(),
            number_format: "compact".to_string(),
            week_start: "monday".to_string(),
            reduced_motion: "system".to_string(),
        },
        refresh: RefreshConfig {
            interval_minutes: 0,
            file_watcher_enabled: false,
        },
    }
}

pub fn config_file_path() -> PathBuf {
    if let Ok(p) = std::env::var("AGY_DASH_CONFIG") {
        if !p.trim().is_empty() {
            return expand_tilde(&p);
        }
    }
    workspace_root().join("config").join("config.json")
}

/// Validate user-editable config fields before saving.
pub fn validate_config(cfg: &AppConfig) -> Result<(), String> {
    if !cfg.fx.usd_inr.is_finite() || cfg.fx.usd_inr <= 0.0 {
        return Err("Enter a number greater than 0 for USD → INR exchange rate.".to_string());
    }
    if !cfg.subscription.amount.is_finite() || cfg.subscription.amount < 0.0 {
        return Err("Subscription amount must be 0 or greater.".to_string());
    }
    if cfg.subscription.period_days < 1 || cfg.subscription.period_days > 365 {
        return Err("Billing period must be between 1 and 365 days.".to_string());
    }
    if cfg.reporting_currency != "INR" && cfg.reporting_currency != "USD" {
        return Err("Reporting currency must be INR or USD.".to_string());
    }
    Ok(())
}

/// Load config from disk, merging missing fields from defaults.
/// Never panics on missing or malformed config files.
pub fn load_config_from(path: &Path) -> AppConfig {
    let mut base = default_config();
    let Ok(text) = fs::read_to_string(path) else {
        return base;
    };
    let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) else {
        return base;
    };
    if let Ok(parsed) = serde_json::from_value::<AppConfig>(val.clone()) {
        if validate_config(&parsed).is_ok() {
            return parsed;
        }
    }
    // Partial / legacy config merge (e.g. Python config.example.json keys)
    if let Some(obj) = val.as_object() {
        if let Some(s) = obj.get("appBrainRoot").and_then(|v| v.as_str()) {
            base.app_brain_root = s.to_string();
        }
        if let Some(s) = obj
            .get("cliBrainRoot")
            .or_else(|| obj.get("brain_root"))
            .and_then(|v| v.as_str())
        {
            base.cli_brain_root = s.to_string();
        }
        if let Some(s) = obj
            .get("reportingCurrency")
            .or_else(|| obj.get("reporting_currency"))
            .and_then(|v| v.as_str())
        {
            if s == "INR" || s == "USD" {
                base.reporting_currency = s.to_string();
            }
        }
        if let Some(fx) = obj.get("fx").and_then(|v| v.as_object()) {
            if let Some(r) = fx
                .get("usdInr")
                .or_else(|| fx.get("USD_INR"))
                .and_then(|v| v.as_f64())
            {
                if r.is_finite() && r > 0.0 {
                    base.fx.usd_inr = r;
                }
            }
        }
        if let Some(sub) = obj.get("subscription").and_then(|v| v.as_object()) {
            if let Some(a) = sub.get("amount").and_then(|v| v.as_f64()) {
                if a.is_finite() && a >= 0.0 {
                    base.subscription.amount = a;
                }
            }
            if let Some(p) = sub
                .get("periodDays")
                .or_else(|| sub.get("period_days"))
                .and_then(|v| v.as_u64())
            {
                if (1..=365).contains(&p) {
                    base.subscription.period_days = p as u32;
                }
            }
        }
    }
    base
}

pub fn load_config() -> AppConfig {
    load_config_from(&config_file_path())
}

pub fn save_config_to(cfg: &AppConfig, path: &Path) -> Result<(), String> {
    validate_config(cfg)?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent)
            .map_err(|e| format!("Failed to create config directory: {e}"))?;
    }
    let json = serde_json::to_string_pretty(cfg)
        .map_err(|e| format!("Failed to serialize config: {e}"))?;
    fs::write(path, format!("{json}\n"))
        .map_err(|e| format!("Failed to write config file: {e}"))?;
    Ok(())
}

pub fn save_config(cfg: &AppConfig) -> Result<(), String> {
    save_config_to(cfg, &config_file_path())
}

pub fn restore_default_paths(cfg: &mut AppConfig) {
    cfg.app_brain_root = default_app_brain_root();
    cfg.cli_brain_root = default_cli_brain_root();
    cfg.app_enabled = true;
    cfg.cli_enabled = true;
    cfg.read_app_sqlite = true;
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn temp_config_path(name: &str) -> PathBuf {
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        std::env::temp_dir().join(format!("agy_cfg_test_{name}_{nanos}.json"))
    }

    #[test]
    fn default_config_is_valid() {
        let cfg = default_config();
        assert!(validate_config(&cfg).is_ok());
        assert_eq!(cfg.fx.usd_inr, 88.0);
        assert_eq!(cfg.reporting_currency, "INR");
        assert_eq!(cfg.default_model_id, "gemini-3.8-flash");
        assert!(cfg.app_brain_root.contains("antigravity"));
        assert!(cfg.cli_brain_root.contains("antigravity-cli"));
    }

    #[test]
    fn validation_rejects_bad_fx_and_period() {
        let mut cfg = default_config();
        cfg.fx.usd_inr = 0.0;
        assert!(validate_config(&cfg).is_err());

        cfg.fx.usd_inr = -5.0;
        assert!(validate_config(&cfg).is_err());

        cfg.fx.usd_inr = 88.0;
        cfg.subscription.period_days = 0;
        assert!(validate_config(&cfg).is_err());

        cfg.subscription.period_days = 366;
        assert!(validate_config(&cfg).is_err());
    }

    #[test]
    fn save_and_load_roundtrip() {
        let path = temp_config_path("roundtrip");
        let mut cfg = default_config();
        cfg.fx.usd_inr = 90.5;
        cfg.reporting_currency = "USD".to_string();
        save_config_to(&cfg, &path).unwrap();

        let loaded = load_config_from(&path);
        assert_eq!(loaded.fx.usd_inr, 90.5);
        assert_eq!(loaded.reporting_currency, "USD");
        let _ = fs::remove_file(&path);
    }
}
