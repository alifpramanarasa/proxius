// Wrapper command git (desktop). UI menyembunyikan jargon-nya.
import { invoke } from "@tauri-apps/api/core";

export interface GitStatus {
  is_repo: boolean;
  dirty: boolean;
  remote: string | null;
}

export const git = {
  available: () => invoke<boolean>("git_available"),
  init: (dir: string) => invoke("git_init", { dir }),
  setIdentity: (dir: string, name: string, email: string) =>
    invoke("git_set_identity", { dir, name, email }),
  setRemote: (dir: string, url: string) => invoke("git_set_remote", { dir, url }),
  currentRemote: (dir: string) => invoke<string | null>("git_current_remote", { dir }),
  commitAll: (dir: string, message: string) =>
    invoke<boolean>("git_commit_all", { dir, message }),
  push: (dir: string) => invoke<string>("git_push", { dir }),
  pull: (dir: string) => invoke<string>("git_pull", { dir }),
  clone: (url: string, dir: string) => invoke("git_clone", { url, dir }),
  status: (dir: string) => invoke<GitStatus>("git_status", { dir }),
};

/** Nama folder dari URL git (buang .git). */
export function repoNameFromUrl(url: string): string {
  const last = url.replace(/\/$/, "").split(/[/\\]/).pop() ?? "workspace";
  return last.replace(/\.git$/i, "") || "workspace";
}
