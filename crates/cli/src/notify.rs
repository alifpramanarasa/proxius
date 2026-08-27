//! Kirim ringkasan hasil run ke webhook (Slack / Discord / Teams / generik).
//! Mendogfood HTTP stack Proxius sendiri (`proxius_engine::send`).

use proxius_core::{HttpMethod, HttpRequest, KeyValue, RequestBody, RunReport};

/// Kapan mengirim notifikasi.
#[derive(Copy, Clone, PartialEq, Eq, clap::ValueEnum)]
pub enum NotifyOn {
    /// Selalu kirim.
    Always,
    /// Hanya bila ada request/assertion yang gagal.
    Failure,
}

fn json_str(s: &str) -> String {
    serde_json::Value::String(s.to_string()).to_string()
}

/// Ringkasan teks lintas semua run (data-driven → beberapa laporan).
fn summarize(reports: &[RunReport], ok: bool) -> String {
    let name = reports.first().map(|r| r.name.as_str()).unwrap_or("Proxius");
    let total: usize = reports.iter().map(|r| r.total).sum();
    let passed_req: usize = reports.iter().map(|r| r.passed_requests).sum();
    let total_as: usize = reports.iter().map(|r| r.total_assertions).sum();
    let passed_as: usize = reports.iter().map(|r| r.passed_assertions).sum();

    let mut msg = format!(
        "{} Proxius: {} — {}/{} requests, {}/{} assertions",
        if ok { "✅" } else { "❌" },
        name,
        passed_req,
        total,
        passed_as,
        total_as,
    );

    // Daftar request gagal (maks 5).
    let mut fails: Vec<String> = Vec::new();
    for r in reports {
        for req in r.requests.iter().filter(|q| !q.ok) {
            let reason = req
                .error
                .clone()
                .or_else(|| {
                    req.assertions
                        .iter()
                        .find(|a| !a.passed)
                        .map(|a| format!("{} — {}", a.description, a.message))
                })
                .unwrap_or_default();
            fails.push(format!("• {} {}: {}", req.method.as_str(), req.name, reason));
        }
    }
    if !fails.is_empty() {
        let shown = fails.len().min(5);
        msg.push('\n');
        msg.push_str(&fails[..shown].join("\n"));
        if fails.len() > shown {
            msg.push_str(&format!("\n… +{} more", fails.len() - shown));
        }
    }
    msg
}

/// Bentuk payload sesuai target webhook (deteksi dari host URL).
fn payload_for(url: &str, text: &str) -> String {
    let u = url.to_lowercase();
    if u.contains("hooks.slack.com") {
        format!("{{\"text\":{}}}", json_str(text))
    } else if u.contains("discord.com/api/webhooks") || u.contains("discordapp.com/api/webhooks") {
        format!("{{\"content\":{}}}", json_str(text))
    } else if u.contains("office.com") || u.contains("office365.com") || u.contains("webhook.office") {
        // Microsoft Teams incoming webhook = MessageCard.
        format!(
            "{{\"@type\":\"MessageCard\",\"@context\":\"http://schema.org/extensions\",\"text\":{}}}",
            json_str(text)
        )
    } else {
        // Generik: teks + ringkasan mentah.
        format!("{{\"text\":{}}}", json_str(text))
    }
}

/// Kirim notifikasi ke setiap URL. `ok` = semua lulus. Mengembalikan Ok bahkan
/// bila sebagian webhook gagal (dilaporkan ke stderr) — notifikasi tak boleh
/// menggagalkan build.
pub async fn notify(urls: &[String], reports: &[RunReport], on: NotifyOn, ok: bool) {
    if urls.is_empty() || (on == NotifyOn::Failure && ok) {
        return;
    }
    let text = summarize(reports, ok);
    for url in urls {
        let mut req = HttpRequest::new("proxius-notify");
        req.method = HttpMethod::Post;
        req.url = url.clone();
        req.headers = vec![KeyValue {
            key: "Content-Type".into(),
            value: "application/json".into(),
            enabled: true,
        }];
        req.body = RequestBody::Json {
            content: payload_for(url, &text),
        };
        match proxius_engine::send(&req).await {
            Ok(resp) if resp.status >= 200 && resp.status < 300 => {
                eprintln!("notifikasi terkirim ({})", resp.status);
            }
            Ok(resp) => eprintln!(
                "notifikasi gagal: HTTP {} — {}",
                resp.status,
                resp.body.chars().take(200).collect::<String>()
            ),
            Err(e) => eprintln!("notifikasi error: {e}"),
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxius_core::{HttpMethod, RequestReport};

    fn rep(ok: bool) -> RunReport {
        RunReport {
            name: "My API".into(),
            total: 1,
            passed_requests: if ok { 1 } else { 0 },
            failed_requests: if ok { 0 } else { 1 },
            total_assertions: 2,
            passed_assertions: if ok { 2 } else { 1 },
            requests: vec![RequestReport {
                name: "Login".into(),
                method: HttpMethod::Post,
                url: "https://api/login".into(),
                status: if ok { 200 } else { 500 },
                duration_ms: 5,
                ok,
                error: None,
                assertions: vec![],
            }],
        }
    }

    #[test]
    fn slack_and_discord_payloads_differ() {
        let s = payload_for("https://hooks.slack.com/services/x", "hi \"there\"");
        assert!(s.starts_with("{\"text\":"));
        assert!(s.contains("\\\"there\\\"")); // di-escape
        let d = payload_for("https://discord.com/api/webhooks/1/2", "hi");
        assert!(d.starts_with("{\"content\":"));
        let t = payload_for("https://outlook.office.com/webhook/x", "hi");
        assert!(t.contains("MessageCard"));
    }

    #[test]
    fn summary_lists_failures() {
        let msg = summarize(&[rep(false)], false);
        assert!(msg.starts_with("❌"));
        assert!(msg.contains("0/1 requests"));
        assert!(msg.contains("POST Login"));
        let okmsg = summarize(&[rep(true)], true);
        assert!(okmsg.starts_with("✅"));
    }
}
