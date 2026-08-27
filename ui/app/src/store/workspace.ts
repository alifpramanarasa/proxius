import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  emptyRequest,
  sampleRequest,
  uid,
  type Collection,
  type Environment,
  type Flow,
  type HistoryEntry,
  type HttpRequest,
  type HttpResponse,
  type ResponseExample,
  type TreeNode,
} from "../lib/types";
import {
  cloneWithNewIds,
  findNode,
  insertAfter,
  insertNode,
  removeNode,
  updateNode,
} from "./tree";

/** Terapkan tema ke <html data-theme>. Dipanggil saat toggle & saat rehydrate. */
export function applyTheme(theme: "dark" | "light") {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.theme = theme;
  }
}

export interface Tab {
  id: string;
  request: HttpRequest;
  response?: HttpResponse;
  /** id node collection asal (bila request tersimpan). */
  savedNodeId?: string;
  savedCollectionId?: string;
  dirty: boolean;
}

/** Metadata sebuah project (model Bruno: 1 project = 1 folder/repo).
 * Data-nya (collections/environments/flows) disimpan terpisah — lihat
 * ProjectBundle & projectData. Config sync melekat per-project. */
export interface ProjectMeta {
  id: string;
  name: string;
  /** Folder di disk (desktop) — juga jadi git repo project ini. */
  folderPath?: string;
  /** Remote git project ini. */
  gitRemote?: string;
  /** Server tim + room untuk kolaborasi realtime project ini. */
  teamServerUrl?: string;
  teamRoom?: string;
}

/** Isi kerja satu project — dipertukarkan masuk/keluar field aktif store
 * saat berpindah project (project non-aktif ditumpuk di projectData). */
export interface ProjectBundle {
  collections: Collection[];
  environments: Environment[];
  activeEnvId: string | null;
  flows: Flow[];
  history: HistoryEntry[];
  tabs: Tab[];
  activeTabId: string | null;
}

function emptyBundle(): ProjectBundle {
  const req = emptyRequest();
  const tab: Tab = { id: uid("tab"), request: req, dirty: false };
  return {
    collections: [],
    environments: [],
    activeEnvId: null,
    flows: [],
    history: [],
    tabs: [tab],
    activeTabId: tab.id,
  };
}

function currentBundle(s: WorkspaceState): ProjectBundle {
  return {
    collections: s.collections,
    environments: s.environments,
    activeEnvId: s.activeEnvId,
    flows: s.flows,
    history: s.history,
    tabs: s.tabs,
    activeTabId: s.activeTabId,
  };
}

interface WorkspaceState {
  // ── Project (workspace) layer ────────────────────────────────────
  /** Daftar project. Data project AKTIF ada di field kerja di bawah;
   * project lain ditumpuk di projectData. */
  projects: ProjectMeta[];
  activeProjectId: string;
  /** Stash isi project NON-aktif (id → bundle). */
  projectData: Record<string, ProjectBundle>;
  addProject: (name: string) => string;
  switchProject: (id: string) => void;
  renameProject: (id: string, name: string) => void;
  deleteProject: (id: string) => void;
  updateProjectSync: (id: string, patch: Partial<ProjectMeta>) => void;

  // ── Field kerja project aktif ────────────────────────────────────
  collections: Collection[];
  environments: Environment[];
  activeEnvId: string | null;
  flows: Flow[];
  history: HistoryEntry[];
  tabs: Tab[];
  activeTabId: string | null;
  /** Minta RequestEditor pindah ke sub-tab tertentu (transient). */
  focusTab: string | null;
  /** Flow yang sedang disusun AI (transient; target tool set_flow_steps). */
  aiFlowId: string | null;
  /** Tema tampilan. */
  theme: "dark" | "light";
  setTheme: (theme: "dark" | "light") => void;
  toggleTheme: () => void;

  // tabs
  newTab: (request?: HttpRequest) => void;
  closeTab: (id: string) => void;
  setActiveTab: (id: string) => void;
  patchActiveRequest: (patch: Partial<HttpRequest>) => void;
  setTabResponse: (tabId: string, response: HttpResponse) => void;
  /** Tambah contoh kosong (editable) ke request tab aktif. */
  addBlankExample: () => void;

  // collections
  openRequestNode: (collectionId: string, nodeId: string) => void;
  saveActiveTab: (collectionId?: string) => void;
  addCollection: (name: string) => string;
  addFolder: (collectionId: string, parentId: string | null, name: string) => void;
  addRequestNode: (
    collectionId: string,
    parentId: string | null,
    request?: HttpRequest,
  ) => void;
  renameNode: (collectionId: string, nodeId: string, name: string) => void;
  duplicateNode: (collectionId: string, nodeId: string) => void;
  setCollectionAuth: (collectionId: string, auth: import("../lib/types").Auth) => void;
  setCollectionScripts: (
    collectionId: string,
    scripts: import("../lib/types").Scripts,
  ) => void;
  setFolderAuth: (collectionId: string, nodeId: string, auth: import("../lib/types").Auth) => void;
  deleteNode: (collectionId: string, nodeId: string) => void;
  deleteCollection: (id: string) => void;
  importCollection: (collection: Collection) => void;
  setFocusTab: (tab: string | null) => void;

  // flows
  addFlow: (name: string) => string;
  updateFlow: (flow: Flow) => void;
  deleteFlow: (id: string) => void;
  setAiFlowId: (id: string | null) => void;

  // environments
  addEnvironment: (name: string) => void;
  updateEnvironment: (env: Environment) => void;
  deleteEnvironment: (id: string) => void;
  setActiveEnv: (id: string | null) => void;

  // history
  addHistory: (entry: HistoryEntry) => void;
  clearHistory: () => void;

  // team sync
  replaceData: (collections: Collection[], environments: Environment[], flows?: Flow[]) => void;
}

function seedCollections(): Collection[] {
  const req = sampleRequest();
  return [
    {
      id: uid("col"),
      name: "My Collection",
      nodes: [{ id: uid("node"), type: "request", name: req.name, request: req }],
    },
  ];
}

function firstTab(collections: Collection[]): Tab {
  const first = collections[0]?.nodes.find((n) => n.type === "request");
  const request =
    first && first.type === "request" ? first.request : sampleRequest();
  return { id: uid("tab"), request: structuredClone(request), dirty: false };
}

const seededCollections = seedCollections();
const seededTab = firstTab(seededCollections);
const seededProjectId = uid("proj");

export const useWorkspace = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      projects: [{ id: seededProjectId, name: "Default" }],
      activeProjectId: seededProjectId,
      projectData: {},

      addProject: (name) => {
        const id = uid("proj");
        const bundle = emptyBundle();
        set((s) => ({
          projects: [...s.projects, { id, name: name || "New Project" }],
          projectData: { ...s.projectData, [id]: bundle },
        }));
        get().switchProject(id);
        return id;
      },

      switchProject: (id) =>
        set((s) => {
          if (id === s.activeProjectId) return {};
          // Tumpuk project aktif saat ini, keluarkan target dari tumpukan.
          const stash = { ...s.projectData, [s.activeProjectId]: currentBundle(s) };
          const next = stash[id] ?? emptyBundle();
          delete stash[id];
          return {
            activeProjectId: id,
            projectData: stash,
            collections: next.collections,
            environments: next.environments,
            activeEnvId: next.activeEnvId,
            flows: next.flows,
            history: next.history,
            tabs: next.tabs,
            activeTabId: next.activeTabId,
          };
        }),

      renameProject: (id, name) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, name } : p)),
        })),

      deleteProject: (id) =>
        set((s) => {
          if (s.projects.length <= 1) return {}; // selalu sisakan satu
          const projects = s.projects.filter((p) => p.id !== id);
          const stash = { ...s.projectData };
          delete stash[id];
          if (id !== s.activeProjectId) {
            return { projects, projectData: stash };
          }
          // Menghapus project aktif → pindah ke project pertama tersisa.
          const target = projects[0].id;
          const next = stash[target] ?? emptyBundle();
          delete stash[target];
          return {
            projects,
            projectData: stash,
            activeProjectId: target,
            collections: next.collections,
            environments: next.environments,
            activeEnvId: next.activeEnvId,
            flows: next.flows,
            history: next.history,
            tabs: next.tabs,
            activeTabId: next.activeTabId,
          };
        }),

      updateProjectSync: (id, patch) =>
        set((s) => ({
          projects: s.projects.map((p) => (p.id === id ? { ...p, ...patch } : p)),
        })),

      collections: seededCollections,
      environments: [],
      activeEnvId: null,
      flows: [],
      history: [],
      tabs: [seededTab],
      activeTabId: seededTab.id,
      focusTab: null,
      aiFlowId: null,
      theme: "dark",

      setTheme: (theme) => {
        applyTheme(theme);
        set({ theme });
      },
      toggleTheme: () => {
        const theme = get().theme === "dark" ? "light" : "dark";
        applyTheme(theme);
        set({ theme });
      },

      newTab: (request) => {
        const tab: Tab = {
          id: uid("tab"),
          request: request ?? emptyRequest(),
          dirty: false,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      },

      closeTab: (id) =>
        set((s) => {
          const tabs = s.tabs.filter((t) => t.id !== id);
          const activeTabId =
            s.activeTabId === id ? (tabs.at(-1)?.id ?? null) : s.activeTabId;
          return { tabs, activeTabId };
        }),

      setActiveTab: (id) => set({ activeTabId: id }),

      patchActiveRequest: (patch) =>
        set((s) => ({
          tabs: s.tabs.map((t) =>
            t.id === s.activeTabId
              ? { ...t, request: { ...t.request, ...patch }, dirty: true }
              : t,
          ),
        })),

      setTabResponse: (tabId, response) =>
        set((s) => ({
          tabs: s.tabs.map((t) => (t.id === tabId ? { ...t, response } : t)),
        })),

      addBlankExample: () =>
        set((s) => {
          const ex: ResponseExample = {
            id: uid("ex"),
            name: "New Example",
            status: 200,
            statusText: "OK",
            headers: [],
            body: "",
            durationMs: 0,
            sizeBytes: 0,
            savedAt: Date.now(),
          };
          return {
            tabs: s.tabs.map((t) =>
              t.id === s.activeTabId
                ? {
                    ...t,
                    request: { ...t.request, examples: [...(t.request.examples ?? []), ex] },
                    dirty: true,
                  }
                : t,
            ),
          };
        }),

      openRequestNode: (collectionId, nodeId) => {
        const col = get().collections.find((c) => c.id === collectionId);
        if (!col) return;
        const node = findNode(col.nodes, nodeId);
        if (!node || node.type !== "request") return;
        const existing = get().tabs.find((t) => t.savedNodeId === nodeId);
        if (existing) {
          set({ activeTabId: existing.id });
          return;
        }
        const tab: Tab = {
          id: uid("tab"),
          request: structuredClone(node.request),
          savedNodeId: nodeId,
          savedCollectionId: collectionId,
          dirty: false,
        };
        set((s) => ({ tabs: [...s.tabs, tab], activeTabId: tab.id }));
      },

      saveActiveTab: (collectionId) => {
        const s = get();
        const tab = s.tabs.find((t) => t.id === s.activeTabId);
        if (!tab) return;

        // Sudah terikat ke node tersimpan → update di tempat.
        if (tab.savedNodeId && tab.savedCollectionId) {
          set({
            collections: s.collections.map((c) =>
              c.id === tab.savedCollectionId
                ? {
                    ...c,
                    nodes: updateNode(c.nodes, tab.savedNodeId!, (n) =>
                      n.type === "request"
                        ? { ...n, name: tab.request.name, request: tab.request }
                        : n,
                    ),
                  }
                : c,
            ),
            tabs: s.tabs.map((t) => (t.id === tab.id ? { ...t, dirty: false } : t)),
          });
          return;
        }

        // Simpan baru ke collection target (default: pertama).
        const target = collectionId ?? s.collections[0]?.id;
        if (!target) return;
        const nodeId = uid("node");
        const node: TreeNode = {
          id: nodeId,
          type: "request",
          name: tab.request.name,
          request: tab.request,
        };
        set({
          collections: s.collections.map((c) =>
            c.id === target ? { ...c, nodes: [...c.nodes, node] } : c,
          ),
          tabs: s.tabs.map((t) =>
            t.id === tab.id
              ? {
                  ...t,
                  savedNodeId: nodeId,
                  savedCollectionId: target,
                  dirty: false,
                }
              : t,
          ),
        });
      },

      addCollection: (name) => {
        const id = uid("col");
        set((s) => ({
          collections: [...s.collections, { id, name, nodes: [] }],
        }));
        return id;
      },

      addFolder: (collectionId, parentId, name) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? {
                  ...c,
                  nodes: insertNode(c.nodes, parentId, {
                    id: uid("node"),
                    type: "folder",
                    name,
                    children: [],
                  }),
                }
              : c,
          ),
        })),

      addRequestNode: (collectionId, parentId, request) =>
        set((s) => {
          const req = request ?? emptyRequest();
          return {
            collections: s.collections.map((c) =>
              c.id === collectionId
                ? {
                    ...c,
                    nodes: insertNode(c.nodes, parentId, {
                      id: uid("node"),
                      type: "request",
                      name: req.name,
                      request: req,
                    }),
                  }
                : c,
            ),
          };
        }),

      renameNode: (collectionId, nodeId, name) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? {
                  ...c,
                  nodes: updateNode(c.nodes, nodeId, (n) => ({ ...n, name })),
                }
              : c,
          ),
        })),

      duplicateNode: (collectionId, nodeId) =>
        set((s) => ({
          collections: s.collections.map((c) => {
            if (c.id !== collectionId) return c;
            const orig = findNode(c.nodes, nodeId);
            if (!orig) return c;
            const clone: TreeNode = { ...cloneWithNewIds(orig), name: `${orig.name} copy` };
            return { ...c, nodes: insertAfter(c.nodes, nodeId, clone) };
          }),
        })),

      setCollectionScripts: (collectionId, scripts) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId ? { ...c, scripts } : c,
          ),
        })),

      setCollectionAuth: (collectionId, auth) =>
        set((s) => ({
          collections: s.collections.map((c) => (c.id === collectionId ? { ...c, auth } : c)),
        })),

      setFolderAuth: (collectionId, nodeId, auth) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? {
                  ...c,
                  nodes: updateNode(c.nodes, nodeId, (n) =>
                    n.type === "folder" ? { ...n, auth } : n,
                  ),
                }
              : c,
          ),
        })),

      setFocusTab: (focusTab) => set({ focusTab }),

      deleteNode: (collectionId, nodeId) =>
        set((s) => ({
          collections: s.collections.map((c) =>
            c.id === collectionId
              ? { ...c, nodes: removeNode(c.nodes, nodeId) }
              : c,
          ),
          tabs: s.tabs.map((t) =>
            t.savedNodeId === nodeId
              ? { ...t, savedNodeId: undefined, savedCollectionId: undefined, dirty: true }
              : t,
          ),
        })),

      deleteCollection: (id) =>
        set((s) => ({ collections: s.collections.filter((c) => c.id !== id) })),

      importCollection: (collection) =>
        set((s) => ({ collections: [...s.collections, collection] })),

      addFlow: (name) => {
        const id = uid("flow");
        set((s) => ({ flows: [...s.flows, { id, name, steps: [] }] }));
        return id;
      },
      updateFlow: (flow) =>
        set((s) => ({ flows: s.flows.map((f) => (f.id === flow.id ? flow : f)) })),
      deleteFlow: (id) => set((s) => ({ flows: s.flows.filter((f) => f.id !== id) })),
      setAiFlowId: (aiFlowId) => set({ aiFlowId }),

      addEnvironment: (name) => {
        const env: Environment = {
          id: uid("env"),
          name,
          variables: [{ key: "", value: "", enabled: true }],
        };
        set((s) => ({
          environments: [...s.environments, env],
          activeEnvId: s.activeEnvId ?? env.id,
        }));
      },

      updateEnvironment: (env) =>
        set((s) => ({
          environments: s.environments.map((e) => (e.id === env.id ? env : e)),
        })),

      deleteEnvironment: (id) =>
        set((s) => ({
          environments: s.environments.filter((e) => e.id !== id),
          activeEnvId: s.activeEnvId === id ? null : s.activeEnvId,
        })),

      setActiveEnv: (id) => set({ activeEnvId: id }),

      addHistory: (entry) =>
        set((s) => ({ history: [entry, ...s.history].slice(0, 100) })),

      clearHistory: () => set({ history: [] }),

      replaceData: (collections, environments, flows) =>
        set(flows ? { collections, environments, flows } : { collections, environments }),
    }),
    {
      name: "proxius-workspace",
      version: 3,
      // Backfill field assertions/extracts pada request lama (pra-M2).
      migrate: (persisted: any) => {
        if (!persisted) return persisted;
        const fixReq = (r: any) => ({
          ...r,
          assertions: r?.assertions ?? [],
          extracts: r?.extracts ?? [],
        });
        const fixNodes = (nodes: any[]): any[] =>
          (nodes ?? []).map((n) =>
            n.type === "request"
              ? { ...n, request: fixReq(n.request) }
              : { ...n, children: fixNodes(n.children ?? []) },
          );
        persisted.collections = (persisted.collections ?? []).map((c: any) => ({
          ...c,
          nodes: fixNodes(c.nodes ?? []),
        }));
        persisted.tabs = (persisted.tabs ?? []).map((t: any) => ({
          ...t,
          request: fixReq(t.request),
        }));
        persisted.history = (persisted.history ?? []).map((h: any) => ({
          ...h,
          request: fixReq(h.request),
        }));
        // v3: bungkus workspace flat lama jadi project "Default".
        if (!persisted.projects || persisted.projects.length === 0) {
          const id = uid("proj");
          persisted.projects = [{ id, name: "Default" }];
          persisted.activeProjectId = id;
          persisted.projectData = {};
        }
        return persisted;
      },
      onRehydrateStorage: () => (state) => {
        if (state) applyTheme(state.theme);
      },
      partialize: (s) => ({
        theme: s.theme,
        projects: s.projects,
        activeProjectId: s.activeProjectId,
        projectData: s.projectData,
        collections: s.collections,
        environments: s.environments,
        activeEnvId: s.activeEnvId,
        flows: s.flows,
        history: s.history,
        // Simpan tab tanpa response (hemat storage).
        tabs: s.tabs.map((t) => ({ ...t, response: undefined })),
        activeTabId: s.activeTabId,
      }),
    },
  ),
);
