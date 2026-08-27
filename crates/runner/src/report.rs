//! Reporter untuk RunReport: pretty (stdout), JSON, JUnit XML, dan HTML.

use proxius_core::RunReport;

/// Ringkasan berwarna ke stdout. Mengembalikan true bila semua lulus.
pub fn print_pretty(report: &RunReport) -> bool {
    const G: &str = "\x1b[32m";
    const R: &str = "\x1b[31m";
    const D: &str = "\x1b[2m";
    const B: &str = "\x1b[1m";
    const X: &str = "\x1b[0m";

    println!("\n{B}{}{X}", report.name);
    for req in &report.requests {
        let mark = if req.ok { format!("{G}✓{X}") } else { format!("{R}✗{X}") };
        let status = if req.status > 0 {
            format!("{D}{}{X}", req.status)
        } else {
            format!("{R}ERR{X}")
        };
        println!(
            "  {mark} {} {} {} {D}{}ms{X}",
            req.method.as_str(),
            req.name,
            status,
            req.duration_ms
        );
        if let Some(err) = &req.error {
            println!("      {R}{err}{X}");
        }
        for a in &req.assertions {
            if a.passed {
                println!("      {G}✓{X} {D}{}{X}", a.description);
            } else {
                println!("      {R}✗ {} — {}{X}", a.description, a.message);
            }
        }
    }

    let all_ok = report.failed_requests == 0;
    let color = if all_ok { G } else { R };
    println!(
        "\n{color}{}{X} {}/{} request lulus · {}/{} assertion lulus\n",
        if all_ok { "PASS" } else { "FAIL" },
        report.passed_requests,
        report.total,
        report.passed_assertions,
        report.total_assertions,
    );
    all_ok
}

/// Serialisasi JSON.
pub fn to_json(report: &RunReport) -> String {
    serde_json::to_string_pretty(report).unwrap_or_else(|_| "{}".into())
}

fn xml_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// JUnit XML (untuk CI).
pub fn to_junit(report: &RunReport) -> String {
    let mut out = String::new();
    out.push_str("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n");
    out.push_str(&format!(
        "<testsuite name=\"{}\" tests=\"{}\" failures=\"{}\">\n",
        xml_escape(&report.name),
        report.total,
        report.failed_requests,
    ));
    for req in &report.requests {
        let time = req.duration_ms as f64 / 1000.0;
        out.push_str(&format!(
            "  <testcase name=\"{}\" classname=\"{}\" time=\"{:.3}\">\n",
            xml_escape(&req.name),
            req.method.as_str(),
            time,
        ));
        if let Some(err) = &req.error {
            out.push_str(&format!(
                "    <error message=\"{}\"/>\n",
                xml_escape(err)
            ));
        }
        for a in req.assertions.iter().filter(|a| !a.passed) {
            out.push_str(&format!(
                "    <failure message=\"{}\">{}</failure>\n",
                xml_escape(&a.description),
                xml_escape(&a.message),
            ));
        }
        out.push_str("  </testcase>\n");
    }
    out.push_str("</testsuite>\n");
    out
}

fn html_escape(s: &str) -> String {
    s.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

/// Laporan HTML mandiri (self-contained, tanpa aset eksternal) untuk CI.
/// Menerima satu atau banyak run (data-driven → banyak iterasi).
pub fn to_html(reports: &[RunReport]) -> String {
    let total: usize = reports.iter().map(|r| r.total).sum();
    let passed_req: usize = reports.iter().map(|r| r.passed_requests).sum();
    let failed_req: usize = reports.iter().map(|r| r.failed_requests).sum();
    let total_as: usize = reports.iter().map(|r| r.total_assertions).sum();
    let passed_as: usize = reports.iter().map(|r| r.passed_assertions).sum();
    let all_ok = failed_req == 0;
    let suite = reports.first().map(|r| r.name.as_str()).unwrap_or("Proxius");

    let mut body = String::new();
    for report in reports {
        body.push_str(&format!(
            "<section class=\"run\"><h2>{}</h2>",
            html_escape(&report.name)
        ));
        for req in &report.requests {
            let cls = if req.ok { "ok" } else { "fail" };
            let mark = if req.ok { "✓" } else { "✗" };
            let status = if req.status > 0 {
                req.status.to_string()
            } else {
                "ERR".into()
            };
            body.push_str(&format!(
                "<div class=\"req {cls}\"><div class=\"req-head\">\
                 <span class=\"mark\">{mark}</span>\
                 <span class=\"method m-{method}\">{method}</span>\
                 <span class=\"name\">{name}</span>\
                 <span class=\"status\">{status}</span>\
                 <span class=\"dur\">{dur} ms</span></div>\
                 <div class=\"url\">{url}</div>",
                method = html_escape(req.method.as_str()),
                name = html_escape(&req.name),
                status = status,
                dur = req.duration_ms,
                url = html_escape(&req.url),
            ));
            if let Some(err) = &req.error {
                body.push_str(&format!("<div class=\"err\">{}</div>", html_escape(err)));
            }
            if !req.assertions.is_empty() {
                body.push_str("<ul class=\"asserts\">");
                for a in &req.assertions {
                    let acls = if a.passed { "ok" } else { "fail" };
                    let amark = if a.passed { "✓" } else { "✗" };
                    let msg = if a.passed || a.message.is_empty() {
                        String::new()
                    } else {
                        format!(" — <span class=\"amsg\">{}</span>", html_escape(&a.message))
                    };
                    body.push_str(&format!(
                        "<li class=\"{acls}\">{amark} {desc}{msg}</li>",
                        desc = html_escape(&a.description),
                    ));
                }
                body.push_str("</ul>");
            }
            body.push_str("</div>");
        }
        body.push_str("</section>");
    }

    let verdict = if all_ok { "PASS" } else { "FAIL" };
    let vcls = if all_ok { "ok" } else { "fail" };

    format!(
        "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">\
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\
<title>Proxius report — {suite}</title><style>\
:root{{--bg:#0d0f12;--card:#15181d;--line:#262b33;--fg:#e5e7eb;--dim:#9aa4b2;\
--ok:#34d399;--fail:#f87171;--okbg:rgba(52,211,153,.12);--failbg:rgba(248,113,113,.12)}}\
*{{box-sizing:border-box}}body{{margin:0;background:var(--bg);color:var(--fg);\
font:14px/1.5 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif;padding:24px}}\
.wrap{{max-width:880px;margin:0 auto}}h1{{font-size:20px;margin:0 0 4px}}\
h2{{font-size:15px;color:var(--dim);font-weight:600;margin:24px 0 8px}}\
.verdict{{display:inline-block;padding:2px 10px;border-radius:6px;font-weight:700;font-size:13px}}\
.verdict.ok{{background:var(--okbg);color:var(--ok)}}.verdict.fail{{background:var(--failbg);color:var(--fail)}}\
.stats{{display:flex;gap:16px;flex-wrap:wrap;margin:12px 0 4px;color:var(--dim);font-size:13px}}\
.stats b{{color:var(--fg)}}\
.req{{border:1px solid var(--line);border-left-width:3px;border-radius:8px;background:var(--card);\
padding:10px 12px;margin:8px 0}}.req.ok{{border-left-color:var(--ok)}}.req.fail{{border-left-color:var(--fail)}}\
.req-head{{display:flex;align-items:center;gap:8px;flex-wrap:wrap}}\
.mark{{font-weight:700}}.req.ok .mark{{color:var(--ok)}}.req.fail .mark{{color:var(--fail)}}\
.method{{font:600 11px ui-monospace,monospace;color:var(--dim)}}\
.name{{flex:1;font-weight:600;min-width:120px}}\
.status,.dur{{font:12px ui-monospace,monospace;color:var(--dim)}}\
.url{{font:12px ui-monospace,monospace;color:var(--dim);margin-top:4px;word-break:break-all}}\
.err{{color:var(--fail);font-size:13px;margin-top:6px}}\
.asserts{{list-style:none;margin:8px 0 0;padding:0;font:12px ui-monospace,monospace}}\
.asserts li{{padding:2px 0}}.asserts li.ok{{color:var(--dim)}}.asserts li.fail{{color:var(--fail)}}\
.amsg{{color:var(--fail)}}footer{{margin-top:28px;color:var(--dim);font-size:12px}}\
</style></head><body><div class=\"wrap\">\
<h1>{suite} <span class=\"verdict {vcls}\">{verdict}</span></h1>\
<div class=\"stats\"><span><b>{passed_req}</b>/{total} requests</span>\
<span><b>{passed_as}</b>/{total_as} assertions</span>\
<span><b>{failed_req}</b> failed</span></div>\
{body}\
<footer>Generated by Proxius CLI · <code>proxius run … --reporter html</code></footer>\
</div></body></html>",
        suite = html_escape(suite),
        vcls = vcls,
        verdict = verdict,
        passed_req = passed_req,
        total = total,
        passed_as = passed_as,
        total_as = total_as,
        failed_req = failed_req,
        body = body,
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxius_core::{AssertionResult, HttpMethod, RequestReport, RunReport};

    fn report(ok: bool) -> RunReport {
        RunReport {
            name: "Suite <A&B>".into(),
            total: 1,
            passed_requests: if ok { 1 } else { 0 },
            failed_requests: if ok { 0 } else { 1 },
            total_assertions: 1,
            passed_assertions: if ok { 1 } else { 0 },
            requests: vec![RequestReport {
                name: "req".into(),
                method: HttpMethod::Get,
                url: "https://x/y?a=1&b=2".into(),
                status: 200,
                duration_ms: 12,
                ok,
                error: None,
                assertions: vec![AssertionResult {
                    id: "a".into(),
                    passed: ok,
                    description: "status equals 200".into(),
                    actual: "200".into(),
                    message: if ok { String::new() } else { "boom".into() },
                }],
            }],
        }
    }

    #[test]
    fn html_reports_verdict_and_escapes() {
        let pass = to_html(&[report(true)]);
        assert!(pass.contains("<!doctype html>"));
        assert!(pass.contains("verdict ok"));
        assert!(pass.contains("Suite &lt;A&amp;B&gt;")); // escaped
        assert!(pass.contains("a=1&amp;b=2")); // url escaped

        let fail = to_html(&[report(false)]);
        assert!(fail.contains("verdict fail"));
        assert!(fail.contains("boom"));
    }

    #[test]
    fn html_aggregates_multiple_runs() {
        let html = to_html(&[report(true), report(false)]);
        assert!(html.contains("verdict fail")); // any failure ⇒ overall fail
        assert!(html.contains("<b>1</b>/2 requests"));
    }
}
