use anyhow::anyhow;
use argon2::password_hash::{PasswordHash, PasswordHasher, PasswordVerifier, SaltString};
use argon2::Argon2;
use async_trait::async_trait;
use axum::extract::{FromRequestParts, State};
use axum::http::header::AUTHORIZATION;
use axum::http::request::Parts;
use axum::Json;
use chrono::{Duration, Utc};
use proxius_db::User;
use rand::RngCore;
use serde::{Deserialize, Serialize};

use crate::error::{ApiResult, AppError};
use crate::state::AppState;

const SESSION_DAYS: i64 = 30;

// ── Kripto ──────────────────────────────────────────────────────────

fn hash_password(pw: &str) -> anyhow::Result<String> {
    let mut salt_bytes = [0u8; 16];
    rand::thread_rng().fill_bytes(&mut salt_bytes);
    let salt = SaltString::encode_b64(&salt_bytes).map_err(|e| anyhow!("salt: {e}"))?;
    let hash = Argon2::default()
        .hash_password(pw.as_bytes(), &salt)
        .map_err(|e| anyhow!("hash: {e}"))?
        .to_string();
    Ok(hash)
}

fn verify_password(pw: &str, hash: &str) -> bool {
    PasswordHash::new(hash)
        .and_then(|ph| Argon2::default().verify_password(pw.as_bytes(), &ph))
        .is_ok()
}

fn new_token() -> String {
    let mut bytes = [0u8; 32];
    rand::thread_rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| format!("{b:02x}")).collect()
}

// ── Extractor: user terautentikasi ──────────────────────────────────

pub struct AuthUser(pub User);

#[async_trait]
impl FromRequestParts<AppState> for AuthUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let token = parts
            .headers
            .get(AUTHORIZATION)
            .and_then(|v| v.to_str().ok())
            .and_then(|s| s.strip_prefix("Bearer "))
            .ok_or(AppError::Unauthorized)?
            .to_string();

        let user = proxius_db::user_from_token(&state.pool, &token)
            .await?
            .ok_or(AppError::Unauthorized)?;
        Ok(AuthUser(user))
    }
}

/// Extractor untuk endpoint admin.
#[allow(dead_code)]
pub struct AdminUser(pub User);

#[async_trait]
impl FromRequestParts<AppState> for AdminUser {
    type Rejection = AppError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let AuthUser(user) = AuthUser::from_request_parts(parts, state).await?;
        if user.role != "admin" {
            return Err(AppError::Forbidden);
        }
        Ok(AdminUser(user))
    }
}

// ── Handlers ────────────────────────────────────────────────────────

#[derive(Deserialize)]
pub struct RegisterReq {
    pub email: String,
    #[serde(default)]
    pub name: String,
    pub password: String,
}

#[derive(Deserialize)]
pub struct LoginReq {
    pub email: String,
    pub password: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AuthResponse {
    pub token: String,
    pub user: User,
}

async fn start_session(state: &AppState, user: User) -> ApiResult<Json<AuthResponse>> {
    let token = new_token();
    let expires = Utc::now() + Duration::days(SESSION_DAYS);
    proxius_db::create_session(&state.pool, &token, user.id, expires).await?;
    Ok(Json(AuthResponse { token, user }))
}

pub async fn register(
    State(state): State<AppState>,
    Json(body): Json<RegisterReq>,
) -> ApiResult<Json<AuthResponse>> {
    let email = body.email.trim().to_lowercase();
    if !email.contains('@') {
        return Err(AppError::BadRequest("email tidak valid".into()));
    }
    if body.password.len() < 8 {
        return Err(AppError::BadRequest("password minimal 8 karakter".into()));
    }
    if proxius_db::find_user_by_email(&state.pool, &email).await?.is_some() {
        return Err(AppError::BadRequest("email sudah terdaftar".into()));
    }

    // User pertama menjadi admin.
    let role = if proxius_db::count_users(&state.pool).await? == 0 {
        "admin"
    } else {
        "member"
    };
    let hash = hash_password(&body.password)?;
    let name = if body.name.trim().is_empty() {
        email.split('@').next().unwrap_or("user").to_string()
    } else {
        body.name.trim().to_string()
    };
    let user = proxius_db::create_user(&state.pool, &email, &name, &hash, role).await?;
    proxius_db::create_workspace(&state.pool, "My Workspace", user.id).await?;
    start_session(&state, user).await
}

pub async fn login(
    State(state): State<AppState>,
    Json(body): Json<LoginReq>,
) -> ApiResult<Json<AuthResponse>> {
    let email = body.email.trim().to_lowercase();
    let user = proxius_db::find_user_by_email(&state.pool, &email)
        .await?
        .ok_or(AppError::Unauthorized)?;
    if !user.active || !verify_password(&body.password, &user.password_hash) {
        return Err(AppError::Unauthorized);
    }
    start_session(&state, user).await
}

pub async fn me(AuthUser(user): AuthUser) -> Json<User> {
    Json(user)
}

pub async fn logout(
    State(state): State<AppState>,
    headers: axum::http::HeaderMap,
) -> ApiResult<Json<serde_json::Value>> {
    if let Some(token) = headers
        .get(AUTHORIZATION)
        .and_then(|v| v.to_str().ok())
        .and_then(|s| s.strip_prefix("Bearer "))
    {
        proxius_db::delete_session(&state.pool, token).await?;
    }
    Ok(Json(serde_json::json!({ "ok": true })))
}
