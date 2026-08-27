import { create } from "zustand";
import { persist } from "zustand/middleware";
import { runAgent } from "../lib/agent/runtime";
import { buildTools } from "../lib/agent/tools";
import { makeProvider, type AgentConfig } from "../lib/agent/providers";
import type { AgentMessage, ImagePart } from "../lib/agent/types";
import { sendRequest } from "../lib/api";
import { envMap, resolveRequest } from "../lib/vars";
import { useWorkspace } from "./workspace";
import { toast } from "./ui";
import { tr } from "./i18n";

type Provider = AgentConfig["provider"];

const DEFAULT_MODELS: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-4o",
  ollama: "llama3.1",
};

interface Saved {
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const SYSTEM_PROMPT = `Kamu asisten di dalam Proxius, sebuah API client (mirip Postman).
Kamu bisa memakai tool untuk melihat & mengubah workspace user: membuat request,
mengirim request, meng-import cURL/OpenAPI, mengatur environment variable,
membuat test case (assertion), dan menjalankan collection (e2e/regresi).

Panduan:
- Saat diminta "buatkan test case", kirim request itu dulu (send_request) untuk
  melihat response, lalu tambahkan assertion yang masuk akal (status 200,
  jsonpath field penting, content-type, responseTime) via add_assertions.
- Saat diminta e2e/regresi, jalankan run_collection dan laporkan hasilnya.
- Bila user sudah menyambungkan integrasi (mis. Atlassian/Linear di Settings),
  tool dari MCP mereka (mis. membuat Jira issue) tersedia dengan awalan "mcp__".
  Pakai itu untuk membuat issue dari test case. Laporkan key + URL issue.
- Jelaskan tindakanmu singkat. Jawab dalam bahasa user.`;

interface AgentState {
  config: AgentConfig;
  /** Simpanan per-provider agar API key tiap provider tak hilang saat ganti. */
  saved: Partial<Record<Provider, Saved>>;
  history: AgentMessage[];
  busy: boolean;
  error: string | null;

  setConfig: (patch: Partial<AgentConfig>) => void;
  send: (text: string, images?: ImagePart[]) => Promise<void>;
  generateTests: () => Promise<void>;
  generateTestCases: () => Promise<void>;
  fixTestCases: () => Promise<void>;
  generateFlow: (flowId: string, description: string) => Promise<void>;
  clear: () => void;
}

/** Serialisasi AssertionSource ke format string yang dipakai tool. */
const sourceToStr = (s: any): string => {
  if (!s) return "status";
  if (s.kind === "jsonPath") return `jsonpath:${s.path}`;
  if (s.kind === "header") return `header:${s.name}`;
  if (s.kind === "responseTime") return "responseTime";
  if (s.kind === "body") return "body";
  return "status";
};

/** Pastikan model tak pernah kosong (mis. dari sesi lama / "Custom" dikosongkan)
 * — kalau kosong pakai default provider, cegah error "no model" dari API. */
const withModel = (c: AgentConfig): AgentConfig => ({
  ...c,
  model: c.model?.trim() || DEFAULT_MODELS[c.provider],
});

const emptyHistory = (): AgentMessage[] => [{ role: "system", content: SYSTEM_PROMPT }];
const pick = (c: AgentConfig): Saved => ({
  model: c.model,
  apiKey: c.apiKey,
  baseUrl: c.baseUrl,
});
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

export const useAgent = create<AgentState>()(
  persist(
    (set, get) => ({
      // CATATAN: apiKey tersimpan di localStorage untuk M5. Idealnya OS keychain.
      config: { provider: "anthropic", model: "claude-opus-5", apiKey: "", baseUrl: "" },
      saved: {},
      history: emptyHistory(),
      busy: false,
      error: null,

      setConfig: (patch) =>
        set((s) => {
          if (patch.provider && patch.provider !== s.config.provider) {
            const saved = { ...s.saved, [s.config.provider]: pick(s.config) };
            const r = saved[patch.provider] ?? {
              model: DEFAULT_MODELS[patch.provider],
              apiKey: "",
              baseUrl: "",
            };
            return {
              saved,
              config: { provider: patch.provider, model: r.model, apiKey: r.apiKey, baseUrl: r.baseUrl },
            };
          }
          const config = { ...s.config, ...patch };
          return { config, saved: { ...s.saved, [config.provider]: pick(config) } };
        }),

      send: async (text, images) => {
        if ((!text.trim() && !images?.length) || get().busy) return;
        const { config } = get();
        if (config.provider !== "ollama" && !config.apiKey) {
          set({ error: tr("aiProviderNotSet") });
          return;
        }
        const history = [
          ...get().history,
          { role: "user" as const, content: text, images: images?.length ? images : undefined },
        ];
        set({ history, busy: true, error: null });
        await runAgent(makeProvider(withModel(config)), buildTools(), history, (e) => {
          if (e.type === "error") set({ error: e.error });
          set({ history: [...history] });
        });
        set({ busy: false });
      },

      // Aksi kontekstual: buat test case untuk request yang sedang aktif.
      generateTests: async () => {
        const { config, busy } = get();
        if (busy) return;
        if (config.provider !== "ollama" && !config.apiKey) {
          toast.error(tr("aiProviderNotSet"));
          return;
        }
        const ws = useWorkspace.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab || !tab.request.url.trim()) {
          toast.error(tr("openRequestWithUrlFirst"));
          return;
        }
        set({ busy: true });
        toast.info(tr("aiGeneratingTests"));
        try {
          const env = ws.environments.find((e) => e.id === ws.activeEnvId);
          const resolved = resolveRequest(tab.request, envMap(env));
          const resp = await sendRequest(resolved);
          ws.setTabResponse(tab.id, resp);
          const prompt = `Request: ${tab.request.method} ${resolved.url}
Response status ${resp.status}, body:
${resp.body.slice(0, 1500)}

Buat test case (assertion) relevan untuk request ini lalu tambahkan lewat add_assertions. Pertimbangkan: status, field penting via jsonpath, content-type, responseTime. Jangan buat request baru.`;
          const history: AgentMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ];
          await runAgent(makeProvider(withModel(config)), buildTools(), history, (e) => {
            if (e.type === "error") toast.error(e.error);
          });
          toast.success(tr("aiTestsDone"));
        } catch (e) {
          toast.error(tr("genericFailed", { msg: msg(e) }));
        } finally {
          set({ busy: false });
        }
      },

      // Aksi kontekstual: buat suite test case (positif + negatif) via AI.
      generateTestCases: async () => {
        const { config, busy } = get();
        if (busy) return;
        if (config.provider !== "ollama" && !config.apiKey) {
          toast.error(tr("aiProviderNotSet"));
          return;
        }
        const ws = useWorkspace.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab || !tab.request.url.trim()) {
          toast.error(tr("openRequestWithUrlFirst"));
          return;
        }
        set({ busy: true });
        toast.info(tr("aiGeneratingTests"));
        try {
          const env = ws.environments.find((e) => e.id === ws.activeEnvId);
          const resolved = resolveRequest(tab.request, envMap(env));
          const resp = await sendRequest(resolved);
          ws.setTabResponse(tab.id, resp);
          const prompt = `Request: ${tab.request.method} ${resolved.url}
Response NYATA — status ${resp.status}, content-type ${resp.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "?"}, body:
${resp.body.slice(0, 1500)}

Buatkan suite QA yang LENGKAP & LUAS via add_test_cases — 6-9 skenario yang MENCAKUP happy path + validasi + otorisasi + not-found + boundary/edge. Tujuannya coverage QA menyeluruh.

1) HAPPY PATH (kind positive — HARUS akurat & LULUS terhadap response nyata di atas):
- assertion status = ${resp.status} (status yang TERAMATI, bukan asumsi 2xx).
- header content-type "contains" nilai content-type nyata di atas.
- responseTime "<" nilai longgar (3-5x durasi wajar, minimal 3000).
- jsonpath "exists" HANYA untuk field yang BENAR-BENAR ADA di body di atas.
- Bila body ARRAY (diawali "["), pakai path indeks: cek "$" exists dan "$[0].field" exists — JANGAN "$.field".
- cek NILAI (equals) HANYA untuk field yang jelas konstan/stabil (boolean, enum, id tetap). JANGAN nilai timestamp, IP/origin, uuid acak, tanggal.

2) SKENARIO LAIN untuk coverage (kind negative — tetap BUAT walau API mungkin tak memvalidasi):
- VALIDASI: field wajib kosong / tipe salah / format salah (mis. email tak valid) → 400/422.
- OTORISASI: tanpa auth (override.auth={type:"none"}) → 401; role kurang → 403 bila relevan.
- NOT FOUND: id/resource tak ada → 404.
- BOUNDARY/EDGE: nilai batas (0, negatif, string sangat panjang, unicode, param tipe salah) → 400/422.
Ini mendokumentasikan perilaku yang DIHARAPKAN. Wajar bila sebagian tampil FAIL pada API demo/read-only yang tak memvalidasi — itu justru MENANDAI gap validasi, bukan bug. JANGAN dihilangkan.

Aturan umum: tiap skenario punya 'name' deskriptif; SELALU sertakan satu assertion status; isi 'inputs' (target 'body'/'var') & 'override' bila relevan; 'scenario.given/when/then' singkat. Jangan buat request baru.`;
          const history: AgentMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ];
          await runAgent(makeProvider(withModel(config)), buildTools(), history, (e) => {
            if (e.type === "error") toast.error(e.error);
          });
          toast.success(tr("aiTestsDone"));
        } catch (e) {
          toast.error(tr("genericFailed", { msg: msg(e) }));
        } finally {
          set({ busy: false });
        }
      },

      // Perbaiki suite test yang gagal agar cocok dengan response nyata.
      fixTestCases: async () => {
        const { config, busy } = get();
        if (busy) return;
        if (config.provider !== "ollama" && !config.apiKey) {
          toast.error(tr("aiProviderNotSet"));
          return;
        }
        const ws = useWorkspace.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab || !tab.request.url.trim()) {
          toast.error(tr("openRequestWithUrlFirst"));
          return;
        }
        const tests = tab.request.tests ?? [];
        if (tests.length === 0) {
          toast.error(tr("noTestsToFix"));
          return;
        }
        set({ busy: true });
        toast.info(tr("aiFixingTests"));
        try {
          const env = ws.environments.find((e) => e.id === ws.activeEnvId);
          const resolved = resolveRequest(tab.request, envMap(env));
          const resp = await sendRequest(resolved);
          ws.setTabResponse(tab.id, resp);
          const ct = resp.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "?";
          const suite = tests.map((t) => ({
            name: t.name,
            kind: t.kind,
            assertions: t.assertions.map((a) => ({ source: sourceToStr(a.source), op: a.op, value: a.value })),
            override: t.override,
          }));
          const prompt = `Request: ${tab.request.method} ${resolved.url}
Response NYATA — status ${resp.status}, content-type ${ct}, body:
${resp.body.slice(0, 1500)}

Suite test SAAT INI (JSON):
${JSON.stringify(suite).slice(0, 2600)}

Sebagian assertion GAGAL karena tak cocok dengan response nyata di atas. PERBAIKI seluruh suite, lalu panggil set_test_cases dengan versi terkoreksi:
- POSITIF (happy path) HARUS lulus terhadap response nyata: pakai status ${resp.status} yang TERAMATI, content-type nyata, path yang benar (bila body ARRAY pakai $[0].field bukan $.field), 'exists' untuk field yang ADA, JANGAN cek NILAI yang berubah (timestamp/ip/uuid/tanggal).
- NEGATIF/EDGE: pertahankan sebagai coverage; bila endpoint memang tak memvalidasi, biarkan apa adanya (itu menandai gap validasi, bukan bug). Jangan hapus.
Kembalikan SELURUH suite (bukan hanya yang diubah) via set_test_cases.`;
          const history: AgentMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ];
          await runAgent(makeProvider(withModel(config)), buildTools(), history, (e) => {
            if (e.type === "error") toast.error(e.error);
          });
          toast.success(tr("aiTestsFixed"));
        } catch (e) {
          toast.error(tr("genericFailed", { msg: msg(e) }));
        } finally {
          set({ busy: false });
        }
      },

      generateFlow: async (flowId, description) => {
        const { config, busy } = get();
        if (busy) return;
        if (config.provider !== "ollama" && !config.apiKey) {
          toast.error(tr("aiProviderNotSet"));
          return;
        }
        const ws = useWorkspace.getState();
        const opts: string[] = [];
        const walk = (nodes: any[], prefix: string) => {
          for (const n of nodes) {
            if (n.type === "request") opts.push(`${n.request.method} ${prefix}${n.name}`);
            else walk(n.children, `${prefix}${n.name} / `);
          }
        };
        for (const c of ws.collections) walk(c.nodes, `${c.name} / `);
        if (opts.length === 0) {
          toast.error(tr("flowNoRequests"));
          return;
        }
        set({ busy: true });
        ws.setAiFlowId(flowId);
        toast.info(tr("aiBuildingFlow"));
        try {
          const prompt = `Request yang tersedia di workspace:
${opts.map((o) => `- ${o}`).join("\n")}

Susun sebuah Flow (alur end-to-end) untuk: "${description}".
Pilih request yang relevan dari daftar di atas, urutkan logis, dan definisikan chaining:
bila sebuah langkah menghasilkan nilai yang dibutuhkan langkah berikutnya (mis. token dari login,
id dari create), tambahkan 'extracts' (mis. { var: "token", from: "jsonpath:$.token" }) agar
langkah berikutnya bisa memakainya via {{token}}. Panggil set_flow_steps sekali dengan seluruh langkah.
Jangan membuat request baru; hanya pakai yang sudah ada.`;
          const history: AgentMessage[] = [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: prompt },
          ];
          await runAgent(makeProvider(withModel(config)), buildTools(), history, (e) => {
            if (e.type === "error") toast.error(e.error);
          });
          toast.success(tr("aiFlowDone"));
        } catch (e) {
          toast.error(tr("genericFailed", { msg: msg(e) }));
        } finally {
          ws.setAiFlowId(null);
          set({ busy: false });
        }
      },

      clear: () => set({ history: emptyHistory(), error: null }),
    }),
    {
      name: "proxius-agent",
      partialize: (s) => ({ config: s.config, saved: s.saved }),
    },
  ),
);
