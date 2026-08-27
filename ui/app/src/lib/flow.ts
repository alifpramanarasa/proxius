// Menjalankan flow e2e: request berurutan dengan variabel yang mengalir
// antar-langkah. Chaining dilakukan via (a) post-response script
// `pm.environment.set(...)`, dan (b) aturan extract pada request.

import { sendRequest } from "./api";
import { applyAuth } from "./auth";
import { jsonPath } from "./assert";
import { evaluate } from "./assert";
import { runScript } from "./script";
import { resolveRequest } from "./vars";
import type {
  AssertionResult,
  Extract,
  Flow,
  FlowStep,
  HttpRequest,
  HttpResponse,
} from "./types";

export interface FlowStepResult {
  stepId: string;
  name: string;
  method: string;
  url: string;
  status: number;
  durationMs: number;
  ok: boolean;
  error?: string;
  assertions: AssertionResult[];
  /** Variabel yang di-set langkah ini (extract / pm.environment.set). */
  extracted: Record<string, string>;
}

export interface FlowResult {
  steps: FlowStepResult[];
  passed: boolean;
}

function headerValue(resp: HttpResponse, name: string): string | undefined {
  return resp.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
}

/** Terapkan sederet aturan extract ke `vars`; kembalikan yang di-set. */
function applyExtractRules(
  rules: Extract[],
  resp: HttpResponse,
  vars: Record<string, string>,
): Record<string, string> {
  const set: Record<string, string> = {};
  for (const e of rules.filter((x) => x.enabled && x.var)) {
    let val: string | undefined;
    switch (e.from.kind) {
      case "jsonPath":
        val = jsonPath(resp.body, e.from.path);
        break;
      case "header":
        val = headerValue(resp, e.from.name);
        break;
      case "status":
        val = String(resp.status);
        break;
      case "body":
        val = resp.body;
        break;
    }
    if (val !== undefined) {
      vars[e.var] = val;
      set[e.var] = val;
    }
  }
  return set;
}

/** Jalankan flow. `resolveReq` memetakan step → request; `baseVars` dari env. */
export async function runFlow(
  flow: Flow,
  resolveReq: (step: FlowStep) => HttpRequest | null,
  baseVars: Record<string, string>,
): Promise<FlowResult> {
  const vars: Record<string, string> = { ...baseVars };
  const steps: FlowStepResult[] = [];

  for (const step of flow.steps) {
    const req = resolveReq(step);
    const name = step.name || req?.name || "step";
    if (!req) {
      steps.push({
        stepId: step.id,
        name,
        method: "",
        url: "",
        status: 0,
        durationMs: 0,
        ok: false,
        error: "request tidak ditemukan (mungkin sudah dihapus)",
        assertions: [],
        extracted: {},
      });
      continue;
    }

    const extracted: Record<string, string> = {};
    try {
      // Pre-request script (boleh set variabel).
      if (req.scripts?.preRequest) {
        runScript(req.scripts.preRequest, {
          getVar: (k) => vars[k],
          setVar: (k, v) => {
            vars[k] = v;
            extracted[k] = v;
          },
        });
      }

      const resolved = await applyAuth(resolveRequest(req, vars), vars);
      const resp = await sendRequest(resolved, req.settings);
      const results = evaluate(resolved, resp);

      // Post-response script (pm.test + pm.environment.set → chaining).
      let scriptOk = true;
      if (req.scripts?.postResponse) {
        const r = runScript(req.scripts.postResponse, {
          response: resp,
          getVar: (k) => vars[k],
          setVar: (k, v) => {
            vars[k] = v;
            extracted[k] = v;
          },
        });
        scriptOk = !r.error && r.tests.every((t) => t.passed);
      }

      // Extract: aturan pada request, lalu aturan khusus langkah (menang).
      Object.assign(extracted, applyExtractRules(req.extracts ?? [], resp, vars));
      Object.assign(extracted, applyExtractRules(step.extracts ?? [], resp, vars));

      const ok = resp.status > 0 && results.every((a) => a.passed) && scriptOk;
      steps.push({
        stepId: step.id,
        name,
        method: req.method,
        url: resolved.url,
        status: resp.status,
        durationMs: resp.durationMs,
        ok,
        assertions: results,
        extracted,
      });
    } catch (e) {
      steps.push({
        stepId: step.id,
        name,
        method: req.method,
        url: req.url,
        status: 0,
        durationMs: 0,
        ok: false,
        error: e instanceof Error ? e.message : String(e),
        assertions: [],
        extracted,
      });
    }
  }

  return { steps, passed: steps.length > 0 && steps.every((s) => s.ok) };
}
