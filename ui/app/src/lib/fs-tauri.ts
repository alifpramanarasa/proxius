// FsAdapter berbasis command Tauri (desktop). Hanya tersedia di dalam Tauri.
import { invoke } from "@tauri-apps/api/core";
import { open } from "@tauri-apps/plugin-dialog";
import type { FsAdapter } from "./fsstore";

interface RustDirEntry {
  name: string;
  is_dir: boolean;
}

export const tauriFs: FsAdapter = {
  readDir: async (path) => {
    const entries = await invoke<RustDirEntry[]>("fs_read_dir", { path });
    return entries.map((e) => ({ name: e.name, isDir: e.is_dir }));
  },
  readTextFile: (path) => invoke<string>("fs_read_text", { path }),
  writeTextFile: (path, content) => invoke("fs_write_text", { path, content }),
  mkdir: (path) => invoke("fs_mkdir", { path }),
  exists: (path) => invoke<boolean>("fs_exists", { path }),
  remove: (path) => invoke("fs_remove", { path }),
};

/** Buka dialog pilih folder. Return path absolut atau null. */
export async function pickFolder(): Promise<string | null> {
  const result = await open({ directory: true, multiple: false });
  return typeof result === "string" ? result : null;
}

/** Buka dialog pilih satu file. Return path absolut atau null. */
export async function pickFile(): Promise<string | null> {
  const result = await open({ directory: false, multiple: false });
  return typeof result === "string" ? result : null;
}
