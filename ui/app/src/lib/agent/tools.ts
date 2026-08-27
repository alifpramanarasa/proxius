// Tool registry: primitif Proxius yang diekspos ke agen.
import { sendRequest } from "../api";
import { parseCurl } from "../curl";
import { parseOpenApi } from "../openapi";
import { runCollection, toRunDocument } from "../run";
import { positiveAssertions } from "../tests";
import {
  emptyRequest,
  uid,
  type AssertionOp,
  type AssertionSource,
  type Auth,
  type Collection,
  type Extract,
  type ExtractFrom,
  type FlowStep,
  type HttpMethod,
  type KeyValue,
  type TestCase,
  type TestInput,
  type TestOverride,
} from "../types";
import { useWorkspace } from "../../store/workspace";
import { useMcp } from "../../store/mcp";
import type { ToolDef } from "./types";

/** "status" | "responseTime" | "body" | "jsonpath:$.x" | "header:Name" */
function parseSource(s: string): AssertionSource {
  if (s.startsWith("jsonpath:")) return { kind: "jsonPath", path: s.slice(9) };
  if (s.startsWith("header:")) return { kind: "header", name: s.slice(7) };
  if (s === "responseTime") return { kind: "responseTime" };
  if (s === "body") return { kind: "body" };
  return { kind: "status" };
}

function kv(obj: unknown): KeyValue[] {
  if (!obj || typeof obj !== "object") return [];
  return Object.entries(obj as Record<string, unknown>).map(([key, value]) => ({
    key,
    value: String(value),
    enabled: true,
  }));
}

const str = (p: Record<string, unknown>, k: string) =>
  typeof p[k] === "string" ? (p[k] as string) : "";

function buildOverride(o: unknown): TestOverride {
  const ov: TestOverride = {};
  if (o && typeof o === "object") {
    const r = o as Record<string, unknown>;
    if (r.method) ov.method = String(r.method).toUpperCase() as HttpMethod;
    if (r.url) ov.url = String(r.url);
    if (r.headers) ov.headers = kv(r.headers);
    if (r.body) ov.body = { kind: "json", content: String(r.body) };
    if (r.auth && typeof r.auth === "object") ov.auth = r.auth as Auth;
  }
  return ov;
}

/** Bangun input skenario (Given) dari argumen tool. */
function buildInputs(arr: unknown): TestInput[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((i: any) => ({
      key: String(i?.key ?? ""),
      value: String(i?.value ?? ""),
      target: (i?.target === "var" ? "var" : "body") as TestInput["target"],
      enabled: true,
    }))
    .filter((i) => i.key.trim() !== "");
}

interface FlowReqOption {
  collectionId: string;
  nodeId: string;
  label: string;
  name: string;
}

/** Datar semua request (label = "Collection / Folder / Request") untuk matching. */
function flattenReqOptions(collections: Collection[]): FlowReqOption[] {
  const out: FlowReqOption[] = [];
  const walk = (colId: string, nodes: Collection["nodes"], prefix: string) => {
    for (const n of nodes) {
      if (n.type === "request") out.push({ collectionId: colId, nodeId: n.id, label: prefix + n.name, name: n.name });
      else walk(colId, n.children, `${prefix}${n.name} / `);
    }
  };
  for (const c of collections) walk(c.id, c.nodes, `${c.name} / `);
  return out;
}

/** "jsonpath:$.x" | "header:Name" | "status" | "body" → ExtractFrom. */
function parseExtractFrom(s: string): ExtractFrom {
  const v = s.trim();
  if (v.toLowerCase().startsWith("jsonpath:")) return { kind: "jsonPath", path: v.slice(9) };
  if (v.startsWith("$")) return { kind: "jsonPath", path: v };
  if (v.toLowerCase().startsWith("header:")) return { kind: "header", name: v.slice(7) };
  if (v.toLowerCase() === "status") return { kind: "status" };
  return { kind: "body" };
}

function buildStepExtracts(arr: unknown): Extract[] {
  if (!Array.isArray(arr)) return [];
  return arr
    .map((e: any) => ({
      id: uid("ex"),
      var: String(e?.var ?? "").trim(),
      from: parseExtractFrom(String(e?.from ?? "body")),
      enabled: true,
    }))
    .filter((e) => e.var !== "");
}

/** Bangun daftar TestCase dari argumen tool (dipakai add_/set_test_cases). */
function buildCases(list: unknown): TestCase[] {
  const arr = Array.isArray(list) ? (list as any[]) : [];
  return arr.map((c) => ({
    id: uid("tc"),
    name: String(c?.name ?? "Case"),
    description: c?.description ? String(c.description) : "",
    kind: c?.kind === "negative" ? ("negative" as const) : ("positive" as const),
    inputs: buildInputs(c?.inputs),
    scenario: buildScenario(c?.scenario),
    override: buildOverride(c?.override),
    assertions: (Array.isArray(c?.assertions) ? c.assertions : []).map((a: any) => ({
      id: uid("as"),
      source: parseSource(String(a?.source ?? "status")),
      op: (a?.op ?? "equals") as AssertionOp,
      value: String(a?.value ?? ""),
      enabled: true,
    })),
  }));
}

/** Bangun narasi BDD opsional dari argumen tool. */
function buildScenario(o: unknown): TestCase["scenario"] {
  if (!o || typeof o !== "object") return undefined;
  const r = o as Record<string, unknown>;
  const s: NonNullable<TestCase["scenario"]> = {};
  if (r.given) s.given = String(r.given);
  if (r.when) s.when = String(r.when);
  if (r.then) s.then = String(r.then);
  return s.given || s.when || s.then ? s : undefined;
}

export function buildTools(): ToolDef[] {
  // Tool bawaan + tool dari server MCP eksternal yang terhubung.
  return [...builtinTools(), ...useMcp.getState().remoteTools()];
}

function builtinTools(): ToolDef[] {
  return [
    {
      name: "list_workspace",
      description:
        "Lihat ringkasan workspace: collections (nama + request di dalamnya) dan environments.",
      parameters: { type: "object", properties: {} },
      run: async () => {
        const { collections, environments } = useWorkspace.getState();
        const summarize = (nodes: any[]): any[] =>
          nodes.map((n) =>
            n.type === "request"
              ? { request: n.name, method: n.request.method, url: n.request.url }
              : { folder: n.name, children: summarize(n.children) },
          );
        return {
          collections: collections.map((c) => ({
            name: c.name,
            items: summarize(c.nodes),
          })),
          environments: environments.map((e) => ({
            name: e.name,
            vars: e.variables.filter((v) => v.key).map((v) => v.key),
          })),
        };
      },
    },
    {
      name: "create_request",
      description:
        "Buat request baru di sebuah collection (dibuat bila belum ada) dan buka sebagai tab.",
      parameters: {
        type: "object",
        properties: {
          collection: { type: "string", description: "nama collection" },
          name: { type: "string" },
          method: { type: "string" },
          url: { type: "string" },
          headers: { type: "object", description: "map header→value" },
          body: { type: "string", description: "body JSON (opsional)" },
        },
        required: ["name", "url"],
      },
      run: async (p) => {
        const ws = useWorkspace.getState();
        const colName = str(p, "collection") || "AI";
        let col = ws.collections.find((c) => c.name === colName);
        const colId = col ? col.id : ws.addCollection(colName);
        const req = {
          ...emptyRequest(str(p, "name") || "Request"),
          method: (str(p, "method").toUpperCase() || "GET") as HttpMethod,
          url: str(p, "url"),
          headers: kv(p.headers),
          body: p.body
            ? { kind: "json" as const, content: String(p.body) }
            : { kind: "none" as const },
        };
        ws.addRequestNode(colId, null, req);
        ws.newTab(req);
        return { ok: true, created: req.name, collection: colName };
      },
    },
    {
      name: "send_request",
      description: "Kirim satu request HTTP dan kembalikan ringkasan response.",
      parameters: {
        type: "object",
        properties: {
          method: { type: "string" },
          url: { type: "string" },
          headers: { type: "object" },
          query: { type: "object" },
          body: { type: "string" },
        },
        required: ["url"],
      },
      run: async (p) => {
        const req = {
          ...emptyRequest("agent"),
          method: (str(p, "method").toUpperCase() || "GET") as HttpMethod,
          url: str(p, "url"),
          headers: kv(p.headers),
          query: kv(p.query),
          body: p.body
            ? { kind: "json" as const, content: String(p.body) }
            : { kind: "none" as const },
        };
        const res = await sendRequest(req);
        return {
          status: res.status,
          timeMs: res.durationMs,
          bytes: res.sizeBytes,
          body: res.body.slice(0, 2000),
        };
      },
    },
    {
      name: "import_curl",
      description: "Impor perintah cURL sebagai request baru (tab).",
      parameters: {
        type: "object",
        properties: { curl: { type: "string" } },
        required: ["curl"],
      },
      run: async (p) => {
        const req = parseCurl(str(p, "curl"));
        useWorkspace.getState().newTab(req);
        return { ok: true, name: req.name, method: req.method, url: req.url };
      },
    },
    {
      name: "import_openapi",
      description:
        "Impor dokumen OpenAPI/Swagger (JSON atau YAML) sebagai collection baru.",
      parameters: {
        type: "object",
        properties: { spec: { type: "string" } },
        required: ["spec"],
      },
      run: async (p) => {
        const col = parseOpenApi(str(p, "spec"));
        useWorkspace.getState().importCollection(col);
        return { ok: true, collection: col.name, count: col.nodes.length };
      },
    },
    {
      name: "set_env_var",
      description:
        "Setel variabel environment (environment dibuat bila belum ada).",
      parameters: {
        type: "object",
        properties: {
          env: { type: "string" },
          key: { type: "string" },
          value: { type: "string" },
        },
        required: ["env", "key", "value"],
      },
      run: async (p) => {
        const ws = useWorkspace.getState();
        const envName = str(p, "env");
        let env = ws.environments.find((e) => e.name === envName);
        if (!env) {
          ws.addEnvironment(envName);
          env = useWorkspace.getState().environments.find((e) => e.name === envName);
        }
        if (!env) return { error: "gagal membuat environment" };
        const key = str(p, "key");
        const variables = env.variables.filter((v) => v.key);
        const existing = variables.find((v) => v.key === key);
        if (existing) existing.value = str(p, "value");
        else variables.push({ key, value: str(p, "value"), enabled: true });
        ws.updateEnvironment({ ...env, variables });
        return { ok: true, env: envName, key };
      },
    },
    {
      name: "add_assertions",
      description:
        "Tambahkan test/assertion ke request yang sedang aktif (tab). Untuk generate test case dari response.",
      parameters: {
        type: "object",
        properties: {
          assertions: {
            type: "array",
            description:
              "daftar assertion. source: 'status'|'responseTime'|'body'|'jsonpath:$.path'|'header:Name'. op: equals|notEquals|contains|exists|notExists|lessThan|greaterThan|matches.",
            items: {
              type: "object",
              properties: {
                source: { type: "string" },
                op: { type: "string" },
                value: { type: "string" },
              },
              required: ["source", "op"],
            },
          },
        },
        required: ["assertions"],
      },
      run: async (p) => {
        const list = Array.isArray(p.assertions) ? (p.assertions as any[]) : [];
        const asserts = list.map((a) => ({
          id: uid("as"),
          source: parseSource(String(a.source ?? "status")),
          op: (a.op ?? "equals") as AssertionOp,
          value: String(a.value ?? ""),
          enabled: true,
        }));
        const ws = useWorkspace.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return { error: "tidak ada request aktif" };
        ws.patchActiveRequest({
          assertions: [...tab.request.assertions, ...asserts],
        });
        return { ok: true, added: asserts.length, on: tab.request.name };
      },
    },
    {
      name: "add_test_cases",
      description:
        "Tambahkan skenario uji QA (positif & negatif) ke request aktif, gaya Given→Maka. " +
        "`inputs` = data yang 'Diberikan' (mis. username/password) — target 'body' menaruhnya sebagai field JSON body, target 'var' sebagai variabel {{key}}. " +
        "`assertions` = 'Maka harapkan' — SELALU sertakan satu status yang diharapkan (mis. positif → status equals 200; negatif → status equals 401/400/500). " +
        "`scenario` = teks Given/When/Then opsional (untuk export Gherkin; bila kosong diturunkan otomatis). Pakai `override` hanya untuk perubahan request tingkat lanjut.",
      parameters: {
        type: "object",
        properties: {
          cases: {
            type: "array",
            items: {
              type: "object",
              properties: {
                name: { type: "string", description: "nama skenario, mis. 'Login dengan kredensial valid'" },
                description: { type: "string", description: "tujuan skenario (opsional)" },
                kind: { type: "string", description: "positive | negative" },
                inputs: {
                  type: "array",
                  description:
                    "data 'Diberikan'. Tiap item { key, value, target }. target: 'body' (field JSON body) | 'var' (variabel {{key}}).",
                  items: {
                    type: "object",
                    properties: {
                      key: { type: "string" },
                      value: { type: "string" },
                      target: { type: "string", description: "body | var" },
                    },
                    required: ["key", "value"],
                  },
                },
                scenario: {
                  type: "object",
                  description: "teks BDD opsional untuk Gherkin",
                  properties: {
                    given: { type: "string" },
                    when: { type: "string" },
                    then: { type: "string" },
                  },
                },
                override: {
                  type: "object",
                  description:
                    "opsional (lanjutan): { method, url, headers: map, body: string }",
                  properties: {
                    method: { type: "string" },
                    url: { type: "string" },
                    headers: { type: "object" },
                    body: { type: "string" },
                  },
                },
                assertions: {
                  type: "array",
                  description:
                    "'Maka harapkan'. source: 'status'|'responseTime'|'body'|'jsonpath:$.x'|'header:Name'; op: equals|notEquals|contains|notContains|exists|notExists|lessThan|greaterThan|matches. Sertakan minimal satu status.",
                  items: {
                    type: "object",
                    properties: {
                      source: { type: "string" },
                      op: { type: "string" },
                      value: { type: "string" },
                    },
                    required: ["source", "op"],
                  },
                },
              },
              required: ["name", "kind", "assertions"],
            },
          },
        },
        required: ["cases"],
      },
      run: async (p) => {
        const cases = buildCases(p.cases);
        const ws = useWorkspace.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return { error: "tidak ada request aktif" };
        const tests = [...(tab.request.tests ?? []), ...cases];
        ws.patchActiveRequest({ tests, assertions: positiveAssertions(tests) });
        return { ok: true, added: cases.length, total: tests.length };
      },
    },
    {
      name: "set_test_cases",
      description:
        "GANTI SELURUH suite test QA request aktif dengan daftar baru (untuk MEMPERBAIKI test yang gagal). " +
        "Bentuk `cases` sama persis dengan add_test_cases. Pakai saat diminta membetulkan assertion yang gagal: " +
        "kembalikan seluruh suite versi terkoreksi (positif harus lulus terhadap response nyata; negatif/edge tetap ada).",
      parameters: {
        type: "object",
        properties: {
          cases: { type: "array", description: "suite lengkap (bentuk = add_test_cases.cases)", items: { type: "object" } },
        },
        required: ["cases"],
      },
      run: async (p) => {
        const cases = buildCases(p.cases);
        const ws = useWorkspace.getState();
        const tab = ws.tabs.find((t) => t.id === ws.activeTabId);
        if (!tab) return { error: "tidak ada request aktif" };
        if (cases.length === 0) return { error: "cases kosong — tak ada yang di-set" };
        ws.patchActiveRequest({ tests: cases, assertions: positiveAssertions(cases) });
        return { ok: true, total: cases.length };
      },
    },
    {
      name: "run_collection",
      description:
        "Jalankan seluruh request dalam collection + assertion-nya (e2e / regresi). Kembalikan laporan.",
      parameters: {
        type: "object",
        properties: { collection: { type: "string" } },
      },
      run: async (p) => {
        const ws = useWorkspace.getState();
        const col =
          ws.collections.find((c) => c.name === str(p, "collection")) ??
          ws.collections[0];
        if (!col) return { error: "collection tidak ditemukan" };
        const env = ws.environments.find((e) => e.id === ws.activeEnvId);
        const report = await runCollection(
          toRunDocument(col, []),
          env?.variables ?? [],
        );
        return {
          name: report.name,
          requestsPassed: `${report.passedRequests}/${report.total}`,
          assertionsPassed: `${report.passedAssertions}/${report.totalAssertions}`,
          results: report.requests.map((r) => ({
            name: r.name,
            ok: r.ok,
            status: r.status,
          })),
        };
      },
    },
    {
      name: "set_flow_steps",
      description:
        "Susun langkah-langkah Flow (alur e2e) yang sedang dibuka dari request yang SUDAH ADA. " +
        "Tiap langkah menunjuk satu request lewat `request` (cocokkan dengan nama/label request dari list_workspace) " +
        "dan boleh punya `extracts` untuk mengambil nilai response ke variabel yang dipakai langkah berikutnya via {{var}}. " +
        "Gunakan untuk merangkai skenario seperti: login → ambil token → panggil endpoint terproteksi. Jangan buat request baru.",
      parameters: {
        type: "object",
        properties: {
          steps: {
            type: "array",
            description: "urutan langkah e2e",
            items: {
              type: "object",
              properties: {
                request: {
                  type: "string",
                  description: "nama/label request yang sudah ada, mis. 'Login' atau 'My Collection / Login'",
                },
                label: { type: "string", description: "label langkah (opsional)" },
                extracts: {
                  type: "array",
                  description: "ambil nilai response langkah ini ke variabel",
                  items: {
                    type: "object",
                    properties: {
                      var: { type: "string", description: "nama variabel, mis. token" },
                      from: {
                        type: "string",
                        description: "sumber: 'jsonpath:$.token' | 'header:Authorization' | 'status' | 'body'",
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
      run: async (p) => {
        const ws = useWorkspace.getState();
        const flow = ws.flows.find((f) => f.id === ws.aiFlowId) ?? ws.flows[ws.flows.length - 1];
        if (!flow) return { error: "tidak ada flow terbuka; buat flow dulu" };
        const opts = flattenReqOptions(ws.collections);
        if (opts.length === 0) return { error: "belum ada request di workspace" };

        const match = (q: string): FlowReqOption | null => {
          const s = q.toLowerCase().trim();
          if (!s) return null;
          return (
            opts.find((o) => o.label.toLowerCase() === s) ??
            opts.find((o) => o.name.toLowerCase() === s) ??
            opts.find((o) => o.label.toLowerCase().endsWith("/ " + s)) ??
            opts.find((o) => o.label.toLowerCase().includes(s)) ??
            null
          );
        };

        const raw = Array.isArray(p.steps) ? p.steps : [];
        const steps: FlowStep[] = [];
        const unmatched: string[] = [];
        for (const rs of raw as any[]) {
          const opt = match(String(rs?.request ?? ""));
          if (!opt) {
            unmatched.push(String(rs?.request ?? ""));
            continue;
          }
          steps.push({
            id: uid("step"),
            name: String(rs?.label ?? ""),
            collectionId: opt.collectionId,
            nodeId: opt.nodeId,
            extracts: buildStepExtracts(rs?.extracts),
          });
        }
        if (steps.length === 0)
          return { error: "tak ada langkah yang cocok dengan request yang ada", unmatched, available: opts.map((o) => o.label) };

        ws.updateFlow({ ...flow, steps });
        return {
          flow: flow.name,
          steps: steps.length,
          chained: steps.flatMap((s) => (s.extracts ?? []).map((e) => e.var)),
          unmatched: unmatched.length ? unmatched : undefined,
        };
      },
    },
  ];
}
