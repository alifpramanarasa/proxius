use axum::extract::{Path, State};
use axum::Json;
use proxius_db::{SyncOutcome, WorkspaceMeta};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::auth::AuthUser;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

/// GET /api/workspaces — daftar workspace milik/teranggota user.
pub async fn list(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<WorkspaceMeta>>> {
    Ok(Json(
        proxius_db::list_workspaces_for_user(&state.pool, user.id).await?,
    ))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceData {
    pub id: Uuid,
    pub name: String,
    pub data: serde_json::Value,
    pub version: i32,
}

/// GET /api/workspaces/:id — ambil snapshot.
pub async fn get(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<WorkspaceData>> {
    let ws = proxius_db::get_workspace(&state.pool, id, user.id)
        .await?
        .ok_or(AppError::NotFound)?;
    Ok(Json(WorkspaceData {
        id: ws.id,
        name: ws.name,
        data: ws.data,
        version: ws.version,
    }))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PushReq {
    pub data: serde_json::Value,
    pub version: i32,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PushResp {
    pub version: i32,
}

#[derive(Deserialize)]
pub struct AddMemberReq {
    pub email: String,
    #[serde(default)]
    pub role: Option<String>,
}

/// POST /api/workspaces/:id/members — tambah anggota via email (owner only).
pub async fn add_member(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<AddMemberReq>,
) -> ApiResult<Json<serde_json::Value>> {
    let role = proxius_db::member_role(&state.pool, id, user.id)
        .await?
        .ok_or(AppError::Forbidden)?;
    if role != "owner" {
        return Err(AppError::Forbidden);
    }
    let target = proxius_db::find_user_by_email(&state.pool, &body.email.trim().to_lowercase())
        .await?
        .ok_or(AppError::BadRequest("user tak ditemukan".into()))?;
    let new_role = match body.role.as_deref() {
        Some("owner") => "owner",
        Some("viewer") => "viewer",
        _ => "editor",
    };
    proxius_db::add_member(&state.pool, id, target.id, new_role).await?;
    Ok(Json(serde_json::json!({ "ok": true, "userId": target.id, "role": new_role })))
}

/// PUT /api/workspaces/:id — dorong snapshot (LWW dengan cek versi).
pub async fn put(
    AuthUser(user): AuthUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<PushReq>,
) -> ApiResult<Json<PushResp>> {
    match proxius_db::update_workspace(&state.pool, id, user.id, &body.data, body.version).await? {
        None => Err(AppError::NotFound),
        Some(SyncOutcome::Conflict(v)) => Err(AppError::Conflict(v)),
        Some(SyncOutcome::Updated(v)) => Ok(Json(PushResp { version: v })),
    }
}
