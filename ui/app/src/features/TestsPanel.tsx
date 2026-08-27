import { useEffect, useState } from "react";
import {
  HTTP_METHODS,
  uid,
  type Assertion,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type KeyValue,
  type RequestBody,
  type TestCase,
  type TestInput,
  type TestInputTarget,
  type TestKind,
} from "../lib/types";
import {
  emptyTestCase,
  expectedStatus,
  generateSuite,
  migrateAssertions,
  parseTestDataset,
  runTestCaseAll,
  scenarioSummary,
  toGherkin,
  type TestCaseResult,
} from "../lib/tests";
import { downloadText } from "../lib/download";
import { bodyRawText } from "../lib/body";
import { toast } from "../store/ui";
import { useT } from "../store/i18n";
import { AssertionsEditor } from "./AssertionsEditor";
import { KeyValueEditor } from "./KeyValueEditor";
import { VarInput, VarTextarea } from "./VarInput";

/** Suite QA untuk satu request: skenario positif/negatif ala Given→Maka. */
export function TestsPanel({
  base,
  vars,
  response,
  onChange,
  onGenerate,
  onFix,
  generating,
}: {
  base: HttpRequest;
  vars: Record<string, string>;
  response?: HttpResponse;
  onChange: (tests: TestCase[]) => void;
  onGenerate?: () => void;
  onFix?: () => void;
  generating?: boolean;
}) {
  const tests = base.tests ?? [];
  const tr = useT();

  function autoSuite() {
    if (!response) return toast.error(tr("sendFirstForSuite"));
    onChange([...tests, ...generateSuite(base, response)]);
  }
  const [results, setResults] = useState<Record<string, TestCaseResult>>({});
  const [running, setRunning] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);

  // Migrasi assertion lama → satu skenario positif "Default" (sekali).
  useEffect(() => {
    if (base.tests === undefined && base.assertions.length > 0) {
      onChange(migrateAssertions(base.assertions));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchCase = (id: string, patch: Partial<TestCase>) =>
    onChange(tests.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  const patchOverride = (id: string, patch: Partial<TestCase["override"]>) => {
    const tc = tests.find((t) => t.id === id);
    if (tc) patchCase(id, { override: { ...tc.override, ...patch } });
  };

  function addCase(kind: TestKind) {
    const tc = emptyTestCase(kind);
    onChange([...tests, tc]);
    setOpenId(tc.id);
  }

  function removeCase(id: string) {
    onChange(tests.filter((t) => t.id !== id));
    setResults((r) => {
      const n = { ...r };
      delete n[id];
      return n;
    });
  }

  async function runOne(tc: TestCase) {
    if (!base.url.trim()) return toast.error(tr("fillRequestUrlFirst"));
    setRunning(true);
    const res = await runTestCaseAll(base, tc, vars);
    setResults((r) => ({ ...r, [tc.id]: res }));
    setRunning(false);
  }

  async function runAll() {
    if (!base.url.trim()) return toast.error(tr("fillRequestUrlFirst"));
    if (tests.length === 0) return toast.error(tr("noTestCasesYet"));
    setRunning(true);
    const next: Record<string, TestCaseResult> = {};
    for (const tc of tests) next[tc.id] = await runTestCaseAll(base, tc, vars);
    setResults(next);
    setRunning(false);
    const passed = tests.filter((t) => next[t.id]?.passed).length;
    if (passed === tests.length) toast.success(tr("allTestsPassed", { total: tests.length }));
    else
      toast.error(
        tr("someTestsFailed", { passed, total: tests.length, failed: tests.length - passed }),
      );
  }

  function exportGherkin() {
    if (tests.length === 0) return toast.error(tr("noTestsToExport"));
    const name = base.name || "API";
    const text = toGherkin(name, tests);
    const safe = (base.name || "scenarios").replace(/[^\w.-]+/g, "-").toLowerCase();
    downloadText(`${safe}.feature`, text);
    toast.success(tr("exportedGherkin"));
  }

  const ranCount = tests.filter((t) => results[t.id]).length;
  const passedCount = tests.filter((t) => results[t.id]?.passed).length;
  const kindStat = (k: TestKind) => {
    const cs = tests.filter((t) => t.kind === k);
    const ran = cs.filter((t) => results[t.id]);
    return { total: cs.length, passed: ran.filter((t) => results[t.id]?.passed).length, ran: ran.length };
  };
  const pos = kindStat("positive");
  const neg = kindStat("negative");

  return (
    <div className="space-y-3">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <button
          onClick={runAll}
          disabled={running || tests.length === 0}
          className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-40"
        >
          {running ? tr("running") : `▶ ${tr("runAll")}`}
        </button>
        {ranCount > 0 && (
          <span className="text-xs">
            <span className={passedCount === ranCount ? "text-emerald-400" : "text-rose-400"}>
              {tr("testsPassedShort", { passed: passedCount, ran: ranCount })}
            </span>
            <span className="text-neutral-600">
              {"  ·  "}
              {tr("posNegStat", { pp: pos.passed, pt: pos.total, np: neg.passed, nt: neg.total })}
            </span>
          </span>
        )}
        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={autoSuite}
            className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20"
          >
            {tr("autoSuiteBtn")}
          </button>
          <button
            onClick={exportGherkin}
            disabled={tests.length === 0}
            title={tr("exportGherkinTitle")}
            className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800 disabled:opacity-40"
          >
            {tr("exportGherkin")}
          </button>
          {onGenerate && (
            <button
              onClick={onGenerate}
              disabled={generating}
              className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs text-brand-fg hover:bg-brand/20 disabled:opacity-50"
            >
              {generating ? "AI…" : tr("generateCases")}
            </button>
          )}
          {onFix && tests.length > 0 && (
            <button
              onClick={onFix}
              disabled={generating}
              className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-300 hover:bg-amber-500/20 disabled:opacity-50"
            >
              {generating ? "AI…" : tr("fixWithAi")}
            </button>
          )}
        </div>
      </div>

      {/* Empty state */}
      {tests.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-xs text-neutral-600">
          {tr("testsEmptyHint")}
        </p>
      )}

      {/* Kartu skenario */}
      <div className="space-y-2">
        {tests.map((tc) => (
          <ScenarioCard
            key={tc.id}
            tc={tc}
            vars={vars}
            response={response}
            result={results[tc.id]}
            open={openId === tc.id}
            running={running}
            onToggleOpen={() => setOpenId(openId === tc.id ? null : tc.id)}
            onToggleKind={() =>
              patchCase(tc.id, { kind: tc.kind === "positive" ? "negative" : "positive" })
            }
            onPatch={(patch) => patchCase(tc.id, patch)}
            onPatchOverride={(patch) => patchOverride(tc.id, patch)}
            onRun={() => runOne(tc)}
            onRemove={() => removeCase(tc.id)}
          />
        ))}
      </div>

      {/* Tambah skenario */}
      <div className="flex gap-2">
        <button
          onClick={() => addCase("positive")}
          className="rounded-md border border-emerald-500/40 bg-emerald-500/10 px-2.5 py-1 text-xs text-emerald-400 hover:bg-emerald-500/20"
        >
          ＋ {tr("addPositiveCase")}
        </button>
        <button
          onClick={() => addCase("negative")}
          className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2.5 py-1 text-xs text-amber-400 hover:bg-amber-500/20"
        >
          ＋ {tr("addNegativeCase")}
        </button>
      </div>
    </div>
  );
}

// ── Kartu satu skenario ─────────────────────────────────────────────

function statusOf(tc: TestCase): Assertion | undefined {
  return tc.assertions.find((a) => a.source.kind === "status" && a.op === "equals");
}
function otherOf(tc: TestCase): Assertion[] {
  return tc.assertions.filter((a) => !(a.source.kind === "status" && a.op === "equals"));
}

function ScenarioCard({
  tc,
  vars,
  response,
  result,
  open,
  running,
  onToggleOpen,
  onToggleKind,
  onPatch,
  onPatchOverride,
  onRun,
  onRemove,
}: {
  tc: TestCase;
  vars: Record<string, string>;
  response?: HttpResponse;
  result?: TestCaseResult;
  open: boolean;
  running: boolean;
  onToggleOpen: () => void;
  onToggleKind: () => void;
  onPatch: (patch: Partial<TestCase>) => void;
  onPatchOverride: (patch: Partial<TestCase["override"]>) => void;
  onRun: () => void;
  onRemove: () => void;
}) {
  const tr = useT();
  const ov = tc.override;
  const ovActive =
    !!ov.method || !!ov.url?.trim() || (ov.headers?.length ?? 0) > 0 || !!ov.body;
  const bdd = tc.scenario ?? {};
  const bddActive = !!(bdd.given?.trim() || bdd.when?.trim() || bdd.then?.trim());
  const dataset = parseTestDataset(tc.dataset);
  const datasetActive = dataset.rows.length > 0;
  const summary = scenarioSummary(tc);
  const expStatus = expectedStatus(tc) ?? "";

  function setExpected(value: string) {
    const others = otherOf(tc);
    if (!value.trim()) return onPatch({ assertions: others });
    const existing = statusOf(tc);
    const st: Assertion = existing
      ? { ...existing, value }
      : { id: uid("as"), source: { kind: "status" }, op: "equals", value, enabled: true };
    onPatch({ assertions: [st, ...others] });
  }
  function setChecks(checks: Assertion[]) {
    const st = statusOf(tc);
    onPatch({ assertions: st ? [st, ...checks] : checks });
  }

  return (
    <div className="rounded-md border border-neutral-800">
      {/* Header */}
      <div className="flex items-center gap-2 px-2 py-1.5">
        <button
          onClick={onToggleKind}
          title={tr("toggleKind")}
          className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold uppercase ${
            tc.kind === "positive"
              ? "bg-emerald-500/15 text-emerald-400"
              : "bg-amber-500/15 text-amber-400"
          }`}
        >
          {tc.kind === "positive" ? tr("positiveWord") : tr("negativeWord")}
        </button>
        <input
          value={tc.name}
          onChange={(e) => onPatch({ name: e.target.value })}
          className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-600"
          placeholder={tr("scenarioNamePh")}
        />
        {result && (
          <span
            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
              result.passed ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
            }`}
            title={result.error || ""}
          >
            {result.passed ? "✓ PASS" : "✗ FAIL"}
            {result.status ? ` · ${result.status}` : ""}
          </span>
        )}
        <button
          onClick={onRun}
          disabled={running}
          className="shrink-0 rounded border border-neutral-700 px-2 py-0.5 text-xs hover:bg-neutral-800 disabled:opacity-40"
        >
          ▶
        </button>
        <button
          onClick={onToggleOpen}
          className="shrink-0 px-1 text-neutral-500 hover:text-neutral-200"
        >
          {open ? "▾" : "▸"}
        </button>
        <button
          onClick={onRemove}
          className="shrink-0 px-1 text-neutral-600 hover:text-rose-400"
        >
          ×
        </button>
      </div>

      {/* Ringkasan 1 baris (saat tertutup) */}
      {!open && summary && (
        <div className="truncate px-3 pb-1.5 font-mono text-[11px] text-neutral-500">
          {summary}
        </div>
      )}

      {open && (
        <div className="space-y-3 border-t border-neutral-800 px-3 py-2">
          {/* Deskripsi */}
          <input
            value={tc.description ?? ""}
            onChange={(e) => onPatch({ description: e.target.value })}
            placeholder={tr("testDescPh")}
            className="w-full bg-transparent text-xs text-neutral-400 outline-none placeholder:text-neutral-700"
          />

          {/* Diberikan — input */}
          <div>
            <div className="mb-1 flex items-center gap-1.5 text-xs font-medium text-emerald-400/90">
              {tr("givenLabel")}
              <span className="text-neutral-600" title={tr("targetHint")}>
                ⓘ
              </span>
            </div>
            <InputsEditor
              inputs={tc.inputs ?? []}
              onChange={(inputs) => onPatch({ inputs })}
              vars={vars}
            />
          </div>

          {/* Maka harapkan */}
          <div>
            <div className="mb-1 text-xs font-medium text-sky-400/90">{tr("thenLabel")}</div>
            <div className="mb-2 flex items-center gap-2">
              <span className="w-28 shrink-0 text-xs text-neutral-500">
                {tr("expectedStatusLabel")}
              </span>
              <input
                inputMode="numeric"
                value={expStatus}
                onChange={(e) => setExpected(e.target.value)}
                placeholder={tc.kind === "positive" ? "200" : "4xx"}
                className="w-24 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-sm outline-none focus:border-brand"
              />
            </div>
            <div className="text-xs text-neutral-500">{tr("responseChecks")}</div>
            <div className="mt-1">
              <AssertionsEditor
                assertions={otherOf(tc)}
                onChange={setChecks}
                response={response}
                results={result?.assertions?.filter(
                  (r) => !(statusOf(tc) && r.id === statusOf(tc)!.id),
                )}
              />
            </div>
          </div>

          {/* Lanjutan — override request mentah */}
          <details open={ovActive}>
            <summary className="cursor-pointer text-xs font-medium text-neutral-500">
              {tr("advancedOverride")}
              {ovActive && <span className="ml-1 text-brand-fg">•</span>}
            </summary>
            <div className="mt-2 space-y-2">
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-neutral-500">{tr("methodWord")}</span>
                <select
                  value={ov.method ?? ""}
                  onChange={(e) =>
                    onPatchOverride({
                      method: (e.target.value || undefined) as HttpMethod | undefined,
                    })
                  }
                  className="rounded border border-neutral-800 bg-neutral-900 px-1 py-1 text-xs outline-none"
                >
                  <option value="">{tr("sameAsRequest")}</option>
                  {HTTP_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {m}
                    </option>
                  ))}
                </select>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-xs text-neutral-500">URL</span>
                <VarInput
                  bare
                  className="flex-1 rounded border border-neutral-800 bg-neutral-900"
                  value={ov.url ?? ""}
                  onChange={(url) => onPatchOverride({ url: url || undefined })}
                  vars={vars}
                  placeholder={tr("sameAsRequest")}
                />
              </div>
              <div>
                <span className="text-xs text-neutral-500">{tr("headerOverride")}</span>
                <KeyValueEditor
                  rows={ov.headers ?? []}
                  onChange={(headers: KeyValue[]) =>
                    onPatchOverride({ headers: headers.length ? headers : undefined })
                  }
                  keyPlaceholder="Header"
                  valuePlaceholder="Value"
                  vars={vars}
                />
              </div>
              <div>
                <span className="text-xs text-neutral-500">{tr("bodyOverride")}</span>
                <VarTextarea
                  className="mt-1 h-24"
                  value={bodyRawText(ov.body)}
                  onChange={(content) =>
                    onPatchOverride({
                      body: content ? ({ kind: "json", content } as RequestBody) : undefined,
                    })
                  }
                  vars={vars}
                  placeholder="{ }"
                />
              </div>
            </div>
          </details>

          {/* BDD (Given / When / Then) untuk export Gherkin */}
          <details open={bddActive}>
            <summary className="cursor-pointer text-xs font-medium text-neutral-500">
              {tr("bddSection")}
              {bddActive && <span className="ml-1 text-brand-fg">•</span>}
            </summary>
            <div className="mt-2 space-y-1.5">
              <input
                value={bdd.given ?? ""}
                onChange={(e) => onPatch({ scenario: { ...bdd, given: e.target.value } })}
                placeholder={tr("bddGivenPh")}
                className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-brand"
              />
              <input
                value={bdd.when ?? ""}
                onChange={(e) => onPatch({ scenario: { ...bdd, when: e.target.value } })}
                placeholder={tr("bddWhenPh")}
                className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-brand"
              />
              <input
                value={bdd.then ?? ""}
                onChange={(e) => onPatch({ scenario: { ...bdd, then: e.target.value } })}
                placeholder={tr("bddThenPh")}
                className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none focus:border-brand"
              />
            </div>
          </details>

          {/* Data-driven (Examples) — dataset CSV/JSON, 1 baris = 1 iterasi */}
          <details open={datasetActive}>
            <summary className="cursor-pointer text-xs font-medium text-neutral-500">
              {tr("dataDrivenSection")}
              {datasetActive && (
                <span className="ml-1 text-brand-fg">
                  • {tr("datasetRowsCols", { rows: dataset.rows.length, cols: dataset.columns.length })}
                </span>
              )}
            </summary>
            <div className="mt-2 space-y-1.5">
              <textarea
                value={tc.dataset ?? ""}
                onChange={(e) => onPatch({ dataset: e.target.value || undefined })}
                placeholder={tr("datasetPh")}
                spellCheck={false}
                className="h-24 w-full resize-none rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-[11px] outline-none focus:border-brand"
              />
              <p className="text-[11px] text-neutral-600">{tr("datasetHint")}</p>
              {datasetActive && (
                <div className="flex flex-wrap gap-1">
                  {dataset.columns.map((c) => (
                    <code
                      key={c}
                      className="rounded bg-neutral-800 px-1.5 py-0.5 text-[10px] text-neutral-300"
                    >{`{{${c}}}`}</code>
                  ))}
                </div>
              )}
            </div>
          </details>

          {/* Hasil per baris (data-driven) */}
          {result?.rows && result.rows.length > 0 && (
            <div className="rounded-md border border-neutral-800">
              <div className="border-b border-neutral-800 px-2 py-1 text-[11px] text-neutral-500">
                {tr("iterationsResult", {
                  passed: result.rows.filter((r) => r.passed).length,
                  total: result.rows.length,
                })}
              </div>
              <ul className="divide-y divide-neutral-800">
                {result.rows.map((row, i) => (
                  <li key={i} className="flex items-center gap-2 px-2 py-1 text-[11px]">
                    <span className={row.passed ? "text-emerald-400" : "text-rose-400"}>
                      {row.passed ? "✓" : "✗"}
                    </span>
                    <span className="font-mono text-neutral-500">{row.status || "—"}</span>
                    <span className="flex-1 truncate text-neutral-400" title={row.error || ""}>
                      {row.name}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Editor input skenario (Given) ───────────────────────────────────

function InputsEditor({
  inputs,
  onChange,
  vars,
}: {
  inputs: TestInput[];
  onChange: (inputs: TestInput[]) => void;
  vars: Record<string, string>;
}) {
  const tr = useT();
  const ensured =
    inputs.length === 0 || inputs[inputs.length - 1].key !== ""
      ? [...inputs, { key: "", value: "", target: "body" as TestInputTarget, enabled: true }]
      : inputs;

  function commit(rows: TestInput[]) {
    onChange(rows.filter((r) => r.key.trim() !== ""));
  }
  function update(i: number, patch: Partial<TestInput>) {
    commit(ensured.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }
  function remove(i: number) {
    commit(ensured.filter((_, idx) => idx !== i));
  }

  return (
    <div className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
      {ensured.map((row, i) => {
        const isLast = i === ensured.length - 1;
        return (
          <div key={i} className="flex items-center gap-2 px-2 py-1">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              className="accent-brand"
              aria-label={tr("fieldEnabled")}
            />
            <input
              value={row.key}
              onChange={(e) => update(i, { key: e.target.value })}
              placeholder={tr("inputKeyPh")}
              className="w-40 shrink-0 bg-transparent px-1 py-1 font-mono text-sm outline-none placeholder:text-neutral-600"
            />
            <span className="text-neutral-600">=</span>
            <VarInput
              bare
              className="flex-1"
              value={row.value}
              onChange={(value) => update(i, { value })}
              vars={vars}
              placeholder={tr("inputValuePh")}
            />
            <div className="flex shrink-0 overflow-hidden rounded border border-neutral-800 text-[10px]">
              {(["body", "var"] as TestInputTarget[]).map((t) => (
                <button
                  key={t}
                  onClick={() => update(i, { target: t })}
                  title={tr("targetHint")}
                  className={`px-1.5 py-0.5 ${
                    row.target === t
                      ? "bg-brand text-white"
                      : "text-neutral-500 hover:bg-neutral-800"
                  }`}
                >
                  {t === "body" ? tr("targetBody") : tr("targetVar")}
                </button>
              ))}
            </div>
            <button
              onClick={() => remove(i)}
              disabled={isLast}
              className="px-1 text-neutral-600 hover:text-rose-400 disabled:opacity-0"
              aria-label={tr("removeRow")}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
