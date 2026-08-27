// Runtime script mini ala Postman `pm`. Menjalankan JS pre-request /
// post-response dengan subset API yang umum (pm.test, pm.expect, pm.response,
// pm.environment/variables). Bukan sandbox penuh — cukup untuk dev tool lokal.

import type { HttpResponse } from "./types";

export interface ScriptTest {
  name: string;
  passed: boolean;
  error?: string;
}

export interface ScriptResult {
  tests: ScriptTest[];
  logs: string[];
  error?: string;
}

interface ScriptCtx {
  response?: HttpResponse;
  getVar: (k: string) => string | undefined;
  setVar: (k: string, v: string) => void;
}

/** chai-mini: pm.expect(x).to.equal/eql/include/be.above/below/a, .to.exist, .to.be.ok */
function makeExpect() {
  return (actual: any) => {
    const fail = (m: string) => {
      throw new Error(m);
    };
    const be: any = {
      above: (n: number) => actual > n || fail(`expected ${actual} > ${n}`),
      below: (n: number) => actual < n || fail(`expected ${actual} < ${n}`),
      a: (t: string) => typeof actual === t || fail(`expected type ${t}, got ${typeof actual}`),
      equal: (e: any) => actual === e || fail(`expected ${j(actual)} to equal ${j(e)}`),
    };
    Object.defineProperty(be, "ok", {
      get: () => (actual ? true : fail(`expected ${j(actual)} to be truthy`)),
    });
    Object.defineProperty(be, "true", {
      get: () => actual === true || fail(`expected true`),
    });
    Object.defineProperty(be, "false", {
      get: () => actual === false || fail(`expected false`),
    });
    const to: any = {
      be,
      equal: (e: any) => actual === e || fail(`expected ${j(actual)} to equal ${j(e)}`),
      eql: (e: any) => j(actual) === j(e) || fail(`expected ${j(actual)} to eql ${j(e)}`),
      include: (e: any) =>
        (typeof actual === "string" && actual.includes(e)) ||
        (Array.isArray(actual) && actual.includes(e)) ||
        fail(`expected ${j(actual)} to include ${j(e)}`),
    };
    Object.defineProperty(to, "exist", {
      get: () => (actual != null ? true : fail(`expected value to exist`)),
    });
    return { to };
  };
}

const j = (v: any) => {
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
};

export function runScript(code: string, ctx: ScriptCtx): ScriptResult {
  if (!code || !code.trim()) return { tests: [], logs: [] };
  const tests: ScriptTest[] = [];
  const logs: string[] = [];

  const resp = ctx.response;
  const pm = {
    response: resp
      ? {
          code: resp.status,
          status: resp.statusText,
          responseTime: resp.durationMs,
          text: () => resp.body,
          json: () => JSON.parse(resp.body),
          headers: {
            get: (n: string) =>
              resp.headers.find((h) => h.key.toLowerCase() === n.toLowerCase())?.value,
          },
        }
      : undefined,
    environment: { set: ctx.setVar, get: ctx.getVar },
    variables: { set: ctx.setVar, get: ctx.getVar },
    expect: makeExpect(),
    test: (name: string, fn: () => void) => {
      try {
        fn();
        tests.push({ name, passed: true });
      } catch (e) {
        tests.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) });
      }
    },
  };
  const cons = { log: (...a: any[]) => logs.push(a.map((x) => (typeof x === "string" ? x : j(x))).join(" ")) };

  try {
    // eslint-disable-next-line no-new-func
    new Function("pm", "console", code)(pm, cons);
  } catch (e) {
    return { tests, logs, error: e instanceof Error ? e.message : String(e) };
  }
  return { tests, logs };
}
