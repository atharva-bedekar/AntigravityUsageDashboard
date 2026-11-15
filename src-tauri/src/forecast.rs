use chrono::{Duration, Local, NaiveDate};
use rand::rngs::StdRng;
use rand::seq::SliceRandom;
use rand::SeedableRng;
use rand_distr::{Distribution, LogNormal};

use crate::metrics::safe_div;
use crate::models::{DailyBucket, ForecastMethod, ForecastPoint, ForecastResult};

pub const MIN_DAYS_FOR_TREND: u64 = 14;
const N_SIMS: usize = 2000;
const BOOTSTRAP_SEED: u64 = 7;
const MONTE_CARLO_SEED: u64 = 11;
const HOLT_ALPHA: f64 = 0.5;
const HOLT_BETA: f64 = 0.3;

fn mean(xs: &[f64]) -> f64 {
    safe_div(xs.iter().sum::<f64>(), xs.len() as f64, 0.0)
}

fn std_dev(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        return 0.0;
    }
    let m = mean(xs);
    let var = safe_div(
        xs.iter().map(|x| (x - m) * (x - m)).sum::<f64>(),
        xs.len() as f64,
        0.0,
    );
    var.sqrt()
}

fn percentile_sorted(sorted: &[f64], p: f64) -> f64 {
    if sorted.is_empty() {
        return 0.0;
    }
    if sorted.len() == 1 {
        return sorted[0];
    }
    let idx = (p / 100.0) * (sorted.len() - 1) as f64;
    let lo = idx.floor() as usize;
    let hi = idx.ceil() as usize;
    if lo == hi {
        sorted[lo]
    } else {
        let frac = idx - lo as f64;
        sorted[lo] * (1.0 - frac) + sorted[hi] * frac
    }
}

fn future_dates(last_date: Option<&str>, horizon: u64) -> Vec<String> {
    let base = last_date
        .and_then(|s| NaiveDate::parse_from_str(s, "%Y-%m-%d").ok())
        .unwrap_or_else(|| Local::now().date_naive());
    (1..=horizon)
        .map(|i| (base + Duration::days(i as i64)).format("%Y-%m-%d").to_string())
        .collect()
}

fn method_label(method: ForecastMethod) -> &'static str {
    match method {
        ForecastMethod::Linear => "Linear extrapolation (baseline)",
        ForecastMethod::Bootstrap => "Bootstrap resampling",
        ForecastMethod::MonteCarlo => "Monte Carlo simulation",
        ForecastMethod::Holt => "Holt linear trend",
    }
}

pub fn compute_forecast(
    daily: &[DailyBucket],
    method: ForecastMethod,
    requested_horizon: u64,
    metric: &str,
) -> ForecastResult {
    let active_days = daily.iter().filter(|d| d.calls > 0).count() as u64;
    let observed_days = daily.len() as u64;
    let max_horizon = (observed_days * 2).max(1);
    let horizon = requested_horizon.clamp(1, max_horizon);

    let values: Vec<f64> = daily
        .iter()
        .map(|d| {
            if metric == "tokens" {
                d.total as f64
            } else {
                d.cost_currency
            }
        })
        .collect();
    let observed_mean = mean(&values);

    if active_days < MIN_DAYS_FOR_TREND {
        return ForecastResult {
            supported: false,
            active_days,
            min_required_days: MIN_DAYS_FOR_TREND,
            observed_days,
            max_horizon_days: max_horizon,
            horizon_days: 0,
            method,
            method_label: method_label(method).to_string(),
            metric: metric.to_string(),
            observed_mean,
            cumulative_low: 0.0,
            cumulative_median: 0.0,
            cumulative_high: 0.0,
            assumptions: format!(
                "Forecasts need at least {MIN_DAYS_FOR_TREND} active days. You have {active_days}."
            ),
            notes: vec![
                "Trend models on fewer than 14 active days mistake bursty agent sessions for long-term trends."
                    .to_string(),
            ],
            points: Vec::new(),
        };
    }

    let last_date = daily.last().map(|d| d.date.as_str());
    let dates = future_dates(last_date, horizon);

    let (points, assumptions, notes) = match method {
        ForecastMethod::Linear => run_linear(&values, &dates),
        ForecastMethod::Bootstrap => run_bootstrap(&values, &dates),
        ForecastMethod::MonteCarlo => run_monte_carlo(&values, &dates),
        ForecastMethod::Holt => run_holt(&values, &dates),
    };

    let cumulative_low: f64 = points.iter().map(|p| p.low).sum();
    let cumulative_median: f64 = points.iter().map(|p| p.median).sum();
    let cumulative_high: f64 = points.iter().map(|p| p.high).sum();

    ForecastResult {
        supported: true,
        active_days,
        min_required_days: MIN_DAYS_FOR_TREND,
        observed_days,
        max_horizon_days: max_horizon,
        horizon_days: horizon,
        method,
        method_label: method_label(method).to_string(),
        metric: metric.to_string(),
        observed_mean,
        cumulative_low,
        cumulative_median,
        cumulative_high,
        assumptions,
        notes,
        points,
    }
}

fn run_linear(values: &[f64], dates: &[String]) -> (Vec<ForecastPoint>, String, Vec<String>) {
    let n = values.len();
    let x_mean = (n as f64 - 1.0) / 2.0;
    let y_mean = mean(values);

    let mut num = 0.0;
    let mut den = 0.0;
    for (i, &y) in values.iter().enumerate() {
        let dx = i as f64 - x_mean;
        num += dx * (y - y_mean);
        den += dx * dx;
    }
    let slope = safe_div(num, den, 0.0);
    let intercept = y_mean - slope * x_mean;

    let resid: Vec<f64> = values
        .iter()
        .enumerate()
        .map(|(i, &y)| y - (slope * i as f64 + intercept))
        .collect();
    let band = 1.96 * std_dev(&resid);

    let points = dates
        .iter()
        .enumerate()
        .map(|(idx, date)| {
            let step = (idx + 1) as f64;
            let med = (intercept + slope * ((n - 1) as f64 + step)).max(0.0);
            let spread = band * step.sqrt();
            ForecastPoint {
                date: date.clone(),
                low: (med - spread).max(0.0),
                median: med,
                high: (med + spread).max(0.0),
            }
        })
        .collect();

    (
        points,
        format!("Daily usage follows an OLS line fitted on {n} calendar days; 95% band = ±1.96 × residual std × √step."),
        vec!["Extrapolation widens with the square root of the forecast horizon.".to_string()],
    )
}

fn run_bootstrap(values: &[f64], dates: &[String]) -> (Vec<ForecastPoint>, String, Vec<String>) {
    let mut rng = StdRng::seed_from_u64(BOOTSTRAP_SEED);
    let h = dates.len();
    let mut per_day_samples = vec![Vec::with_capacity(N_SIMS); h];

    for _ in 0..N_SIMS {
        for day_vec in &mut per_day_samples {
            let draw = *values.choose(&mut rng).unwrap_or(&0.0);
            day_vec.push(draw.max(0.0));
        }
    }

    let points = dates
        .iter()
        .enumerate()
        .map(|(idx, date)| {
            let samples = &mut per_day_samples[idx];
            samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            ForecastPoint {
                date: date.clone(),
                low: percentile_sorted(samples, 10.0),
                median: percentile_sorted(samples, 50.0),
                high: percentile_sorted(samples, 90.0),
            }
        })
        .collect();

    (
        points,
        format!(
            "Each future day is an independent draw with replacement from the {} observed days ({N_SIMS} resamples, seed={BOOTSTRAP_SEED}); P10/P50/P90 bands.",
            values.len()
        ),
        vec!["Bootstrap can only produce daily values already observed, so it never forecasts a new high.".to_string()],
    )
}

fn run_monte_carlo(values: &[f64], dates: &[String]) -> (Vec<ForecastPoint>, String, Vec<String>) {
    let mut rng = StdRng::seed_from_u64(MONTE_CARLO_SEED);
    let recent_len = values.len().min(5);
    let recent = &values[values.len() - recent_len..];
    let base = mean(recent);
    let nonzero: Vec<f64> = recent.iter().copied().filter(|&v| v > 0.0).collect();
    let obs_cv = if nonzero.len() > 1 {
        safe_div(std_dev(&nonzero), mean(&nonzero), 0.5)
    } else {
        0.5
    };
    let sigma = obs_cv.clamp(0.05, 2.0);
    let dist = LogNormal::new(0.0, sigma).unwrap_or_else(|_| LogNormal::new(0.0, 0.5).unwrap());

    let h = dates.len();
    let mut per_day_samples = vec![Vec::with_capacity(N_SIMS); h];
    for _ in 0..N_SIMS {
        for day_vec in &mut per_day_samples {
            let factor = dist.sample(&mut rng);
            let v = if factor.is_finite() { base * factor } else { base };
            day_vec.push(v.max(0.0));
        }
    }

    let points = dates
        .iter()
        .enumerate()
        .map(|(idx, date)| {
            let samples = &mut per_day_samples[idx];
            samples.sort_by(|a, b| a.partial_cmp(b).unwrap_or(std::cmp::Ordering::Equal));
            ForecastPoint {
                date: date.clone(),
                low: percentile_sorted(samples, 10.0),
                median: percentile_sorted(samples, 50.0),
                high: percentile_sorted(samples, 90.0),
            }
        })
        .collect();

    (
        points,
        format!(
            "Future days ~ LogNormal around recent {recent_len}-day mean ({base:.2}) with sigma={sigma:.2} ({N_SIMS} paths, seed={MONTE_CARLO_SEED}); P10/P50/P90 bands."
        ),
        vec!["Simulated paths describe possible future variance, not a reconstruction of past trends.".to_string()],
    )
}

fn run_holt(values: &[f64], dates: &[String]) -> (Vec<ForecastPoint>, String, Vec<String>) {
    let mut level = values[0];
    let mut trend = values[1] - values[0];
    let mut resid = Vec::with_capacity(values.len());

    for &v in values {
        let last_level = level;
        level = HOLT_ALPHA * v + (1.0 - HOLT_ALPHA) * (level + trend);
        trend = HOLT_BETA * (level - last_level) + (1.0 - HOLT_BETA) * trend;
        resid.push(v - level);
    }

    let band = 1.96 * std_dev(&resid);
    let points = dates
        .iter()
        .enumerate()
        .map(|(idx, date)| {
            let step = (idx + 1) as f64;
            let med = (level + trend * step).max(0.0);
            let spread = band * step.sqrt();
            ForecastPoint {
                date: date.clone(),
                low: (med - spread).max(0.0),
                median: med,
                high: (med + spread).max(0.0),
            }
        })
        .collect();

    (
        points,
        format!(
            "Holt's level + trend exponential smoothing (alpha={HOLT_ALPHA}, beta={HOLT_BETA}) on {} days; 95% band = ±1.96 × residual std × √step.",
            values.len()
        ),
        vec!["Bursty agent days are treated as signal, which keeps uncertainty bands wide.".to_string()],
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn make_daily(active_count: usize, total_count: usize) -> Vec<DailyBucket> {
        let start = NaiveDate::from_ymd_opt(2026, 10, 1).unwrap();
        (0..total_count)
            .map(|i| {
                let d = (start + Duration::days(i as i64)).format("%Y-%m-%d").to_string();
                let is_active = i < active_count;
                let total = if is_active { 1_000_000 + (i as u64 * 50_000) } else { 0 };
                DailyBucket {
                    date: d,
                    calls: if is_active { 5 } else { 0 },
                    sessions: if is_active { 1 } else { 0 },
                    app_sessions: 0,
                    cli_sessions: if is_active { 1 } else { 0 },
                    fresh_in: total / 10,
                    cached: (total * 8) / 10,
                    output: total / 10,
                    total,
                    app_fresh_in: 0,
                    app_cached: 0,
                    app_output: 0,
                    app_total: 0,
                    cli_fresh_in: total / 10,
                    cli_cached: (total * 8) / 10,
                    cli_output: total / 10,
                    cli_total: total,
                    cost_usd: if is_active { 2.5 + i as f64 * 0.1 } else { 0.0 },
                    cost_currency: if is_active { 220.0 + i as f64 * 8.8 } else { 0.0 },
                    is_date_estimate: false,
                }
            })
            .collect()
    }

    #[test]
    fn gate_blocks_when_active_days_under_14() {
        let daily = make_daily(13, 20);
        let res = compute_forecast(&daily, ForecastMethod::Linear, 7, "cost");
        assert!(!res.supported);
        assert_eq!(res.active_days, 13);
        assert_eq!(res.min_required_days, 14);
        assert!(res.points.is_empty());
    }

    #[test]
    fn unlocked_at_14_days_and_deterministic() {
        let daily = make_daily(14, 14);

        let b1 = compute_forecast(&daily, ForecastMethod::Bootstrap, 10, "cost");
        let b2 = compute_forecast(&daily, ForecastMethod::Bootstrap, 10, "cost");
        assert!(b1.supported);
        assert_eq!(b1.points.len(), 10);
        assert_eq!(b1.cumulative_median, b2.cumulative_median);

        let mc1 = compute_forecast(&daily, ForecastMethod::MonteCarlo, 10, "cost");
        let mc2 = compute_forecast(&daily, ForecastMethod::MonteCarlo, 10, "cost");
        assert!(mc1.supported);
        assert_eq!(mc1.cumulative_median, mc2.cumulative_median);

        let lin = compute_forecast(&daily, ForecastMethod::Linear, 100, "cost");
        assert_eq!(lin.horizon_days, 28); // capped at 2 * observed_days

        let holt = compute_forecast(&daily, ForecastMethod::Holt, 7, "cost");
        assert!(holt.supported);
        assert_eq!(holt.points.len(), 7);
    }
}
