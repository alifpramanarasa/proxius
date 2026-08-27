import { useState } from "react";
import { parseCurl } from "../lib/curl";
import { parseOpenApi } from "../lib/openapi";
import { parsePostman } from "../lib/postman";
import { parseInsomnia } from "../lib/insomnia";
import { parseHar } from "../lib/har";
import { parsePxs } from "../lib/pxs";
import { useWorkspace } from "../store/workspace";
import { toast } from "../store/ui";
import { useT } from "../store/i18n";
import { Button, Modal } from "./Modal";

type ImportMode = "curl" | "openapi" | "postman" | "insomnia" | "har" | "pxs";

export function ImportDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const [mode, setMode] = useState<ImportMode>("curl");
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const { newTab, importCollection, addEnvironment, updateEnvironment } = useWorkspace();
  const t = useT();

  function doImport() {
    setError(null);
    try {
      if (mode === "curl") {
        const req = parseCurl(text);
        newTab(req);
        toast.success(t("curlImported"));
      } else if (mode === "pxs") {
        const { collection, environment } = parsePxs(text);
        importCollection(collection);
        if (environment) {
          addEnvironment(environment.name);
          const created = useWorkspace
            .getState()
            .environments.find((e) => e.name === environment.name);
          if (created) updateEnvironment({ ...created, variables: environment.variables });
        }
        toast.success(t("importOk", { name: collection.name, count: countRequests(collection) }));
      } else {
        const col =
          mode === "postman"
            ? parsePostman(text)
            : mode === "insomnia"
              ? parseInsomnia(text)
              : mode === "har"
                ? parseHar(text)
                : parseOpenApi(text);
        const count = countRequests(col);
        importCollection(col);
        toast.success(t("importOk", { name: col.name, count }));
      }
      setText("");
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  const MODES: { m: ImportMode; label: string }[] = [
    { m: "curl", label: "cURL" },
    { m: "openapi", label: "OpenAPI / Swagger" },
    { m: "postman", label: "Postman" },
    { m: "insomnia", label: "Insomnia" },
    { m: "har", label: "HAR" },
    { m: "pxs", label: "Proxius (.pxs)" },
  ];
  const placeholder =
    mode === "curl"
      ? "curl https://api.example.com -H 'Authorization: Bearer ...'"
      : mode === "postman"
        ? t("importPostmanPlaceholder")
        : mode === "insomnia"
          ? t("importInsomniaPlaceholder")
          : mode === "har"
            ? t("importHarPlaceholder")
            : mode === "pxs"
              ? t("importPxsPlaceholder")
              : t("importOpenApiPlaceholder");
  const hint =
    mode === "curl"
      ? t("importCurlHint")
      : mode === "postman"
        ? t("importPostmanHint")
        : mode === "insomnia"
          ? t("importInsomniaHint")
          : mode === "har"
            ? t("importHarHint")
            : mode === "pxs"
              ? t("importPxsHint")
              : t("importOpenApiHint");

  return (
    <Modal
      open={open}
      title={t("importTitle")}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("cancel")}
          </Button>
          <Button variant="primary" onClick={doImport} disabled={!text.trim()}>
            {t("import")}
          </Button>
        </>
      }
    >
      <div className="mb-3 flex gap-2">
        {MODES.map(({ m, label }) => (
          <button
            key={m}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 text-sm ${
              mode === m
                ? "bg-brand text-white"
                : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder={placeholder}
        spellCheck={false}
        className="h-56 w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs outline-none focus:border-brand"
      />
      {error && <p className="mt-2 text-xs text-rose-400">{error}</p>}
      <p className="mt-2 text-xs text-neutral-500">{hint}</p>
    </Modal>
  );
}

function countRequests(col: {
  nodes: { type: string; children?: unknown[] }[];
}): number {
  let n = 0;
  const walk = (nodes: any[]) => {
    for (const node of nodes) {
      if (node.type === "request") n++;
      else if (node.children) walk(node.children);
    }
  };
  walk(col.nodes as any[]);
  return n;
}
