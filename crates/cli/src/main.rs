//! `proxius` — CLI headless runner (setara Newman) untuk CI/CD.

use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;

use anyhow::{Context, Result};
use clap::{Parser, Subcommand, ValueEnum};
use proxius_core::{RunDocument, RunReport};
use proxius_runner::report;

mod mcp;
mod mock;
mod notify;

#[derive(Parser)]
#[command(name = "proxius", version, about = "Proxius CLI — jalankan test API headless")]
struct Cli {
    #[command(subcommand)]
    command: Command,
}

#[derive(Subcommand)]
enum Command {
    /// Jalankan file dokumen (.pxs / JSON hasil ekspor collection).
    Run {
        /// Path file dokumen.
        file: PathBuf,
        /// File environment JSON: objek {"key":"value"}.
        #[arg(short, long)]
        env: Option<PathBuf>,
        /// Set variabel tunggal, mis. --var token=abc (boleh berkali-kali).
        #[arg(long = "var", value_name = "K=V")]
        vars: Vec<String>,
        /// File data-driven: array JSON berisi objek variabel per iterasi.
        #[arg(long)]
        data: Option<PathBuf>,
        /// Format output tunggal (dipakai bila --report tidak diberikan).
        #[arg(long, value_enum, default_value_t = Reporter::Pretty)]
        reporter: Reporter,
        /// Tulis output ke file (untuk json/junit/html).
        #[arg(short, long)]
        output: Option<PathBuf>,
        /// Emit beberapa laporan sekaligus dalam satu run (mis. --report junit
        /// --report html). File ditulis ke --report-dir; stdout tetap pretty.
        #[arg(long = "report", value_enum)]
        report: Vec<Reporter>,
        /// Direktori tujuan file --report (default: direktori saat ini).
        #[arg(long, default_value = ".")]
        report_dir: PathBuf,
        /// URL webhook untuk kirim ringkasan hasil (Slack/Discord/Teams/generik;
        /// boleh berkali-kali).
        #[arg(long = "notify", value_name = "URL")]
        notify: Vec<String>,
        /// Kapan mengirim notifikasi.
        #[arg(long, value_enum, default_value_t = notify::NotifyOn::Failure)]
        notify_on: notify::NotifyOn,
    },
    /// Load test: tembak request secara konkuren, laporkan p95/rps/error rate.
    Load {
        /// Path file dokumen (.pxs / JSON).
        file: PathBuf,
        /// File environment JSON.
        #[arg(short, long)]
        env: Option<PathBuf>,
        /// Set variabel tunggal (boleh berkali-kali).
        #[arg(long = "var", value_name = "K=V")]
        vars: Vec<String>,
        /// Virtual user konkuren.
        #[arg(long, default_value_t = 10)]
        vus: usize,
        /// Durasi dalam detik.
        #[arg(long, default_value_t = 10)]
        duration: u64,
        /// Hanya request dengan nama ini.
        #[arg(long)]
        only: Option<String>,
        /// Emit laporan JSON ke file, bukan hanya ringkasan stdout.
        #[arg(short, long)]
        output: Option<PathBuf>,
    },
    /// Jalankan sebagai server MCP (stdio) — konek dari Claude Code dll.
    Mcp,
    /// Mock server: sajikan example response sebagai endpoint HTTP nyata.
    Mock {
        /// File route mock JSON (objek {"routes":[...]} atau array [...]).
        file: PathBuf,
        /// Port (default 9090).
        #[arg(long, default_value_t = 9090)]
        port: u16,
    },
}

#[derive(Copy, Clone, ValueEnum)]
enum Reporter {
    Pretty,
    Json,
    Junit,
    /// Laporan HTML mandiri (untuk artifact CI).
    Html,
}

fn load_env(path: &Option<PathBuf>) -> Result<HashMap<String, String>> {
    let mut map = HashMap::new();
    if let Some(p) = path {
        let text = fs::read_to_string(p)
            .with_context(|| format!("gagal baca env {}", p.display()))?;
        let obj: HashMap<String, serde_json::Value> =
            serde_json::from_str(&text).context("env harus objek JSON {\"k\":\"v\"}")?;
        for (k, v) in obj {
            map.insert(k, json_to_str(&v));
        }
    }
    Ok(map)
}

fn json_to_str(v: &serde_json::Value) -> String {
    match v {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

fn parse_var(s: &str) -> Result<(String, String)> {
    let (k, v) = s
        .split_once('=')
        .with_context(|| format!("--var harus format K=V: {s}"))?;
    Ok((k.trim().to_string(), v.to_string()))
}

#[tokio::main]
async fn main() -> ExitCode {
    match run().await {
        Ok(code) => code,
        Err(e) => {
            eprintln!("\x1b[31merror:\x1b[0m {e:#}");
            ExitCode::from(2)
        }
    }
}

async fn run() -> Result<ExitCode> {
    let cli = Cli::parse();
    match cli.command {
        Command::Mcp => {
            mcp::serve().await?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Mock { file, port } => {
            let text = fs::read_to_string(&file)
                .with_context(|| format!("gagal baca {}", file.display()))?;
            let routes = mock::parse_routes(&text).context("file mock tidak valid")?;
            if routes.is_empty() {
                anyhow::bail!("tidak ada route mock di file");
            }
            mock::serve(routes, port).await?;
            Ok(ExitCode::SUCCESS)
        }
        Command::Load {
            file,
            env,
            vars,
            vus,
            duration,
            only,
            output,
        } => load_cmd(file, env, vars, vus, duration, only, output).await,
        Command::Run {
            file,
            env,
            vars,
            data,
            reporter,
            output,
            report,
            report_dir,
            notify,
            notify_on,
        } => {
            run_document_cmd(
                file, env, vars, data, reporter, output, report, report_dir, notify, notify_on,
            )
            .await
        }
    }
}

#[allow(clippy::too_many_arguments)]
async fn run_document_cmd(
    file: PathBuf,
    env: Option<PathBuf>,
    vars: Vec<String>,
    data: Option<PathBuf>,
    reporter: Reporter,
    output: Option<PathBuf>,
    report: Vec<Reporter>,
    report_dir: PathBuf,
    notify_urls: Vec<String>,
    notify_on: notify::NotifyOn,
) -> Result<ExitCode> {
    let text =
        fs::read_to_string(&file).with_context(|| format!("gagal baca {}", file.display()))?;
    let doc: RunDocument =
        serde_json::from_str(&text).context("file bukan RunDocument JSON yang valid")?;

    // Variabel dasar: env file lalu --var (menimpa).
    let mut base = load_env(&env)?;
    for v in &vars {
        let (k, val) = parse_var(v)?;
        base.insert(k, val);
    }

    // Data-driven: satu iterasi per baris; tanpa --data → satu iterasi.
    let rows: Vec<HashMap<String, String>> = match &data {
        Some(p) => {
            let t = fs::read_to_string(p)
                .with_context(|| format!("gagal baca data {}", p.display()))?;
            let arr: Vec<HashMap<String, serde_json::Value>> =
                serde_json::from_str(&t).context("data harus array JSON berisi objek")?;
            arr.into_iter()
                .map(|o| o.iter().map(|(k, v)| (k.clone(), json_to_str(v))).collect())
                .collect()
        }
        None => vec![HashMap::new()],
    };

    let mut reports: Vec<RunReport> = Vec::new();
    for (i, row) in rows.iter().enumerate() {
        let mut vars = base.clone();
        for (k, v) in row {
            vars.insert(k.clone(), v.clone());
        }
        let mut r = proxius_runner::run_document(&doc, &vars).await;
        if rows.len() > 1 {
            r.name = format!("{} [#{}]", doc.name, i + 1);
        }
        reports.push(r);
    }

    let any_failed = reports.iter().any(|r| r.failed_requests > 0);

    // Notifikasi webhook (opsional) — tak menggagalkan build bila webhook error.
    notify::notify(&notify_urls, &reports, notify_on, !any_failed).await;

    // Mode multi-laporan: satu run → pretty ke stdout + file per format.
    if !report.is_empty() {
        for r in &reports {
            report::print_pretty(r);
        }
        fs::create_dir_all(&report_dir)
            .with_context(|| format!("gagal buat dir {}", report_dir.display()))?;
        for fmt in &report {
            let (payload, file_name) = render_report(*fmt, &reports);
            if let Some(name) = file_name {
                let path = report_dir.join(name);
                fs::write(&path, &payload)
                    .with_context(|| format!("gagal tulis {}", path.display()))?;
                eprintln!("ditulis ke {}", path.display());
            }
        }
        return Ok(if any_failed {
            ExitCode::from(1)
        } else {
            ExitCode::SUCCESS
        });
    }

    match reporter {
        Reporter::Pretty => {
            for r in &reports {
                report::print_pretty(r);
            }
        }
        Reporter::Json => {
            let payload = if reports.len() == 1 {
                report::to_json(&reports[0])
            } else {
                serde_json::to_string_pretty(&reports).unwrap_or_default()
            };
            emit(&output, &payload)?;
        }
        Reporter::Junit => {
            let payload = reports
                .iter()
                .map(report::to_junit)
                .collect::<Vec<_>>()
                .join("\n");
            emit(&output, &payload)?;
        }
        Reporter::Html => {
            emit(&output, &report::to_html(&reports))?;
        }
    }

    Ok(if any_failed {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    })
}

/// Render laporan gabungan untuk mode multi-`--report`; None = tak ada file
/// (pretty sudah dicetak ke stdout).
fn render_report(fmt: Reporter, reports: &[RunReport]) -> (String, Option<&'static str>) {
    match fmt {
        Reporter::Pretty => (String::new(), None),
        Reporter::Json => {
            let payload = if reports.len() == 1 {
                report::to_json(&reports[0])
            } else {
                serde_json::to_string_pretty(&reports).unwrap_or_default()
            };
            (payload, Some("report.json"))
        }
        Reporter::Junit => (
            reports
                .iter()
                .map(report::to_junit)
                .collect::<Vec<_>>()
                .join("\n"),
            Some("junit.xml"),
        ),
        Reporter::Html => (report::to_html(reports), Some("report.html")),
    }
}

async fn load_cmd(
    file: PathBuf,
    env: Option<PathBuf>,
    vars: Vec<String>,
    vus: usize,
    duration: u64,
    only: Option<String>,
    output: Option<PathBuf>,
) -> Result<ExitCode> {
    let text =
        fs::read_to_string(&file).with_context(|| format!("gagal baca {}", file.display()))?;
    let doc: RunDocument =
        serde_json::from_str(&text).context("file bukan RunDocument JSON yang valid")?;

    let mut base = load_env(&env)?;
    for v in &vars {
        let (k, val) = parse_var(v)?;
        base.insert(k, val);
    }

    let opts = proxius_runner::load::LoadOptions {
        vus,
        duration: std::time::Duration::from_secs(duration),
        only,
    };
    eprintln!("load: {} VUs selama {}s…", vus, duration);
    let report = proxius_runner::load::run_load(&doc, &base, opts).await;
    proxius_runner::load::print_load(&report);

    if let Some(path) = &output {
        let json = serde_json::to_string_pretty(&report).unwrap_or_default();
        fs::write(path, json).with_context(|| format!("gagal tulis {}", path.display()))?;
        eprintln!("ditulis ke {}", path.display());
    }

    // Exit non-zero bila ada kegagalan (berguna untuk gate CI).
    Ok(if report.failures > 0 {
        ExitCode::from(1)
    } else {
        ExitCode::SUCCESS
    })
}

fn emit(output: &Option<PathBuf>, payload: &str) -> Result<()> {
    match output {
        Some(p) => {
            fs::write(p, payload).with_context(|| format!("gagal tulis {}", p.display()))?;
            eprintln!("ditulis ke {}", p.display());
        }
        None => println!("{payload}"),
    }
    Ok(())
}
