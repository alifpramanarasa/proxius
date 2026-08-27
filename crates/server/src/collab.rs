//! Endpoint WebSocket kolaborasi: presence, live-sync, dan comment broadcast.

use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Path, Query, State};
use axum::response::{IntoResponse, Response};
use futures::{SinkExt, StreamExt};
use proxius_db::User;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::state::AppState;

#[derive(Deserialize)]
pub struct WsQuery {
    pub token: String,
}

/// GET /api/ws/workspace/:id?token=...
pub async fn ws_workspace(
    ws: WebSocketUpgrade,
    State(state): State<AppState>,
    Path(workspace): Path<Uuid>,
    Query(q): Query<WsQuery>,
) -> Response {
    // Auth via token + cek keanggotaan.
    let user = match proxius_db::user_from_token(&state.pool, &q.token).await {
        Ok(Some(u)) => u,
        _ => return (axum::http::StatusCode::UNAUTHORIZED, "unauthorized").into_response(),
    };
    let role = match proxius_db::member_role(&state.pool, workspace, user.id).await {
        Ok(Some(r)) => r,
        _ => return (axum::http::StatusCode::FORBIDDEN, "forbidden").into_response(),
    };

    ws.on_upgrade(move |socket| handle_socket(socket, state, workspace, user, role))
}

#[derive(Deserialize)]
#[serde(tag = "type", rename_all = "camelCase")]
enum ClientMsg {
    /// Klien baru saja push versi N → beri tahu yang lain untuk pull.
    Sync { version: i32 },
    /// Klien sedang melihat request tertentu (presence detail).
    #[serde(rename_all = "camelCase")]
    Cursor { request_id: Option<String> },
    /// Tambah komentar (butuh role editor/owner).
    #[serde(rename_all = "camelCase")]
    Comment { request_id: String, body: String },
    Ping,
}

async fn handle_socket(
    socket: WebSocket,
    state: AppState,
    workspace: Uuid,
    user: User,
    role: String,
) {
    let conn_id = state.hub.next_conn_id();
    let mut rx = state.hub.join(
        workspace,
        conn_id,
        user.id,
        user.name.clone(),
        user.email.clone(),
    );

    let (mut sink, mut stream) = socket.split();

    // Sambut klien.
    let _ = sink
        .send(Message::Text(
            json!({ "type": "welcome", "userId": user.id, "role": role }).to_string(),
        ))
        .await;

    // Task: teruskan broadcast room → socket.
    let mut send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if sink.send(Message::Text(msg)).await.is_err() {
                break;
            }
        }
    });

    // Task: baca pesan klien.
    let hub = state.hub.clone();
    let pool = state.pool.clone();
    let uid = user.id;
    let can_write = role == "owner" || role == "editor";
    let mut recv_task = tokio::spawn(async move {
        while let Some(Ok(msg)) = stream.next().await {
            let Message::Text(text) = msg else {
                if matches!(msg, Message::Close(_)) {
                    break;
                }
                continue;
            };
            let Ok(cmsg) = serde_json::from_str::<ClientMsg>(&text) else {
                continue;
            };
            match cmsg {
                ClientMsg::Ping => {}
                ClientMsg::Sync { version } => {
                    hub.broadcast(
                        workspace,
                        json!({ "type": "changed", "version": version, "by": uid }).to_string(),
                    );
                }
                ClientMsg::Cursor { request_id } => {
                    hub.broadcast(
                        workspace,
                        json!({ "type": "cursor", "userId": uid, "requestId": request_id })
                            .to_string(),
                    );
                }
                ClientMsg::Comment { request_id, body } => {
                    if !can_write || body.trim().is_empty() {
                        continue;
                    }
                    if let Ok(comment) =
                        proxius_db::create_comment(&pool, workspace, &request_id, uid, &body).await
                    {
                        hub.broadcast(
                            workspace,
                            json!({ "type": "comment", "comment": comment }).to_string(),
                        );
                    }
                }
            }
        }
    });

    // Selesai bila salah satu task berhenti.
    tokio::select! {
        _ = &mut send_task => recv_task.abort(),
        _ = &mut recv_task => send_task.abort(),
    }

    state.hub.leave(workspace, conn_id);
}
