//! Server MCP (Model Context Protocol) untuk Proxius.
//!
//! Mengekspos primitif API-testing Proxius sebagai *tools* MCP lewat transport
//! stdio (JSON-RPC 2.0, satu pesan per baris). Dengan ini Claude Code (atau
//! MCP client lain) bisa "menembak" API, menjalankan collection, dan memeriksa
//! assertion — semua headless lewat engine + runner Rust yang sama.
//!
//! Protokol di-*hand-roll* memakai serde_json (tanpa dependency MCP tambahan)
//! agar tetap ringan dan bisa dibangun offline.
//!
//! Framing: setiap pesan JSON-RPC adalah satu baris di stdin/stdout. Semua
//! diagnostik ditulis ke stderr agar stdout murni berisi protokol.

use std::collections::HashMap;

use anyhow::{Context, Result};
use proxius_core::{
    Assertion, AssertionOp, AssertionSource, HttpMethod, HttpRequest, RequestBody, RunDocument,
    RunReport,
};
use serde_json::{json, Value};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

/// Versi protokol default bila client tak mengirim (kita echo milik client).
const DEFAULT_PROTOCOL: &str = "2025-06-18";
const BODY_LIMIT: usize = 8_000;

/// Loop utama: baca baris dari stdin, tangani, tulis balasan ke stdout.
pub async fn serve() -> Result<()> {
    let mut lines = BufReader::new(tokio::io::stdin()).lines();
    let mut stdout = tokio::io::stdout();
    eprintln!("proxius mcp: siap (stdio)");

    while let Some(line) = lines.next_line().await? {
        let line = line.trim();
        if line.is_empty() {
            continue;
        }
        let msg: Value = match serde_json::from_str(line) {
            Ok(v) => v,
            Err(e) => {
                eprintln!("proxius mcp: JSON tidak valid: {e}");
                continue;
            }
        };
        if let Some(resp) = handle(&msg).await {
            let s = serde_json::to_string(&resp).unwrap_or_else(|_| "{}".into());
            stdout.write_all(s.as_bytes()).await?;
            stdout.write_all(b"\n").await?;
            stdout.flush().await?;
        }
    }
    Ok(())
}

/// Tangani satu pesan; None untuk notification (tanpa balasan).
async fn handle(msg: &Value) -> Option<Value> {
    let method = msg.get("method")?.as_str()?;
    let id = msg.get("id").cloned();
    match method {
        "initialize" => Some(ok(id, initialize_result(msg))),
        "notifications/initialized" | "notifications/cancelled" => None,
        "ping" => Some(ok(id, json!({}))),
        "tools/list" => Some(ok(id, json!({ "tools": tool_specs() }))),
        "tools/call" => Some(tools_call(id, msg).await),
        "resources/list" => Some(ok(id, json!({ "resources": [] }))),
        "prompts/list" => Some(ok(id, json!({ "prompts": [] }))),
        _ => {
            // Request (punya id) dengan method tak dikenal → error; notifikasi diabaikan.
            id.map(|id| err(Some(id), -32601, &format!("method tidak dikenal: {method}")))
        }
    }
}

fn initialize_result(msg: &Value) -> Value {
    let pv = msg
        .pointer("/params/protocolVersion")
        .and_then(|v| v.as_str())
        .unwrap_or(DEFAULT_PROTOCOL);
    json!({
        "protocolVersion": pv,
        "capabilities": { "tools": {} },
        "serverInfo": { "name": "proxius", "version": env!("CARGO_PKG_VERSION") },
        "instructions": "Proxius API-testing tools. http_send menembak satu request; assert_request menembak + memeriksa assertion; run_document menjalankan file collection (.pxs) beserta test-nya."
    })
}

fn ok(id: Option<Value>, result: Value) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "result": result })
}

fn err(id: Option<Value>, code: i64, message: &str) -> Value {
    json!({ "jsonrpc": "2.0", "id": id.unwrap_or(Value::Null), "error": { "code": code, "message": message } })
}

// ── Definisi tools (dikembalikan pada tools/list) ───────────────────

fn tool_specs() -> Value {
    let kv_obj = json!({ "type": "object", "additionalProperties": { "type": "string" } });
    json!([
        {
            "name": "http_send",
            "description": "Kirim satu request HTTP dan kembalikan status, header, waktu, dan body. Untuk eksplorasi/uji API cepat.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "method": { "type": "string", "description": "GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS (default GET)" },
                    "url": { "type": "string" },
                    "headers": kv_obj,
                    "query": kv_obj,
                    "body": { "type": "string", "description": "isi body (opsional)" },
                    "bodyKind": { "type": "string", "enum": ["json", "text"], "description": "default json" }
                },
                "required": ["url"]
            }
        },
        {
            "name": "assert_request",
            "description": "Kirim satu request lalu evaluasi assertion. Kembalikan lulus/gagal tiap check. Untuk test API deklaratif.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "method": { "type": "string" },
                    "url": { "type": "string" },
                    "headers": kv_obj,
                    "query": kv_obj,
                    "body": { "type": "string" },
                    "bodyKind": { "type": "string", "enum": ["json", "text"] },
                    "assertions": {
                        "type": "array",
                        "description": "daftar assertion",
                        "items": {
                            "type": "object",
                            "properties": {
                                "source": { "type": "string", "description": "status | responseTime | body | jsonpath:$.path | header:Name" },
                                "op": { "type": "string", "description": "equals|notEquals|contains|notContains|exists|notExists|lessThan|greaterThan|matches" },
                                "value": { "type": "string" }
                            },
                            "required": ["source", "op"]
                        }
                    }
                },
                "required": ["url", "assertions"]
            }
        },
        {
            "name": "run_document",
            "description": "Jalankan file dokumen Proxius (.pxs / RunDocument JSON hasil ekspor collection) beserta seluruh assertion-nya. Untuk e2e/regresi.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "file": { "type": "string", "description": "path file .pxs / RunDocument JSON" },
                    "env": kv_obj,
                    "vars": kv_obj
                },
                "required": ["file"]
            }
        },
        {
            "name": "list_documents",
            "description": "Cari file dokumen Proxius (.pxs / RunDocument JSON) di sebuah folder. Kembalikan path, nama, dan ringkasan request tiap dokumen — untuk menemukan collection yang bisa dijalankan run_document.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "dir": { "type": "string", "description": "folder yang dipindai (default: folder kerja saat ini)" },
                    "recursive": { "type": "boolean", "description": "pindai subfolder (default true)" }
                }
            }
        }
    ])
}

// ── Dispatch tools/call ─────────────────────────────────────────────

async fn tools_call(id: Option<Value>, msg: &Value) -> Value {
    let name = msg
        .pointer("/params/name")
        .and_then(|v| v.as_str())
        .unwrap_or("");
    let args = msg
        .pointer("/params/arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));

    let result = match name {
        "http_send" => tool_http_send(&args).await,
        "assert_request" => tool_assert_request(&args).await,
        "run_document" => tool_run_document(&args).await,
        "list_documents" => tool_list_documents(&args),
        other => Err(anyhow::anyhow!("tool tidak dikenal: {other}")),
    };

    match result {
        Ok(text) => ok(
            id,
            json!({ "content": [{ "type": "text", "text": text }], "isError": false }),
        ),
        Err(e) => ok(
            id,
            json!({ "content": [{ "type": "text", "text": format!("error: {e:#}") }], "isError": true }),
        ),
    }
}

// ── Implementasi tools ──────────────────────────────────────────────

async fn tool_http_send(args: &Value) -> Result<String> {
    let req = build_request(args)?;
    let resp = proxius_engine::send(&req).await?;
    let out = json!({
        "status": resp.status,
        "statusText": resp.status_text,
        "timeMs": resp.duration_ms,
        "sizeBytes": resp.size_bytes,
        "headers": resp.headers.iter()
            .map(|h| json!({ "name": h.key, "value": h.value }))
            .collect::<Vec<_>>(),
        "body": truncate(&resp.body),
    });
    Ok(serde_json::to_string_pretty(&out)?)
}

async fn tool_assert_request(args: &Value) -> Result<String> {
    let mut req = build_request(args)?;
    req.assertions = parse_assertions(args.get("assertions"))?;
    let doc = RunDocument {
        name: "assert".into(),
        variables: Vec::new(),
        requests: vec![req],
    };
    let report = proxius_runner::run_document(&doc, &HashMap::new()).await;
    report_json(&report)
}

async fn tool_run_document(args: &Value) -> Result<String> {
    let file = args
        .get("file")
        .and_then(|v| v.as_str())
        .context("argumen `file` wajib")?;
    let text =
        std::fs::read_to_string(file).with_context(|| format!("gagal baca {file}"))?;
    let doc: RunDocument =
        serde_json::from_str(&text).context("file bukan RunDocument JSON yang valid")?;

    let mut base: HashMap<String, String> = HashMap::new();
    merge_vars(&mut base, args.get("env"));
    merge_vars(&mut base, args.get("vars"));

    let report = proxius_runner::run_document(&doc, &base).await;
    report_json(&report)
}

fn tool_list_documents(args: &Value) -> Result<String> {
    let dir = args.get("dir").and_then(|v| v.as_str()).unwrap_or(".");
    let recursive = args
        .get("recursive")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let root = std::path::Path::new(dir);
    if !root.is_dir() {
        anyhow::bail!("bukan folder: {dir}");
    }

    let mut found: Vec<Value> = Vec::new();
    let mut budget = 500usize; // batas jumlah file yang diperiksa
    walk_documents(root, recursive, 0, &mut budget, &mut found);

    let out = json!({
        "dir": dir,
        "count": found.len(),
        "documents": found,
    });
    Ok(serde_json::to_string_pretty(&out)?)
}

/// Telusuri folder mencari file yang parse sebagai RunDocument.
fn walk_documents(
    dir: &std::path::Path,
    recursive: bool,
    depth: usize,
    budget: &mut usize,
    out: &mut Vec<Value>,
) {
    if depth > 8 || *budget == 0 {
        return;
    }
    let entries = match std::fs::read_dir(dir) {
        Ok(e) => e,
        Err(_) => return,
    };
    for entry in entries.flatten() {
        if *budget == 0 {
            return;
        }
        let path = entry.path();
        if path.is_dir() {
            // Lewati folder berat yang umum.
            let name = path.file_name().and_then(|n| n.to_str()).unwrap_or("");
            if matches!(name, "node_modules" | "target" | ".git" | "dist") {
                continue;
            }
            if recursive {
                walk_documents(&path, recursive, depth + 1, budget, out);
            }
            continue;
        }
        let ext = path
            .extension()
            .and_then(|e| e.to_str())
            .unwrap_or("")
            .to_ascii_lowercase();
        if ext != "pxs" && ext != "json" {
            continue;
        }
        *budget -= 1;
        let Ok(text) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(doc) = serde_json::from_str::<RunDocument>(&text) else {
            continue; // JSON lain yang bukan RunDocument diabaikan
        };
        out.push(json!({
            "file": path.to_string_lossy(),
            "name": doc.name,
            "requestCount": doc.requests.len(),
            "requests": doc.requests.iter().map(|r| json!({
                "name": r.name,
                "method": r.method.as_str(),
                "url": r.url,
                "assertions": r.assertions.len(),
            })).collect::<Vec<_>>(),
        }));
    }
}

// ── Util pembangun tipe dari argumen JSON ───────────────────────────

fn build_request(args: &Value) -> Result<HttpRequest> {
    let url = args
        .get("url")
        .and_then(|v| v.as_str())
        .context("argumen `url` wajib")?;
    let mut req = HttpRequest::new("mcp");
    req.method = method_from(args.get("method").and_then(|v| v.as_str()).unwrap_or("GET"));
    req.url = url.to_string();
    req.headers = kv_from(args.get("headers"));
    req.query = kv_from(args.get("query"));
    req.body = match args.get("body").and_then(|v| v.as_str()) {
        Some(b) if !b.is_empty() => {
            let kind = args.get("bodyKind").and_then(|v| v.as_str()).unwrap_or("json");
            if kind == "text" {
                RequestBody::Text { content: b.to_string() }
            } else {
                RequestBody::Json { content: b.to_string() }
            }
        }
        _ => RequestBody::None,
    };
    Ok(req)
}

fn method_from(s: &str) -> HttpMethod {
    match s.to_ascii_uppercase().as_str() {
        "POST" => HttpMethod::Post,
        "PUT" => HttpMethod::Put,
        "PATCH" => HttpMethod::Patch,
        "DELETE" => HttpMethod::Delete,
        "HEAD" => HttpMethod::Head,
        "OPTIONS" => HttpMethod::Options,
        _ => HttpMethod::Get,
    }
}

fn kv_from(obj: Option<&Value>) -> Vec<proxius_core::KeyValue> {
    let mut out = Vec::new();
    if let Some(Value::Object(m)) = obj {
        for (k, v) in m {
            out.push(proxius_core::KeyValue {
                key: k.clone(),
                value: val_str(v),
                enabled: true,
            });
        }
    }
    out
}

fn merge_vars(base: &mut HashMap<String, String>, obj: Option<&Value>) {
    if let Some(Value::Object(m)) = obj {
        for (k, v) in m {
            base.insert(k.clone(), val_str(v));
        }
    }
}

fn val_str(v: &Value) -> String {
    match v {
        Value::String(s) => s.clone(),
        other => other.to_string(),
    }
}

/// "status" | "responseTime" | "body" | "jsonpath:$.x" | "header:Name"
fn parse_source(s: &str) -> AssertionSource {
    if let Some(p) = s.strip_prefix("jsonpath:") {
        AssertionSource::JsonPath { path: p.to_string() }
    } else if let Some(n) = s.strip_prefix("header:") {
        AssertionSource::Header { name: n.to_string() }
    } else if s == "responseTime" {
        AssertionSource::ResponseTime
    } else if s == "body" {
        AssertionSource::Body
    } else {
        AssertionSource::Status
    }
}

fn parse_op(s: &str) -> AssertionOp {
    match s {
        "notEquals" => AssertionOp::NotEquals,
        "contains" => AssertionOp::Contains,
        "notContains" => AssertionOp::NotContains,
        "exists" => AssertionOp::Exists,
        "notExists" => AssertionOp::NotExists,
        "lessThan" => AssertionOp::LessThan,
        "greaterThan" => AssertionOp::GreaterThan,
        "matches" => AssertionOp::Matches,
        _ => AssertionOp::Equals,
    }
}

fn parse_assertions(v: Option<&Value>) -> Result<Vec<Assertion>> {
    let arr = v
        .and_then(|v| v.as_array())
        .context("argumen `assertions` harus array")?;
    let mut out = Vec::new();
    for (i, a) in arr.iter().enumerate() {
        let source = a
            .get("source")
            .and_then(|v| v.as_str())
            .unwrap_or("status");
        let op = a.get("op").and_then(|v| v.as_str()).unwrap_or("equals");
        let value = a.get("value").and_then(|v| v.as_str()).unwrap_or("");
        out.push(Assertion {
            id: format!("a{i}"),
            source: parse_source(source),
            op: parse_op(op),
            value: value.to_string(),
            enabled: true,
        });
    }
    Ok(out)
}

fn report_json(r: &RunReport) -> Result<String> {
    let requests: Vec<Value> = r
        .requests
        .iter()
        .map(|rr| {
            json!({
                "name": rr.name,
                "method": rr.method.as_str(),
                "url": rr.url,
                "status": rr.status,
                "ok": rr.ok,
                "timeMs": rr.duration_ms,
                "error": rr.error,
                "assertions": rr.assertions.iter().map(|a| json!({
                    "passed": a.passed,
                    "check": a.description,
                    "actual": truncate(&a.actual),
                    "message": a.message,
                })).collect::<Vec<_>>(),
            })
        })
        .collect();
    let out = json!({
        "name": r.name,
        "allPassed": r.failed_requests == 0,
        "requestsPassed": format!("{}/{}", r.passed_requests, r.total),
        "assertionsPassed": format!("{}/{}", r.passed_assertions, r.total_assertions),
        "requests": requests,
    });
    Ok(serde_json::to_string_pretty(&out)?)
}

fn truncate(s: &str) -> String {
    if s.len() <= BODY_LIMIT {
        return s.to_string();
    }
    let mut end = BODY_LIMIT;
    while !s.is_char_boundary(end) {
        end -= 1;
    }
    format!("{}… [dipangkas, total {} byte]", &s[..end], s.len())
}
