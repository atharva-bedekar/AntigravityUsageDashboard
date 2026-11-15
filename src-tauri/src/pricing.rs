use std::collections::BTreeSet;
use std::fs;
use std::path::Path;

use chrono::Local;

use crate::config::{expand_tilde, workspace_root};
use crate::metrics::safe_div;
use crate::models::{ModelBenchmarkRow, ModelCatalogItem, PriceEntry};

fn entry(
    model_id: &str,
    name: &str,
    vendor: &str,
    effective_from: &str,
    effective_until: Option<&str>,
    input_usd: f64,
    cached_usd: f64,
    output_usd: f64,
    source: &str,
    verified: bool,
) -> PriceEntry {
    PriceEntry {
        model_id: model_id.to_string(),
        name: name.to_string(),
        vendor: vendor.to_string(),
        effective_from: effective_from.to_string(),
        effective_until: effective_until.map(|s| s.to_string()),
        input_usd,
        cached_usd,
        output_usd,
        source: source.to_string(),
        verified,
    }
}

/// Exact seeded catalog carried over from `agy_dash/pricing.py` (USD per 1M tokens).
pub fn default_catalog() -> Vec<PriceEntry> {
    let base = 0.75;
    vec![
        entry(
            "gemini-3.8-flash",
            "Gemini 3.8 Flash",
            "Google",
            "2026-10-01",
            Some("2026-12-31"),
            base,
            base / 10.0,
            base * 5.0,
            "Antigravity launch blog + Gemini API pricing page",
            true,
        ),
        entry(
            "gemini-3.8-flash",
            "Gemini 3.8 Flash (post-intro)",
            "Google",
            "2027-01-01",
            None,
            base * 2.0,
            base / 5.0,
            base * 10.0,
            "documented 2027-01-01 price change",
            true,
        ),
        entry(
            "gemini-4-argon",
            "Gemini 4 Argon",
            "Google",
            "2026-10-01",
            None,
            2.00,
            0.10,
            10.00,
            "Antigravity docs (--*-price example)",
            true,
        ),
        entry(
            "gemini-3.1-pro",
            "Gemini 3.1 Pro",
            "Google",
            "2026-09-01",
            None,
            1.25,
            0.31,
            10.00,
            "Gemini API list price (approximate)",
            false,
        ),
        entry(
            "claude-haiku",
            "Claude Haiku",
            "Anthropic",
            "2026-01-01",
            None,
            1.00,
            0.10,
            5.00,
            "Anthropic list price (approximate)",
            false,
        ),
        entry(
            "claude-sonnet",
            "Claude Sonnet",
            "Anthropic",
            "2026-01-01",
            None,
            3.00,
            0.30,
            15.00,
            "Anthropic list price (approximate)",
            false,
        ),
        entry(
            "claude-opus",
            "Claude Opus",
            "Anthropic",
            "2026-01-01",
            None,
            15.00,
            1.50,
            75.00,
            "Anthropic list price (approximate)",
            false,
        ),
        entry(
            "gpt-mini",
            "OpenAI mini tier",
            "OpenAI",
            "2026-01-01",
            None,
            0.15,
            0.075,
            0.60,
            "OpenAI list price (approximate)",
            false,
        ),
        entry(
            "gpt-flagship",
            "OpenAI flagship",
            "OpenAI",
            "2026-01-01",
            None,
            2.50,
            1.25,
            10.00,
            "OpenAI list price (approximate)",
            false,
        ),
        entry(
            "llama-70b-api",
            "Llama 3.3 70B (hosted)",
            "Open-weight API",
            "2026-01-01",
            None,
            0.60,
            0.60,
            0.70,
            "typical hosted-serverless price; no prompt cache",
            false,
        ),
        entry(
            "deepseek-v3-api",
            "DeepSeek V3 (hosted)",
            "Open-weight API",
            "2026-01-01",
            None,
            0.27,
            0.07,
            1.10,
            "typical hosted-serverless price",
            false,
        ),
        entry(
            "qwen-32b-api",
            "Qwen 2.5 32B (hosted)",
            "Open-weight API",
            "2026-01-01",
            None,
            0.20,
            0.20,
            0.60,
            "typical hosted-serverless price; no prompt cache",
            false,
        ),
        entry(
            "mistral-large-api",
            "Mistral Large (hosted)",
            "Open-weight API",
            "2026-01-01",
            None,
            2.00,
            0.50,
            6.00,
            "typical hosted-serverless price",
            false,
        ),
    ]
}

fn parse_external_entry(val: &serde_json::Value) -> Option<PriceEntry> {
    let obj = val.as_object()?;
    let get_str = |camel: &str, snake: &str| -> Option<String> {
        obj.get(camel)
            .or_else(|| obj.get(snake))
            .and_then(|v| v.as_str())
            .map(|s| s.to_string())
    };
    let get_f64 = |camel: &str, snake: &str| -> Option<f64> {
        obj.get(camel)
            .or_else(|| obj.get(snake))
            .and_then(|v| v.as_f64())
    };

    Some(PriceEntry {
        model_id: get_str("modelId", "model_id")?,
        name: get_str("name", "name")?,
        vendor: get_str("vendor", "vendor").unwrap_or_default(),
        effective_from: get_str("effectiveFrom", "effective_from")?,
        effective_until: get_str("effectiveUntil", "effective_until"),
        input_usd: get_f64("inputUsd", "input_usd")?,
        cached_usd: get_f64("cachedUsd", "cached_usd")?,
        output_usd: get_f64("outputUsd", "output_usd")?,
        source: get_str("source", "source").unwrap_or_default(),
        verified: obj
            .get("verified")
            .and_then(|v| v.as_bool())
            .unwrap_or(false),
    })
}

/// Load pricing catalog from custom path or `config/pricing.json`, falling back to `default_catalog()`.
pub fn load_catalog(custom_path: Option<&str>) -> Vec<PriceEntry> {
    let candidate = match custom_path.map(str::trim).filter(|s| !s.is_empty()) {
        Some(p) => expand_tilde(p),
        None => workspace_root().join("config").join("pricing.json"),
    };
    load_catalog_from_path(&candidate)
}

pub fn load_catalog_from_path(path: &Path) -> Vec<PriceEntry> {
    if let Ok(text) = fs::read_to_string(path) {
        if let Ok(val) = serde_json::from_str::<serde_json::Value>(&text) {
            if let Some(arr) = val.get("models").and_then(|v| v.as_array()) {
                let parsed: Vec<PriceEntry> =
                    arr.iter().filter_map(parse_external_entry).collect();
                if !parsed.is_empty() {
                    return parsed;
                }
            }
        }
    }
    default_catalog()
}

pub fn entry_covers(entry: &PriceEntry, date: &str) -> bool {
    if date < entry.effective_from.as_str() {
        return false;
    }
    match &entry.effective_until {
        Some(until) => date <= until.as_str(),
        None => true,
    }
}

#[derive(Debug, Clone)]
pub struct Catalog {
    pub entries: Vec<PriceEntry>,
}

impl Catalog {
    pub fn new(entries: Vec<PriceEntry>) -> Self {
        Self { entries }
    }

    pub fn load(custom_path: Option<&str>) -> Self {
        Self::new(load_catalog(custom_path))
    }

    pub fn versions(&self, model_id: &str) -> Vec<&PriceEntry> {
        let mut vs: Vec<&PriceEntry> = self
            .entries
            .iter()
            .filter(|e| e.model_id == model_id)
            .collect();
        vs.sort_by(|a, b| a.effective_from.cmp(&b.effective_from));
        vs
    }

    /// Return `(Some(entry), is_date_estimate)` for `date` (`YYYY-MM-DD`).
    /// `is_date_estimate` is `true` when no version covers that date.
    pub fn price_on(&self, model_id: &str, date: &str) -> (Option<&PriceEntry>, bool) {
        let vs = self.versions(model_id);
        if vs.is_empty() {
            return (None, true);
        }
        for e in &vs {
            if entry_covers(e, date) {
                return (Some(*e), false);
            }
        }
        let older: Vec<&PriceEntry> = vs
            .iter()
            .copied()
            .filter(|e| e.effective_from.as_str() <= date)
            .collect();
        if let Some(last) = older.last() {
            return (Some(*last), true);
        }
        (Some(vs[0]), true)
    }

    pub fn latest(&self, model_id: &str) -> Option<&PriceEntry> {
        self.versions(model_id).into_iter().last()
    }

    pub fn model_ids(&self) -> Vec<String> {
        let mut ids = BTreeSet::new();
        for e in &self.entries {
            ids.insert(e.model_id.clone());
        }
        ids.into_iter().collect()
    }

    pub fn catalog_items(&self, on_date: Option<&str>) -> Vec<ModelCatalogItem> {
        let today = Local::now().format("%Y-%m-%d").to_string();
        let date = on_date.unwrap_or(&today);
        self.model_ids()
            .into_iter()
            .filter_map(|id| {
                let entry = self
                    .price_on(&id, date)
                    .0
                    .or_else(|| self.latest(&id))?;
                Some(ModelCatalogItem {
                    model_id: entry.model_id.clone(),
                    name: entry.name.clone(),
                    vendor: entry.vendor.clone(),
                    latest_input_usd: entry.input_usd,
                    latest_cached_usd: entry.cached_usd,
                    latest_output_usd: entry.output_usd,
                    effective_from: entry.effective_from.clone(),
                    effective_until: entry.effective_until.clone(),
                    verified: entry.verified,
                    source: entry.source.clone(),
                })
            })
            .collect()
    }

    /// Evaluate the given token volume across every model in the catalog.
    pub fn benchmark(
        &self,
        fresh_in: u64,
        cached: u64,
        output: u64,
        active_model_id: &str,
        on_date: &str,
        currency: &str,
        usd_inr: f64,
    ) -> Vec<ModelBenchmarkRow> {
        let mut rows: Vec<ModelBenchmarkRow> = self
            .model_ids()
            .into_iter()
            .filter_map(|id| {
                let (opt, _) = self.price_on(&id, on_date);
                let e = opt.or_else(|| self.latest(&id))?;
                let cost_usd = (fresh_in as f64 * e.input_usd
                    + cached as f64 * e.cached_usd
                    + output as f64 * e.output_usd)
                    / 1_000_000.0;
                let cost_currency = if currency == "INR" {
                    cost_usd * usd_inr
                } else {
                    cost_usd
                };
                Some(ModelBenchmarkRow {
                    model_id: e.model_id.clone(),
                    name: e.name.clone(),
                    vendor: e.vendor.clone(),
                    input_usd: e.input_usd,
                    cached_usd: e.cached_usd,
                    output_usd: e.output_usd,
                    verified: e.verified,
                    is_current: e.model_id == active_model_id,
                    cost_usd,
                    cost_currency,
                    ratio_to_cheapest: 1.0,
                    relative_bar: 1.0,
                })
            })
            .collect();

        rows.sort_by(|a, b| {
            a.cost_usd
                .partial_cmp(&b.cost_usd)
                .unwrap_or(std::cmp::Ordering::Equal)
        });

        let min_cost = rows.first().map(|r| r.cost_usd).unwrap_or(0.0);
        let max_cost = rows.last().map(|r| r.cost_usd).unwrap_or(0.0);

        for r in &mut rows {
            r.ratio_to_cheapest = if min_cost > 0.0 {
                safe_div(r.cost_usd, min_cost, 1.0)
            } else {
                1.0
            };
            r.relative_bar = safe_div(r.cost_usd, max_cost, 0.0);
        }
        rows
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn price_on_handles_versioned_dates() {
        let cat = Catalog::new(default_catalog());

        let (p_2026, est_2026) = cat.price_on("gemini-3.8-flash", "2026-11-15");
        let p_2026 = p_2026.unwrap();
        assert!(!est_2026);
        assert_eq!(p_2026.input_usd, 0.75);
        assert_eq!(p_2026.cached_usd, 0.075);
        assert_eq!(p_2026.output_usd, 3.75);

        let (p_2027, est_2027) = cat.price_on("gemini-3.8-flash", "2027-02-01");
        let p_2027 = p_2027.unwrap();
        assert!(!est_2027);
        assert_eq!(p_2027.input_usd, 1.50);
        assert_eq!(p_2027.cached_usd, 0.15);
        assert_eq!(p_2027.output_usd, 7.50);

        let (p_early, est_early) = cat.price_on("gemini-3.8-flash", "2025-05-01");
        assert!(p_early.is_some());
        assert!(est_early);

        let (p_missing, est_missing) = cat.price_on("nonexistent-model", "2026-11-15");
        assert!(p_missing.is_none());
        assert!(est_missing);
    }

    #[test]
    fn benchmark_evaluates_all_12_models() {
        let cat = Catalog::new(default_catalog());
        let rows = cat.benchmark(
            28_300_000,
            276_310_000,
            3_080_000,
            "gemini-3.8-flash",
            "2026-11-15",
            "INR",
            88.0,
        );
        assert_eq!(rows.len(), 12);
        assert_eq!(rows.iter().filter(|r| r.is_current).count(), 1);
        assert!(rows.windows(2).all(|w| w[0].cost_usd <= w[1].cost_usd));
        assert!((rows[0].ratio_to_cheapest - 1.0).abs() < 1e-9);
    }
}
