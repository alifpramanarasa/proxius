//! Load / performance test: jalankan request secara konkuren (banyak virtual
//! user) selama durasi tertentu, lalu agregasi latensi (p50/p90/p95/p99),
//! throughput (rps), dan error rate. Memakai `proxius_engine::send`.

use std::collections::BTreeMap;
use std::sync::Arc;
use std::time::{Duration, Instant};

use proxius_core::{resolve_request, HttpRequest, RunDocument};
use serde::Serialize;

/// Opsi load test.
pub struct LoadOptions {
    /// Virtual user konkuren.
    pub vus: usize,
    /// Durasi total.
    pub duration: Duration,
    /// Hanya jalankan request dengan nama ini (opsional).
    pub only: Option<String>,
}

struct Sample {
    latency_ms: u64,
    ok: bool,
    status: u16,
}

/// Persentil latensi (ms).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Latency {
    pub min: u64,
    pub mean: u64,
    pub p50: u64,
    pub p90: u64,
    pub p95: u64,
    pub p99: u64,
    pub max: u64,
}

/// Laporan agregat load test.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LoadReport {
    pub name: String,
    pub vus: usize,
    pub duration_s: f64,
    pub total: usize,
    pub failures: usize,
    pub error_rate: f64,
    pub rps: f64,
    pub latency: Latency,
    /// Distribusi status code (0 = error transport).
    pub status_dist: BTreeMap<u16, usize>,
}

/// Nearest-rank percentile atas slice terurut menaik.
fn pct(sorted: &[u64], p: f64) -> u64 {
    if sorted.is_empty() {
        return 0;
    }
    let rank = (p / 100.0 * sorted.len() as f64).ceil() as usize;
    let idx = rank.saturating_sub(1).min(sorted.len() - 1);
    sorted[idx]
}

/// Jalankan load test. Me-resolve request dengan `base` sekali, lalu menembak
/// berulang dari `vus` task konkuren hingga `duration` habis.
pub async fn run_load(
    doc: &RunDocument,
    base: &std::collections::HashMap<String, String>,
    opts: LoadOptions,
) -> LoadReport {
    // Gabung variabel dokumen lalu `base` (base menimpa) — sama seperti
    // run_document, agar `{{var}}` di URL/headers ikut ter-resolve.
    let mut vars: std::collections::HashMap<String, String> = std::collections::HashMap::new();
    for kv in &doc.variables {
        if kv.enabled && !kv.key.is_empty() {
            vars.insert(kv.key.clone(), kv.value.clone());
        }
    }
    for (k, v) in base {
        vars.insert(k.clone(), v.clone());
    }

    // Pra-resolve request (interpolasi variabel statis).
    let mut requests: Vec<HttpRequest> = doc
        .requests
        .iter()
        .filter(|r| opts.only.as_ref().map_or(true, |n| &r.name == n))
        .map(|r| resolve_request(r, &vars))
        .collect();
    if requests.is_empty() {
        requests = doc.requests.iter().map(|r| resolve_request(r, &vars)).collect();
    }
    let requests = Arc::new(requests);

    let start = Instant::now();
    let deadline = start + opts.duration;
    let vus = opts.vus.max(1);

    let mut handles = Vec::with_capacity(vus);
    for _ in 0..vus {
        let reqs = Arc::clone(&requests);
        handles.push(tokio::spawn(async move {
            let mut samples: Vec<Sample> = Vec::new();
            while Instant::now() < deadline {
                for req in reqs.iter() {
                    if Instant::now() >= deadline {
                        break;
                    }
                    let t = Instant::now();
                    match proxius_engine::send(req).await {
                        Ok(resp) => samples.push(Sample {
                            latency_ms: t.elapsed().as_millis() as u64,
                            ok: resp.status >= 200 && resp.status < 400,
                            status: resp.status,
                        }),
                        Err(_) => samples.push(Sample {
                            latency_ms: t.elapsed().as_millis() as u64,
                            ok: false,
                            status: 0,
                        }),
                    }
                }
            }
            samples
        }));
    }

    let mut all: Vec<Sample> = Vec::new();
    for h in handles {
        if let Ok(mut s) = h.await {
            all.append(&mut s);
        }
    }
    let elapsed = start.elapsed().as_secs_f64().max(0.001);

    let total = all.len();
    let failures = all.iter().filter(|s| !s.ok).count();
    let mut status_dist: BTreeMap<u16, usize> = BTreeMap::new();
    for s in &all {
        *status_dist.entry(s.status).or_insert(0) += 1;
    }

    let mut lat: Vec<u64> = all.iter().map(|s| s.latency_ms).collect();
    lat.sort_unstable();
    let sum: u128 = lat.iter().map(|&x| x as u128).sum();
    let mean = if lat.is_empty() { 0 } else { (sum / lat.len() as u128) as u64 };

    LoadReport {
        name: doc.name.clone(),
        vus,
        duration_s: (elapsed * 100.0).round() / 100.0,
        total,
        failures,
        error_rate: if total == 0 {
            0.0
        } else {
            (failures as f64 / total as f64 * 10000.0).round() / 100.0
        },
        rps: (total as f64 / elapsed * 100.0).round() / 100.0,
        latency: Latency {
            min: lat.first().copied().unwrap_or(0),
            mean,
            p50: pct(&lat, 50.0),
            p90: pct(&lat, 90.0),
            p95: pct(&lat, 95.0),
            p99: pct(&lat, 99.0),
            max: lat.last().copied().unwrap_or(0),
        },
        status_dist,
    }
}

/// Ringkasan berwarna ke stdout.
pub fn print_load(r: &LoadReport) {
    const G: &str = "\x1b[32m";
    const R: &str = "\x1b[31m";
    const D: &str = "\x1b[2m";
    const B: &str = "\x1b[1m";
    const X: &str = "\x1b[0m";

    println!("\n{B}{}{X} {D}· {} VUs · {:.2}s{X}", r.name, r.vus, r.duration_s);
    let ecol = if r.failures == 0 { G } else { R };
    println!(
        "  {B}{}{X} requests · {}{:.2} rps{X} · {ecol}{}/{} failed ({:.2}%){X}",
        r.total, B, r.rps, r.failures, r.total, r.error_rate,
    );
    println!(
        "  {D}latency ms:{X} min {} · p50 {} · p90 {} · p95 {B}{}{X} · p99 {} · max {}",
        r.latency.min, r.latency.p50, r.latency.p90, r.latency.p95, r.latency.p99, r.latency.max,
    );
    let dist: Vec<String> = r
        .status_dist
        .iter()
        .map(|(k, v)| if *k == 0 { format!("ERR:{v}") } else { format!("{k}:{v}") })
        .collect();
    println!("  {D}status:{X} {}\n", dist.join("  "));
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn percentiles_nearest_rank() {
        let v: Vec<u64> = (1..=100).collect(); // 1..100
        assert_eq!(pct(&v, 50.0), 50);
        assert_eq!(pct(&v, 90.0), 90);
        assert_eq!(pct(&v, 95.0), 95);
        assert_eq!(pct(&v, 99.0), 99);
        assert_eq!(pct(&v, 100.0), 100);
        assert_eq!(pct(&[], 95.0), 0);
        assert_eq!(pct(&[42], 95.0), 42);
    }
}
