import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  TeamClient,
  type Comment,
  type TeamUser,
  type WorkspaceMeta,
} from "../lib/team";
import { CollabClient, type CollabEvent, type PresenceUser } from "../lib/collab";
import type { Collection, Environment } from "../lib/types";
import { useWorkspace } from "./workspace";
import { toast, confirmDialog } from "./ui";
import { tr } from "./i18n";

// Instance non-serializable disimpan di modul.
let client: TeamClient | null = null;
let collab: CollabClient | null = null;
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let applyingRemote = false; // cegah loop pull→push

export type SyncState = "offline" | "syncing" | "synced" | "error";

interface WorkspaceBlob {
  collections?: Collection[];
  environments?: Environment[];
}

interface TeamState {
  baseUrl: string;
  token: string | null;
  user: TeamUser | null;
  status: "disconnected" | "connecting" | "connected";
  sync: SyncState;
  workspaces: WorkspaceMeta[];
  workspaceId: string | null;
  version: number;
  presence: PresenceUser[];
  comments: Record<string, Comment[]>;
  error: string | null;

  setBaseUrl: (u: string) => void;
  restore: () => Promise<void>;
  register: (email: string, password: string, name?: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
  refreshWorkspaces: () => Promise<void>;
  openWorkspace: (id: string) => Promise<void>;
  push: (manual?: boolean) => Promise<void>;
  pull: (manual?: boolean) => Promise<void>;
  addMember: (email: string, role: "owner" | "editor" | "viewer") => Promise<void>;
  loadComments: (requestId: string) => Promise<void>;
  postComment: (requestId: string, body: string) => void;
}

function ensureClient(baseUrl: string, token: string | null): TeamClient {
  if (!client || client.baseUrl !== baseUrl) client = new TeamClient(baseUrl, token);
  client.token = token;
  return client;
}

function localBlob(): WorkspaceBlob {
  const { collections, environments } = useWorkspace.getState();
  return { collections, environments };
}

export const useTeam = create<TeamState>()(
  persist(
    (set, get) => {
      function handleEvent(e: CollabEvent) {
        const me = get().user?.id;
        if (e.type === "presence") set({ presence: e.users });
        else if (e.type === "welcome") set({ status: "connected", sync: "synced" });
        else if (e.type === "changed") {
          if (e.by !== me) get().pull();
        } else if (e.type === "comment") {
          const rid = e.comment.requestId;
          set((s) => {
            const list = s.comments[rid] ?? [];
            if (list.some((c) => c.id === e.comment.id)) return s;
            return { comments: { ...s.comments, [rid]: [...list, e.comment] } };
          });
        }
      }

      function connectRealtime() {
        const { baseUrl, workspaceId, token } = get();
        if (!workspaceId || !token) return;
        collab?.close();
        collab = new CollabClient(baseUrl, workspaceId, token, handleEvent);
        collab.connect();
      }

      return {
        baseUrl: "http://localhost:8080",
        token: null,
        user: null,
        status: "disconnected",
        sync: "offline",
        workspaces: [],
        workspaceId: null,
        version: 0,
        presence: [],
        comments: {},
        error: null,

        setBaseUrl: (u) => set({ baseUrl: u.replace(/\/$/, "") }),

        restore: async () => {
          const { baseUrl, token, workspaceId } = get();
          if (!token) return;
          try {
            const c = ensureClient(baseUrl, token);
            const user = await c.me();
            set({ user });
            await get().refreshWorkspaces();
            if (workspaceId && get().workspaces.some((w) => w.id === workspaceId)) {
              await get().openWorkspace(workspaceId);
            }
          } catch {
            set({ token: null, user: null, status: "disconnected", sync: "offline" });
          }
        },

        register: async (email, password, name) => {
          set({ error: null });
          const c = ensureClient(get().baseUrl, null);
          const r = await c.register(email, password, name);
          set({ token: r.token, user: r.user });
          await get().refreshWorkspaces();
          const first = get().workspaces[0];
          if (first) await get().openWorkspace(first.id);
        },

        login: async (email, password) => {
          set({ error: null });
          const c = ensureClient(get().baseUrl, null);
          const r = await c.login(email, password);
          set({ token: r.token, user: r.user });
          await get().refreshWorkspaces();
          const first = get().workspaces[0];
          if (first) await get().openWorkspace(first.id);
        },

        logout: () => {
          collab?.close();
          collab = null;
          if (pushTimer) clearTimeout(pushTimer);
          set({
            token: null,
            user: null,
            status: "disconnected",
            sync: "offline",
            workspaces: [],
            workspaceId: null,
            presence: [],
            comments: {},
            error: null,
          });
        },

        refreshWorkspaces: async () => {
          const c = ensureClient(get().baseUrl, get().token);
          set({ workspaces: await c.workspaces() });
        },

        openWorkspace: async (id) => {
          set({ workspaceId: id, status: "connecting", sync: "syncing", comments: {} });
          try {
            const c = ensureClient(get().baseUrl, get().token);
            const ws = await c.workspace(id);
            const blob = (ws.data ?? {}) as WorkspaceBlob;
            const serverEmpty =
              ws.version === 0 && (blob.collections ?? []).length === 0;
            const localHasData = useWorkspace.getState().collections.length > 0;

            if (serverEmpty && localHasData) {
              // Server kosong → unggah workspace lokal sebagai isi awal.
              set({ version: 0 });
              await get().push();
              toast.success(tr("localDataUploaded", { name: ws.name }));
            } else {
              // Server punya data. Bila lokal juga ada isi, konfirmasi dulu
              // karena menyambung akan mengganti collections lokal.
              if (localHasData) {
                const okReplace = await confirmDialog({
                  title: tr("replaceLocalTitle"),
                  message: tr("replaceLocalMsg", { name: ws.name }),
                  confirmLabel: tr("replaceWithServer"),
                  danger: true,
                });
                if (!okReplace) {
                  set({ workspaceId: null, status: "disconnected", sync: "offline" });
                  return;
                }
              }
              applyingRemote = true;
              useWorkspace
                .getState()
                .replaceData(blob.collections ?? [], blob.environments ?? []);
              applyingRemote = false;
              set({ version: ws.version });
              toast.info(tr("connectedToWorkspace", { name: ws.name }));
            }
            connectRealtime();
            set({ status: "connected", sync: "synced" });
            // Ingat room ini sebagai room team untuk project aktif.
            const ws2 = useWorkspace.getState();
            ws2.updateProjectSync(ws2.activeProjectId, {
              teamRoom: id,
              teamServerUrl: get().baseUrl,
            });
          } catch (e) {
            set({ sync: "error", error: msg(e) });
            toast.error(tr("openWorkspaceFailed", { msg: msg(e) }));
          }
        },

        pull: async (manual) => {
          const { workspaceId } = get();
          if (!workspaceId) return;
          set({ sync: "syncing" });
          try {
            const c = ensureClient(get().baseUrl, get().token);
            const ws = await c.workspace(workspaceId);
            const blob = (ws.data ?? {}) as WorkspaceBlob;
            applyingRemote = true;
            useWorkspace
              .getState()
              .replaceData(blob.collections ?? [], blob.environments ?? []);
            applyingRemote = false;
            set({ version: ws.version, sync: "synced" });
            if (manual) toast.success(tr("pulledFromServer"));
          } catch (e) {
            set({ sync: "error", error: msg(e) });
            if (manual) toast.error(tr("pullFailed", { msg: msg(e) }));
          }
        },

        push: async (manual) => {
          const { workspaceId } = get();
          if (!workspaceId) return;
          set({ sync: "syncing" });
          try {
            const c = ensureClient(get().baseUrl, get().token);
            const r = await c.pushWorkspace(workspaceId, localBlob(), get().version);
            set({ version: r.version, sync: "synced", error: null });
            collab?.notifySync(r.version);
            if (manual) toast.success(tr("pushedToServer"));
          } catch (e) {
            if (msg(e).includes("conflict")) {
              // Anggota lain lebih dulu → tarik versi server (server menang).
              await get().pull();
              toast.info(tr("changesFromOthersSynced"));
            } else {
              set({ sync: "error", error: msg(e) });
              if (manual) toast.error(tr("pushFailed", { msg: msg(e) }));
            }
          }
        },

        addMember: async (email, role) => {
          const { workspaceId } = get();
          if (!workspaceId) return;
          const c = ensureClient(get().baseUrl, get().token);
          await c.addMember(workspaceId, email, role);
        },

        loadComments: async (requestId) => {
          const { workspaceId } = get();
          if (!workspaceId) return;
          const c = ensureClient(get().baseUrl, get().token);
          const list = await c.listComments(workspaceId, requestId);
          set((s) => ({ comments: { ...s.comments, [requestId]: list } }));
        },

        postComment: (requestId, body) => {
          collab?.comment(requestId, body);
        },
      };
    },
    {
      name: "proxius-team",
      partialize: (s) => ({
        baseUrl: s.baseUrl,
        token: s.token,
        workspaceId: s.workspaceId,
      }),
    },
  ),
);

// Auto-push: saat tersambung, perubahan lokal (debounce) otomatis dikirim.
useWorkspace.subscribe((state, prev) => {
  // Ganti project → putus koneksi room lama, arahkan ke room project baru
  // (tidak auto-connect; user buka sendiri). Jangan push data ke room lama.
  if (state.activeProjectId !== prev.activeProjectId) {
    collab?.close();
    collab = null;
    if (pushTimer) clearTimeout(pushTimer);
    const proj = state.projects.find((p) => p.id === state.activeProjectId);
    useTeam.setState({
      status: "disconnected",
      sync: "offline",
      workspaceId: proj?.teamRoom ?? null,
      presence: [],
      version: 0,
    });
    return;
  }
  if (applyingRemote) return;
  if (state.collections === prev.collections && state.environments === prev.environments)
    return;
  const t = useTeam.getState();
  if (t.status !== "connected" || !t.workspaceId) return;
  useTeam.setState({ sync: "syncing" });
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => useTeam.getState().push(), 800);
});

function msg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
