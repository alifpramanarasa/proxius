//! Proxius domain model (inti).
//!
//! Tipe di sini adalah sumber kebenaran untuk request/response HTTP dan
//! di-*derive* ke TypeScript lewat `ts-rs` (lihat `cargo test -p proxius-core`
//! → menulis file ke `bindings/`). Untuk M0, UI juga punya salinan tipe manual
//! di `ui/app/src/lib/types.ts`; keduanya harus tetap sinkron sampai pipeline
//! ts-rs jadi bagian build.

use serde::{Deserialize, Serialize};
use ts_rs::TS;
use uuid::Uuid;

/// Metode HTTP yang didukung.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "UPPERCASE")]
#[ts(export, export_to = "../../../bindings/")]
pub enum HttpMethod {
    Get,
    Post,
    Put,
    Patch,
    Delete,
    Head,
    Options,
}

impl Default for HttpMethod {
    fn default() -> Self {
        HttpMethod::Get
    }
}

impl HttpMethod {
    pub fn as_str(&self) -> &'static str {
        match self {
            HttpMethod::Get => "GET",
            HttpMethod::Post => "POST",
            HttpMethod::Put => "PUT",
            HttpMethod::Patch => "PATCH",
            HttpMethod::Delete => "DELETE",
            HttpMethod::Head => "HEAD",
            HttpMethod::Options => "OPTIONS",
        }
    }
}

/// Pasangan key-value yang bisa di-toggle (header, query param).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct KeyValue {
    pub key: String,
    pub value: String,
    pub enabled: bool,
}

/// Satu field pada body multipart/form-data.
/// `field_type` "text" → nilai teks; "file" → `value` berisi path file.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct FormField {
    pub id: String,
    pub key: String,
    pub value: String,
    #[serde(rename = "type")]
    pub field_type: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub filename: Option<String>,
    pub enabled: bool,
}

/// Body request. Ditag `kind` agar mudah dipetakan ke union TypeScript.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "lowercase")]
#[ts(export, export_to = "../../../bindings/")]
pub enum RequestBody {
    None,
    Text { content: String },
    Json { content: String },
    UrlEncoded { items: Vec<KeyValue> },
    Form { items: Vec<FormField> },
}

impl Default for RequestBody {
    fn default() -> Self {
        RequestBody::None
    }
}

/// Satu request HTTP yang siap dieksekusi engine.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct HttpRequest {
    pub id: String,
    pub name: String,
    pub method: HttpMethod,
    pub url: String,
    pub headers: Vec<KeyValue>,
    pub query: Vec<KeyValue>,
    pub body: RequestBody,
    /// Assertion (test) yang menempel pada request.
    #[serde(default)]
    pub assertions: Vec<Assertion>,
    /// Aturan ekstraksi variabel dari response (untuk chaining).
    #[serde(default)]
    pub extracts: Vec<Extract>,
}

impl HttpRequest {
    /// Request kosong baru dengan id UUID v7.
    pub fn new(name: impl Into<String>) -> Self {
        Self {
            id: Uuid::now_v7().to_string(),
            name: name.into(),
            method: HttpMethod::Get,
            url: String::new(),
            headers: Vec::new(),
            query: Vec::new(),
            body: RequestBody::None,
            assertions: Vec::new(),
            extracts: Vec::new(),
        }
    }
}

/// Hasil eksekusi sebuah request.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct HttpResponse {
    pub status: u16,
    pub status_text: String,
    pub headers: Vec<KeyValue>,
    pub body: String,
    /// Body mentah base64 untuk konten biner (gambar/PDF/dll). None untuk teks.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub body_base64: Option<String>,
    /// Total durasi request (ms).
    pub duration_ms: u64,
    /// Time-to-first-byte (ms): start → header response tiba. Sisanya = download.
    #[serde(default)]
    pub ttfb_ms: u64,
    /// Ukuran body response (byte).
    pub size_bytes: u64,
}

// ── Testing: assertion, extract, report ─────────────────────────────

/// Sumber nilai yang diperiksa assertion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub enum AssertionSource {
    /// Kode status HTTP.
    Status,
    /// Durasi response (ms).
    ResponseTime,
    /// Nilai header tertentu.
    Header { name: String },
    /// Hasil query JSONPath pada body JSON.
    JsonPath { path: String },
    /// Seluruh body (teks).
    Body,
}

/// Operator perbandingan assertion.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub enum AssertionOp {
    Equals,
    NotEquals,
    Contains,
    NotContains,
    Exists,
    NotExists,
    LessThan,
    GreaterThan,
    Matches,
    MatchesSchema,
}

/// Satu assertion deklaratif.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct Assertion {
    pub id: String,
    pub source: AssertionSource,
    pub op: AssertionOp,
    /// Nilai yang diharapkan (teks; ops numerik akan mem-parse).
    pub value: String,
    pub enabled: bool,
}

/// Hasil evaluasi satu assertion.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct AssertionResult {
    pub id: String,
    pub passed: bool,
    /// Deskripsi human-readable, mis. "status equals 200".
    pub description: String,
    pub actual: String,
    /// Alasan gagal (kosong bila lulus).
    pub message: String,
}

/// Sumber nilai untuk ekstraksi variabel (chaining).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub enum ExtractFrom {
    JsonPath { path: String },
    Header { name: String },
    Status,
    Body,
}

/// Aturan: setel variabel `var` dari response.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct Extract {
    pub id: String,
    pub var: String,
    pub from: ExtractFrom,
    pub enabled: bool,
}

/// Dokumen yang bisa dijalankan headless (ekspor collection).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct RunDocument {
    pub name: String,
    #[serde(default)]
    pub variables: Vec<KeyValue>,
    pub requests: Vec<HttpRequest>,
}

/// Laporan hasil menjalankan satu request + assertion-nya.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct RequestReport {
    pub name: String,
    pub method: HttpMethod,
    pub url: String,
    pub status: u16,
    pub duration_ms: u64,
    /// True bila request terkirim dan semua assertion lulus.
    pub ok: bool,
    pub error: Option<String>,
    pub assertions: Vec<AssertionResult>,
}

/// Laporan agregat satu run.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, TS)]
#[serde(rename_all = "camelCase")]
#[ts(export, export_to = "../../../bindings/")]
pub struct RunReport {
    pub name: String,
    pub total: usize,
    pub passed_requests: usize,
    pub failed_requests: usize,
    pub total_assertions: usize,
    pub passed_assertions: usize,
    pub requests: Vec<RequestReport>,
}

/// Label human-readable untuk sumber assertion (dipakai deskripsi hasil).
pub fn evaluate_source_label(src: &AssertionSource) -> String {
    match src {
        AssertionSource::Status => "status".into(),
        AssertionSource::ResponseTime => "responseTime".into(),
        AssertionSource::Header { name } => format!("header[{name}]"),
        AssertionSource::JsonPath { path } => format!("jsonpath({path})"),
        AssertionSource::Body => "body".into(),
    }
}

// ── Interpolasi variabel {{var}} ────────────────────────────────────

/// Ganti semua `{{key}}` pada string dengan nilai dari map (UTF-8 aman).
pub fn interpolate(input: &str, vars: &std::collections::HashMap<String, String>) -> String {
    let mut out = String::with_capacity(input.len());
    let mut rest = input;
    while let Some(start) = rest.find("{{") {
        out.push_str(&rest[..start]);
        let after = &rest[start + 2..];
        if let Some(end) = after.find("}}") {
            let key = after[..end].trim();
            match vars.get(key) {
                Some(v) => out.push_str(v),
                None => {
                    out.push_str("{{");
                    out.push_str(&after[..end]);
                    out.push_str("}}");
                }
            }
            rest = &after[end + 2..];
        } else {
            out.push_str("{{");
            rest = after;
        }
    }
    out.push_str(rest);
    out
}

fn interp_kv(rows: &[KeyValue], vars: &std::collections::HashMap<String, String>) -> Vec<KeyValue> {
    rows.iter()
        .map(|r| KeyValue {
            key: interpolate(&r.key, vars),
            value: interpolate(&r.value, vars),
            enabled: r.enabled,
        })
        .collect()
}

/// Terapkan variabel ke seluruh request.
pub fn resolve_request(
    req: &HttpRequest,
    vars: &std::collections::HashMap<String, String>,
) -> HttpRequest {
    HttpRequest {
        url: interpolate(&req.url, vars),
        headers: interp_kv(&req.headers, vars),
        query: interp_kv(&req.query, vars),
        body: match &req.body {
            RequestBody::None => RequestBody::None,
            RequestBody::Text { content } => RequestBody::Text {
                content: interpolate(content, vars),
            },
            RequestBody::Json { content } => RequestBody::Json {
                content: interpolate(content, vars),
            },
            RequestBody::UrlEncoded { items } => RequestBody::UrlEncoded {
                items: interp_kv(items, vars),
            },
            RequestBody::Form { items } => RequestBody::Form {
                items: items
                    .iter()
                    .map(|f| FormField {
                        key: interpolate(&f.key, vars),
                        value: if f.field_type == "file" {
                            f.value.clone()
                        } else {
                            interpolate(&f.value, vars)
                        },
                        ..f.clone()
                    })
                    .collect(),
            },
        },
        ..req.clone()
    }
}
