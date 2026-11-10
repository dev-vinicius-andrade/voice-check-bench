// Tiny helpers: option parsing, level stats, percentiles.
use std::collections::HashMap;

pub struct Opts {
    map: HashMap<String, String>,
}

impl Opts {
    /// `--key value` pairs; a `--flag` followed by another `--x` (or nothing) is "1".
    pub fn parse(args: &[String]) -> Opts {
        let mut map = HashMap::new();
        let mut k = 0;
        while k < args.len() {
            if let Some(key) = args[k].strip_prefix("--") {
                let val = args.get(k + 1).filter(|v| !v.starts_with("--"));
                map.insert(key.to_string(), val.cloned().unwrap_or_else(|| "1".into()));
                k += if val.is_some() { 2 } else { 1 };
            } else {
                k += 1;
            }
        }
        Opts { map }
    }
    pub fn get(&self, k: &str) -> Option<&str> {
        self.map.get(k).map(String::as_str)
    }
    pub fn has(&self, k: &str) -> bool {
        self.map.contains_key(k)
    }
    pub fn usize(&self, k: &str, d: usize) -> usize {
        self.get(k).and_then(|v| v.parse().ok()).unwrap_or(d)
    }
    pub fn f32(&self, k: &str, d: f32) -> f32 {
        self.get(k).and_then(|v| v.parse().ok()).unwrap_or(d)
    }
}

/// (rms, peak, share of exact zeros)
pub fn stats(x: &[f32]) -> (f64, f64, f64) {
    if x.is_empty() {
        return (0.0, 0.0, 0.0);
    }
    let mut sq = 0.0f64;
    let mut peak = 0.0f64;
    let mut zeros = 0usize;
    for &v in x {
        let v = v as f64;
        sq += v * v;
        peak = peak.max(v.abs());
        if v == 0.0 {
            zeros += 1;
        }
    }
    ((sq / x.len() as f64).sqrt(), peak, zeros as f64 / x.len() as f64)
}

pub fn db(a: f64) -> f64 {
    if a > 0.0 { 20.0 * a.log10() } else { f64::NEG_INFINITY }
}

/// Percentile (0..100) of a sample set; sorts in place. Returns 0 for an empty set.
pub fn pct(v: &mut [f64], p: f64) -> f64 {
    if v.is_empty() {
        return 0.0;
    }
    v.sort_by(|a, b| a.partial_cmp(b).unwrap());
    let k = ((p / 100.0) * (v.len() - 1) as f64).round() as usize;
    v[k.min(v.len() - 1)]
}
