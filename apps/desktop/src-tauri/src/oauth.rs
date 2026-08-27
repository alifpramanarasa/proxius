//! OAuth 2.1 (Authorization Code + PKCE + Dynamic Client Registration) untuk
//! menyambung ke server MCP ber-OAuth seperti **Atlassian Remote MCP**.
//!
//! Alur (RFC 6749/7636/8707 + MCP auth spec):
//! 1. Temukan metadata: protected-resource → authorization server.
//! 2. Dynamic Client Registration → dapat `client_id`.
//! 3. PKCE + buka browser ke authorize endpoint; loopback 127.0.0.1 menangkap `code`.
//! 4. Tukar `code` → access/refresh token.
//!
//! Semua HTTP lewat `proxius_engine::send` (reqwest) — tak menambah dependency
//! jaringan baru. Logika inti (`run_oauth`) menerima closure `open` agar bisa
//! diuji headless tanpa browser sungguhan.

use anyhow::{anyhow, Context, Result};
use base64::Engine as _;
use proxius_core::{HttpMethod, HttpRequest, KeyValue, RequestBody};
use serde::Serialize;
use serde_json::Value;
use sha2::{Digest, Sha256};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};

/// Token hasil login, dikembalikan ke UI (camelCase untuk JS).
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TokenSet {
    pub access_token: String,
    pub refresh_token: Option<String>,
    pub expires_in: Option<u64>,
    pub scope: Option<String>,
    /// Disimpan agar UI bisa refresh nanti.
    pub token_endpoint: String,
    pub client_id: String,
}

struct AuthMeta {
    authorize: String,
    token: String,
    register: Option<String>,
    scopes: Option<String>,
}

const B64: base64::engine::general_purpose::GeneralPurpose =
    base64::engine::general_purpose::URL_SAFE_NO_PAD;

fn b64url(bytes: &[u8]) -> String {
    B64.encode(bytes)
}

fn random_b64(len: usize) -> Result<String> {
    let mut buf = vec![0u8; len];
    getrandom::getrandom(&mut buf).map_err(|e| anyhow!("gagal RNG: {e}"))?;
    Ok(b64url(&buf))
}

fn pkce_challenge(verifier: &str) -> String {
    let mut h = Sha256::new();
    h.update(verifier.as_bytes());
    b64url(&h.finalize())
}

// ── HTTP helper (via engine) ────────────────────────────────────────

fn http_get(url: &str) -> HttpRequest {
    let mut r = HttpRequest::new("oauth");
    r.method = HttpMethod::Get;
    r.url = url.to_string();
    r
}

fn http_post_form(url: &str, form: String) -> HttpRequest {
    let mut r = HttpRequest::new("oauth");
    r.method = HttpMethod::Post;
    r.url = url.to_string();
    r.headers = vec![KeyValue {
        key: "Content-Type".into(),
        value: "application/x-www-form-urlencoded".into(),
        enabled: true,
    }];
    r.body = RequestBody::Text { content: form };
    r
}

fn http_post_json(url: &str, body: Value) -> HttpRequest {
    let mut r = HttpRequest::new("oauth");
    r.method = HttpMethod::Post;
    r.url = url.to_string();
    r.body = RequestBody::Json {
        content: body.to_string(),
    };
    r
}

fn snippet(s: &str) -> String {
    let s = s.trim();
    if s.len() <= 400 {
        s.to_string()
    } else {
        let mut end = 400;
        while !s.is_char_boundary(end) {
            end -= 1;
        }
        format!("{}…", &s[..end])
    }
}

/// GET + parse JSON, dengan log status & body (untuk diagnosa).
async fn get_json(url: &str) -> Result<Value> {
    let resp = proxius_engine::send(&http_get(url)).await?;
    eprintln!("[oauth] GET {url} -> {}", resp.status);
    if resp.status < 200 || resp.status >= 300 {
        eprintln!("[oauth]   body: {}", snippet(&resp.body));
        return Err(anyhow!("GET {url} → HTTP {}", resp.status));
    }
    serde_json::from_str(&resp.body).with_context(|| format!("respon non-JSON dari {url}"))
}

/// Kandidat lokasi metadata `.well-known` untuk sebuah base (RFC 8414/9728):
/// bila base punya path (mis. .../v1), well-known disisipkan setelah host.
fn well_known(base: &str, name: &str) -> Vec<String> {
    let mut out = Vec::new();
    if let Ok(u) = url::Url::parse(base) {
        let origin = u.origin().ascii_serialization();
        let path = u.path().trim_end_matches('/');
        if !path.is_empty() {
            out.push(format!("{origin}/.well-known/{name}{path}"));
        }
        out.push(format!("{origin}/.well-known/{name}"));
        if !path.is_empty() {
            // Sebagian server menaruh well-known langsung di bawah path.
            out.push(format!("{origin}{path}/.well-known/{name}"));
        }
    }
    out.dedup();
    out
}

fn form(pairs: &[(&str, &str)]) -> String {
    url::form_urlencoded::Serializer::new(String::new())
        .extend_pairs(pairs.iter().copied())
        .finish()
}

// ── Penemuan metadata ───────────────────────────────────────────────

async fn discover(mcp_url: &str) -> Result<AuthMeta> {
    eprintln!("[oauth] mulai discovery untuk {mcp_url}");
    let origin = url::Url::parse(mcp_url)
        .with_context(|| format!("URL MCP tidak valid: {mcp_url}"))?
        .origin()
        .ascii_serialization();
    eprintln!("[oauth] origin={origin}");

    // 1) Protected Resource Metadata (RFC 9728, opsional) → authorization server.
    let mut as_base = origin.clone();
    for cand in well_known(mcp_url, "oauth-protected-resource") {
        if let Ok(v) = get_json(&cand).await {
            eprintln!("[oauth] protected-resource: {}", snippet(&v.to_string()));
            if let Some(s) = v
                .get("authorization_servers")
                .and_then(|a| a.as_array())
                .and_then(|a| a.first())
                .and_then(|s| s.as_str())
            {
                as_base = s.trim_end_matches('/').to_string();
                eprintln!("[oauth] authorization_server dari PRM: {as_base}");
                break;
            }
        }
    }

    // 2) Authorization Server Metadata (RFC 8414; oauth lalu openid).
    let mut meta: Option<Value> = None;
    for name in ["oauth-authorization-server", "openid-configuration"] {
        for cand in well_known(&as_base, name) {
            if let Ok(v) = get_json(&cand).await {
                if v.get("authorization_endpoint").is_some() {
                    eprintln!("[oauth] metadata AS ditemukan di {cand}");
                    eprintln!("[oauth] metadata: {}", snippet(&v.to_string()));
                    meta = Some(v);
                    break;
                }
            }
        }
        if meta.is_some() {
            break;
        }
    }
    let meta = meta.context(
        "gagal menemukan metadata authorization server (.well-known). Server mungkin tak mengekspos OAuth metadata standar.",
    )?;

    let authorize = meta
        .get("authorization_endpoint")
        .and_then(|v| v.as_str())
        .context("metadata tanpa authorization_endpoint")?
        .to_string();
    let token = meta
        .get("token_endpoint")
        .and_then(|v| v.as_str())
        .context("metadata tanpa token_endpoint")?
        .to_string();
    let register = meta
        .get("registration_endpoint")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let scopes = meta
        .get("scopes_supported")
        .and_then(|v| v.as_array())
        .map(|a| {
            a.iter()
                .filter_map(|s| s.as_str())
                .collect::<Vec<_>>()
                .join(" ")
        });

    eprintln!("[oauth] authorize_endpoint={authorize}");
    eprintln!("[oauth] token_endpoint={token}");
    eprintln!("[oauth] registration_endpoint={register:?}");
    eprintln!("[oauth] scopes_supported={scopes:?}");

    Ok(AuthMeta {
        authorize,
        token,
        register,
        scopes,
    })
}

async fn register_client(register: &str, redirect_uri: &str) -> Result<String> {
    let body = serde_json::json!({
        "client_name": "Proxius",
        "redirect_uris": [redirect_uri],
        "grant_types": ["authorization_code", "refresh_token"],
        "response_types": ["code"],
        "token_endpoint_auth_method": "none"
    });
    eprintln!("[oauth] DCR POST {register}");
    let resp = proxius_engine::send(&http_post_json(register, body)).await?;
    eprintln!("[oauth] DCR -> {} body: {}", resp.status, snippet(&resp.body));
    if resp.status < 200 || resp.status >= 300 {
        return Err(anyhow!("registration → HTTP {}: {}", resp.status, resp.body));
    }
    let v: Value = serde_json::from_str(&resp.body).context("respon DCR non-JSON")?;
    v.get("client_id")
        .and_then(|s| s.as_str())
        .map(str::to_string)
        .context("DCR tanpa client_id")
}

// ── Loopback callback ───────────────────────────────────────────────

/// Terima satu request callback, kembalikan (code, state).
async fn await_callback(listener: TcpListener) -> Result<(String, String)> {
    let (mut stream, _) = listener.accept().await.context("accept callback gagal")?;
    let (_, path, _) = read_request(&mut stream).await?;

    // path = "/callback?code=...&state=..."
    let parsed = url::Url::parse(&format!("http://127.0.0.1{path}"))
        .context("callback path tidak valid")?;
    let mut code = None;
    let mut state = None;
    let mut err = None;
    for (k, v) in parsed.query_pairs() {
        match k.as_ref() {
            "code" => code = Some(v.to_string()),
            "state" => state = Some(v.to_string()),
            "error" => err = Some(v.to_string()),
            _ => {}
        }
    }

    let ok = code.is_some() && err.is_none();
    let msg = if ok {
        "Proxius: login berhasil. Silakan tutup tab ini."
    } else {
        "Proxius: login gagal atau dibatalkan."
    };
    let html = format!("<!doctype html><meta charset=utf-8><body style=\"font-family:system-ui;padding:2rem\">{msg}</body>");
    let resp = format!(
        "HTTP/1.1 200 OK\r\nContent-Type: text/html; charset=utf-8\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
        html.len(),
        html
    );
    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;

    if let Some(e) = err {
        return Err(anyhow!("authorize gagal: {e}"));
    }
    Ok((
        code.context("callback tanpa code")?,
        state.unwrap_or_default(),
    ))
}

/// Baca satu request HTTP mentah → (method, path, body).
async fn read_request(stream: &mut TcpStream) -> Result<(String, String, String)> {
    let mut buf = Vec::new();
    let mut tmp = [0u8; 2048];
    loop {
        let n = stream.read(&mut tmp).await?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&tmp[..n]);
        if let Some(pos) = find(&buf, b"\r\n\r\n") {
            let head = String::from_utf8_lossy(&buf[..pos]).to_string();
            let mut lines = head.split("\r\n");
            let reqline = lines.next().unwrap_or("");
            let mut parts = reqline.split(' ');
            let method = parts.next().unwrap_or("").to_string();
            let path = parts.next().unwrap_or("").to_string();
            let mut clen = 0usize;
            for l in lines {
                if let Some(v) = l.to_ascii_lowercase().strip_prefix("content-length:") {
                    clen = v.trim().parse().unwrap_or(0);
                }
            }
            let mut body = buf[pos + 4..].to_vec();
            while body.len() < clen {
                let n = stream.read(&mut tmp).await?;
                if n == 0 {
                    break;
                }
                body.extend_from_slice(&tmp[..n]);
            }
            return Ok((method, path, String::from_utf8_lossy(&body).to_string()));
        }
    }
    Err(anyhow!("request HTTP tidak lengkap"))
}

fn find(haystack: &[u8], needle: &[u8]) -> Option<usize> {
    haystack.windows(needle.len()).position(|w| w == needle)
}

// ── Flow inti (dapat diuji) ─────────────────────────────────────────

async fn run_oauth<F>(mcp_url: &str, open: F) -> Result<TokenSet>
where
    F: FnOnce(&str),
{
    let meta = discover(mcp_url).await?;

    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .context("gagal bind loopback")?;
    let port = listener.local_addr()?.port();
    let redirect_uri = format!("http://127.0.0.1:{port}/callback");

    eprintln!("[oauth] redirect_uri={redirect_uri}");
    let register = meta
        .register
        .as_deref()
        .context("server tidak mendukung Dynamic Client Registration; client_id manual belum didukung")?;
    let client_id = register_client(register, &redirect_uri).await?;
    eprintln!("[oauth] client_id={client_id}");

    let verifier = random_b64(32)?;
    let challenge = pkce_challenge(&verifier);
    let state = random_b64(16)?;

    let mut params: Vec<(&str, &str)> = vec![
        ("response_type", "code"),
        ("client_id", &client_id),
        ("redirect_uri", &redirect_uri),
        ("code_challenge", &challenge),
        ("code_challenge_method", "S256"),
        ("state", &state),
        // RFC 8707: audience = server MCP yang dituju.
        ("resource", mcp_url),
    ];
    if let Some(scopes) = meta.scopes.as_deref() {
        params.push(("scope", scopes));
    }
    let authorize_url = url::Url::parse_with_params(&meta.authorize, &params)
        .context("gagal bangun authorize URL")?
        .to_string();
    eprintln!("[oauth] >>> membuka authorize URL:\n{authorize_url}");

    open(&authorize_url);
    eprintln!("[oauth] menunggu callback di {redirect_uri} …");

    // Tunggu callback (maks 5 menit).
    let (code, got_state) =
        tokio::time::timeout(std::time::Duration::from_secs(300), await_callback(listener))
            .await
            .context("timeout menunggu login (5 menit)")??;
    eprintln!("[oauth] callback diterima (code len={}, state cocok={})", code.len(), got_state == state);
    if got_state != state {
        return Err(anyhow!("state tidak cocok (kemungkinan CSRF); login dibatalkan"));
    }

    // Tukar code → token.
    let body = form(&[
        ("grant_type", "authorization_code"),
        ("code", &code),
        ("redirect_uri", &redirect_uri),
        ("client_id", &client_id),
        ("code_verifier", &verifier),
        ("resource", mcp_url),
    ]);
    eprintln!("[oauth] token exchange POST {}", meta.token);
    let resp = proxius_engine::send(&http_post_form(&meta.token, body)).await?;
    eprintln!("[oauth] token -> {}", resp.status);
    if resp.status < 200 || resp.status >= 300 {
        eprintln!("[oauth]   body: {}", snippet(&resp.body));
        return Err(anyhow!("token exchange → HTTP {}: {}", resp.status, resp.body));
    }
    eprintln!("[oauth] token exchange sukses");
    parse_tokens(&resp.body, &meta.token, &client_id)
}

async fn refresh(token_endpoint: &str, client_id: &str, refresh_token: &str) -> Result<TokenSet> {
    let body = form(&[
        ("grant_type", "refresh_token"),
        ("refresh_token", refresh_token),
        ("client_id", client_id),
    ]);
    let resp = proxius_engine::send(&http_post_form(token_endpoint, body)).await?;
    if resp.status < 200 || resp.status >= 300 {
        return Err(anyhow!("refresh → HTTP {}: {}", resp.status, resp.body));
    }
    let mut set = parse_tokens(&resp.body, token_endpoint, client_id)?;
    // Sebagian server tak mengembalikan refresh_token baru → pertahankan lama.
    if set.refresh_token.is_none() {
        set.refresh_token = Some(refresh_token.to_string());
    }
    Ok(set)
}

fn parse_tokens(body: &str, token_endpoint: &str, client_id: &str) -> Result<TokenSet> {
    let v: Value = serde_json::from_str(body).context("respon token non-JSON")?;
    let access_token = v
        .get("access_token")
        .and_then(|s| s.as_str())
        .context("respon tanpa access_token")?
        .to_string();
    Ok(TokenSet {
        access_token,
        refresh_token: v
            .get("refresh_token")
            .and_then(|s| s.as_str())
            .map(str::to_string),
        expires_in: v.get("expires_in").and_then(|s| s.as_u64()),
        scope: v.get("scope").and_then(|s| s.as_str()).map(str::to_string),
        token_endpoint: token_endpoint.to_string(),
        client_id: client_id.to_string(),
    })
}

fn open_browser(url: &str) {
    if let Err(e) = open_url(url) {
        eprintln!("[oauth] gagal buka browser otomatis: {e}");
    }
    // Selalu cetak URL sebagai cadangan (buka manual bila perlu).
    eprintln!("[oauth] Bila browser tak terbuka otomatis, buka URL ini manual:\n{url}");
}

#[cfg(target_os = "windows")]
fn open_url(url: &str) -> std::io::Result<()> {
    use std::os::windows::process::CommandExt;
    // PENTING: JANGAN lewat cmd.exe. Karakter '&' di URL dianggap pemisah
    // perintah oleh cmd, sehingga URL terpotong di '&' pertama. rundll32
    // FileProtocolHandler dipanggil langsung (bukan via cmd) → URL utuh.
    std::process::Command::new("rundll32")
        .raw_arg(format!("url.dll,FileProtocolHandler {url}"))
        .spawn()
        .map(|_| ())
}

#[cfg(target_os = "macos")]
fn open_url(url: &str) -> std::io::Result<()> {
    std::process::Command::new("open").arg(url).spawn().map(|_| ())
}

#[cfg(all(unix, not(target_os = "macos")))]
fn open_url(url: &str) -> std::io::Result<()> {
    std::process::Command::new("xdg-open").arg(url).spawn().map(|_| ())
}

// ── Tauri commands ──────────────────────────────────────────────────

#[tauri::command]
pub async fn oauth_login(mcp_url: String) -> Result<TokenSet, String> {
    run_oauth(&mcp_url, open_browser)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[tauri::command]
pub async fn oauth_refresh(
    token_endpoint: String,
    client_id: String,
    refresh_token: String,
) -> Result<TokenSet, String> {
    refresh(&token_endpoint, &client_id, &refresh_token)
        .await
        .map_err(|e| format!("{e:#}"))
}

#[cfg(test)]
mod tests {
    use super::*;

    // Mock authorization server (hand-rolled HTTP) untuk menguji seluruh flow.
    async fn mock_server() -> (String, tokio::task::JoinHandle<()>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let base = format!("http://127.0.0.1:{port}");
        let base2 = base.clone();
        let handle = tokio::spawn(async move {
            let challenge = std::sync::Arc::new(tokio::sync::Mutex::new(String::new()));
            loop {
                let (mut stream, _) = match listener.accept().await {
                    Ok(x) => x,
                    Err(_) => break,
                };
                let (_, path, body) = read_request(&mut stream).await.unwrap();
                let ch = challenge.clone();
                let base = base2.clone();
                let route = path.split('?').next().unwrap_or("").to_string();
                let resp: String = match route.as_str() {
                    "/.well-known/oauth-protected-resource" => {
                        json_resp(&serde_json::json!({ "authorization_servers": [base] }))
                    }
                    "/.well-known/oauth-authorization-server" => json_resp(&serde_json::json!({
                        "authorization_endpoint": format!("{base}/authorize"),
                        "token_endpoint": format!("{base}/token"),
                        "registration_endpoint": format!("{base}/register"),
                        "scopes_supported": ["read:jira-work", "write:jira-work"]
                    })),
                    "/register" => json_resp(&serde_json::json!({ "client_id": "test-client" })),
                    "/authorize" => {
                        let u = url::Url::parse(&format!("http://x{path}")).unwrap();
                        let mut redirect = String::new();
                        let mut state = String::new();
                        for (k, v) in u.query_pairs() {
                            match k.as_ref() {
                                "code_challenge" => *ch.lock().await = v.to_string(),
                                "redirect_uri" => redirect = v.to_string(),
                                "state" => state = v.to_string(),
                                _ => {}
                            }
                        }
                        format!(
                            "HTTP/1.1 302 Found\r\nLocation: {redirect}?code=auth-code-xyz&state={state}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
                        )
                    }
                    "/token" => {
                        let mut verifier = String::new();
                        let mut code = String::new();
                        let mut grant = String::new();
                        let mut refresh_tok = String::new();
                        for (k, v) in url::form_urlencoded::parse(body.as_bytes()) {
                            match k.as_ref() {
                                "code_verifier" => verifier = v.to_string(),
                                "code" => code = v.to_string(),
                                "grant_type" => grant = v.to_string(),
                                "refresh_token" => refresh_tok = v.to_string(),
                                _ => {}
                            }
                        }
                        if grant == "refresh_token" {
                            if refresh_tok.is_empty() {
                                "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
                            } else {
                                // Sengaja tak balas refresh_token baru → uji "keep old".
                                json_resp(&serde_json::json!({
                                    "access_token": "ACCESS-REFRESHED",
                                    "expires_in": 3600
                                }))
                            }
                        } else {
                            let expect = ch.lock().await.clone();
                            if code == "auth-code-xyz" && pkce_challenge(&verifier) == expect {
                                json_resp(&serde_json::json!({
                                    "access_token": "ACCESS-123",
                                    "refresh_token": "REFRESH-456",
                                    "expires_in": 3600,
                                    "scope": "read:jira-work"
                                }))
                            } else {
                                "HTTP/1.1 400 Bad Request\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into()
                            }
                        }
                    }
                    _ => "HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".into(),
                };
                let _ = stream.write_all(resp.as_bytes()).await;
                let _ = stream.flush().await;
            }
        });
        (base, handle)
    }

    fn json_resp(v: &Value) -> String {
        let body = v.to_string();
        format!(
            "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
            body.len(),
            body
        )
    }

    #[tokio::test]
    async fn full_oauth_flow() {
        let (base, _h) = mock_server().await;
        let mcp_url = format!("{base}/mcp");

        // "Browser": GET authorize URL → ikuti redirect ke loopback.
        let open = |url: &str| {
            let url = url.to_string();
            tokio::spawn(async move {
                let _ = proxius_engine::send(&http_get(&url)).await;
            });
        };

        let tokens = run_oauth(&mcp_url, open).await.expect("oauth gagal");
        assert_eq!(tokens.access_token, "ACCESS-123");
        assert_eq!(tokens.refresh_token.as_deref(), Some("REFRESH-456"));
        assert_eq!(tokens.expires_in, Some(3600));
        assert_eq!(tokens.client_id, "test-client");
        assert!(tokens.token_endpoint.ends_with("/token"));
    }

    #[tokio::test]
    async fn refresh_flow() {
        let (base, _h) = mock_server().await;
        let set = refresh(&format!("{base}/token"), "test-client", "REFRESH-OLD")
            .await
            .expect("refresh gagal");
        assert_eq!(set.access_token, "ACCESS-REFRESHED");
        // Server tak kirim refresh_token baru → yang lama dipertahankan.
        assert_eq!(set.refresh_token.as_deref(), Some("REFRESH-OLD"));
    }
}
