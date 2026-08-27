import { useMemo, useState } from "react";
import type { Collection, TreeNode } from "../lib/types";
import { useWorkspace } from "../store/workspace";
import { promptDialog } from "../store/ui";
import { useT } from "../store/i18n";
import { CollectionTree } from "./CollectionTree";
import { StorageBar } from "./StorageBar";
import { FlowsPane } from "./FlowsPane";
import { MockPane } from "./MockPane";
import { IconSearch, IconInbox, IconPlus, IconDownload } from "./icons";
import { Button } from "./Modal";

type Pane = "collections" | "flows" | "mock" | "history";

export function Sidebar({ onImport }: { onImport: () => void }) {
  const [pane, setPane] = useState<Pane>("collections");
  const [query, setQuery] = useState("");
  const t = useT();
  const { collections, addCollection } = useWorkspace();

  async function newCollection() {
    const name = await promptDialog({
      title: t("newCollection"),
      defaultValue: "New Collection",
    });
    if (name) addCollection(name);
  }

  return (
    <aside className="flex h-full w-72 shrink-0 flex-col border-r border-neutral-800 bg-neutral-950">
      <StorageBar />
      {/* Pane switch */}
      <div className="flex items-center border-b border-neutral-800 px-2 text-sm">
        {(["collections", "flows", "mock", "history"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPane(p)}
            className={`-mb-px border-b-2 px-3 py-2 transition-colors ${
              pane === p
                ? "border-brand text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {t(p)}
          </button>
        ))}
      </div>

      {pane === "collections" ? (
        <>
          {/* Cari + aksi */}
          <div className="border-b border-neutral-800/60 px-3 py-2.5">
            <div className="flex items-center gap-2 rounded-md border border-neutral-800 bg-neutral-900 px-2.5 py-1.5 focus-within:border-neutral-600">
              <IconSearch className="shrink-0 text-neutral-500" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={t("searchRequestsPh")}
                className="min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-600"
              />
              {query && (
                <button
                  onClick={() => setQuery("")}
                  className="shrink-0 text-neutral-500 hover:text-neutral-200"
                  aria-label={t("clear")}
                >
                  ×
                </button>
              )}
            </div>
            <div className="mt-2 flex gap-1.5">
              <button
                onClick={newCollection}
                className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-700 hover:bg-neutral-800"
              >
                <IconPlus className="text-neutral-400" /> {t("newCollection")}
              </button>
              <button
                onClick={onImport}
                className="flex items-center justify-center gap-1.5 rounded-md border border-neutral-800 bg-neutral-900 px-3 py-1.5 text-xs font-medium text-neutral-200 transition hover:border-neutral-700 hover:bg-neutral-800"
              >
                <IconDownload className="text-neutral-400" /> {t("import")}
              </button>
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto py-1">
            {query ? (
              <SearchResults collections={collections} query={query} />
            ) : collections.length === 0 ? (
              <EmptyCollections onNew={newCollection} onImport={onImport} />
            ) : (
              collections.map((c) => <CollectionTree key={c.id} collection={c} />)
            )}
          </div>
        </>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto py-2">
          {pane === "flows" ? <FlowsPane /> : pane === "mock" ? <MockPane /> : <HistoryPane />}
        </div>
      )}
    </aside>
  );
}

// ── Empty state (onboarding) ────────────────────────────────────────
function EmptyCollections({ onNew, onImport }: { onNew: () => void; onImport: () => void }) {
  const t = useT();
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <div className="flex h-12 w-12 items-center justify-center rounded-full border border-neutral-800 text-neutral-600">
        <IconInbox className="text-xl" />
      </div>
      <div>
        <p className="text-sm text-neutral-300">{t("noCollectionsTitle")}</p>
        <p className="mx-auto mt-1 max-w-[13rem] text-xs leading-relaxed text-neutral-500">
          {t("noCollectionsHint")}
        </p>
      </div>
      <div className="flex gap-1.5">
        <Button variant="primary" onClick={onNew}>
          ＋ {t("newCollection")}
        </Button>
        <Button variant="ghost" onClick={onImport}>
          {t("import")}
        </Button>
      </div>
    </div>
  );
}

// ── Hasil pencarian (daftar rata lintas collection) ─────────────────
interface Hit {
  collectionId: string;
  nodeId: string;
  name: string;
  method: string;
  path: string;
  crumb: string;
}

function collectHits(collections: Collection[], q: string): Hit[] {
  const needle = q.toLowerCase();
  const hits: Hit[] = [];
  const walk = (colId: string, nodes: TreeNode[], crumb: string) => {
    for (const n of nodes) {
      if (n.type === "folder") {
        walk(colId, n.children, crumb ? `${crumb} / ${n.name}` : n.name);
      } else {
        const r = n.request;
        if (
          n.name.toLowerCase().includes(needle) ||
          r.url.toLowerCase().includes(needle) ||
          r.method.toLowerCase().includes(needle)
        ) {
          hits.push({
            collectionId: colId,
            nodeId: n.id,
            name: n.name,
            method: r.method,
            path: r.url,
            crumb,
          });
        }
      }
    }
  };
  for (const c of collections) walk(c.id, c.nodes, c.name);
  return hits;
}

function SearchResults({ collections, query }: { collections: Collection[]; query: string }) {
  const t = useT();
  const openRequestNode = useWorkspace((s) => s.openRequestNode);
  const activeTabId = useWorkspace((s) => s.activeTabId);
  const tabs = useWorkspace((s) => s.tabs);
  const activeNodeId = tabs.find((tb) => tb.id === activeTabId)?.savedNodeId;
  const hits = useMemo(() => collectHits(collections, query.trim()), [collections, query]);

  if (hits.length === 0) {
    return (
      <p className="px-4 py-6 text-center text-xs text-neutral-600">
        {t("searchNoResults").replace("{q}", query.trim())}
      </p>
    );
  }
  return (
    <ul>
      {hits.map((h) => (
        <li key={`${h.collectionId}:${h.nodeId}`}>
          <button
            onClick={() => openRequestNode(h.collectionId, h.nodeId)}
            className={`flex w-full items-center gap-2 px-3 py-1 text-left hover:bg-neutral-800/50 ${
              h.nodeId === activeNodeId ? "bg-neutral-800" : ""
            }`}
          >
            <span className={`method-${h.method} w-10 shrink-0 font-mono text-[10px] font-bold`}>
              {h.method}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm text-neutral-200">{h.name}</span>
              <span className="block truncate text-[10px] text-neutral-600">{h.crumb}</span>
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

function HistoryPane() {
  const { history, clearHistory, newTab } = useWorkspace();
  const t = useT();
  if (history.length === 0) {
    return (
      <div className="px-3 py-4 text-xs text-neutral-600">{t("historyEmpty")}</div>
    );
  }
  return (
    <div>
      <div className="mb-1 flex justify-end px-2">
        <button
          onClick={clearHistory}
          className="text-xs text-neutral-500 hover:text-rose-400"
        >
          {t("clear")}
        </button>
      </div>
      <ul>
        {history.map((h) => (
          <li
            key={h.id}
            onClick={() => newTab(structuredClone(h.request))}
            className="group cursor-pointer px-2 py-1 text-sm hover:bg-neutral-800/50"
          >
            <div className="flex items-center gap-2">
              <span className={`method-${h.method} w-10 shrink-0 font-mono text-[10px] font-bold`}>
                {h.method}
              </span>
              <span
                className={`shrink-0 text-xs ${
                  h.status >= 200 && h.status < 300 ? "text-emerald-400" : "text-rose-400"
                }`}
              >
                {h.status || "—"}
              </span>
              <span className="truncate text-neutral-400">{h.url}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}
