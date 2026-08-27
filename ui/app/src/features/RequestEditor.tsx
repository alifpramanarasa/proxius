import { useEffect, useMemo, useRef, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { MOD_KEY } from "../lib/platform";
import {
  HTTP_METHODS,
  uid,
  type AssertionResult,
  type FormField,
  type HttpMethod,
  type HttpRequest,
  type HttpResponse,
  type RequestBody,
} from "../lib/types";
import { sendRequest, isTauri, probeConnection } from "../lib/api";
import { bodyRawText, basename } from "../lib/body";
import { setFieldFile } from "../lib/fileStore";
import { pickFile } from "../lib/fs-tauri";
import { applyAuth } from "../lib/auth";
import { resolveAuth } from "../lib/authresolve";
import { runScript } from "../lib/script";
import { evaluate } from "../lib/assert";
import { envMap, missingVars, resolveRequest } from "../lib/vars";
import { useWorkspace } from "../store/workspace";
import { useTeam } from "../store/team";
import { toast } from "../store/ui";
import { useT } from "../store/i18n";
import { useAgent } from "../store/agent";
import { exportMarkdown } from "../lib/tracker/describe";
import { positiveAssertions } from "../lib/tests";
import { downloadText } from "../lib/download";
import { promptDialog } from "../store/ui";
import type { ResponseExample } from "../lib/types";
import { KeyValueEditor } from "./KeyValueEditor";
import { VarInput, VarTextarea } from "./VarInput";
import { UrlField } from "./UrlField";
import { TestsPanel } from "./TestsPanel";
import { ExamplesPanel } from "./ExamplesPanel";
import { AuthPanel } from "./AuthPanel";
import { ScriptsPanel } from "./ScriptsPanel";
import { SettingsPanel } from "./SettingsPanel";
import { CommentsPanel } from "./CommentsPanel";
import { ResponseBody } from "./ResponseView";
import { CodeDialog } from "./CodeDialog";

type Tab =
  | "params"
  | "auth"
  | "headers"
  | "body"
  | "scripts"
  | "tests"
  | "examples"
  | "settings"
  | "comments";

export function RequestEditor() {
  const [tab, setTab] = useState<Tab>("params");
  const [codeOpen, setCodeOpen] = useState(false);
  const [tabsMoreOpen, setTabsMoreOpen] = useState(false);
  const responseRef = useRef<HTMLDivElement>(null);
  const tr = useT();
  const {
    tabs,
    activeTabId,
    patchActiveRequest,
    setTabResponse,
    saveActiveTab,
    environments,
    activeEnvId,
    addHistory,
    updateEnvironment,
    addBlankExample,
    collections,
    focusTab,
    setFocusTab,
  } = useWorkspace();

  // Pindah sub-tab bila diminta dari sidebar (mis. "Add example").
  useEffect(() => {
    if (focusTab) {
      setTab(focusTab as Tab);
      setFocusTab(null);
    }
  }, [focusTab, setFocusTab]);

  function setEnvVar(key: string, value: string) {
    const env = environments.find((e) => e.id === activeEnvId);
    if (!env || !key) return;
    const variables = env.variables.filter((v) => v.key);
    const ex = variables.find((v) => v.key === key);
    if (ex) ex.value = value;
    else variables.push({ key, value, enabled: true });
    updateEnvironment({ ...env, variables });
  }

  const current = tabs.find((t) => t.id === activeTabId);
  const env = environments.find((e) => e.id === activeEnvId);
  const vars = envMap(env);
  const teamConnected = useTeam((s) => s.status === "connected");
  const generateTestCases = useAgent((s) => s.generateTestCases);
  const fixTestCases = useAgent((s) => s.fixTestCases);
  const agentBusy = useAgent((s) => s.busy);

  const mut = useMutation<
    HttpResponse,
    Error,
    { tabId: string; request: HttpRequest }
  >({
    mutationFn: async ({ request }) => {
      const localVars: Record<string, string> = { ...vars };
      const setVar = (k: string, v: string) => {
        localVars[k] = v;
        setEnvVar(k, v);
      };
      // Pre-request script: collection dulu (membungkus), lalu request.
      const ownerCol = collections.find((c) => c.id === current?.savedCollectionId);
      for (const [label, code] of [
        ["Collection pre-request", ownerCol?.scripts?.preRequest],
        ["Pre-request", request.scripts?.preRequest],
      ] as const) {
        if (code) {
          const r = runScript(code, { getVar: (k) => localVars[k], setVar });
          if (r.error) toast.error(`${label}: ${r.error}`);
        }
      }
      const prepared = await applyAuth(
        resolveRequest({ ...request, auth: effectiveAuth }, localVars),
        localVars,
      );
      return sendRequest(prepared, request.settings);
    },
    onSuccess: (res, { tabId, request }) => {
      setTabResponse(tabId, res);
      // Bawa response ke tampilan setelah dikirim (layout satu-scroll).
      setTimeout(
        () => responseRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }),
        60,
      );
      addHistory({
        id: uid("hist"),
        at: Date.now(),
        method: request.method,
        url: resolveRequest(request, vars).url,
        status: res.status,
        durationMs: res.durationMs,
        request: structuredClone(request),
      });
      // Post-response script (tes ala Postman): request dulu, lalu collection.
      const ownerCol = collections.find((c) => c.id === current?.savedCollectionId);
      const runPost = (label: string, code?: string) => {
        if (!code) return;
        const r = runScript(code, {
          response: res,
          getVar: (k) => vars[k],
          setVar: setEnvVar,
        });
        r.logs.forEach((l) => console.log("[pm]", l));
        if (r.error) {
          toast.error(`${label}: ${r.error}`);
        } else if (r.tests.length) {
          const passed = r.tests.filter((t) => t.passed).length;
          if (passed === r.tests.length)
            toast.success(`${label}: ${passed}/${r.tests.length} tes lulus ✓`);
          else
            toast.error(
              `${label}: ${passed}/${r.tests.length} lulus — gagal: ${r.tests
                .filter((t) => !t.passed)
                .map((t) => t.name)
                .join(", ")}`,
            );
        }
      };
      runPost("Scripts", request.scripts?.postResponse);
      runPost("Collection", ownerCol?.scripts?.postResponse);
    },
  });

  // Shortcut keyboard: ⌘/Ctrl+Enter kirim, ⌘/Ctrl+S simpan.
  const hotkeyRef = useRef<{ send: () => void; save: () => void }>({
    send: () => {},
    save: () => {},
  });
  hotkeyRef.current.send = () => {
    if (current && current.request.url.trim() && !mut.isPending)
      mut.mutate({ tabId: current.id, request: current.request });
  };
  hotkeyRef.current.save = () => saveActiveTab();
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey)) return;
      if (e.key === "Enter") {
        e.preventDefault();
        hotkeyRef.current.send();
      } else if (e.key.toLowerCase() === "s") {
        e.preventDefault();
        hotkeyRef.current.save();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { newTab } = useWorkspace.getState();
  if (!current) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-6 text-center">
        <div className="text-sm text-neutral-500">{tr("noTabsOpen")}</div>
        <button
          onClick={() => newTab()}
          className="rounded-md bg-brand px-4 py-1.5 text-sm font-semibold text-white transition hover:opacity-90"
        >
          ＋ {tr("newRequest")}
        </button>
        <div className="text-xs text-neutral-600">{tr("emptyWorkspaceHint")}</div>
      </div>
    );
  }

  const req = current.request;
  // Auth efektif (resolusi "Inherit" dari folder/collection induk).
  const effectiveAuth = resolveAuth(
    req.auth,
    collections.find((c) => c.id === current.savedCollectionId),
    current.savedNodeId,
  );
  const missing = missingVars(req, vars);
  const testResults: AssertionResult[] = useMemo(
    () => (current.response ? evaluate(current.request, current.response) : []),
    [current.response, current.request],
  );

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (current) mut.mutate({ tabId: current.id, request: current.request });
  }

  async function saveExample() {
    const r = current?.response;
    if (!r) {
      toast.error(tr("sendFirstToSaveExample"));
      return;
    }
    const name = await promptDialog({
      title: tr("saveExampleTitle"),
      defaultValue: `${r.status} ${r.statusText}`.trim() || "Example",
    });
    if (!name) return;
    const ex: ResponseExample = {
      id: uid("ex"),
      name,
      status: r.status,
      statusText: r.statusText,
      headers: r.headers,
      body: r.body,
      durationMs: r.durationMs,
      sizeBytes: r.sizeBytes,
      savedAt: Date.now(),
    };
    patchActiveRequest({ examples: [...(req.examples ?? []), ex] });
    toast.success(tr("exampleSaved"));
    setTab("examples");
  }

  const hasResponse = !!(current.response || mut.isPending || mut.error);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {/* Satu area scroll: header (nama/URL/tab) menempel, konten & response
          mengalir di bawahnya sehingga semuanya bisa di-scroll bersama. */}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {/* Header lengket */}
        <div className="sticky top-0 z-20 bg-neutral-950">
          {/* Name + save */}
          <div className="flex items-center gap-2 px-4 pt-3">
        <input
          value={req.name}
          onChange={(e) => patchActiveRequest({ name: e.target.value })}
          className="flex-1 bg-transparent text-sm font-medium outline-none placeholder:text-neutral-600"
          placeholder={tr("requestName")}
        />
        <button
          onClick={async () => {
            if (!isTauri()) return toast.error(tr("probeConnDesktopOnly"));
            try {
              const c = await probeConnection(resolveRequest(req, vars).url);
              toast.success(`DNS ${c.dnsMs} ms · connect ${c.connectMs} ms · ${c.address}`);
            } catch (e) {
              toast.error(e instanceof Error ? e.message : String(e));
            }
          }}
          title={tr("probeBtn")}
          className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          {tr("probeBtn")}
        </button>
        <button
          onClick={() => setCodeOpen(true)}
          title={tr("codeTitle")}
          className="rounded-md border border-neutral-700 px-2.5 py-1 font-mono text-xs text-neutral-400 hover:bg-neutral-800"
        >
          {"</>"} {tr("codeBtn")}
        </button>
        <button
          onClick={() => saveActiveTab()}
          title={`${tr("saveHintTitle")} · ${MOD_KEY}S`}
          className="rounded-md border border-neutral-700 px-3 py-1 text-xs hover:bg-neutral-800"
        >
          {tr("save")}
          {current.dirty ? " •" : ""}
        </button>
      </div>

      {/* URL bar */}
      <form onSubmit={submit} className="flex items-stretch gap-2 px-4 py-2">
        <select
          value={req.method}
          onChange={(e) => patchActiveRequest({ method: e.target.value as HttpMethod })}
          className={`method-${req.method} rounded-md border border-neutral-800 bg-neutral-900 px-2 font-mono text-sm font-semibold outline-none`}
        >
          {HTTP_METHODS.map((m) => (
            <option key={m} value={m} className="text-neutral-100">
              {m}
            </option>
          ))}
        </select>
        <UrlField
          url={req.url}
          query={req.query}
          onChange={(patch) => patchActiveRequest(patch)}
          vars={vars}
          placeholder="https://api.example.com/{{path}}"
        />
        <button
          type="submit"
          disabled={mut.isPending || !req.url.trim()}
          title={`${tr("sendHintTitle")} · ${MOD_KEY}↵`}
          className="rounded-md bg-brand px-5 text-sm font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
        >
          {mut.isPending ? tr("sending") : tr("send")}
        </button>
      </form>

      {missing.length > 0 && (
        <div className="mx-4 mb-1 rounded bg-amber-500/10 px-2 py-1 text-xs text-amber-400">
          {tr("missingVars", { vars: missing.map((m) => `{{${m}}}`).join(", ") })}
        </div>
      )}

      {/* Request tabs — utama inline (dengan badge jumlah), sisanya di » */}
      {(() => {
        const PRIMARY: Tab[] = ["params", "auth", "headers", "body", "scripts", "tests"];
        const SECONDARY: Tab[] = ["examples", "settings", "comments"];
        const qCount = req.query.filter((q) => q.enabled && q.key).length;
        const hCount = req.headers.filter((h) => h.enabled && h.key).length;
        const label = (t: Tab) => tr(`tab${t[0].toUpperCase()}${t.slice(1)}`);
        const badgeFor = (t: Tab) => {
          switch (t) {
            case "params":
              return qCount > 0 ? <Count n={qCount} /> : null;
            case "headers":
              return hCount > 0 ? <Count n={hCount} /> : null;
            case "tests":
              return (req.tests?.length ?? 0) > 0 ? <Count n={req.tests!.length} /> : null;
            case "examples":
              return (req.examples?.length ?? 0) > 0 ? <Count n={req.examples!.length} /> : null;
            case "auth":
              return req.auth && req.auth.type !== "none" ? <Dot /> : null;
            case "body":
              return req.body.kind !== "none" ? <Dot /> : null;
            case "scripts":
              return req.scripts?.preRequest || req.scripts?.postResponse ? <Dot /> : null;
            case "comments":
              return teamConnected ? <Dot /> : null;
            default:
              return null;
          }
        };
        const tabClass = (active: boolean) =>
          `flex items-center px-3 py-2 text-sm capitalize ${
            active
              ? "border-b-2 border-brand text-neutral-100"
              : "text-neutral-500 hover:text-neutral-300"
          }`;
        const inSecondary = SECONDARY.includes(tab);
        return (
          <div className="flex items-center gap-1 border-b border-neutral-800 px-4">
            {PRIMARY.map((t) => (
              <button key={t} onClick={() => setTab(t)} className={tabClass(tab === t)}>
                {label(t)}
                {badgeFor(t)}
              </button>
            ))}
            <div className="relative ml-auto">
              <button
                onClick={() => setTabsMoreOpen((o) => !o)}
                onBlur={() => setTimeout(() => setTabsMoreOpen(false), 150)}
                title={tr("moreTabs")}
                className={`px-2 py-2 text-sm ${
                  inSecondary
                    ? "border-b-2 border-brand text-neutral-100"
                    : "text-neutral-500 hover:text-neutral-300"
                }`}
              >
                {inSecondary ? label(tab) : "»"}
              </button>
              {tabsMoreOpen && (
                <div className="absolute right-0 z-30 mt-1 min-w-40 rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl">
                  {SECONDARY.map((t) => (
                    <button
                      key={t}
                      onClick={() => {
                        setTab(t);
                        setTabsMoreOpen(false);
                      }}
                      className={`flex w-full items-center justify-between px-3 py-1.5 text-sm capitalize hover:bg-neutral-800 ${
                        tab === t ? "text-neutral-100" : "text-neutral-300"
                      }`}
                    >
                      <span className="flex items-center">
                        {label(t)}
                        {badgeFor(t)}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        );
      })()}
        </div>
        {/* Konten tab — mengalir natural; area luar yang scroll. */}
        <div className="px-4 py-3">
        {tab === "params" && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-neutral-400">Query Params</div>
            <KeyValueEditor
              rows={req.query}
              onChange={(query) => patchActiveRequest({ query })}
              keyPlaceholder="Key"
              valuePlaceholder="Value"
              vars={vars}
              withDescription
            />
          </div>
        )}
        {tab === "auth" && (
          <AuthPanel
            auth={req.auth}
            onChange={(auth) => patchActiveRequest({ auth })}
            vars={vars}
          />
        )}
        {tab === "headers" && (
          <div className="space-y-2">
            <div className="text-xs font-medium text-neutral-400">Headers</div>
            <KeyValueEditor
              rows={req.headers}
              onChange={(headers) => patchActiveRequest({ headers })}
              keyPlaceholder="Key"
              valuePlaceholder="Value"
              vars={vars}
              withDescription
            />
          </div>
        )}
        {tab === "body" && (
          <BodyEditor
            req={req}
            patch={(p) => patchActiveRequest(p)}
            vars={vars}
          />
        )}
        {tab === "scripts" && (
          <ScriptsPanel
            scripts={req.scripts}
            onChange={(scripts) => patchActiveRequest({ scripts })}
          />
        )}
        {tab === "tests" && (
          <div className="space-y-2">
            <div className="flex justify-end">
              <ExportTestsButton />
            </div>
            <TestsPanel
              base={{ ...req, auth: effectiveAuth }}
              vars={vars}
              response={current.response}
              onChange={(tests) =>
                patchActiveRequest({ tests, assertions: positiveAssertions(tests) })
              }
              onGenerate={generateTestCases}
              onFix={fixTestCases}
              generating={agentBusy}
            />
          </div>
        )}
        {tab === "examples" && (
          <ExamplesPanel
            req={req}
            examples={req.examples ?? []}
            onChange={(examples) => patchActiveRequest({ examples })}
            onAdd={addBlankExample}
          />
        )}
        {tab === "settings" && (
          <SettingsPanel
            settings={req.settings}
            onChange={(settings) => patchActiveRequest({ settings })}
          />
        )}
        {tab === "comments" && (
          <div className="h-56">
            <CommentsPanel requestId={req.id} />
          </div>
        )}
        </div>

        {/* Response — bagian yang mengalir; tinggi tetap saat ada isi agar
            body-nya punya scroll sendiri, placeholder kecil saat kosong. */}
        <div
          ref={responseRef}
          className={`border-t border-neutral-800 ${hasResponse ? "h-[55vh]" : "h-[140px]"}`}
        >
          <ResponsePanel
            pending={mut.isPending}
            error={mut.error}
            response={current.response}
            testResults={testResults}
            onShowTests={() => setTab("tests")}
            onSaveExample={saveExample}
          />
        </div>
      </div>

      <CodeDialog req={req} open={codeOpen} onClose={() => setCodeOpen(false)} />
    </div>
  );
}

function Dot() {
  // Titik indikator kecil pada tab yang punya isi.
  return <span className="ml-1 inline-block h-1.5 w-1.5 rounded-full bg-brand align-middle" />;
}

function Count({ n }: { n: number }) {
  // Badge jumlah pada tab (mis. Params 3) — cepat di-scan.
  return (
    <span className="ml-1.5 rounded bg-neutral-800 px-1 text-[10px] tabular-nums text-neutral-400">
      {n}
    </span>
  );
}

function BodyEditor({
  req,
  patch,
  vars,
}: {
  req: HttpRequest;
  patch: (p: Partial<HttpRequest>) => void;
  vars: Record<string, string>;
}) {
  const tr = useT();
  const body = req.body;
  const kind = body.kind;

  const KINDS: { k: RequestBody["kind"]; label: string }[] = [
    { k: "none", label: "none" },
    { k: "json", label: "json" },
    { k: "text", label: "text" },
    { k: "form", label: "form-data" },
    { k: "urlencoded", label: "urlencoded" },
    { k: "graphql", label: "GraphQL" },
  ];

  function switchKind(k: RequestBody["kind"]) {
    if (k === kind) return;
    if (k === "none") return patch({ body: { kind: "none" } });
    if (k === "json" || k === "text")
      return patch({ body: { kind: k, content: bodyRawText(body) } });
    if (k === "urlencoded")
      return patch({
        body: { kind: "urlencoded", items: body.kind === "urlencoded" ? body.items : [] },
      });
    if (k === "graphql")
      return patch({
        body: {
          kind: "graphql",
          query: body.kind === "graphql" ? body.query : "",
          variables: body.kind === "graphql" ? body.variables : "",
        },
      });
    return patch({ body: { kind: "form", items: body.kind === "form" ? body.items : [] } });
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap gap-3 text-sm">
        {KINDS.map(({ k, label }) => (
          <label key={k} className="flex items-center gap-1">
            <input
              type="radio"
              name="bodykind"
              checked={kind === k}
              onChange={() => switchKind(k)}
              className="accent-brand"
            />
            <span className="text-neutral-400">{label}</span>
          </label>
        ))}
      </div>

      {(kind === "json" || kind === "text") && (
        <VarTextarea
          className="h-40"
          value={bodyRawText(body)}
          onChange={(c) => patch({ body: { kind, content: c } })}
          vars={vars}
          placeholder={kind === "json" ? '{\n  "key": "value"\n}' : "raw body"}
        />
      )}

      {kind === "urlencoded" && body.kind === "urlencoded" && (
        <KeyValueEditor
          rows={body.items}
          onChange={(items) => patch({ body: { kind: "urlencoded", items } })}
          keyPlaceholder={tr("keyPh")}
          valuePlaceholder={tr("valuePh")}
          vars={vars}
        />
      )}

      {kind === "form" && body.kind === "form" && (
        <FormDataEditor
          items={body.items}
          onChange={(items) => patch({ body: { kind: "form", items } })}
          vars={vars}
        />
      )}

      {kind === "graphql" && body.kind === "graphql" && (
        <div className="space-y-2">
          <div className="text-xs font-medium text-neutral-400">{tr("graphqlQuery")}</div>
          <VarTextarea
            className="h-32"
            value={body.query}
            onChange={(query) => patch({ body: { ...body, query } })}
            vars={vars}
            placeholder={"query {\n  me { id name }\n}"}
          />
          <div className="text-xs font-medium text-neutral-400">{tr("graphqlVariables")}</div>
          <VarTextarea
            className="h-20"
            value={body.variables}
            onChange={(variables) => patch({ body: { ...body, variables } })}
            vars={vars}
            placeholder={'{ "id": 1 }'}
          />
        </div>
      )}
    </div>
  );
}

function FormDataEditor({
  items,
  onChange,
  vars,
}: {
  items: FormField[];
  onChange: (items: FormField[]) => void;
  vars: Record<string, string>;
}) {
  const tr = useT();
  const ensured =
    items.length === 0 || items[items.length - 1].key !== ""
      ? [...items, { id: "", key: "", value: "", type: "text" as const, enabled: true }]
      : items;

  function commit(rows: FormField[]) {
    onChange(
      rows
        .map((r) => (r.key.trim() && !r.id ? { ...r, id: uid("ff") } : r))
        .filter((r) => r.key.trim() !== ""),
    );
  }
  const update = (i: number, patch: Partial<FormField>) =>
    commit(ensured.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => commit(ensured.filter((_, idx) => idx !== i));

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
              placeholder={tr("keyPh")}
              className="w-40 shrink-0 bg-transparent px-1 py-1 font-mono text-sm outline-none placeholder:text-neutral-600"
            />
            <div className="flex shrink-0 overflow-hidden rounded border border-neutral-800 text-[10px]">
              {(["text", "file"] as const).map((t) => (
                <button
                  key={t}
                  onClick={() => update(i, { type: t })}
                  className={`px-1.5 py-0.5 ${
                    row.type === t ? "bg-brand text-white" : "text-neutral-500 hover:bg-neutral-800"
                  }`}
                >
                  {t === "text" ? tr("fieldText") : tr("fieldFile")}
                </button>
              ))}
            </div>
            {row.type === "file" ? (
              <FileCell row={row} onPick={(patch) => update(i, patch)} />
            ) : (
              <VarInput
                bare
                className="flex-1"
                value={row.value}
                onChange={(value) => update(i, { value })}
                vars={vars}
                placeholder={tr("valuePh")}
              />
            )}
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

function FileCell({
  row,
  onPick,
}: {
  row: FormField;
  onPick: (patch: Partial<FormField>) => void;
}) {
  const tr = useT();
  const display = row.filename || (row.value ? basename(row.value) : "");
  const cls =
    "flex-1 truncate rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-left text-xs hover:bg-neutral-800";

  if (isTauri()) {
    return (
      <button
        onClick={async () => {
          const p = await pickFile();
          if (p) onPick({ value: p, filename: basename(p) });
        }}
        className={`${cls} ${display ? "text-neutral-300" : "text-neutral-500"}`}
      >
        {display || tr("chooseFileField")}
      </button>
    );
  }
  return (
    <label className={`${cls} cursor-pointer ${display ? "text-neutral-300" : "text-neutral-500"}`}>
      {display || tr("chooseFileField")}
      <input
        type="file"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (!f) return;
          setFieldFile(row.id, f);
          onPick({ value: f.name, filename: f.name });
        }}
      />
    </label>
  );
}

function ResponsePanel({
  pending,
  error,
  response,
  testResults,
  onShowTests,
  onSaveExample,
}: {
  pending: boolean;
  error: Error | null;
  response?: HttpResponse;
  testResults: AssertionResult[];
  onShowTests: () => void;
  onSaveExample: () => void;
}) {
  const [view, setView] = useState<"body" | "headers">("body");
  const tr = useT();

  if (pending)
    return (
      <Centered>
        <span className="animate-pulse">{tr("sendingRequest")}</span>
      </Centered>
    );
  if (error)
    return (
      <Centered>
        <span className="text-rose-400">✕ {error.message}</span>
      </Centered>
    );
  if (!response)
    return (
      <Centered>
        <div className="flex flex-col items-center gap-2">
          <span>{tr("sendToSeeResponse")}</span>
          <span className="flex items-center gap-1 text-xs text-neutral-600">
            <kbd>{MOD_KEY}</kbd>
            <kbd>↵</kbd>
          </span>
        </div>
      </Centered>
    );

  const ok = response.status >= 200 && response.status < 300;
  const passed = testResults.filter((r) => r.passed).length;
  const allPass = testResults.length > 0 && passed === testResults.length;

  function copy() {
    const text = view === "headers"
      ? response!.headers.map((h) => `${h.key}: ${h.value}`).join("\n")
      : response!.body;
    navigator.clipboard?.writeText(text).then(
      () => toast.success(tr("copied")),
      () => toast.error(tr("copyFailed")),
    );
  }

  return (
    <div className="flex h-full flex-col">
      {/* status bar */}
      <div className="flex items-center gap-3 border-b border-neutral-800 px-4 py-2 text-sm">
        <span
          className={`rounded px-1.5 py-0.5 text-xs font-bold ${
            ok ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
          }`}
        >
          {response.status} {response.statusText}
        </span>
        <span
          className="text-xs text-neutral-500"
          title={
            response.ttfbMs !== undefined
              ? `${tr("timingWait")} ${response.ttfbMs} ms · ${tr("timingDownload")} ${Math.max(0, response.durationMs - response.ttfbMs)} ms`
              : undefined
          }
        >
          {response.durationMs} ms
          {response.ttfbMs !== undefined && (
            <span className="ml-1 text-neutral-600">
              ({tr("timingWait")} {response.ttfbMs} · {tr("timingDownload")}{" "}
              {Math.max(0, response.durationMs - response.ttfbMs)})
            </span>
          )}
        </span>
        <span className="text-xs text-neutral-500">{formatBytes(response.sizeBytes)}</span>
        {testResults.length > 0 && (
          <button
            onClick={onShowTests}
            className={`rounded-full px-2 py-0.5 text-xs ${
              allPass ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
            }`}
          >
            Tests {passed}/{testResults.length}
          </button>
        )}
        <button
          onClick={onSaveExample}
          title={tr("saveExampleHint")}
          className="ml-auto rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          ＋ {tr("exampleWord")}
        </button>
        <button
          onClick={copy}
          className="rounded border border-neutral-800 px-2 py-0.5 text-xs text-neutral-400 hover:bg-neutral-800"
        >
          {tr("copy")}
        </button>
      </div>

      {/* view tabs */}
      <div className="flex items-center gap-1 border-b border-neutral-800 px-3 text-xs">
        {(["body", "headers"] as const).map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            className={`px-2 py-1.5 capitalize ${
              view === v
                ? "border-b-2 border-brand text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tr(v === "body" ? "tabBody" : "tabHeaders")}
            {v === "headers" && (
              <span className="ml-1 text-neutral-600">({response.headers.length})</span>
            )}
          </button>
        ))}
      </div>

      {view === "body" ? (
        <ResponseBody response={response} />
      ) : (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <table className="w-full text-xs">
            <tbody>
              {response.headers.map((h, i) => (
                <tr key={i} className="border-b border-neutral-800/60 align-top">
                  <td className="w-1/3 py-1 pr-3 font-mono text-neutral-400">{h.key}</td>
                  <td className="py-1 font-mono text-neutral-200 break-all">{h.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function ExportTestsButton() {
  const tr = useT();
  const { tabs, activeTabId } = useWorkspace();
  function exportMd() {
    const req = tabs.find((t) => t.id === activeTabId)?.request;
    if (!req || !req.url.trim()) {
      toast.error(tr("openRequestWithUrlFirst"));
      return;
    }
    const md = exportMarkdown([req], req.name || "Test Case");
    const safe = (req.name || "test-case").replace(/[^\w.-]+/g, "-").toLowerCase();
    downloadText(`${safe}.md`, md);
    toast.success(tr("exportMd"));
  }
  return (
    <button
      onClick={exportMd}
      className="rounded-md border border-neutral-700 px-2.5 py-1 text-xs text-neutral-400 hover:bg-neutral-800"
      title={tr("exportMd")}
    >
      {tr("exportMd")}
    </button>
  );
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center p-6 text-sm text-neutral-500">
      {children}
    </div>
  );
}

function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}
