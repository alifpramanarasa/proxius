import { useState } from "react";
import type { Collection, RunReport } from "../lib/types";
import { parseDataset, runCollection, runCollectionData, toRunDocument } from "../lib/run";
import { useWorkspace } from "../store/workspace";
import { useT } from "../store/i18n";
import { Button, Modal } from "./Modal";

export function RunnerDialog({
  collection,
  open,
  onClose,
}: {
  collection: Collection | null;
  open: boolean;
  onClose: () => void;
}) {
  const { environments, activeEnvId } = useWorkspace();
  const t = useT();
  const [report, setReport] = useState<RunReport | null>(null);
  const [dataReports, setDataReports] = useState<RunReport[] | null>(null);
  const [dataText, setDataText] = useState("");
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const env = environments.find((e) => e.id === activeEnvId);

  let dataset: Record<string, string>[] = [];
  let dataError = "";
  if (dataText.trim()) {
    try {
      dataset = parseDataset(dataText);
    } catch (e) {
      dataError = e instanceof Error ? e.message : String(e);
    }
  }

  async function run() {
    if (!collection) return;
    setRunning(true);
    setError(null);
    setReport(null);
    setDataReports(null);
    try {
      const doc = toRunDocument(collection, []);
      const base = env?.variables ?? [];
      if (dataset.length > 0) {
        setDataReports(await runCollectionData(doc, base, dataset));
      } else {
        setReport(await runCollection(doc, base));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setRunning(false);
    }
  }

  return (
    <Modal
      open={open}
      title={`Run: ${collection?.name ?? ""}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
          <Button variant="primary" onClick={run} disabled={running}>
            {running ? t("running") : report || dataReports ? t("reRun") : "Run"}
          </Button>
        </>
      }
    >
      <p className="mb-3 text-xs text-neutral-500">
        {t("runIntro", {
          count: collection ? toRunDocument(collection, []).requests.length : 0,
        })}
        {env ? t("runWithEnv", { name: env.name }) : ""}.
      </p>

      {/* Data-driven: dataset CSV/JSON opsional */}
      <div className="mb-3">
        <div className="mb-1 flex items-center gap-2 text-xs text-neutral-500">
          <span>{t("datasetLabel")}</span>
          {dataset.length > 0 && (
            <span className="text-brand-fg">{t("iterationsLabel", { n: dataset.length })}</span>
          )}
        </div>
        <textarea
          value={dataText}
          onChange={(e) => setDataText(e.target.value)}
          placeholder={t("datasetPlaceholder")}
          spellCheck={false}
          className="h-20 w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs outline-none focus:border-brand"
        />
        {dataError && <p className="mt-1 text-xs text-rose-400">{dataError}</p>}
      </div>

      {error && (
        <p className="mb-2 text-sm text-rose-400">{t("genericFailed", { msg: error })}</p>
      )}

      {dataReports && (
        <div className="mb-3 space-y-1">
          {dataReports.map((rep, i) => (
            <div
              key={i}
              className={`flex items-center gap-2 rounded-md px-3 py-1.5 text-xs ${
                rep.failedRequests === 0
                  ? "bg-emerald-500/10 text-emerald-400"
                  : "bg-rose-500/10 text-rose-400"
              }`}
            >
              <span className="font-bold">{rep.failedRequests === 0 ? "✓" : "✗"}</span>
              <span className="text-neutral-300">{t("iterationLabel", { i: i + 1 })}</span>
              <span className="ml-auto font-mono">
                {t("runReportSummary", {
                  passedR: rep.passedRequests,
                  totalR: rep.total,
                  passedA: rep.passedAssertions,
                  totalA: rep.totalAssertions,
                })}
              </span>
            </div>
          ))}
        </div>
      )}

      {report && (
        <div>
          <div
            className={`mb-3 rounded-md px-3 py-2 text-sm ${
              report.failedRequests === 0
                ? "bg-emerald-500/10 text-emerald-400"
                : "bg-rose-500/10 text-rose-400"
            }`}
          >
            {report.failedRequests === 0 ? "PASS" : "FAIL"} ·{" "}
            {t("runReportSummary", {
              passedR: report.passedRequests,
              totalR: report.total,
              passedA: report.passedAssertions,
              totalA: report.totalAssertions,
            })}
          </div>
          <ul className="space-y-2">
            {report.requests.map((r, i) => (
              <li key={i} className="rounded border border-neutral-800 p-2">
                <div className="flex items-center gap-2 text-sm">
                  <span className={r.ok ? "text-emerald-400" : "text-rose-400"}>
                    {r.ok ? "✓" : "✗"}
                  </span>
                  <span className={`method-${r.method} font-mono text-xs font-bold`}>
                    {r.method}
                  </span>
                  <span className="truncate">{r.name}</span>
                  <span className="ml-auto text-xs text-neutral-500">
                    {r.status || "ERR"} · {r.durationMs}ms
                  </span>
                </div>
                {r.error && (
                  <p className="mt-1 text-xs text-rose-400">{r.error}</p>
                )}
                {r.assertions.map((a) => (
                  <div
                    key={a.id}
                    className="ml-6 mt-1 flex items-center gap-1 text-xs"
                  >
                    <span className={a.passed ? "text-emerald-400" : "text-rose-400"}>
                      {a.passed ? "✓" : "✗"}
                    </span>
                    <span className="text-neutral-400">{a.description}</span>
                    {!a.passed && (
                      <span className="text-rose-400">— {a.message}</span>
                    )}
                  </div>
                ))}
              </li>
            ))}
          </ul>
        </div>
      )}

      {!report && !dataReports && !running && !error && (
        <p className="py-6 text-center text-sm text-neutral-600">{t("clickRunHint")}</p>
      )}
    </Modal>
  );
}
