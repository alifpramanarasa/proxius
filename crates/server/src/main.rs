//! Proxius team server (Axum): auth, sync workspace, admin API, dan
//! (opsional) melayani SPA Admin CMS.

mod admin;
mod auth;
mod collab;
mod comments;
mod error;
mod hub;
mod state;
mod workspace;

use std::env;
use std::path::Path;

use axum::routing::{delete, get, patch, post};
use axum::Router;
use tower_http::cors::CorsLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::trace::TraceLayer;

use crate::state::AppState;

fn env_or(key: &str, default: &str) -> String {
    env::var(key).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(env_or("RUST_LOG", "info,proxius_server=debug"))
        .init();

    let database_url = env_or(
        "DATABASE_URL",
        "postgres://proxius:proxius@localhost:5433/proxius",
    );
    let bind = env_or("BIND", "127.0.0.1:8080");

    let pool = proxius_db::connect(&database_url).await?;
    proxius_db::migrate(&pool).await?;
    tracing::info!("migrasi DB selesai");

    let state = AppState {
        pool,
        hub: hub::Hub::new(),
    };

    let api = Router::new()
        .route("/health", get(|| async { "ok" }))
        .route("/auth/register", post(auth::register))
        .route("/auth/login", post(auth::login))
        .route("/auth/logout", post(auth::logout))
        .route("/auth/me", get(auth::me))
        .route("/workspaces", get(workspace::list))
        .route("/workspaces/:id", get(workspace::get).put(workspace::put))
        .route("/workspaces/:id/members", post(workspace::add_member))
        .route(
            "/workspaces/:id/comments",
            get(comments::list).post(comments::create),
        )
        .route("/comments/:id", delete(comments::delete))
        .route("/ws/workspace/:id", get(collab::ws_workspace))
        .route("/admin/stats", get(admin::stats))
        .route("/admin/users", get(admin::users))
        .route("/admin/users/:id/role", patch(admin::set_role))
        .route("/admin/workspaces", get(admin::workspaces))
        .route("/admin/workspaces/:id", delete(admin::delete_workspace));

    let mut app = Router::new().nest("/api", api);

    // Layani SPA Admin CMS bila direktori build tersedia.
    if let Ok(dir) = env::var("PROXIUS_ADMIN_DIR") {
        if Path::new(&dir).exists() {
            let index = format!("{dir}/index.html");
            app = app.nest_service(
                "/admin",
                ServeDir::new(&dir).fallback(ServeFile::new(index)),
            );
            tracing::info!("Admin CMS dilayani dari {dir}");
        }
    }

    let app = app
        .layer(CorsLayer::very_permissive())
        .layer(TraceLayer::new_for_http())
        .with_state(state);

    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("Proxius server berjalan di http://{bind}");
    axum::serve(listener, app).await?;
    Ok(())
}
