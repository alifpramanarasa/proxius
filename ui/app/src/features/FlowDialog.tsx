import { useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useAgent } from "../store/agent";
import { findNode } from "../store/tree";
import { toast } from "../store/ui";
import { useT } from "../store/i18n";
import { resolveAuth } from "../lib/authresolve";
import { envMap } from "../lib/vars";
import { runFlow, type FlowResult } from "../lib/flow";
import {
  uid,
  type Collection,
  type Extract,
  type ExtractFrom,
  type Flow,
  type FlowStep,
  type HttpRequest,
} from "../lib/types";
import { Button, Modal } from "./Modal";

interface ReqOption {
  collectionId: string;
  nodeId: string;
  label: string;
  method: string;
}

function flattenRequests(collections: Collection[]): ReqOption[] {
  const out: ReqOption[] = [];
  const walk = (colId: string, nodes: Collection["nodes"], prefix: string) => {
    for (const n of nodes) {
      if (n.type === "request") {
        out.push({ collectionId: colId, nodeId: n.id, label: prefix + n.name, method: n.request.method });
      } else {
        walk(colId, n.children, `${prefix}${n.name} / `);
      }
    }
  };
  for (const c of collections) walk(c.id, c.nodes, `${c.name} / `);
  return out;
}

export function FlowDialog({
  flow,
  open,
  onClose,
}: {
  flow: Flow;
  open: boolean;
  onClose: () => void;
}) {
  const { collections, updateFlow, environments, activeEnvId } = useWorkspace();
  const generateFlow = useAgent((s) => s.generateFlow);
  const aiBusy = useAgent((s) => s.busy);
  const t = useT();
  const [results, setResults] = useState<FlowResult | null>(null);
  const [running, setRunning] = useState(false);
  const [aiDesc, setAiDesc] = useState("");

  const options = useMemo(() => flattenRequests(collections), [collections]);

  const patch = (p: Partial<Flow>) => updateFlow({ ...flow, ...p });
  const setStep = (id: string, p: Partial<Flow["steps"][number]>) =>
    patch({ steps: flow.steps.map((s) => (s.id === id ? { ...s, ...p } : s)) });
  const removeStep = (id: string) => patch({ steps: flow.steps.filter((s) => s.id !== id) });
  const addStep = () => {
    const first = options[0];
    patch({
      steps: [
        ...flow.steps,
        {
          id: uid("step"),
          name: "",
          collectionId: first?.collectionId ?? "",
          nodeId: first?.nodeId ?? "",
        },
      ],
    });
  };
  const move = (i: number, dir: -1 | 1) => {
    const j = i + dir;
    if (j < 0 || j >= flow.steps.length) return;
    const steps = [...flow.steps];
    [steps[i], steps[j]] = [steps[j], steps[i]];
    patch({ steps });
  };

  function resolveReq(step: Flow["steps"][number]): HttpRequest | null {
    const col = collections.find((c) => c.id === step.collectionId);
    if (!col) return null;
    const node = findNode(col.nodes, step.nodeId);
    if (!node || node.type !== "request") return null;
    // Auth efektif (pewarisan folder/collection).
    return { ...node.request, auth: resolveAuth(node.request.auth, col, step.nodeId) };
  }

  async function run() {
    if (flow.steps.length === 0) return toast.error(t("addStepFirst"));
    setRunning(true);
    setResults(null);
    const env = environments.find((e) => e.id === activeEnvId);
    const res = await runFlow(flow, resolveReq, envMap(env));
    setResults(res);
    setRunning(false);
    if (res.passed) toast.success(t("flowPassed"));
    else toast.error(t("flowFailedSteps"));
  }

  const byStep = new Map(results?.steps.map((s) => [s.stepId, s]) ?? []);

  return (
    <Modal open={open} title={flow.name} onClose={onClose} wide>
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          <input
            value={flow.name}
            onChange={(e) => patch({ name: e.target.value })}
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-brand"
            placeholder={t("flowNamePh")}
          />
          <Button variant="primary" onClick={run} disabled={running}>
            {running ? t("running") : `▶ ${t("runFlow")}`}
          </Button>
        </div>

        {/* AI: susun flow dari deskripsi */}
        <div className="flex items-center gap-2 rounded-md border border-brand/40 bg-brand/10 px-2 py-1.5">
          <input
            value={aiDesc}
            onChange={(e) => setAiDesc(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && aiDesc.trim() && !aiBusy) generateFlow(flow.id, aiDesc.trim());
            }}
            placeholder={t("aiFlowPlaceholder")}
            className="flex-1 bg-transparent text-xs outline-none placeholder:text-neutral-500"
          />
          <button
            onClick={() => aiDesc.trim() && generateFlow(flow.id, aiDesc.trim())}
            disabled={aiBusy || !aiDesc.trim()}
            className="shrink-0 rounded bg-brand px-2.5 py-1 text-xs font-medium text-white hover:opacity-90 disabled:opacity-50"
          >
            {aiBusy ? t("aiThinking") : t("aiBuildFlow")}
          </button>
        </div>

        {results && (
          <div
            className={`rounded-md px-3 py-1.5 text-xs ${
              results.passed ? "bg-emerald-500/10 text-emerald-400" : "bg-rose-500/10 text-rose-400"
            }`}
          >
            {t("stepsPassed", {
              ok: results.steps.filter((s) => s.ok).length,
              total: results.steps.length,
            })}
          </div>
        )}

        <ol className="space-y-2">
          {flow.steps.map((step, i) => {
            const r = byStep.get(step.id);
            return (
              <li key={step.id} className="rounded-md border border-neutral-800 p-2">
                <div className="flex items-center gap-2">
                  <span className="w-5 shrink-0 text-center text-xs text-neutral-500">{i + 1}</span>
                  <select
                    value={`${step.collectionId}::${step.nodeId}`}
                    onChange={(e) => {
                      const [collectionId, nodeId] = e.target.value.split("::");
                      setStep(step.id, { collectionId, nodeId });
                    }}
                    className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none"
                  >
                    {options.length === 0 && <option value="::">{t("noRequestOption")}</option>}
                    {options.map((o) => (
                      <option key={`${o.collectionId}::${o.nodeId}`} value={`${o.collectionId}::${o.nodeId}`}>
                        {o.method} · {o.label}
                      </option>
                    ))}
                  </select>
                  <input
                    value={step.name}
                    onChange={(e) => setStep(step.id, { name: e.target.value })}
                    placeholder={t("stepLabelOptional")}
                    className="w-32 shrink-0 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none"
                  />
                  <button onClick={() => move(i, -1)} className="px-1 text-neutral-500 hover:text-neutral-200">
                    ↑
                  </button>
                  <button onClick={() => move(i, 1)} className="px-1 text-neutral-500 hover:text-neutral-200">
                    ↓
                  </button>
                  <button onClick={() => removeStep(step.id)} className="px-1 text-neutral-600 hover:text-rose-400">
                    ×
                  </button>
                </div>

                <StepChain
                  step={step}
                  onChange={(extracts) => setStep(step.id, { extracts })}
                />

                {r && (
                  <div className="mt-1.5 pl-7 text-xs">
                    <span
                      className={`rounded px-1.5 py-0.5 text-[10px] font-bold ${
                        r.ok ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                      }`}
                    >
                      {r.ok ? "✓" : "✗"} {r.method} {r.status || "ERR"}
                    </span>
                    <span className="ml-2 text-neutral-600">{r.durationMs}ms</span>
                    {r.error && <span className="ml-2 text-rose-400">{r.error}</span>}
                    {Object.keys(r.extracted).length > 0 && (
                      <span className="ml-2 text-neutral-500">
                        → {Object.entries(r.extracted).map(([k, v]) => `${k}=${String(v).slice(0, 20)}`).join(", ")}
                      </span>
                    )}
                    {r.assertions.filter((a) => !a.passed).map((a, k) => (
                      <div key={k} className="text-rose-400">
                        ✗ {a.description} — {a.message}
                      </div>
                    ))}
                  </div>
                )}
              </li>
            );
          })}
        </ol>

        <button
          onClick={addStep}
          disabled={options.length === 0}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs hover:bg-neutral-800 disabled:opacity-40"
        >
          ＋ {t("addStep")}
        </button>

        <p className="text-[11px] text-neutral-600">{t("flowVarsHint")}</p>
      </div>
    </Modal>
  );
}

// ── Editor chaining per-langkah: ambil nilai response → variabel ─────

const SOURCE_KINDS: ExtractFrom["kind"][] = ["jsonPath", "header", "status", "body"];

function sourceOf(kind: ExtractFrom["kind"]): ExtractFrom {
  switch (kind) {
    case "jsonPath":
      return { kind: "jsonPath", path: "$." };
    case "header":
      return { kind: "header", name: "" };
    case "status":
      return { kind: "status" };
    case "body":
      return { kind: "body" };
  }
}

function StepChain({
  step,
  onChange,
}: {
  step: FlowStep;
  onChange: (extracts: Extract[]) => void;
}) {
  const t = useT();
  const rows = step.extracts ?? [];
  const update = (i: number, patch: Partial<Extract>) =>
    onChange(rows.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => onChange(rows.filter((_, idx) => idx !== i));
  const add = () =>
    onChange([...rows, { id: uid("ex"), var: "", from: { kind: "jsonPath", path: "$." }, enabled: true }]);

  return (
    <div className="mt-1.5 pl-7">
      {rows.length > 0 && (
        <div className="mb-1 space-y-1">
          {rows.map((e, i) => (
            <div key={e.id} className="flex items-center gap-1.5 text-xs">
              <span className="text-neutral-600">{t("saveAs")}</span>
              <input
                value={e.var}
                onChange={(ev) => update(i, { var: ev.target.value })}
                placeholder="token"
                className="w-24 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 font-mono outline-none focus:border-brand"
              />
              <span className="text-neutral-600">←</span>
              <select
                value={e.from.kind}
                onChange={(ev) => update(i, { from: sourceOf(ev.target.value as ExtractFrom["kind"]) })}
                className="rounded border border-neutral-800 bg-neutral-900 px-1 py-1 outline-none"
              >
                {SOURCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              {e.from.kind === "jsonPath" && (
                <input
                  value={e.from.path}
                  onChange={(ev) => update(i, { from: { kind: "jsonPath", path: ev.target.value } })}
                  placeholder="$.data.token"
                  className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 font-mono outline-none focus:border-brand"
                />
              )}
              {e.from.kind === "header" && (
                <input
                  value={e.from.name}
                  onChange={(ev) => update(i, { from: { kind: "header", name: ev.target.value } })}
                  placeholder="Authorization"
                  className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-1.5 py-1 font-mono outline-none focus:border-brand"
                />
              )}
              {(e.from.kind === "status" || e.from.kind === "body") && <span className="flex-1" />}
              <button onClick={() => remove(i)} className="px-1 text-neutral-600 hover:text-rose-400">
                ×
              </button>
            </div>
          ))}
        </div>
      )}
      <button
        onClick={add}
        className="text-[11px] text-neutral-500 hover:text-neutral-300"
        title={t("chainHint")}
      >
        ＋ {t("chainExtract")}
      </button>
    </div>
  );
}
