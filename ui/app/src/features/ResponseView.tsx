import { useMemo, useState } from "react";
import type { HttpResponse } from "../lib/types";
import { useT } from "../store/i18n";
import { highlightJson, searchMarks, countMatches } from "../lib/highlight";
import { JsonTree } from "./JsonTree";

type Mode = "pretty" | "raw" | "tree" | "preview";

function contentTypeOf(r: HttpResponse): string {
  return r.headers.find((h) => h.key.toLowerCase() === "content-type")?.value.toLowerCase() ?? "";
}

const modeKey = (m: Mode): string =>
  m === "pretty" ? "pretty" : m === "raw" ? "raw" : m === "tree" ? "treeView" : "previewView";

/** Penampil body response: Pretty (highlight) / Tree / Raw / Preview (HTML) + cari. */
export function ResponseBody({ response }: { response: HttpResponse }) {
  const tr = useT();
  const ct = contentTypeOf(response);
  const parsed = useMemo(() => {
    try {
      return { ok: true, value: JSON.parse(response.body) as unknown };
    } catch {
      return { ok: false, value: null };
    }
  }, [response.body]);

  const trimmed = response.body.trimStart();
  const isJson =
    parsed.ok && (ct.includes("json") || trimmed.startsWith("{") || trimmed.startsWith("["));
  const isHtml = ct.includes("html");
  const isImage = ct.startsWith("image/");
  const isPdf = ct.includes("pdf");
  const binary = !!response.bodyBase64;
  const dataUrl = binary ? `data:${ct.split(";")[0] || "application/octet-stream"};base64,${response.bodyBase64}` : "";

  const modes: Mode[] = binary
    ? isImage || isPdf
      ? ["preview"]
      : []
    : isJson
      ? ["pretty", "tree", "raw"]
      : isHtml
        ? ["preview", "raw"]
        : ["raw"];
  const [mode, setMode] = useState<Mode>("pretty");
  const [query, setQuery] = useState("");
  const activeMode: Mode = modes.includes(mode) ? mode : modes[0] ?? "raw";

  // Biner tanpa preview (mis. octet-stream/zip) → tampilkan catatan.
  if (binary && modes.length === 0) {
    return (
      <div className="flex min-h-0 flex-1 items-center justify-center p-6 text-sm text-neutral-500">
        {tr("binaryNoPreview")}
      </div>
    );
  }

  const prettyText = useMemo(
    () => (isJson ? JSON.stringify(parsed.value, null, 2) : response.body),
    [isJson, parsed, response.body],
  );
  const textForSearch = activeMode === "raw" ? response.body : prettyText;
  const matches = query ? countMatches(textForSearch, query) : 0;

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex items-center gap-1 border-b border-neutral-800 px-3 py-1 text-xs">
        {modes.map((m) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded px-2 py-0.5 capitalize ${
              activeMode === m
                ? "bg-neutral-800 text-neutral-100"
                : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {tr(modeKey(m))}
          </button>
        ))}
        {activeMode !== "preview" && activeMode !== "tree" && (
          <div className="ml-auto flex items-center gap-2">
            {query && <span className="text-neutral-600">{tr("matchCount", { n: matches })}</span>}
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={tr("searchInResponse")}
              className="w-40 rounded border border-neutral-800 bg-neutral-900 px-2 py-0.5 text-xs outline-none focus:border-brand"
            />
          </div>
        )}
      </div>

      {activeMode === "tree" && isJson ? (
        <div className="min-h-0 flex-1 overflow-auto p-3">
          <JsonTree data={parsed.value} />
        </div>
      ) : activeMode === "preview" && isImage ? (
        <div className="flex min-h-0 flex-1 items-center justify-center overflow-auto bg-neutral-950 p-4">
          <img src={dataUrl} alt="response" className="max-h-full max-w-full object-contain" />
        </div>
      ) : activeMode === "preview" && isPdf ? (
        <iframe title="preview" src={dataUrl} className="min-h-0 flex-1 border-0 bg-white" />
      ) : activeMode === "preview" && isHtml ? (
        <iframe
          title="preview"
          sandbox=""
          srcDoc={response.body}
          className="min-h-0 flex-1 border-0 bg-white"
        />
      ) : (
        <pre className="min-h-0 flex-1 overflow-auto p-4 font-mono text-sm text-neutral-200">
          {activeMode === "pretty" && isJson && !query
            ? highlightJson(prettyText)
            : searchMarks(textForSearch, query)}
        </pre>
      )}
    </div>
  );
}
