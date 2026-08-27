import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  createIssue,
  defaultTrackerConfig,
  exportMarkdown,
  toIssuePayload,
  trackerLabel,
  validateTracker,
  type JiraConfig,
  type LinearConfig,
  type TrackerConfig,
  type TrackerProvider,
} from "../lib/tracker";
import { downloadText } from "../lib/download";
import { toRunDocument } from "../lib/run";
import type { Collection } from "../lib/types";
import { translate } from "./i18n";
import { useI18n } from "./i18n";
import { useWorkspace } from "./workspace";
import { toast } from "./ui";

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));
const t = (key: string, params?: Record<string, string | number>) =>
  translate(useI18n.getState().lang, key, params);

interface TrackerState {
  config: TrackerConfig;
  busy: boolean;

  setProvider: (p: TrackerProvider) => void;
  setJira: (patch: Partial<JiraConfig>) => void;
  setLinear: (patch: Partial<LinearConfig>) => void;

  /** Kirim test case dari request tab aktif ke tracker aktif. */
  syncActiveRequest: () => Promise<void>;
  /** Kirim semua request dalam sebuah collection sebagai issue (bulk). */
  syncCollection: (collection: Collection) => Promise<void>;
  /** Export test case dari request tab aktif sebagai file .md. */
  exportActiveRequest: () => void;
}

function activeRequest() {
  const ws = useWorkspace.getState();
  return ws.tabs.find((tab) => tab.id === ws.activeTabId)?.request ?? null;
}

export const useTracker = create<TrackerState>()(
  persist(
    (set, get) => ({
      // CATATAN: token tersimpan di localStorage (samakan dengan agent M5).
      // Idealnya OS keychain.
      config: defaultTrackerConfig(),
      busy: false,

      setProvider: (provider) =>
        set((s) => ({ config: { ...s.config, provider } })),
      setJira: (patch) =>
        set((s) => ({ config: { ...s.config, jira: { ...s.config.jira, ...patch } } })),
      setLinear: (patch) =>
        set((s) => ({ config: { ...s.config, linear: { ...s.config.linear, ...patch } } })),

      syncActiveRequest: async () => {
        const { config, busy } = get();
        if (busy) return;
        const req = activeRequest();
        if (!req || !req.url.trim()) {
          toast.error(t("openRequestWithUrlFirst"));
          return;
        }
        if (validateTracker(config)) {
          toast.error(t("trackerNotConfigured"));
          return;
        }
        const name = trackerLabel(config);
        set({ busy: true });
        toast.info(`${name}…`);
        try {
          const res = await createIssue(config, toIssuePayload(req));
          toast.success(`${res.key} · ${res.url}`);
        } catch (e) {
          toast.error(msg(e));
        } finally {
          set({ busy: false });
        }
      },

      syncCollection: async (collection) => {
        const { config, busy } = get();
        if (busy) return;
        if (validateTracker(config)) {
          toast.error(t("trackerNotConfigured"));
          return;
        }
        const requests = toRunDocument(collection, []).requests;
        if (requests.length === 0) {
          toast.error(t("collectionEmpty"));
          return;
        }
        const name = trackerLabel(config);
        set({ busy: true });
        toast.info(t("creatingIssues", { name, count: requests.length }));
        let ok = 0;
        let fail = 0;
        for (const req of requests) {
          try {
            await createIssue(config, toIssuePayload(req));
            ok++;
          } catch {
            fail++;
          }
        }
        set({ busy: false });
        if (fail === 0) toast.success(t("issuesCreated", { name, ok }));
        else toast.error(t("issuesSomeFailed", { name, ok, fail }));
      },

      exportActiveRequest: () => {
        const req = activeRequest();
        if (!req || !req.url.trim()) {
          toast.error(t("openRequestWithUrlFirst"));
          return;
        }
        const md = exportMarkdown([req], req.name || "Test Case");
        const safe = (req.name || "test-case").replace(/[^\w.-]+/g, "-").toLowerCase();
        downloadText(`${safe}.md`, md);
        toast.success(t("exportMd"));
      },
    }),
    { name: "proxius-tracker", partialize: (s) => ({ config: s.config }) },
  ),
);
