//! Operasi git minimal (shell ke CLI `git`) untuk sync. UI menyembunyikan
//! jargon: user cuma lihat "tersinkron", detail commit/push/pull disembunyikan.

use std::process::Command;

use serde::Serialize;

fn run(dir: &str, args: &[&str]) -> Result<String, String> {
    let out = Command::new("git")
        .args(args)
        .current_dir(dir)
        .output()
        .map_err(|e| format!("git tidak tersedia: {e}"))?;
    if out.status.success() {
        Ok(String::from_utf8_lossy(&out.stdout).to_string())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

/// Pastikan ada identitas commit (fallback lokal bila global belum diset).
fn ensure_identity(dir: &str) {
    if run(dir, &["config", "user.email"]).is_err() {
        let _ = run(dir, &["config", "user.email", "you@proxius.local"]);
        let _ = run(dir, &["config", "user.name", "Proxius User"]);
    }
}

#[tauri::command]
pub fn git_available() -> bool {
    Command::new("git")
        .arg("--version")
        .output()
        .map(|o| o.status.success())
        .unwrap_or(false)
}

/// Inisialisasi repo di folder workspace (branch default `main`).
#[tauri::command]
pub fn git_init(dir: String) -> Result<(), String> {
    if run(&dir, &["rev-parse", "--is-inside-work-tree"]).is_err() {
        run(&dir, &["init"])?;
        let _ = run(&dir, &["symbolic-ref", "HEAD", "refs/heads/main"]);
        ensure_identity(&dir);
    }
    // Paksa LF + tandai .pxr.json sebagai teks → diff bersih lintas-OS.
    let attrs = std::path::Path::new(&dir).join(".gitattributes");
    if !attrs.exists() {
        let _ = std::fs::write(&attrs, "* text=auto eol=lf\n*.json text eol=lf\n");
    }
    Ok(())
}

/// Setel identitas commit (nama + email) untuk repo ini.
#[tauri::command]
pub fn git_set_identity(dir: String, name: String, email: String) -> Result<(), String> {
    run(&dir, &["config", "user.name", &name])?;
    run(&dir, &["config", "user.email", &email])?;
    Ok(())
}

#[tauri::command]
pub fn git_set_remote(dir: String, url: String) -> Result<(), String> {
    let _ = run(&dir, &["remote", "remove", "origin"]);
    run(&dir, &["remote", "add", "origin", &url])?;
    Ok(())
}

#[tauri::command]
pub fn git_current_remote(dir: String) -> Option<String> {
    run(&dir, &["remote", "get-url", "origin"])
        .ok()
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
}

/// Commit semua perubahan. Return true bila ada yang di-commit.
#[tauri::command]
pub fn git_commit_all(dir: String, message: String) -> Result<bool, String> {
    ensure_identity(&dir);
    run(&dir, &["add", "-A"])?;
    if run(&dir, &["status", "--porcelain"])?.trim().is_empty() {
        return Ok(false);
    }
    run(&dir, &["commit", "-m", &message])?;
    Ok(true)
}

/// Dorong branch saat ini (set upstream).
#[tauri::command]
pub fn git_push(dir: String) -> Result<String, String> {
    run(&dir, &["push", "-u", "origin", "HEAD"])
}

/// Tarik dari remote (merge, no editor). Autostash agar aman bila tree kotor.
#[tauri::command]
pub fn git_pull(dir: String) -> Result<String, String> {
    run(
        &dir,
        &["-c", "rebase.autoStash=true", "pull", "--no-edit", "--no-rebase", "origin", "HEAD"],
    )
}

/// Clone remote ke folder tujuan (harus belum ada / kosong).
#[tauri::command]
pub fn git_clone(url: String, dir: String) -> Result<(), String> {
    let out = Command::new("git")
        .args(["clone", &url, &dir])
        .output()
        .map_err(|e| format!("git tidak tersedia: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}

#[derive(Serialize)]
pub struct GitStatus {
    pub is_repo: bool,
    pub dirty: bool,
    pub remote: Option<String>,
}

#[tauri::command]
pub fn git_status(dir: String) -> GitStatus {
    let is_repo = run(&dir, &["rev-parse", "--is-inside-work-tree"]).is_ok();
    if !is_repo {
        return GitStatus { is_repo: false, dirty: false, remote: None };
    }
    let dirty = run(&dir, &["status", "--porcelain"])
        .map(|s| !s.trim().is_empty())
        .unwrap_or(false);
    let remote = git_current_remote(dir);
    GitStatus { is_repo, dirty, remote }
}
