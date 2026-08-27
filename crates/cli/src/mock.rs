//! Mock server: sajikan example response tersimpan sebagai endpoint HTTP nyata
//! agar frontend/QA bisa mulai kerja sebelum API backend jadi.

use std::collections::BTreeMap;
use std::sync::Arc;

use axum::{
    body::Body,
    extract::{Request, State},
    http::{HeaderName, HeaderValue, StatusCode},
    response::Response,
    Router,
};
use serde::Deserialize;
use tower_http::cors::CorsLayer;

fn default_status() -> u16 {
    200
}

/// Header framing/hop-by-hop yang tak boleh di-replay dari example capture.
fn is_hop_by_hop(k: &str) -> bool {
    const SKIP: [&str; 8] = [
        "content-length",
        "transfer-encoding",
        "connection",
        "keep-alive",
        "trailer",
        "te",
        "upgrade",
        "proxy-authenticate",
    ];
    SKIP.iter().any(|s| k.eq_ignore_ascii_case(s))
}

/// Satu route mock: method + path → status/headers/body.
#[derive(Deserialize, Clone)]
pub struct MockRoute {
    pub method: String,
    pub path: String,
    #[serde(default = "default_status")]
    pub status: u16,
    #[serde(default)]
    pub headers: BTreeMap<String, String>,
    #[serde(default)]
    pub body: String,
}

#[derive(Deserialize)]
struct MockFile {
    routes: Vec<MockRoute>,
}

/// Parse teks file mock: objek `{ "routes": [...] }` atau array telanjang `[...]`.
pub fn parse_routes(text: &str) -> anyhow::Result<Vec<MockRoute>> {
    if let Ok(f) = serde_json::from_str::<MockFile>(text) {
        return Ok(f.routes);
    }
    Ok(serde_json::from_str::<Vec<MockRoute>>(text)?)
}

pub async fn serve(routes: Vec<MockRoute>, port: u16) -> anyhow::Result<()> {
    let bind = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    println!("Proxius mock di http://{bind} — {} route:", routes.len());
    for r in &routes {
        println!("  {} {} -> {}", r.method.to_uppercase(), r.path, r.status);
    }
    let app = Router::new()
        .fallback(handler)
        .layer(CorsLayer::very_permissive())
        .with_state(Arc::new(routes));
    axum::serve(listener, app).await?;
    Ok(())
}

async fn handler(State(routes): State<Arc<Vec<MockRoute>>>, req: Request) -> Response {
    let method = req.method().as_str().to_string();
    let path = req.uri().path().to_string();
    let found = routes
        .iter()
        .find(|r| r.method.eq_ignore_ascii_case(&method) && r.path == path);

    match found {
        Some(r) => {
            let mut builder =
                Response::builder().status(StatusCode::from_u16(r.status).unwrap_or(StatusCode::OK));
            let mut has_ct = false;
            for (k, v) in &r.headers {
                if is_hop_by_hop(k) {
                    continue;
                }
                if k.eq_ignore_ascii_case("content-type") {
                    has_ct = true;
                }
                if let (Ok(name), Ok(val)) =
                    (HeaderName::from_bytes(k.as_bytes()), HeaderValue::from_str(v))
                {
                    builder = builder.header(name, val);
                }
            }
            if !has_ct {
                builder = builder.header("content-type", "application/json");
            }
            builder
                .body(Body::from(r.body.clone()))
                .unwrap_or_else(|_| Response::new(Body::empty()))
        }
        None => {
            let available: Vec<String> = routes
                .iter()
                .map(|r| format!("{} {}", r.method.to_uppercase(), r.path))
                .collect();
            let body =
                serde_json::json!({ "error": "no mock route", "available": available }).to_string();
            Response::builder()
                .status(StatusCode::NOT_FOUND)
                .header("content-type", "application/json")
                .body(Body::from(body))
                .unwrap_or_else(|_| Response::new(Body::empty()))
        }
    }
}
