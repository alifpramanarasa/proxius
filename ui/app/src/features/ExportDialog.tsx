import { useState } from "react";
import type { Collection } from "../lib/types";
import { toFramework, type FrameworkTarget } from "../lib/frameworks";
import { toMockRoutes } from "../lib/mock";
import { toDocsHtml } from "../lib/docs";
import { downloadRunDocument, toRunDocument } from "../lib/run";
import { downloadText } from "../lib/download";
import { useWorkspace } from "../store/workspace";
import { useT } from "../store/i18n";
import { toast } from "../store/ui";
import { Button, Modal } from "./Modal";

type Target = "pxs" | "mock" | "docs" | FrameworkTarget;

const TARGETS: { id: Target; label: string; hint: string }[] = [
  { id: "pxs", label: "Proxius (.pxs)", hint: "proxius run / CI" },
  { id: "postman", label: "Postman / Newman", hint: "newman run" },
  { id: "playwright", label: "Playwright", hint: "@playwright/test" },
  { id: "k6", label: "k6 (load test)", hint: "k6 run" },
  { id: "mock", label: "Mock server", hint: "proxius mock" },
  { id: "docs", label: "API docs (HTML)", hint: "shareable docs page" },
];

export function ExportDialog({
  collection,
  open,
  onClose,
}: {
  collection: Collection | null;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [target, setTarget] = useState<Target>("pxs");
  const { environments, activeEnvId } = useWorkspace();
  const env = environments.find((e) => e.id === activeEnvId);

  if (!collection) return null;
  const safe = (collection.name || "collection").replace(/[^\w.-]+/g, "-").toLowerCase();
  const preview =
    target === "pxs"
      ? JSON.stringify(toRunDocument(collection, env?.variables ?? []), null, 2)
      : target === "mock"
        ? toMockRoutes(collection)
        : target === "docs"
          ? toDocsHtml(collection)
          : toFramework(collection, target).text;

  function download() {
    if (target === "pxs") {
      downloadRunDocument(toRunDocument(collection!, env?.variables ?? []));
    } else if (target === "mock") {
      downloadText(`${safe}.mock.json`, toMockRoutes(collection!), "application/json");
    } else if (target === "docs") {
      downloadText(`${safe}.docs.html`, toDocsHtml(collection!), "text/html");
    } else {
      const { text, ext } = toFramework(collection!, target);
      downloadText(`${safe}.${ext}`, text);
    }
    toast.success(t("exportedFile"));
  }
  function copy() {
    navigator.clipboard?.writeText(preview).then(
      () => toast.success(t("copied")),
      () => toast.error(t("copyFailed")),
    );
  }

  return (
    <Modal
      open={open}
      title={`${t("exportTitle")} — ${collection.name}`}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={copy}>
            {t("copy")}
          </Button>
          <Button variant="primary" onClick={download}>
            {t("exportDownloadBtn")}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex flex-wrap gap-1">
        {TARGETS.map((x) => (
          <button
            key={x.id}
            onClick={() => setTarget(x.id)}
            title={x.hint}
            className={`rounded-md px-2.5 py-1 text-xs ${
              target === x.id
                ? "bg-brand text-white"
                : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {x.label}
          </button>
        ))}
      </div>
      {target === "mock" && (
        <p className="mb-2 text-[11px] text-neutral-500">
          {t("mockRunHint")}{" "}
          <code className="rounded bg-neutral-800 px-1 text-neutral-300">
            proxius mock {safe}.mock.json --port 9090
          </code>
        </p>
      )}
      {target === "docs" ? (
        <iframe
          title="docs-preview"
          srcDoc={preview}
          sandbox=""
          className="h-[55vh] w-full rounded-md border border-neutral-800 bg-white"
        />
      ) : (
        <pre className="max-h-[55vh] overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-200">
          {preview}
        </pre>
      )}
    </Modal>
  );
}
