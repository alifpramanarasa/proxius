//! Entry point Tauri + command yang diekspos ke UI.

mod fsops;
mod git;
mod mock;
mod oauth;

use std::collections::HashMap;
use std::sync::Arc;

use proxius_core::{HttpRequest, HttpResponse, KeyValue, RunDocument, RunReport};
use proxius_engine::Jar;

/// Command: kirim satu request lewat native engine (Rust/reqwest).
/// Memakai cookie jar bersama agar cookie sesi bertahan antar-request.
#[tauri::command]
async fn send_request(
    req: HttpRequest,
    options: Option<proxius_engine::SendOptions>,
    jar: tauri::State<'_, Arc<Jar>>,
) -> Result<HttpResponse, String> {
    let resp = proxius_engine::send_with_jar(&req, &options.unwrap_or_default(), jar.inner().clone())
        .await
        .map_err(|e| format!("{e:#}"))?;
    // Diagnostik: log request yang gagal (4xx/5xx) beserta body-nya.
    if resp.status >= 400 {
        let body: String = resp.body.chars().take(700).collect();
        eprintln!(
            "[req] {} {} -> {} body: {}",
            req.method.as_str(),
            req.url,
            resp.status,
            body
        );
    }
    Ok(resp)
}

/// Command: ukur fase koneksi (DNS + TCP connect) ke host sebuah URL.
#[tauri::command]
async fn probe_connection(url: String) -> Result<proxius_engine::ConnTiming, String> {
    proxius_engine::probe(&url).await.map_err(|e| format!("{e:#}"))
}

/// Command: daftar method "/pkg.Service/Method" dari sumber .proto.
#[tauri::command]
fn grpc_methods(proto: String) -> Result<Vec<String>, String> {
    let pool =
        proxius_grpc::compile_proto("service.proto", &proto).map_err(|e| format!("{e:#}"))?;
    Ok(proxius_grpc::list_methods(&pool))
}

/// Command: panggil satu method unary gRPC (proto + JSON → JSON).
#[tauri::command]
async fn grpc_unary(
    endpoint: String,
    proto: String,
    method: String,
    message: String,
) -> Result<String, String> {
    proxius_grpc::grpc_unary(&endpoint, &proto, &method, &message)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Command: ambil daftar method sebuah simbol via server reflection.
#[tauri::command]
async fn grpc_reflect_methods(endpoint: String, symbol: String) -> Result<Vec<String>, String> {
    proxius_grpc::reflect_methods(&endpoint, &symbol)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Command: panggil unary via reflection (tanpa paste proto).
#[tauri::command]
async fn grpc_unary_reflect(
    endpoint: String,
    symbol: String,
    method: String,
    message: String,
) -> Result<String, String> {
    proxius_grpc::grpc_unary_reflect(&endpoint, &symbol, &method, &message)
        .await
        .map_err(|e| format!("{e:#}"))
}

/// Command: jalankan seluruh dokumen (collection) + assertion secara headless.
#[tauri::command]
async fn run_collection(
    doc: RunDocument,
    variables: Vec<KeyValue>,
) -> Result<RunReport, String> {
    let base: HashMap<String, String> = variables
        .into_iter()
        .filter(|v| v.enabled && !v.key.is_empty())
        .map(|v| (v.key, v.value))
        .collect();
    Ok(proxius_runner::run_document(&doc, &base).await)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(proxius_engine::new_jar())
        .manage(mock::MockState::default())
        .invoke_handler(tauri::generate_handler![
            send_request,
            probe_connection,
            grpc_methods,
            grpc_unary,
            grpc_reflect_methods,
            grpc_unary_reflect,
            run_collection,
            fsops::fs_read_dir,
            fsops::fs_read_text,
            fsops::fs_write_text,
            fsops::fs_mkdir,
            fsops::fs_exists,
            fsops::fs_remove,
            git::git_available,
            git::git_init,
            git::git_set_identity,
            git::git_set_remote,
            git::git_current_remote,
            git::git_commit_all,
            git::git_push,
            git::git_pull,
            git::git_clone,
            git::git_status,
            oauth::oauth_login,
            oauth::oauth_refresh,
            mock::mock_start,
            mock::mock_stop,
            mock::mock_status,
        ])
        .run(tauri::generate_context!())
        .expect("error saat menjalankan aplikasi Tauri");
}
