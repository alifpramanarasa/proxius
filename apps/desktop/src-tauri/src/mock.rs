//! Mock server yang bisa di-start/stop dari UI (Tauri command).
//! Menyajikan example response sebagai endpoint HTTP nyata di localhost.

use std::collections::BTreeMap;
use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    extract::{Request, State as AxState},
    http::{HeaderName, HeaderValue, StatusCode},
    response::Response,
    Router,
};
use serde::Deserialize;
use tauri::State;
use tokio::sync::oneshot;
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

struct MockCtl {
    shutdown: oneshot::Sender<()>,
    port: u16,
}

#[derive(Default)]
pub struct MockState(Mutex<Option<MockCtl>>);

#[tauri::command]
pub async fn mock_start(
    state: State<'_, MockState>,
    routes: Vec<MockRoute>,
    port: u16,
) -> Result<u16, String> {
    // Hentikan server lama bila ada.
    if let Some(ctl) = state.0.lock().unwrap().take() {
        let _ = ctl.shutdown.send(());
    }
    if routes.is_empty() {
        return Err("tidak ada route (belum ada example tersimpan)".into());
    }
    let listener = tokio::net::TcpListener::bind(("127.0.0.1", port))
        .await
        .map_err(|e| format!("port {port}: {e}"))?;
    let (tx, rx) = oneshot::channel::<()>();
    let app = Router::new()
        .fallback(handler)
        .layer(CorsLayer::very_permissive())
        .with_state(Arc::new(routes));
    tokio::spawn(async move {
        let _ = axum::serve(listener, app)
            .with_graceful_shutdown(async {
                let _ = rx.await;
            })
            .await;
    });
    *state.0.lock().unwrap() = Some(MockCtl { shutdown: tx, port });
    Ok(port)
}

#[tauri::command]
pub fn mock_stop(state: State<'_, MockState>) -> Result<(), String> {
    if let Some(ctl) = state.0.lock().unwrap().take() {
        let _ = ctl.shutdown.send(());
    }
    Ok(())
}

#[tauri::command]
pub fn mock_status(state: State<'_, MockState>) -> Option<u16> {
    state.0.lock().unwrap().as_ref().map(|c| c.port)
}

async fn handler(AxState(routes): AxState<Arc<Vec<MockRoute>>>, req: Request) -> Response {
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
                // Header framing hasil capture tak boleh di-replay — biar hyper
                // yang hitung sendiri, kalau tidak koneksi di-drop (ERR_EMPTY_RESPONSE).
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
