// Export collection Proxius ke skrip framework testing/load: Playwright, k6,
// dan Postman collection (untuk `newman run`). Berdasarkan request + assertions.
import { flatten } from "./run";
import { bodyRawText, normalizeBody } from "./body";
import type { Assertion, Collection, HttpRequest, KeyValue } from "./types";

export type FrameworkTarget = "playwright" | "k6" | "postman";

const active = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key);
const jstr = (s: string) => JSON.stringify(s);
const jpath = (p: string) => p.replace(/^\$\.?/, ""); // "$.a.b" → "a.b"

function fullUrl(req: HttpRequest): string {
  const q = active(req.query)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  return q ? req.url + (req.url.includes("?") ? "&" : "?") + q : req.url;
}

function headersObj(req: HttpRequest): Record<string, string> {
  const o: Record<string, string> = {};
  for (const h of active(req.headers)) o[h.key] = h.value;
  return o;
}

function reqBody(req: HttpRequest): string {
  return bodyRawText(normalizeBody(req.body));
}

// ── Playwright (@playwright/test, APIRequestContext) ────────────────

function pwChecks(a: Assertion): string | null {
  const v = a.value;
  switch (a.source.kind) {
    case "status":
      return `  expect(res.status()).toBe(${Number(v) || v});`;
    case "responseTime":
      return null; // durasi tak diekspos langsung
    case "header":
      return `  expect(String(res.headers()[${jstr(a.source.name.toLowerCase())}] ?? "")).toContain(${jstr(v)});`;
    case "jsonPath": {
      const path = jpath(a.source.path)
        .split(".")
        .map((k) => `[${jstr(k)}]`)
        .join("");
      if (a.op === "exists") return `  expect(body${path}).toBeDefined();`;
      if (a.op === "notExists") return `  expect(body${path}).toBeUndefined();`;
      if (a.op === "equals") return `  expect(String(body${path})).toBe(${jstr(v)});`;
      if (a.op === "contains") return `  expect(String(body${path})).toContain(${jstr(v)});`;
      return null;
    }
    default:
      return null;
  }
}

function playwright(col: Collection): string {
  const out = [`import { test, expect } from "@playwright/test";`, ""];
  for (const req of flatten(col.nodes)) {
    const asserts = req.assertions.filter((a) => a.enabled);
    const needsBody = asserts.some((a) => a.source.kind === "jsonPath");
    const method = req.method.toLowerCase();
    const opts: string[] = [`headers: ${JSON.stringify(headersObj(req))}`];
    const b = reqBody(req);
    if (b && method !== "get" && method !== "head") opts.push(`data: ${jstr(b)}`);
    out.push(`test(${jstr(req.name || fullUrl(req))}, async ({ request }) => {`);
    out.push(`  const res = await request.${method}(${jstr(fullUrl(req))}, { ${opts.join(", ")} });`);
    if (needsBody) out.push(`  const body = await res.json();`);
    for (const a of asserts) {
      const line = pwChecks(a);
      if (line) out.push(line);
    }
    out.push(`});`, "");
  }
  return out.join("\n");
}

// ── k6 (load test) ──────────────────────────────────────────────────

function k6Check(a: Assertion): string | null {
  const v = a.value;
  switch (a.source.kind) {
    case "status":
      return `    ${jstr(`status is ${v}`)}: (r) => r.status === ${Number(v) || 0},`;
    case "responseTime":
      return `    ${jstr(`response < ${v}ms`)}: (r) => r.timings.duration < ${Number(v) || 0},`;
    case "header":
      return `    ${jstr(`header ${a.source.name}`)}: (r) => String(r.headers[${jstr(a.source.name)}] || "").includes(${jstr(v)}),`;
    case "jsonPath": {
      const p = jstr(jpath(a.source.path));
      if (a.op === "exists") return `    ${jstr(`has ${a.source.path}`)}: (r) => r.json(${p}) !== undefined && r.json(${p}) !== null,`;
      if (a.op === "equals") return `    ${jstr(`${a.source.path} == ${v}`)}: (r) => String(r.json(${p})) === ${jstr(v)},`;
      return null;
    }
    default:
      return null;
  }
}

function k6(col: Collection): string {
  const out = [
    `import http from "k6/http";`,
    `import { check, sleep } from "k6";`,
    ``,
    `export const options = { vus: 10, duration: "30s" };`,
    ``,
    `export default function () {`,
  ];
  for (const req of flatten(col.nodes)) {
    const method = req.method.toLowerCase();
    const b = reqBody(req);
    const params = `{ headers: ${JSON.stringify(headersObj(req))} }`;
    const args =
      method === "get" || method === "head"
        ? `${jstr(fullUrl(req))}, ${params}`
        : `${jstr(fullUrl(req))}, ${jstr(b)}, ${params}`;
    out.push(`  {`);
    out.push(`    const res = http.${method}(${args});`);
    const checks = req.assertions
      .filter((a) => a.enabled)
      .map(k6Check)
      .filter(Boolean);
    if (checks.length) {
      out.push(`    check(res, {`);
      out.push(...(checks as string[]));
      out.push(`    });`);
    }
    out.push(`  }`);
  }
  out.push(`  sleep(1);`, `}`);
  return out.join("\n");
}

// ── Postman collection v2.1 (untuk `newman run`) ────────────────────

function pmTest(a: Assertion): string | null {
  const v = a.value;
  switch (a.source.kind) {
    case "status":
      return `pm.test(${jstr(`status is ${v}`)}, () => pm.response.to.have.status(${Number(v) || 0}));`;
    case "responseTime":
      return `pm.test(${jstr(`response < ${v}ms`)}, () => pm.expect(pm.response.responseTime).to.be.below(${Number(v) || 0}));`;
    case "header":
      return `pm.test(${jstr(`header ${a.source.name}`)}, () => pm.expect(String(pm.response.headers.get(${jstr(a.source.name)}) || "")).to.include(${jstr(v)}));`;
    case "jsonPath": {
      const path = jpath(a.source.path)
        .split(".")
        .map((k) => `[${jstr(k)}]`)
        .join("");
      if (a.op === "exists") return `pm.test(${jstr(`has ${a.source.path}`)}, () => pm.expect(pm.response.json()${path}).to.exist);`;
      if (a.op === "equals") return `pm.test(${jstr(`${a.source.path} == ${v}`)}, () => pm.expect(String(pm.response.json()${path})).to.eql(${jstr(v)}));`;
      return null;
    }
    default:
      return null;
  }
}

function postman(col: Collection): unknown {
  const items = flatten(col.nodes).map((req) => {
    const testLines = req.assertions
      .filter((a) => a.enabled)
      .map(pmTest)
      .filter(Boolean) as string[];
    const b = reqBody(req);
    const request: Record<string, unknown> = {
      method: req.method,
      header: active(req.headers).map((h) => ({ key: h.key, value: h.value })),
      url: {
        raw: fullUrl(req),
        query: active(req.query).map((q) => ({ key: q.key, value: q.value })),
      },
    };
    if (b && req.method !== "GET" && req.method !== "HEAD") {
      request.body = { mode: "raw", raw: b, options: { raw: { language: "json" } } };
    }
    return {
      name: req.name || fullUrl(req),
      request,
      event: testLines.length
        ? [{ listen: "test", script: { type: "text/javascript", exec: testLines } }]
        : [],
    };
  });
  return {
    info: { name: col.name, schema: "https://schema.getpostman.com/json/collection/v2.1.0/collection.json" },
    item: items,
  };
}

export function toFramework(col: Collection, target: FrameworkTarget): { text: string; ext: string } {
  switch (target) {
    case "playwright":
      return { text: playwright(col), ext: "spec.ts" };
    case "k6":
      return { text: k6(col), ext: "k6.js" };
    case "postman":
      return { text: JSON.stringify(postman(col), null, 2), ext: "postman_collection.json" };
  }
}
