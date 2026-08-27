// Evaluasi assertion di sisi UI (mirror crate `runner`).
// Sumber kebenaran headless tetap Rust; ini fallback untuk feedback langsung
// (dan satu-satunya jalur di mode browser). JSONPath di sini disederhanakan;
// versi native (Rust) mendukung RFC 9535 penuh.

import type {
  Assertion,
  AssertionResult,
  AssertionSource,
  HttpRequest,
  HttpResponse,
} from "./types";
import { validateJsonText } from "./schema";

/** JSONPath minimal: $.a.b[0].c, $['a']['b'], indeks array. */
export function jsonPath(body: string, path: string): string | undefined {
  let json: unknown;
  try {
    json = JSON.parse(body);
  } catch {
    return undefined;
  }
  const segs = path
    .replace(/^\$/, "")
    .replace(/\['([^']+)'\]/g, ".$1")
    .replace(/\["([^"]+)"\]/g, ".$1")
    .replace(/\[(\d+)\]/g, ".$1")
    .split(".")
    .filter(Boolean);

  let cur: any = json;
  for (const s of segs) {
    if (cur == null) return undefined;
    cur = cur[s];
  }
  if (cur === undefined) return undefined;
  return typeof cur === "string" ? cur : JSON.stringify(cur);
}

function headerValue(resp: HttpResponse, name: string): string | undefined {
  const h = resp.headers.find(
    (h) => h.key.toLowerCase() === name.toLowerCase(),
  );
  return h?.value;
}

function sourceValue(
  src: AssertionSource,
  resp: HttpResponse,
): string | undefined {
  switch (src.kind) {
    case "status":
      return String(resp.status);
    case "responseTime":
      return String(resp.durationMs);
    case "header":
      return headerValue(resp, src.name);
    case "jsonPath":
      return jsonPath(resp.body, src.path);
    case "body":
      return resp.body;
  }
}

function sourceLabel(src: AssertionSource): string {
  switch (src.kind) {
    case "status":
      return "status";
    case "responseTime":
      return "responseTime";
    case "header":
      return `header[${src.name}]`;
    case "jsonPath":
      return `jsonpath(${src.path})`;
    case "body":
      return "body";
  }
}

const OP_LABEL: Record<string, string> = {
  equals: "equals",
  notEquals: "not equals",
  contains: "contains",
  notContains: "not contains",
  exists: "exists",
  notExists: "not exists",
  lessThan: "<",
  greaterThan: ">",
  matches: "matches",
  matchesSchema: "matches schema",
};

function num(s: string): number | null {
  const n = Number(s.trim());
  return s.trim() !== "" && !Number.isNaN(n) ? n : null;
}

function compare(op: string, actual: string, expected: string): [boolean, string] {
  switch (op) {
    case "equals": {
      const a = num(actual);
      const b = num(expected);
      const eq = a !== null && b !== null ? a === b : actual.trim() === expected.trim();
      return eq ? [true, ""] : [false, `diharapkan \`${expected}\`, dapat \`${actual}\``];
    }
    case "notEquals":
      return actual.trim() !== expected.trim()
        ? [true, ""]
        : [false, `tidak boleh sama dengan \`${expected}\``];
    case "contains":
      return actual.includes(expected)
        ? [true, ""]
        : [false, `\`${actual}\` tidak memuat \`${expected}\``];
    case "notContains":
      return !actual.includes(expected)
        ? [true, ""]
        : [false, `\`${actual}\` seharusnya tidak memuat \`${expected}\``];
    case "lessThan":
    case "greaterThan": {
      const a = num(actual);
      const b = num(expected);
      if (a === null || b === null) return [false, "perbandingan numerik butuh angka"];
      const ok = op === "lessThan" ? a < b : a > b;
      return ok ? [true, ""] : [false, `${a} ${OP_LABEL[op]} ${b} bernilai salah`];
    }
    case "matches":
      try {
        return new RegExp(expected).test(actual)
          ? [true, ""]
          : [false, `\`${actual}\` tidak cocok /${expected}/`];
      } catch (e) {
        return [false, `regex tidak valid: ${e instanceof Error ? e.message : e}`];
      }
    default:
      return [true, ""];
  }
}

/** Deskripsi assertion yang mudah dibaca, mis. "status equals 200". */
export function describeAssertion(a: Assertion): string {
  const label = `${sourceLabel(a.source)} ${OP_LABEL[a.op] ?? a.op}`;
  if (a.op === "matchesSchema") return `${sourceLabel(a.source)} matches JSON Schema`;
  const valueless = a.op === "exists" || a.op === "notExists";
  return valueless ? label : `${label} ${a.value}`.trimEnd();
}

function evalOne(a: Assertion, resp: HttpResponse): AssertionResult {
  const actual = sourceValue(a.source, resp);
  const description =
    a.op === "matchesSchema"
      ? `${sourceLabel(a.source)} matches JSON Schema`
      : `${sourceLabel(a.source)} ${OP_LABEL[a.op]} ${a.value}`;

  let passed: boolean;
  let message: string;
  if (a.op === "matchesSchema") {
    // `actual` = teks JSON dari sumber (body / jsonpath), `a.value` = JSON Schema.
    if (actual === undefined) {
      passed = false;
      message = "nilai tidak ditemukan";
    } else {
      const r = validateJsonText(a.value, actual);
      passed = r.valid;
      message = r.message;
    }
    return { id: a.id, passed, description, actual: actual ?? "", message };
  }
  if (a.op === "exists") {
    passed = actual !== undefined;
    message = passed ? "" : "nilai tidak ditemukan";
  } else if (a.op === "notExists") {
    passed = actual === undefined;
    message = passed ? "" : "nilai seharusnya tidak ada";
  } else if (actual === undefined) {
    passed = false;
    message = "nilai tidak ditemukan";
  } else {
    [passed, message] = compare(a.op, actual, a.value);
  }

  return { id: a.id, passed, description, actual: actual ?? "", message };
}

/** Evaluasi semua assertion aktif sebuah request terhadap response. */
export function evaluate(
  request: HttpRequest,
  resp: HttpResponse,
): AssertionResult[] {
  return request.assertions.filter((a) => a.enabled).map((a) => evalOne(a, resp));
}
