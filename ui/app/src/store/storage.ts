import { create } from "zustand";
import { persist } from "zustand/middleware";
import { isTauri } from "../lib/api";
import { tauriFs, pickFolder } from "../lib/fs-tauri";
import { loadWorkspace, saveWorkspace } from "../lib/fsstore";
import { git, repoNameFromUrl } from "../lib/git";
import { useWorkspace } from "./workspace";
import { toast } from "./ui";
import { tr } from "./i18n";

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let gitTimer: ReturnType<typeof setTimeout> | null = null;
let loading = false; // cegah auto-save saat memuat dari folder

export type StorageStatus = "local" | "syncing" | "saved" | "error";
export type GitStatus = "off" | "syncing" | "synced" | "error";

export interface GitIdentity {
  name: string;
  email: string;
}

interface StorageState {
  dir: string | null;
  status: StorageStatus;
  gitRemote: string | null;
  gitStatus: GitStatus;
  busy: boolean;
  identity: GitIdentity;

  setIdentity: (id: GitIdentity) => void;
  chooseFolder: () => Promise<void>;
  saveNow: () => Promise<void>;
  detach: () => void;
  restore: () => Promise<void>;

  connectGit: (url: string) => Promise<void>;
  cloneGit: (url: string) => Promise<void>;
  syncNow: () => Promise<void>;
}

/** Terapkan identitas git (nama+email) ke repo di `dir`, bila terisi. */
async function applyIdentity(dir: string) {
  const { name, email } = useStorage.getState().identity;
  if (name.trim() && email.trim()) {
    await git.setIdentity(dir, name.trim(), email.trim()).catch(() => {});
  }
}

export function folderName(p: string): string {
  return p.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? "Workspace";
}

/** Simpan config sync (folder/git) ke ProjectMeta project AKTIF — supaya
 * setiap project punya folder & remote-nya sendiri. */
function syncBack(patch: { folderPath?: string; gitRemote?: string }) {
  const ws = useWorkspace.getState();
  ws.updateProjectSync(ws.activeProjectId, patch);
}

async function writeCurrent(dir: string) {
  const { collections, environments, flows } = useWorkspace.getState();
  await saveWorkspace(tauriFs, dir, { name: folderName(dir), collections, environments, flows });
}

async function loadInto(dir: string) {
  loading = true;
  try {
    const ws = await loadWorkspace(tauriFs, dir);
    useWorkspace.getState().replaceData(ws.collections, ws.environments, ws.flows);
  } finally {
    loading = false;
  }
}

export const useStorage = create<StorageState>()(
  persist(
    (set, get) => ({
      dir: null,
      status: "local",
      gitRemote: null,
      gitStatus: "off",
      busy: false,
      identity: { name: "", email: "" },

      setIdentity: (identity) => set({ identity }),

      chooseFolder: async () => {
        if (!isTauri()) {
          toast.error(tr("foldersDesktopOnly"));
          return;
        }
        const dir = await pickFolder();
        if (!dir) return;
        try {
          set({ status: "syncing" });
          const hasWs = await tauriFs.exists(`${dir}/proxius.json`);
          if (hasWs) {
            await loadInto(dir);
            toast.success(tr("workspaceOpenedFromFolder"));
          } else {
            await writeCurrent(dir);
            toast.success(tr("workspaceSavedToFolder"));
          }
          const st = await git.status(dir).catch(() => null);
          set({
            dir,
            status: "saved",
            gitRemote: st?.remote ?? null,
            gitStatus: st?.remote ? "synced" : "off",
          });
          syncBack({ folderPath: dir, gitRemote: st?.remote ?? undefined });
        } catch (e) {
          set({ status: "error" });
          toast.error(tr("genericFailed", { msg: msg(e) }));
        }
      },

      saveNow: async () => {
        const { dir, gitRemote } = get();
        if (!dir) return;
        try {
          set({ status: "syncing" });
          await writeCurrent(dir);
          set({ status: "saved" });
          if (gitRemote) scheduleGitPush();
        } catch (e) {
          set({ status: "error" });
          toast.error(tr("saveFailed", { msg: msg(e) }));
        }
      },

      detach: () => {
        set({ dir: null, status: "local", gitRemote: null, gitStatus: "off" });
        syncBack({ folderPath: undefined, gitRemote: undefined });
      },

      restore: async () => {
        const { dir } = get();
        if (!dir || !isTauri()) return;
        try {
          if (await tauriFs.exists(`${dir}/proxius.json`)) {
            await loadInto(dir);
            const st = await git.status(dir).catch(() => null);
            set({
              status: "saved",
              gitRemote: st?.remote ?? null,
              gitStatus: st?.remote ? "synced" : "off",
            });
            if (st?.remote) get().syncNow();
          }
        } catch {
          set({ status: "error" });
        }
      },

      connectGit: async (url) => {
        const { dir } = get();
        if (!dir || !url.trim()) return;
        set({ busy: true, gitStatus: "syncing" });
        try {
          if (!(await git.available())) throw new Error(tr("gitNotInstalled"));
          await git.init(dir);
          await applyIdentity(dir);
          await git.setRemote(dir, url.trim());
          await writeCurrent(dir);
          await git.commitAll(dir, "Proxius: initial");
          await git.push(dir);
          set({ gitRemote: url.trim(), gitStatus: "synced" });
          syncBack({ gitRemote: url.trim() });
          toast.success(tr("gitConnectedPushed"));
        } catch (e) {
          set({ gitStatus: "error" });
          toast.error(tr("gitFailed", { msg: msg(e) }));
        } finally {
          set({ busy: false });
        }
      },

      cloneGit: async (url) => {
        if (!isTauri()) {
          toast.error(tr("cloneDesktopOnly"));
          return;
        }
        if (!url.trim()) return;
        const parent = await pickFolder();
        if (!parent) return;
        set({ busy: true, gitStatus: "syncing" });
        try {
          if (!(await git.available())) throw new Error(tr("gitNotInstalled"));
          const target = `${parent}/${repoNameFromUrl(url)}`;
          await git.clone(url.trim(), target);
          await applyIdentity(target);
          await loadInto(target);
          const st = await git.status(target).catch(() => null);
          set({
            dir: target,
            status: "saved",
            gitRemote: st?.remote ?? url.trim(),
            gitStatus: "synced",
          });
          syncBack({ folderPath: target, gitRemote: st?.remote ?? url.trim() });
          toast.success(tr("teamWorkspaceOpened"));
        } catch (e) {
          set({ gitStatus: "error" });
          toast.error(tr("cloneFailed", { msg: msg(e) }));
        } finally {
          set({ busy: false });
        }
      },

      syncNow: async () => {
        const { dir, gitRemote } = get();
        if (!dir || !gitRemote) return;
        set({ gitStatus: "syncing" });
        try {
          await git.commitAll(dir, "Proxius: update");
          await git.pull(dir);
          await loadInto(dir); // terapkan perubahan tim ke UI
          await git.push(dir);
          set({ gitStatus: "synced" });
        } catch (e) {
          set({ gitStatus: "error" });
          toast.error(tr("syncFailed", { msg: msg(e) }));
        }
      },
    }),
    {
      name: "proxius-storage",
      partialize: (s) => ({ dir: s.dir, gitRemote: s.gitRemote, identity: s.identity }),
    },
  ),
);

function scheduleGitPush() {
  useStorage.setState({ gitStatus: "syncing" });
  if (gitTimer) clearTimeout(gitTimer);
  gitTimer = setTimeout(async () => {
    const { dir } = useStorage.getState();
    if (!dir) return;
    try {
      await git.commitAll(dir, "Proxius: update");
      await git.push(dir);
      useStorage.setState({ gitStatus: "synced" });
    } catch (e) {
      useStorage.setState({ gitStatus: "error" });
      toast.error(tr("gitPushFailed", { msg: msg(e) }));
    }
  }, 2500);
}

// Pindah project → arahkan koneksi folder/git ke config project baru.
// (Data lokal sudah aman di localStorage; folder = mirror sekunder.)
function repointStorage(projectId: string) {
  const ws = useWorkspace.getState();
  const proj = ws.projects.find((p) => p.id === projectId);
  useStorage.setState({
    dir: proj?.folderPath ?? null,
    gitRemote: proj?.gitRemote ?? null,
    status: proj?.folderPath ? "saved" : "local",
    gitStatus: proj?.gitRemote ? "synced" : "off",
  });
}

// Auto-save ke folder saat berubah (debounce).
useWorkspace.subscribe((state, prev) => {
  if (state.activeProjectId !== prev.activeProjectId) {
    // Ganti project, bukan edit — pindahkan koneksi, jangan auto-save.
    repointStorage(state.activeProjectId);
    return;
  }
  if (loading) return;
  if (
    state.collections === prev.collections &&
    state.environments === prev.environments &&
    state.flows === prev.flows
  )
    return;
  const st = useStorage.getState();
  if (!st.dir || !isTauri()) return;
  useStorage.setState({ status: "syncing" });
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => useStorage.getState().saveNow(), 600);
});

// Rekonsiliasi sekali saat load: kalau project aktif belum punya folderPath
// tapi useStorage (versi lama) sudah, adopsi ke project; sebaliknya arahkan
// koneksi ke config project aktif.
(function reconcileStorageWithProject() {
  const ws = useWorkspace.getState();
  const active = ws.projects.find((p) => p.id === ws.activeProjectId);
  if (!active) return;
  const st = useStorage.getState();
  if (!active.folderPath && st.dir) {
    ws.updateProjectSync(active.id, {
      folderPath: st.dir,
      gitRemote: st.gitRemote ?? undefined,
    });
  } else {
    repointStorage(active.id);
  }
})();

// Tarik perubahan tim saat jendela kembali fokus.
if (typeof window !== "undefined") {
  window.addEventListener("focus", () => {
    const st = useStorage.getState();
    if (st.dir && st.gitRemote && !st.busy) st.syncNow();
  });
}

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
