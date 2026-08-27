// Menjalankan test case (QA) di sisi UI: terapkan override request, kirim,
// lalu evaluasi assertion. Positif/negatif diperlakukan sama secara mekanis —
// bedanya hanya pada ekspektasi yang ditulis user.

import { sendRequest } from "./api";
import { applyAuth } from "./auth";
import { evaluate, describeAssertion } from "./assert";
import { interpolate, resolveRequest } from "./vars";
import { bodyRawText } from "./body";
import { parseDataset } from "./run";
import { tr } from "../store/i18n";
import {
  uid,
  type Assertion,
  type AssertionOp,
  type AssertionResult,
  type HttpRequest,
  type HttpResponse,
  type KeyValue,
  type TestCase,
  type TestInput,
  type TestKind,
  type TestOverride,
} from "./types";

export interface TestRowResult {
  name: string;
  passed: boolean;
  status: number;
  error?: string;
  assertions: AssertionResult[];
}

export interface TestCaseResult {
  id: string;
  passed: boolean;
  status: number;
  durationMs: number;
  error?: string;
  assertions: AssertionResult[];
  /** Bila data-driven: hasil per baris dataset. */
  rows?: TestRowResult[];
  /** Jumlah iterasi (baris) yang dijalankan. */
  iterations?: number;
}

function mergeHeaders(base: KeyValue[], ov?: KeyValue[]): KeyValue[] {
  if (!ov || ov.length === 0) return base;
  const out = [...base];
  for (const h of ov) {
    if (!h.key) continue;
    const i = out.findIndex((x) => x.key.toLowerCase() === h.key.toLowerCase());
    if (i >= 0) out[i] = h;
    else out.push(h);
  }
  return out;
}

/** Gabungkan override ke request dasar. */
export function applyOverride(base: HttpRequest, ov: TestOverride): HttpRequest {
  return {
    ...base,
    method: ov.method ?? base.method,
    url: ov.url && ov.url.trim() ? ov.url : base.url,
    headers: mergeHeaders(base.headers, ov.headers),
    body: ov.body ?? base.body,
    auth: ov.auth ?? base.auth,
  };
}

/** Ubah string angka/boolean/null jadi tipe JSON-nya; selain itu tetap string. */
function coerce(value: string): unknown {
  const t = value.trim();
  if (t === "true") return true;
  if (t === "false") return false;
  if (t === "null") return null;
  if (t !== "" && !Number.isNaN(Number(t)) && /^-?\d+(\.\d+)?$/.test(t)) return Number(t);
  return value;
}

/** Set satu field (mendukung dot-path "a.b") pada body JSON, kembalikan JSON baru. */
function setJsonField(bodyContent: string, key: string, value: string): string {
  let obj: any;
  try {
    obj = bodyContent.trim() ? JSON.parse(bodyContent) : {};
  } catch {
    obj = {};
  }
  if (typeof obj !== "object" || obj === null || Array.isArray(obj)) obj = {};
  const parts = key.split(".").filter(Boolean);
  if (parts.length === 0) return JSON.stringify(obj, null, 2);
  let cur = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    if (typeof cur[parts[i]] !== "object" || cur[parts[i]] === null) cur[parts[i]] = {};
    cur = cur[parts[i]];
  }
  cur[parts[parts.length - 1]] = coerce(value);
  return JSON.stringify(obj, null, 2);
}

/** Terapkan input skenario ("Diberikan"): field body → patch body JSON,
 * variabel → tambahkan ke peta variabel untuk run ini. */
export function applyInputs(
  base: HttpRequest,
  tc: TestCase,
  vars: Record<string, string>,
): { req: HttpRequest; vars: Record<string, string> } {
  const inputs = (tc.inputs ?? []).filter((i) => i.enabled && i.key.trim());
  if (inputs.length === 0) return { req: base, vars };
  const localVars = { ...vars };
  let bodyContent = bodyRawText(base.body);
  let touchedBody = false;
  for (const inp of inputs) {
    if (inp.target === "var") localVars[inp.key.trim()] = inp.value;
    else {
      bodyContent = setJsonField(bodyContent, inp.key.trim(), inp.value);
      touchedBody = true;
    }
  }
  const req = touchedBody
    ? { ...base, body: { kind: "json" as const, content: bodyContent } }
    : base;
  return { req, vars: localVars };
}

/** Jalankan satu test case: kirim request (dengan override) & cek assertion. */
export async function runTestCase(
  base: HttpRequest,
  tc: TestCase,
  vars: Record<string, string>,
): Promise<TestCaseResult> {
  // Terapkan input skenario dulu (body/variabel), lalu override mentah.
  const { req: withInputs, vars: v } = applyInputs(base, tc, vars);
  const resolved = await applyAuth(resolveRequest(applyOverride(withInputs, tc.override), v), v);
  const withAsserts: HttpRequest = {
    ...resolved,
    assertions: tc.assertions.map((a) => ({ ...a, value: interpolate(a.value, v) })),
  };
  try {
    const resp = await sendRequest(resolved, base.settings);
    const results = evaluate(withAsserts, resp);
    const passed = results.length === 0 ? true : results.every((r) => r.passed);
    return {
      id: tc.id,
      passed,
      status: resp.status,
      durationMs: resp.durationMs,
      assertions: results,
    };
  } catch (e) {
    return {
      id: tc.id,
      passed: false,
      status: 0,
      durationMs: 0,
      error: e instanceof Error ? e.message : String(e),
      assertions: [],
    };
  }
}

// ── Data-driven (Examples) ──────────────────────────────────────────

/** Kolom (urut kemunculan) + baris dari dataset CSV/JSON sebuah kasus. */
export function parseTestDataset(text: string | undefined): {
  columns: string[];
  rows: Record<string, string>[];
} {
  if (!text || !text.trim()) return { columns: [], rows: [] };
  let rows: Record<string, string>[] = [];
  try {
    rows = parseDataset(text);
  } catch {
    return { columns: [], rows: [] };
  }
  const columns: string[] = [];
  for (const r of rows) for (const k of Object.keys(r)) if (!columns.includes(k)) columns.push(k);
  return { columns, rows };
}

/** Label ringkas satu baris dataset, mis. `user=admin, role=x`. */
function rowLabel(row: Record<string, string>, i: number): string {
  const parts = Object.entries(row)
    .slice(0, 3)
    .map(([k, v]) => `${k}=${maskSecret(k, v)}`);
  return parts.length ? parts.join(", ") : `#${i + 1}`;
}

/** Jalankan kasus; bila punya dataset, sekali per baris (kolom → variabel).
 * Mengembalikan satu TestCaseResult dengan `rows[]` bila data-driven. */
export async function runTestCaseAll(
  base: HttpRequest,
  tc: TestCase,
  vars: Record<string, string>,
): Promise<TestCaseResult> {
  const { rows } = parseTestDataset(tc.dataset);
  if (rows.length === 0) return runTestCase(base, tc, vars);

  const rowResults: TestRowResult[] = [];
  for (let i = 0; i < rows.length; i++) {
    const r = await runTestCase(base, tc, { ...vars, ...rows[i] });
    rowResults.push({
      name: rowLabel(rows[i], i),
      passed: r.passed,
      status: r.status,
      error: r.error,
      assertions: r.assertions,
    });
  }
  const passed = rowResults.every((r) => r.passed);
  const first = rowResults[0];
  return {
    id: tc.id,
    passed,
    status: first?.status ?? 0,
    durationMs: 0,
    assertions: first?.assertions ?? [],
    rows: rowResults,
    iterations: rows.length,
  };
}

/** Assertion dari kasus positif — disalin ke `request.assertions` agar CLI /
 * run_collection dan indikator response lama tetap jalan. */
export function positiveAssertions(tests: TestCase[]): Assertion[] {
  return tests.filter((t) => t.kind === "positive").flatMap((t) => t.assertions);
}

const statusAssertion = (value: string): Assertion => ({
  id: uid("as"),
  source: { kind: "status" },
  op: "equals",
  value,
  enabled: true,
});

export function emptyTestCase(kind: TestKind): TestCase {
  return {
    id: uid("tc"),
    name: kind === "positive" ? tr("scenarioPositiveDefault") : tr("scenarioNegativeDefault"),
    description: "",
    kind,
    inputs: [],
    scenario: {},
    override: {},
    assertions: [statusAssertion(kind === "positive" ? "200" : "400")],
  };
}

// ── QA scenario helpers ─────────────────────────────────────────────

/** Status yang diharapkan (dari assertion status equals), bila ada. */
export function expectedStatus(tc: TestCase): string | null {
  const a = tc.assertions.find((x) => x.source.kind === "status" && x.op === "equals");
  return a ? a.value : null;
}

const SECRET_RE = /pass|secret|token|key|pwd|otp/i;
/** Samarkan nilai rahasia (password dsb.) di ringkasan. */
function maskSecret(key: string, value: string): string {
  return SECRET_RE.test(key) && value ? "•••" : value;
}

const activeInputs = (tc: TestCase): TestInput[] =>
  (tc.inputs ?? []).filter((i) => i.enabled && i.key.trim());

/** Ringkasan 1 baris skenario, mis. `username=admin, password=••• → 200, +1 cek`. */
export function scenarioSummary(tc: TestCase): string {
  const inStr = activeInputs(tc)
    .map((i) => `${i.key}=${maskSecret(i.key, i.value) || "∅"}`)
    .join(", ");
  const st = expectedStatus(tc);
  const checks = tc.assertions.filter(
    (a) => a.enabled && !(a.source.kind === "status" && a.op === "equals"),
  ).length;
  const right = [st, checks ? `+${checks}` : null].filter(Boolean).join(", ");
  return [inStr, right].filter(Boolean).join(" → ");
}

/** Klausa "Given" turunan dari inputs, mis. `username is "admin" and password is "•••"`. */
export function deriveGiven(tc: TestCase): string {
  const parts = activeInputs(tc).map((i) => `${i.key} is "${maskSecret(i.key, i.value)}"`);
  return parts.join(" and ");
}

/** Klausa "Then" turunan dari ekspektasi (status + assertion lain). */
function deriveThens(tc: TestCase): string[] {
  const out: string[] = [];
  const st = expectedStatus(tc);
  if (st) out.push(`the response status is ${st}`);
  for (const a of tc.assertions) {
    if (!a.enabled) continue;
    if (a.source.kind === "status" && a.op === "equals") continue;
    out.push(`the response ${describeAssertion(a)}`);
  }
  return out;
}

/** Ganti `{{col}}` → `<col>` untuk placeholder Scenario Outline. */
function toOutlinePlaceholders(text: string, columns: string[]): string {
  let out = text;
  for (const c of columns) {
    out = out.replace(new RegExp(`\\{\\{\\s*${c}\\s*\\}\\}`, "g"), `<${c}>`);
  }
  return out;
}

function gherkinTableRow(cells: string[]): string {
  return `      | ${cells.map((c) => c.replace(/\|/g, "\\|")).join(" | ")} |`;
}

/** Export daftar test case sebuah request ke teks Gherkin (.feature).
 * Kasus dengan dataset → Scenario Outline + tabel Examples. */
export function toGherkin(featureName: string, tests: TestCase[]): string {
  const lines: string[] = [`Feature: ${featureName || "API"}`, ""];
  for (const tc of tests) {
    const { columns, rows } = parseTestDataset(tc.dataset);
    const outline = columns.length > 0 && rows.length > 0;
    lines.push(`  @${tc.kind}`);
    lines.push(`  ${outline ? "Scenario Outline" : "Scenario"}: ${tc.name || "(untitled)"}`);

    // Given
    let given = (tc.scenario?.given ?? "").trim() || deriveGiven(tc);
    if (outline) {
      given = toOutlinePlaceholders(given, columns);
      // Bila tak ada Given eksplisit, turunkan dari kolom dataset.
      if (!given) given = columns.map((c) => `${c} is "<${c}>"`).join(" and ");
    }
    if (given) lines.push(`    Given ${given}`);

    // When
    const when = (tc.scenario?.when ?? "").trim() || "the request is sent";
    lines.push(`    When ${outline ? toOutlinePlaceholders(when, columns) : when}`);

    // Then
    let thens = deriveThens(tc);
    const explicitThen = (tc.scenario?.then ?? "").trim();
    if (thens.length === 0 && explicitThen) thens.push(explicitThen);
    if (thens.length === 0) thens.push("the response is as expected");
    if (outline) thens = thens.map((t) => toOutlinePlaceholders(t, columns));
    thens.forEach((t, i) => lines.push(`    ${i === 0 ? "Then" : "And"} ${t}`));

    // Examples
    if (outline) {
      lines.push("");
      lines.push("    Examples:");
      lines.push(gherkinTableRow(columns));
      for (const row of rows) lines.push(gherkinTableRow(columns.map((c) => row[c] ?? "")));
    }
    lines.push("");
  }
  return lines.join("\n").trimEnd() + "\n";
}

const jp = (path: string, op: AssertionOp, value = ""): Assertion => ({
  id: uid("as"),
  source: { kind: "jsonPath", path },
  op,
  value,
  enabled: true,
});

/** Generate suite QA detail dari response NYATA (tanpa AI):
 * happy path (status + content-type + responseTime + field jsonpath) + kasus
 * negatif "tanpa auth → 401" bila request memakai otorisasi. */
export function generateSuite(base: HttpRequest, response: HttpResponse): TestCase[] {
  const asserts: Assertion[] = [statusAssertion(String(response.status))];

  const ct = response.headers.find((h) => h.key.toLowerCase() === "content-type")?.value;
  if (ct) {
    asserts.push({
      id: uid("as"),
      source: { kind: "header", name: "content-type" },
      op: "contains",
      value: ct.split(";")[0].trim(),
      enabled: true,
    });
  }
  asserts.push({
    id: uid("as"),
    source: { kind: "responseTime" },
    op: "lessThan",
    value: String(Math.max(1000, response.durationMs * 3)),
    enabled: true,
  });

  try {
    const body = JSON.parse(response.body);
    if (Array.isArray(body)) {
      asserts.push(jp("$", "exists"));
      if (body.length) asserts.push(jp("$[0]", "exists"));
    } else if (body && typeof body === "object") {
      for (const key of Object.keys(body as Record<string, unknown>).slice(0, 15)) {
        asserts.push(jp(`$.${key}`, "exists"));
        const v = (body as Record<string, unknown>)[key];
        // Field boolean = nilai stabil → jadikan assertion nilai (regresi).
        if (typeof v === "boolean") asserts.push(jp(`$.${key}`, "equals", String(v)));
      }
    }
  } catch {
    // body bukan JSON → cukup status + content-type + responseTime.
  }

  const suite: TestCase[] = [
    {
      id: uid("tc"),
      name: tr("suiteHappyPath"),
      kind: "positive",
      inputs: [],
      scenario: {},
      override: {},
      assertions: asserts,
    },
  ];

  if (base.auth && base.auth.type !== "none" && base.auth.type !== "inherit") {
    suite.push({
      id: uid("tc"),
      name: tr("suiteUnauthorized"),
      kind: "negative",
      inputs: [],
      scenario: {},
      override: { auth: { type: "none" } },
      assertions: [statusAssertion("401")],
    });
  }
  return suite;
}

/** Migrasi assertion lama → satu kasus positif "Default". */
export function migrateAssertions(assertions: Assertion[]): TestCase[] {
  if (assertions.length === 0) return [];
  return [
    {
      id: uid("tc"),
      name: "Default",
      kind: "positive",
      override: {},
      assertions: assertions.map((a) => ({ ...a })),
    },
  ];
}
