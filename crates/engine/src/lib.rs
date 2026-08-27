//! HTTP engine Proxius.
//!
//! Crate ini adalah *native HTTP engine* yang dipakai ulang di desktop (via
//! Tauri command), server (scheduler/e2e), dan CLI. Untuk M0 hanya `send`
//! satu-shot; streaming, mTLS, cookie jar, proxy, dan timing granular menyusul.

use std::sync::Arc;
use std::time::{Duration, Instant};

use anyhow::{anyhow, Context, Result};
use proxius_core::{HttpMethod, HttpRequest, HttpResponse, KeyValue, RequestBody};
use reqwest::redirect::Policy;
use reqwest::Method;
use serde::{Deserialize, Serialize};

/// Hasil probe koneksi: waktu resolusi DNS & TCP connect ke host target.
/// (TLS handshake tercakup dalam TTFB response biasa.)
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConnTiming {
    pub dns_ms: u64,
    pub connect_ms: u64,
    pub address: String,
}

/// Ukur fase koneksi (DNS + TCP connect) ke host sebuah URL. Koneksi baru.
pub async fn probe(url: &str) -> Result<ConnTiming> {
    let u = reqwest::Url::parse(url.trim()).context("URL tidak valid")?;
    let host = u
        .host_str()
        .ok_or_else(|| anyhow!("URL tanpa host"))?
        .to_string();
    let port = u.port_or_known_default().unwrap_or(80);

    let t0 = Instant::now();
    let addr = tokio::net::lookup_host((host.as_str(), port))
        .await
        .context("resolusi DNS gagal")?
        .next()
        .ok_or_else(|| anyhow!("host tak ditemukan"))?;
    let dns_ms = t0.elapsed().as_millis() as u64;

    let t1 = Instant::now();
    let _tcp = tokio::net::TcpStream::connect(addr)
        .await
        .context("TCP connect gagal")?;
    let connect_ms = t1.elapsed().as_millis() as u64;

    Ok(ConnTiming {
        dns_ms,
        connect_ms,
        address: addr.to_string(),
    })
}

/// Cookie jar bersama (opsional) untuk mempertahankan cookie antar-request.
/// Dipakai desktop (single-user); server/CLI biarkan `None` agar tak bocor.
pub use reqwest::cookie::Jar;

/// Buat cookie jar kosong yang bisa dibagikan (Arc).
pub fn new_jar() -> Arc<Jar> {
    Arc::new(Jar::default())
}

/// Timeout default.
const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Opsi per-request (dari tab Settings di UI).
#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SendOptions {
    pub timeout_ms: Option<u64>,
    pub follow_redirects: Option<bool>,
    pub verify_ssl: Option<bool>,
    /// URL proxy (http/https/socks5). Kosong/None = tanpa proxy.
    pub proxy_url: Option<String>,
    /// mTLS: path file sertifikat & kunci client (PEM).
    pub client_cert_path: Option<String>,
    pub client_key_path: Option<String>,
}

/// Kirim satu request dengan opsi default.
pub async fn send(req: &HttpRequest) -> Result<HttpResponse> {
    send_inner(req, &SendOptions::default(), None).await
}

/// Kirim satu request dengan opsi (timeout, redirect, verifikasi SSL).
pub async fn send_with(req: &HttpRequest, opts: &SendOptions) -> Result<HttpResponse> {
    send_inner(req, opts, None).await
}

/// Kirim satu request memakai cookie jar bersama (cookie dipertahankan antar-request).
pub async fn send_with_jar(
    req: &HttpRequest,
    opts: &SendOptions,
    jar: Arc<Jar>,
) -> Result<HttpResponse> {
    send_inner(req, opts, Some(jar)).await
}

async fn send_inner(
    req: &HttpRequest,
    opts: &SendOptions,
    jar: Option<Arc<Jar>>,
) -> Result<HttpResponse> {
    let timeout = opts
        .timeout_ms
        .filter(|&ms| ms > 0)
        .map(Duration::from_millis)
        .unwrap_or(REQUEST_TIMEOUT);
    let redirect = if opts.follow_redirects == Some(false) {
        Policy::none()
    } else {
        Policy::limited(10)
    };
    let mut client_builder = reqwest::Client::builder()
        .user_agent(concat!("Proxius/", env!("CARGO_PKG_VERSION")))
        .connect_timeout(CONNECT_TIMEOUT)
        .timeout(timeout)
        .redirect(redirect)
        .danger_accept_invalid_certs(opts.verify_ssl == Some(false));
    if let Some(j) = jar {
        client_builder = client_builder.cookie_provider(j);
    }
    if let Some(url) = opts.proxy_url.as_deref().filter(|u| !u.trim().is_empty()) {
        let proxy = reqwest::Proxy::all(url.trim()).context("URL proxy tidak valid")?;
        client_builder = client_builder.proxy(proxy);
    }
    // mTLS: sertifikat client (PEM cert + PEM key).
    if let (Some(cert), Some(key)) = (
        opts.client_cert_path.as_deref().filter(|p| !p.trim().is_empty()),
        opts.client_key_path.as_deref().filter(|p| !p.trim().is_empty()),
    ) {
        // rustls: satu buffer PEM berisi sertifikat lalu kunci.
        let mut pem = tokio::fs::read(cert.trim())
            .await
            .context("gagal baca sertifikat client")?;
        pem.push(b'\n');
        pem.extend_from_slice(
            &tokio::fs::read(key.trim())
                .await
                .context("gagal baca kunci client")?,
        );
        let identity =
            reqwest::Identity::from_pem(&pem).context("sertifikat/kunci client tidak valid")?;
        client_builder = client_builder.identity(identity);
    }
    let client = client_builder
        .build()
        .context("gagal membuat HTTP client")?;

    // URL + query param yang aktif.
    let mut url = reqwest::Url::parse(req.url.trim())
        .with_context(|| format!("URL tidak valid: {}", req.url))?;
    {
        let mut qp = url.query_pairs_mut();
        for kv in req.query.iter().filter(|q| q.enabled && !q.key.is_empty()) {
            qp.append_pair(&kv.key, &kv.value);
        }
    }

    let method = to_reqwest_method(req.method);
    let mut builder = client.request(method, url);

    // Header yang aktif.
    let has_content_type = req
        .headers
        .iter()
        .any(|h| h.enabled && h.key.eq_ignore_ascii_case("content-type"));
    for kv in req.headers.iter().filter(|h| h.enabled && !h.key.is_empty()) {
        builder = builder.header(&kv.key, &kv.value);
    }

    // Body.
    builder = match &req.body {
        RequestBody::None => builder,
        RequestBody::Text { content } => builder.body(content.clone()),
        // Set Content-Type hanya bila request belum punya (hindari header ganda
        // yang bisa bikin sebagian server — mis. OpenAI — gagal mem-parse body).
        RequestBody::Json { content } => {
            let b = builder.body(content.clone());
            if has_content_type {
                b
            } else {
                b.header(reqwest::header::CONTENT_TYPE, "application/json")
            }
        }
        RequestBody::UrlEncoded { items } => {
            let pairs: Vec<(&str, &str)> = items
                .iter()
                .filter(|i| i.enabled && !i.key.is_empty())
                .map(|i| (i.key.as_str(), i.value.as_str()))
                .collect();
            builder.form(&pairs)
        }
        RequestBody::Form { items } => {
            let mut form = reqwest::multipart::Form::new();
            for f in items.iter().filter(|f| f.enabled && !f.key.is_empty()) {
                if f.field_type == "file" {
                    let bytes = tokio::fs::read(&f.value)
                        .await
                        .with_context(|| format!("gagal membaca file: {}", f.value))?;
                    let fname = f.filename.clone().unwrap_or_else(|| {
                        std::path::Path::new(&f.value)
                            .file_name()
                            .and_then(|s| s.to_str())
                            .unwrap_or("file")
                            .to_string()
                    });
                    let part = reqwest::multipart::Part::bytes(bytes).file_name(fname);
                    form = form.part(f.key.clone(), part);
                } else {
                    form = form.text(f.key.clone(), f.value.clone());
                }
            }
            builder.multipart(form)
        }
    };

    let started = Instant::now();
    let resp = builder.send().await.context("request gagal dikirim")?;
    let ttfb_ms = started.elapsed().as_millis() as u64;

    let status = resp.status();
    let headers: Vec<KeyValue> = resp
        .headers()
        .iter()
        .map(|(name, value)| KeyValue {
            key: name.to_string(),
            value: value.to_str().unwrap_or("<binary>").to_string(),
            enabled: true,
        })
        .collect();

    let content_type = headers
        .iter()
        .find(|h| h.key.eq_ignore_ascii_case("content-type"))
        .map(|h| h.value.to_lowercase())
        .unwrap_or_default();

    let bytes = resp.bytes().await.context("gagal membaca body response")?;
    let duration_ms = started.elapsed().as_millis() as u64;
    let size_bytes = bytes.len() as u64;

    // Konten biner (gambar/PDF/dll) → base64 agar UI bisa preview; teks → utf8.
    let (body, body_base64) = if is_binary_content_type(&content_type) {
        (String::new(), Some(base64_encode(&bytes)))
    } else {
        (String::from_utf8_lossy(&bytes).into_owned(), None)
    };

    Ok(HttpResponse {
        status: status.as_u16(),
        status_text: status
            .canonical_reason()
            .unwrap_or("")
            .to_string(),
        headers,
        body,
        body_base64,
        duration_ms,
        ttfb_ms,
        size_bytes,
    })
}

/// Apakah content-type merupakan konten biner (bukan teks)?
fn is_binary_content_type(ct: &str) -> bool {
    if ct.is_empty() {
        return false;
    }
    if ct.starts_with("text/")
        || ct.contains("json")
        || ct.contains("xml")
        || ct.contains("javascript")
        || ct.contains("x-www-form-urlencoded")
        || ct.contains("csv")
        || ct.contains("html")
    {
        return false;
    }
    ct.starts_with("image/")
        || ct.starts_with("audio/")
        || ct.starts_with("video/")
        || ct.starts_with("font/")
        || ct.contains("pdf")
        || ct.contains("octet-stream")
        || ct.contains("zip")
        || ct.contains("protobuf")
}

/// Encoder base64 standar (tanpa dependensi).
fn base64_encode(data: &[u8]) -> String {
    const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    let mut out = String::with_capacity((data.len() + 2) / 3 * 4);
    for chunk in data.chunks(3) {
        let b = [
            chunk[0],
            *chunk.get(1).unwrap_or(&0),
            *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | (b[2] as u32);
        out.push(T[((n >> 18) & 63) as usize] as char);
        out.push(T[((n >> 12) & 63) as usize] as char);
        out.push(if chunk.len() > 1 {
            T[((n >> 6) & 63) as usize] as char
        } else {
            '='
        });
        out.push(if chunk.len() > 2 {
            T[(n & 63) as usize] as char
        } else {
            '='
        });
    }
    out
}

fn to_reqwest_method(m: HttpMethod) -> Method {
    match m {
        HttpMethod::Get => Method::GET,
        HttpMethod::Post => Method::POST,
        HttpMethod::Put => Method::PUT,
        HttpMethod::Patch => Method::PATCH,
        HttpMethod::Delete => Method::DELETE,
        HttpMethod::Head => Method::HEAD,
        HttpMethod::Options => Method::OPTIONS,
    }
}
