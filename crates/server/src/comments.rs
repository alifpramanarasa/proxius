//! REST comments: list, create (broadcast via hub), delete.

use axum::extract::{Path, Query, State};
use axum::Json;
use proxius_db::CommentView;
use serde::Deserialize;
use serde_json::json;
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ListQuery {
    pub request_id: String,
}

/// GET /api/workspaces/:id/comments?requestId=...
pub async fn list(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Path(workspace): Path<Uuid>,
    Query(q): Query<ListQuery>,
) -> ApiResult<Json<Vec<CommentView>>> {
    // Harus anggota.
    proxius_db::member_role(&state.pool, workspace, user.id)
        .await?
        .ok_or(AppError::Forbidden)?;
    Ok(Json(
        proxius_db::list_comments(&state.pool, workspace, &q.request_id).await?,
    ))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateReq {
    pub request_id: String,
    pub body: String,
}

/// POST /api/workspaces/:id/comments — butuh role editor/owner.
pub async fn create(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Path(workspace): Path<Uuid>,
    Json(body): Json<CreateReq>,
) -> ApiResult<Json<CommentView>> {
    let role = proxius_db::member_role(&state.pool, workspace, user.id)
        .await?
        .ok_or(AppError::Forbidden)?;
    if role != "owner" && role != "editor" {
        return Err(AppError::Forbidden);
    }
    if body.body.trim().is_empty() {
        return Err(AppError::BadRequest("komentar kosong".into()));
    }
    let comment =
        proxius_db::create_comment(&state.pool, workspace, &body.request_id, user.id, &body.body)
            .await?;
    // Siarkan ke klien realtime.
    state.hub.broadcast(
        workspace,
        json!({ "type": "comment", "comment": comment }).to_string(),
    );
    Ok(Json(comment))
}

/// DELETE /api/comments/:id — hanya penulis.
pub async fn delete(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    let deleted = proxius_db::delete_comment(&state.pool, id, user.id).await?;
    if !deleted {
        return Err(AppError::NotFound);
    }
    Ok(Json(json!({ "ok": true })))
}
