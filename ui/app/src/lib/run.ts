import { invoke } from "@tauri-apps/api/core";
import { isTauri, sendRequest } from "./api";
import { evaluate, jsonPath } from "./assert";
import { normalizeBody } from "./body";
import { resolveRequest } from "./vars";
import type {
  Collection,
  Extract,
  HttpRequest,
  HttpResponse,
  KeyValue,
  RequestReport,
  RunDocument,
  RunReport,
  TreeNode,
} from "./types";

/** Kumpulkan semua request (urut) dari pohon collection. */
export function flatten(nodes: TreeNode[], out: HttpRequest[] = []): HttpRequest[] {
  for (const n of nodes) {
    if (n.type === "request") out.push(n.request);
    else flatten(n.children, out);
  }
  return out;
}

export function toRunDocument(col: Collection, variables: KeyValue[]): RunDocument {
  // Normalisasi body (GraphQL → JSON) agar CLI/engine Rust bisa membacanya.
  const requests = flatten(col.nodes).map((r) => ({ ...r, body: normalizeBody(r.body) }));
  return { name: col.name, variables, requests };
}

function extractValue(from: Extract["from"], resp: HttpResponse): string | undefined {
  switch (from.kind) {
    case "jsonPath":
      return jsonPath(resp.body, from.path);
    case "header":
      return resp.headers.find(
        (h) => h.key.toLowerCase() === from.name.toLowerCase(),
      )?.value;
    case "status":
      return String(resp.status);
    case "body":
      return resp.body;
  }
}

/** Jalankan dokumen. Desktop → runner Rust (satu implementasi). Browser → fallback TS. */
export async function runCollection(
  doc: RunDocument,
  variables: KeyValue[],
): Promise<RunReport> {
  if (isTauri()) {
    return invoke<RunReport>("run_collection", { doc, variables });
  }
  return runInBrowser(doc, variables);
}

async function runInBrowser(
  doc: RunDocument,
  variables: KeyValue[],
): Promise<RunReport> {
  const vars: Record<string, string> = {};
  for (const kv of doc.variables) if (kv.enabled && kv.key) vars[kv.key] = kv.value;
  for (const kv of variables) if (kv.enabled && kv.key) vars[kv.key] = kv.value;

  const reports: RequestReport[] = [];
  for (const req of doc.requests) {
    const resolved = resolveRequest(req, vars);
    try {
      const resp = await sendRequest(resolved);
      const assertions = evaluate(resolved, resp);
      for (const e of req.extracts.filter((e) => e.enabled && e.var)) {
        const v = extractValue(e.from, resp);
        if (v !== undefined) vars[e.var] = v;
      }
      const ok = assertions.every((a) => a.passed);
      reports.push({
        name: req.name,
        method: req.method,
        url: resolved.url,
        status: resp.status,
        durationMs: resp.durationMs,
        ok,
        error: null,
        assertions,
      });
    } catch (err) {
      reports.push({
        name: req.name,
        method: req.method,
        url: resolved.url,
        status: 0,
        durationMs: 0,
        ok: false,
        error: err instanceof Error ? err.message : String(err),
        assertions: [],
      });
    }
  }

  const passedRequests = reports.filter((r) => r.ok).length;
  const totalAssertions = reports.reduce((s, r) => s + r.assertions.length, 0);
  const passedAssertions = reports.reduce(
    (s, r) => s + r.assertions.filter((a) => a.passed).length,
    0,
  );
  return {
    name: doc.name,
    total: reports.length,
    passedRequests,
    failedRequests: reports.length - passedRequests,
    totalAssertions,
    passedAssertions,
    requests: reports,
  };
}

/** Jalankan dokumen sekali per baris dataset (data-driven), tiap baris jadi variabel. */
export async function runCollectionData(
  doc: RunDocument,
  variables: KeyValue[],
  dataset: Record<string, string>[],
): Promise<RunReport[]> {
  const out: RunReport[] = [];
  for (const row of dataset) {
    const rowVars: KeyValue[] = Object.entries(row).map(([key, value]) => ({
      key,
      value: String(value),
      enabled: true,
    }));
    out.push(await runCollection(doc, [...variables, ...rowVars]));
  }
  return out;
}

/** Parse dataset dari teks CSV atau JSON (array objek) menjadi baris variabel. */
export function parseDataset(text: string): Record<string, string>[] {
  const t = text.trim();
  if (!t) return [];
  if (t.startsWith("[") || t.startsWith("{")) {
    const j = JSON.parse(t);
    const arr = Array.isArray(j) ? j : [j];
    return arr.map((o) => {
      const r: Record<string, string> = {};
      for (const [k, v] of Object.entries(o as Record<string, unknown>)) r[k] = String(v);
      return r;
    });
  }
  return parseCsv(t);
}

function csvRows(text: string): string[][] {
  const s = text.replace(/\r\n?/g, "\n");
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inq = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (inq) {
      if (c === '"') {
        if (s[i + 1] === '"') {
          cell += '"';
          i++;
        } else inq = false;
      } else cell += c;
    } else if (c === '"') inq = true;
    else if (c === ",") {
      row.push(cell);
      cell = "";
    } else if (c === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function parseCsv(text: string): Record<string, string>[] {
  const rows = csvRows(text);
  if (rows.length < 2) return [];
  const headers = rows[0].map((h) => h.trim());
  return rows
    .slice(1)
    .filter((r) => r.some((c) => c.trim() !== ""))
    .map((cells) => {
      const o: Record<string, string> = {};
      headers.forEach((h, i) => {
        if (h) o[h] = (cells[i] ?? "").trim();
      });
      return o;
    });
}

/** Unduh dokumen sebagai file .pxs.json (untuk dijalankan via CLI `proxius run`). */
export function downloadRunDocument(doc: RunDocument) {
  const blob = new Blob([JSON.stringify(doc, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${doc.name.replace(/\s+/g, "-").toLowerCase() || "collection"}.pxs.json`;
  a.click();
  URL.revokeObjectURL(url);
}
