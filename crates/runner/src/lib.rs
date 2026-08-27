//! Runner headless Proxius: evaluasi assertion, chaining variabel, dan
//! menjalankan `RunDocument`. Dipakai ulang oleh CLI, server (M6), dan
//! command Tauri untuk "jalankan collection".

use std::collections::HashMap;

use proxius_core::{
    evaluate_source_label, resolve_request, Assertion, AssertionOp, AssertionResult,
    AssertionSource, ExtractFrom, HttpRequest, HttpResponse, RequestReport, RunDocument,
    RunReport,
};
use serde_json_path::JsonPath;

pub mod load;
pub mod report;

// ── Ekstraksi nilai dari response ───────────────────────────────────

fn header_value(resp: &HttpResponse, name: &str) -> Option<String> {
    resp.headers
        .iter()
        .find(|h| h.key.eq_ignore_ascii_case(name))
        .map(|h| h.value.clone())
}

fn jsonpath_value(body: &str, path: &str) -> Option<String> {
    let json: serde_json::Value = serde_json::from_str(body).ok()?;
    let p = JsonPath::parse(path).ok()?;
    let node = p.query(&json).all().into_iter().next()?;
    Some(match node {
        serde_json::Value::String(s) => s.clone(),
        other => other.to_string(),
    })
}

fn source_value(src: &AssertionSource, resp: &HttpResponse) -> Option<String> {
    match src {
        AssertionSource::Status => Some(resp.status.to_string()),
        AssertionSource::ResponseTime => Some(resp.duration_ms.to_string()),
        AssertionSource::Header { name } => header_value(resp, name),
        AssertionSource::JsonPath { path } => jsonpath_value(&resp.body, path),
        AssertionSource::Body => Some(resp.body.clone()),
    }
}

// ── Evaluasi assertion ──────────────────────────────────────────────

fn num(s: &str) -> Option<f64> {
    s.trim().parse::<f64>().ok()
}

fn op_label(op: AssertionOp) -> &'static str {
    match op {
        AssertionOp::Equals => "equals",
        AssertionOp::NotEquals => "not equals",
        AssertionOp::Contains => "contains",
        AssertionOp::NotContains => "not contains",
        AssertionOp::Exists => "exists",
        AssertionOp::NotExists => "not exists",
        AssertionOp::LessThan => "<",
        AssertionOp::GreaterThan => ">",
        AssertionOp::Matches => "matches",
        AssertionOp::MatchesSchema => "matches schema",
    }
}

// ── Validasi JSON Schema minimal (subset Draft-07) ──────────────────
// Cermin dari `ui/app/src/lib/schema.ts`. Cukup untuk contract-test QA.

fn json_type(v: &serde_json::Value) -> &'static str {
    match v {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

fn type_matches(v: &serde_json::Value, t: &str) -> bool {
    match t {
        "integer" => v.as_i64().is_some() || v.as_u64().is_some(),
        "number" => v.is_number(),
        other => json_type(v) == other,
    }
}

fn validate_schema(schema: &serde_json::Value, value: &serde_json::Value, path: &str, errs: &mut Vec<String>) {
    let obj = match schema.as_object() {
        Some(o) => o,
        None => return,
    };

    if let Some(all) = obj.get("allOf").and_then(|v| v.as_array()) {
        for sub in all {
            validate_schema(sub, value, path, errs);
        }
    }
    if let Some(any) = obj.get("anyOf").and_then(|v| v.as_array()) {
        let ok = any.iter().any(|sub| {
            let mut e = Vec::new();
            validate_schema(sub, value, path, &mut e);
            e.is_empty()
        });
        if !ok {
            errs.push(format!("{path}: tidak memenuhi anyOf"));
        }
    }
    if let Some(one) = obj.get("oneOf").and_then(|v| v.as_array()) {
        let matches = one
            .iter()
            .filter(|sub| {
                let mut e = Vec::new();
                validate_schema(sub, value, path, &mut e);
                e.is_empty()
            })
            .count();
        if matches != 1 {
            errs.push(format!("{path}: harus memenuhi tepat satu oneOf (cocok {matches})"));
        }
    }

    if let Some(t) = obj.get("type") {
        let types: Vec<String> = match t {
            serde_json::Value::String(s) => vec![s.clone()],
            serde_json::Value::Array(a) => a.iter().filter_map(|x| x.as_str().map(String::from)).collect(),
            _ => vec![],
        };
        if !types.is_empty() && !types.iter().any(|ty| type_matches(value, ty)) {
            errs.push(format!(
                "{path}: bertipe {}, diharapkan {}",
                json_type(value),
                types.join("|")
            ));
            return;
        }
    }

    if let Some(en) = obj.get("enum").and_then(|v| v.as_array()) {
        if !en.iter().any(|e| e == value) {
            errs.push(format!("{path}: bukan salah satu enum"));
        }
    }
    if let Some(c) = obj.get("const") {
        if c != value {
            errs.push(format!("{path}: harus sama dengan const"));
        }
    }

    if let Some(n) = value.as_f64() {
        if let Some(min) = obj.get("minimum").and_then(|v| v.as_f64()) {
            if n < min {
                errs.push(format!("{path}: {n} < minimum {min}"));
            }
        }
        if let Some(max) = obj.get("maximum").and_then(|v| v.as_f64()) {
            if n > max {
                errs.push(format!("{path}: {n} > maximum {max}"));
            }
        }
    }

    if let Some(s) = value.as_str() {
        if let Some(ml) = obj.get("minLength").and_then(|v| v.as_u64()) {
            if (s.chars().count() as u64) < ml {
                errs.push(format!("{path}: panjang < {ml}"));
            }
        }
        if let Some(ml) = obj.get("maxLength").and_then(|v| v.as_u64()) {
            if (s.chars().count() as u64) > ml {
                errs.push(format!("{path}: panjang > {ml}"));
            }
        }
        if let Some(pat) = obj.get("pattern").and_then(|v| v.as_str()) {
            match regex::Regex::new(pat) {
                Ok(re) if !re.is_match(s) => errs.push(format!("{path}: tidak cocok pattern")),
                _ => {}
            }
        }
    }

    if let Some(arr) = value.as_array() {
        if let Some(mi) = obj.get("minItems").and_then(|v| v.as_u64()) {
            if (arr.len() as u64) < mi {
                errs.push(format!("{path}: item < {mi}"));
            }
        }
        if let Some(mi) = obj.get("maxItems").and_then(|v| v.as_u64()) {
            if (arr.len() as u64) > mi {
                errs.push(format!("{path}: item > {mi}"));
            }
        }
        if let Some(items) = obj.get("items") {
            for (i, v) in arr.iter().enumerate() {
                validate_schema(items, v, &format!("{path}[{i}]"), errs);
            }
        }
    }

    if let Some(map) = value.as_object() {
        if let Some(req) = obj.get("required").and_then(|v| v.as_array()) {
            for key in req.iter().filter_map(|k| k.as_str()) {
                if !map.contains_key(key) {
                    errs.push(format!("{path}.{key}: field wajib tidak ada"));
                }
            }
        }
        if let Some(props) = obj.get("properties").and_then(|v| v.as_object()) {
            for (key, sub) in props {
                if let Some(v) = map.get(key) {
                    validate_schema(sub, v, &format!("{path}.{key}"), errs);
                }
            }
            if obj.get("additionalProperties") == Some(&serde_json::Value::Bool(false)) {
                for key in map.keys() {
                    if !props.contains_key(key) {
                        errs.push(format!("{path}.{key}: properti tak diizinkan"));
                    }
                }
            }
        }
    }
}

/// Validasi teks JSON `actual` terhadap teks JSON Schema `schema_text`.
fn matches_schema(schema_text: &str, actual: &str) -> (bool, String) {
    let schema: serde_json::Value = match serde_json::from_str(schema_text) {
        Ok(v) => v,
        Err(_) => return (false, "schema bukan JSON valid".into()),
    };
    let value: serde_json::Value = match serde_json::from_str(actual) {
        Ok(v) => v,
        Err(_) => return (false, "body bukan JSON valid".into()),
    };
    let mut errs = Vec::new();
    validate_schema(&schema, &value, "$", &mut errs);
    if errs.is_empty() {
        (true, String::new())
    } else {
        let extra = if errs.len() > 3 {
            format!(" (+{})", errs.len() - 3)
        } else {
            String::new()
        };
        (false, format!("{}{}", errs.iter().take(3).cloned().collect::<Vec<_>>().join("; "), extra))
    }
}

fn compare(op: AssertionOp, actual: &str, expected: &str) -> (bool, String) {
    let fail = |msg: String| (false, msg);
    match op {
        AssertionOp::Equals => {
            let eq = match (num(actual), num(expected)) {
                (Some(a), Some(b)) => a == b,
                _ => actual.trim() == expected.trim(),
            };
            if eq {
                (true, String::new())
            } else {
                fail(format!("diharapkan `{expected}`, dapat `{actual}`"))
            }
        }
        AssertionOp::NotEquals => {
            let eq = actual.trim() == expected.trim();
            if !eq {
                (true, String::new())
            } else {
                fail(format!("tidak boleh sama dengan `{expected}`"))
            }
        }
        AssertionOp::Contains => {
            if actual.contains(expected) {
                (true, String::new())
            } else {
                fail(format!("`{actual}` tidak memuat `{expected}`"))
            }
        }
        AssertionOp::NotContains => {
            if !actual.contains(expected) {
                (true, String::new())
            } else {
                fail(format!("`{actual}` seharusnya tidak memuat `{expected}`"))
            }
        }
        AssertionOp::LessThan | AssertionOp::GreaterThan => {
            match (num(actual), num(expected)) {
                (Some(a), Some(b)) => {
                    let ok = if op == AssertionOp::LessThan { a < b } else { a > b };
                    if ok {
                        (true, String::new())
                    } else {
                        fail(format!("{a} {} {b} bernilai salah", op_label(op)))
                    }
                }
                _ => fail("perbandingan numerik butuh angka".into()),
            }
        }
        AssertionOp::Matches => match regex::Regex::new(expected) {
            Ok(re) => {
                if re.is_match(actual) {
                    (true, String::new())
                } else {
                    fail(format!("`{actual}` tidak cocok /{expected}/"))
                }
            }
            Err(e) => fail(format!("regex tidak valid: {e}")),
        },
        AssertionOp::MatchesSchema => matches_schema(expected, actual),
        AssertionOp::Exists | AssertionOp::NotExists => (true, String::new()), // ditangani di eval_one
    }
}

fn eval_one(a: &Assertion, resp: &HttpResponse) -> AssertionResult {
    let actual_opt = source_value(&a.source, resp);
    let description = if a.op == AssertionOp::MatchesSchema {
        format!("{} matches JSON Schema", evaluate_source_label(&a.source))
    } else {
        format!(
            "{} {} {}",
            evaluate_source_label(&a.source),
            op_label(a.op),
            a.value
        )
    };

    let (passed, message) = match a.op {
        AssertionOp::Exists => (
            actual_opt.is_some(),
            if actual_opt.is_some() {
                String::new()
            } else {
                "nilai tidak ditemukan".into()
            },
        ),
        AssertionOp::NotExists => (
            actual_opt.is_none(),
            if actual_opt.is_none() {
                String::new()
            } else {
                "nilai seharusnya tidak ada".into()
            },
        ),
        _ => match &actual_opt {
            None => (false, "nilai tidak ditemukan".into()),
            Some(actual) => compare(a.op, actual, &a.value),
        },
    };

    AssertionResult {
        id: a.id.clone(),
        passed,
        description,
        actual: actual_opt.unwrap_or_default(),
        message,
    }
}

/// Evaluasi semua assertion (yang aktif) sebuah request terhadap response.
pub fn evaluate(request: &HttpRequest, resp: &HttpResponse) -> Vec<AssertionResult> {
    request
        .assertions
        .iter()
        .filter(|a| a.enabled)
        .map(|a| eval_one(a, resp))
        .collect()
}

/// Terapkan aturan extract ke map variabel (chaining).
pub fn apply_extracts(
    request: &HttpRequest,
    resp: &HttpResponse,
    vars: &mut HashMap<String, String>,
) {
    for e in request.extracts.iter().filter(|e| e.enabled && !e.var.is_empty()) {
        let val = match &e.from {
            ExtractFrom::JsonPath { path } => jsonpath_value(&resp.body, path),
            ExtractFrom::Header { name } => header_value(resp, name),
            ExtractFrom::Status => Some(resp.status.to_string()),
            ExtractFrom::Body => Some(resp.body.clone()),
        };
        if let Some(v) = val {
            vars.insert(e.var.clone(), v);
        }
    }
}

// ── Menjalankan RunDocument ─────────────────────────────────────────

fn interp_assertions(req: &HttpRequest, vars: &HashMap<String, String>) -> HttpRequest {
    let mut r = resolve_request(req, vars);
    r.assertions = req
        .assertions
        .iter()
        .map(|a| Assertion {
            value: proxius_core::interpolate(&a.value, vars),
            ..a.clone()
        })
        .collect();
    r
}

/// Jalankan seluruh request dalam dokumen secara berurutan, merangkai
/// variabel via extract. `base` (mis. dari environment) menimpa variabel dokumen.
pub async fn run_document(doc: &RunDocument, base: &HashMap<String, String>) -> RunReport {
    let mut vars: HashMap<String, String> = HashMap::new();
    for kv in &doc.variables {
        if kv.enabled && !kv.key.is_empty() {
            vars.insert(kv.key.clone(), kv.value.clone());
        }
    }
    for (k, v) in base {
        vars.insert(k.clone(), v.clone());
    }

    let mut reports: Vec<RequestReport> = Vec::new();
    for req in &doc.requests {
        let resolved = interp_assertions(req, &vars);
        match proxius_engine::send(&resolved).await {
            Ok(resp) => {
                let results = evaluate(&resolved, &resp);
                apply_extracts(&resolved, &resp, &mut vars);
                let ok = results.iter().all(|r| r.passed);
                reports.push(RequestReport {
                    name: req.name.clone(),
                    method: req.method,
                    url: resolved.url.clone(),
                    status: resp.status,
                    duration_ms: resp.duration_ms,
                    ok,
                    error: None,
                    assertions: results,
                });
            }
            Err(e) => reports.push(RequestReport {
                name: req.name.clone(),
                method: req.method,
                url: resolved.url,
                status: 0,
                duration_ms: 0,
                ok: false,
                error: Some(format!("{e:#}")),
                assertions: Vec::new(),
            }),
        }
    }

    aggregate(&doc.name, reports)
}

fn aggregate(name: &str, reports: Vec<RequestReport>) -> RunReport {
    let total = reports.len();
    let passed_requests = reports.iter().filter(|r| r.ok).count();
    let total_assertions: usize = reports.iter().map(|r| r.assertions.len()).sum();
    let passed_assertions: usize = reports
        .iter()
        .flat_map(|r| &r.assertions)
        .filter(|a| a.passed)
        .count();
    RunReport {
        name: name.to_string(),
        total,
        passed_requests,
        failed_requests: total - passed_requests,
        total_assertions,
        passed_assertions,
        requests: reports,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use proxius_core::{AssertionSource, Extract, KeyValue};

    fn resp(status: u16, body: &str) -> HttpResponse {
        HttpResponse {
            status,
            status_text: "OK".into(),
            headers: vec![KeyValue {
                key: "Content-Type".into(),
                value: "application/json".into(),
                enabled: true,
            }],
            body: body.into(),
            body_base64: None,
            duration_ms: 42,
            ttfb_ms: 20,
            size_bytes: body.len() as u64,
        }
    }

    fn assertion(source: AssertionSource, op: AssertionOp, value: &str) -> Assertion {
        Assertion {
            id: "a".into(),
            source,
            op,
            value: value.into(),
            enabled: true,
        }
    }

    #[test]
    fn status_equals() {
        let mut req = HttpRequest::new("t");
        req.assertions = vec![assertion(AssertionSource::Status, AssertionOp::Equals, "200")];
        let r = evaluate(&req, &resp(200, "{}"));
        assert!(r[0].passed);
    }

    #[test]
    fn jsonpath_and_extract() {
        let mut req = HttpRequest::new("t");
        req.assertions = vec![assertion(
            AssertionSource::JsonPath {
                path: "$.token".into(),
            },
            AssertionOp::Exists,
            "",
        )];
        req.extracts = vec![Extract {
            id: "e".into(),
            var: "tok".into(),
            from: ExtractFrom::JsonPath {
                path: "$.token".into(),
            },
            enabled: true,
        }];
        let response = resp(200, r#"{"token":"abc123"}"#);
        let r = evaluate(&req, &response);
        assert!(r[0].passed);
        let mut vars = HashMap::new();
        apply_extracts(&req, &response, &mut vars);
        assert_eq!(vars.get("tok").map(String::as_str), Some("abc123"));
    }

    #[test]
    fn response_time_less_than() {
        let mut req = HttpRequest::new("t");
        req.assertions = vec![assertion(
            AssertionSource::ResponseTime,
            AssertionOp::LessThan,
            "500",
        )];
        assert!(evaluate(&req, &resp(200, "{}"))[0].passed);
    }

    #[test]
    fn body_matches_schema() {
        let schema = r#"{"type":"object","required":["id","name"],
            "properties":{"id":{"type":"integer"},"name":{"type":"string"}}}"#;
        let mut req = HttpRequest::new("t");
        req.assertions = vec![assertion(AssertionSource::Body, AssertionOp::MatchesSchema, schema)];
        // Cocok
        assert!(evaluate(&req, &resp(200, r#"{"id":1,"name":"x"}"#))[0].passed);
        // Field wajib hilang
        assert!(!evaluate(&req, &resp(200, r#"{"id":1}"#))[0].passed);
        // Tipe salah
        assert!(!evaluate(&req, &resp(200, r#"{"id":"nope","name":"x"}"#))[0].passed);
    }

    #[test]
    fn schema_invalid_body_or_schema() {
        let (ok, msg) = matches_schema("{bad", "{}");
        assert!(!ok && msg.contains("schema"));
        let (ok2, msg2) = matches_schema("{}", "notjson");
        assert!(!ok2 && msg2.contains("body"));
    }
}
