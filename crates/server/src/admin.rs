use axum::extract::{Path, State};
use axum::Json;
use proxius_db::{AdminStats, AdminUser as AdminUserRow, AdminWorkspace};
use serde::Deserialize;
use uuid::Uuid;

use crate::auth::AdminUser;
use crate::error::{ApiResult, AppError};
use crate::state::AppState;

/// GET /api/admin/stats
pub async fn stats(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> ApiResult<Json<AdminStats>> {
    Ok(Json(proxius_db::admin_stats(&state.pool).await?))
}

/// GET /api/admin/users
pub async fn users(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<AdminUserRow>>> {
    Ok(Json(proxius_db::admin_list_users(&state.pool).await?))
}

/// GET /api/admin/workspaces
pub async fn workspaces(
    _admin: AdminUser,
    State(state): State<AppState>,
) -> ApiResult<Json<Vec<AdminWorkspace>>> {
    Ok(Json(proxius_db::admin_list_workspaces(&state.pool).await?))
}

#[derive(Deserialize)]
pub struct RoleReq {
    pub role: String,
}

/// PATCH /api/admin/users/:id/role
pub async fn set_role(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
    Json(body): Json<RoleReq>,
) -> ApiResult<Json<serde_json::Value>> {
    if body.role != "admin" && body.role != "member" {
        return Err(AppError::BadRequest("role harus admin|member".into()));
    }
    proxius_db::set_user_role(&state.pool, id, &body.role).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}

/// DELETE /api/admin/workspaces/:id
pub async fn delete_workspace(
    _admin: AdminUser,
    State(state): State<AppState>,
    Path(id): Path<Uuid>,
) -> ApiResult<Json<serde_json::Value>> {
    proxius_db::delete_workspace(&state.pool, id).await?;
    Ok(Json(serde_json::json!({ "ok": true })))
}
