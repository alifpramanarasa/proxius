//! Lapisan database Proxius (Postgres via sqlx). Query runtime (bukan makro
//! compile-time) agar crate ini build tanpa DB hidup.

use anyhow::Result;
use chrono::{DateTime, Utc};
use serde::Serialize;
use sqlx::postgres::PgPoolOptions;
use sqlx::{FromRow, PgPool};
use uuid::Uuid;

pub type Db = PgPool;

/// Buat pool koneksi.
pub async fn connect(url: &str) -> Result<Db> {
    let pool = PgPoolOptions::new()
        .max_connections(10)
        .connect(url)
        .await?;
    Ok(pool)
}

/// Jalankan migrasi (embedded saat compile).
pub async fn migrate(pool: &Db) -> Result<()> {
    sqlx::migrate!("./migrations").run(pool).await?;
    Ok(())
}

// ── Model ───────────────────────────────────────────────────────────

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    #[serde(skip_serializing)]
    pub password_hash: String,
    pub role: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub last_active: Option<DateTime<Utc>>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
pub struct Workspace {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub data: serde_json::Value,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceMeta {
    pub id: Uuid,
    pub name: String,
    pub owner_id: Uuid,
    pub version: i32,
    pub role: String,
    pub updated_at: DateTime<Utc>,
}

// ── Users & sessions ────────────────────────────────────────────────

pub async fn count_users(pool: &Db) -> Result<i64> {
    let row: (i64,) = sqlx::query_as("select count(*) from users")
        .fetch_one(pool)
        .await?;
    Ok(row.0)
}

pub async fn create_user(
    pool: &Db,
    email: &str,
    name: &str,
    password_hash: &str,
    role: &str,
) -> Result<User> {
    let user = sqlx::query_as::<_, User>(
        "insert into users (email, name, password_hash, role)
         values ($1, $2, $3, $4)
         returning *",
    )
    .bind(email)
    .bind(name)
    .bind(password_hash)
    .bind(role)
    .fetch_one(pool)
    .await?;
    Ok(user)
}

pub async fn find_user_by_email(pool: &Db, email: &str) -> Result<Option<User>> {
    let user = sqlx::query_as::<_, User>("select * from users where email = $1")
        .bind(email)
        .fetch_optional(pool)
        .await?;
    Ok(user)
}

pub async fn create_session(
    pool: &Db,
    token: &str,
    user_id: Uuid,
    expires_at: DateTime<Utc>,
) -> Result<()> {
    sqlx::query("insert into sessions (token, user_id, expires_at) values ($1, $2, $3)")
        .bind(token)
        .bind(user_id)
        .bind(expires_at)
        .execute(pool)
        .await?;
    Ok(())
}

/// Cari user dari token sesi yang masih berlaku, sekaligus update last_active.
pub async fn user_from_token(pool: &Db, token: &str) -> Result<Option<User>> {
    let user = sqlx::query_as::<_, User>(
        "select u.* from sessions s
         join users u on u.id = s.user_id
         where s.token = $1 and s.expires_at > now() and u.active",
    )
    .bind(token)
    .fetch_optional(pool)
    .await?;
    if let Some(u) = &user {
        let _ = sqlx::query("update users set last_active = now() where id = $1")
            .bind(u.id)
            .execute(pool)
            .await;
    }
    Ok(user)
}

pub async fn delete_session(pool: &Db, token: &str) -> Result<()> {
    sqlx::query("delete from sessions where token = $1")
        .bind(token)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Workspaces & sync ───────────────────────────────────────────────

pub async fn create_workspace(pool: &Db, name: &str, owner_id: Uuid) -> Result<Workspace> {
    let ws = sqlx::query_as::<_, Workspace>(
        "insert into workspaces (name, owner_id) values ($1, $2) returning *",
    )
    .bind(name)
    .bind(owner_id)
    .fetch_one(pool)
    .await?;
    sqlx::query(
        "insert into workspace_members (workspace_id, user_id, role)
         values ($1, $2, 'owner') on conflict do nothing",
    )
    .bind(ws.id)
    .bind(owner_id)
    .execute(pool)
    .await?;
    Ok(ws)
}

pub async fn list_workspaces_for_user(pool: &Db, user_id: Uuid) -> Result<Vec<WorkspaceMeta>> {
    let rows = sqlx::query_as::<_, WorkspaceMeta>(
        "select w.id, w.name, w.owner_id, w.version, m.role, w.updated_at
         from workspaces w
         join workspace_members m on m.workspace_id = w.id
         where m.user_id = $1
         order by w.updated_at desc",
    )
    .bind(user_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Ambil workspace bila user adalah anggota.
pub async fn get_workspace(pool: &Db, id: Uuid, user_id: Uuid) -> Result<Option<Workspace>> {
    let ws = sqlx::query_as::<_, Workspace>(
        "select w.* from workspaces w
         join workspace_members m on m.workspace_id = w.id
         where w.id = $1 and m.user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(ws)
}

pub enum SyncOutcome {
    Updated(i32),
    /// Konflik: versi klien basi; kembalikan versi server terkini.
    Conflict(i32),
}

/// Update data workspace bila `base_version` == versi server (LWW dengan cek versi).
pub async fn update_workspace(
    pool: &Db,
    id: Uuid,
    user_id: Uuid,
    data: &serde_json::Value,
    base_version: i32,
) -> Result<Option<SyncOutcome>> {
    // Pastikan anggota + ambil versi terkini.
    let current: Option<(i32,)> = sqlx::query_as(
        "select w.version from workspaces w
         join workspace_members m on m.workspace_id = w.id
         where w.id = $1 and m.user_id = $2",
    )
    .bind(id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;

    let Some((ver,)) = current else {
        return Ok(None); // bukan anggota / tak ada
    };
    if base_version != ver {
        return Ok(Some(SyncOutcome::Conflict(ver)));
    }
    let new_version = ver + 1;
    sqlx::query(
        "update workspaces set data = $1, version = $2, updated_at = now() where id = $3",
    )
    .bind(data)
    .bind(new_version)
    .bind(id)
    .execute(pool)
    .await?;
    Ok(Some(SyncOutcome::Updated(new_version)))
}

// ── Admin ───────────────────────────────────────────────────────────

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminUser {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub role: String,
    pub active: bool,
    pub created_at: DateTime<Utc>,
    pub last_active: Option<DateTime<Utc>>,
    pub workspace_count: i64,
}

#[derive(Debug, Serialize, FromRow)]
#[serde(rename_all = "camelCase")]
pub struct AdminWorkspace {
    pub id: Uuid,
    pub name: String,
    pub owner_email: String,
    pub member_count: i64,
    pub version: i32,
    pub updated_at: DateTime<Utc>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AdminStats {
    pub users: i64,
    pub workspaces: i64,
    pub active_sessions: i64,
}

pub async fn admin_list_users(pool: &Db) -> Result<Vec<AdminUser>> {
    let rows = sqlx::query_as::<_, AdminUser>(
        "select u.id, u.email, u.name, u.role, u.active, u.created_at, u.last_active,
                count(m.workspace_id) as workspace_count
         from users u
         left join workspace_members m on m.user_id = u.id
         group by u.id
         order by u.created_at",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn admin_list_workspaces(pool: &Db) -> Result<Vec<AdminWorkspace>> {
    let rows = sqlx::query_as::<_, AdminWorkspace>(
        "select w.id, w.name, o.email as owner_email,
                count(m.user_id) as member_count, w.version, w.updated_at
         from workspaces w
         join users o on o.id = w.owner_id
         left join workspace_members m on m.workspace_id = w.id
         group by w.id, o.email
         order by w.updated_at desc",
    )
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

pub async fn admin_stats(pool: &Db) -> Result<AdminStats> {
    let users = count_users(pool).await?;
    let (workspaces,): (i64,) = sqlx::query_as("select count(*) from workspaces")
        .fetch_one(pool)
        .await?;
    let (active_sessions,): (i64,) =
        sqlx::query_as("select count(*) from sessions where expires_at > now()")
            .fetch_one(pool)
            .await?;
    Ok(AdminStats {
        users,
        workspaces,
        active_sessions,
    })
}

pub async fn set_user_role(pool: &Db, id: Uuid, role: &str) -> Result<()> {
    sqlx::query("update users set role = $1 where id = $2")
        .bind(role)
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

pub async fn delete_workspace(pool: &Db, id: Uuid) -> Result<()> {
    sqlx::query("delete from workspaces where id = $1")
        .bind(id)
        .execute(pool)
        .await?;
    Ok(())
}

// ── Kolaborasi: role & comments ─────────────────────────────────────

/// Tambah/ubah anggota workspace.
pub async fn add_member(pool: &Db, workspace_id: Uuid, user_id: Uuid, role: &str) -> Result<()> {
    sqlx::query(
        "insert into workspace_members (workspace_id, user_id, role)
         values ($1, $2, $3)
         on conflict (workspace_id, user_id) do update set role = $3",
    )
    .bind(workspace_id)
    .bind(user_id)
    .bind(role)
    .execute(pool)
    .await?;
    Ok(())
}

pub async fn find_user_by_id(pool: &Db, id: Uuid) -> Result<Option<User>> {
    let user = sqlx::query_as::<_, User>("select * from users where id = $1")
        .bind(id)
        .fetch_optional(pool)
        .await?;
    Ok(user)
}

/// Role user pada workspace ('owner'|'editor'|'viewer'), None bila bukan anggota.
pub async fn member_role(pool: &Db, workspace_id: Uuid, user_id: Uuid) -> Result<Option<String>> {
    let row: Option<(String,)> = sqlx::query_as(
        "select role from workspace_members where workspace_id = $1 and user_id = $2",
    )
    .bind(workspace_id)
    .bind(user_id)
    .fetch_optional(pool)
    .await?;
    Ok(row.map(|r| r.0))
}

#[derive(Debug, Clone, FromRow, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CommentView {
    pub id: Uuid,
    pub request_id: String,
    pub body: String,
    pub created_at: DateTime<Utc>,
    pub author_id: Uuid,
    pub author_name: String,
    pub author_email: String,
}

pub async fn create_comment(
    pool: &Db,
    workspace_id: Uuid,
    request_id: &str,
    user_id: Uuid,
    body: &str,
) -> Result<CommentView> {
    let id: (Uuid,) = sqlx::query_as(
        "insert into comments (workspace_id, request_id, user_id, body)
         values ($1, $2, $3, $4) returning id",
    )
    .bind(workspace_id)
    .bind(request_id)
    .bind(user_id)
    .bind(body)
    .fetch_one(pool)
    .await?;
    get_comment(pool, id.0).await?.ok_or_else(|| anyhow::anyhow!("comment hilang"))
}

pub async fn get_comment(pool: &Db, id: Uuid) -> Result<Option<CommentView>> {
    let c = sqlx::query_as::<_, CommentView>(
        "select c.id, c.request_id, c.body, c.created_at,
                u.id as author_id, u.name as author_name, u.email as author_email
         from comments c join users u on u.id = c.user_id
         where c.id = $1",
    )
    .bind(id)
    .fetch_optional(pool)
    .await?;
    Ok(c)
}

pub async fn list_comments(
    pool: &Db,
    workspace_id: Uuid,
    request_id: &str,
) -> Result<Vec<CommentView>> {
    let rows = sqlx::query_as::<_, CommentView>(
        "select c.id, c.request_id, c.body, c.created_at,
                u.id as author_id, u.name as author_name, u.email as author_email
         from comments c join users u on u.id = c.user_id
         where c.workspace_id = $1 and c.request_id = $2
         order by c.created_at",
    )
    .bind(workspace_id)
    .bind(request_id)
    .fetch_all(pool)
    .await?;
    Ok(rows)
}

/// Hapus komentar bila milik user (author). Return true bila terhapus.
pub async fn delete_comment(pool: &Db, id: Uuid, user_id: Uuid) -> Result<bool> {
    let res = sqlx::query("delete from comments where id = $1 and user_id = $2")
        .bind(id)
        .bind(user_id)
        .execute(pool)
        .await?;
    Ok(res.rows_affected() > 0)
}
