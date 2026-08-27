import { useEffect, useMemo, useRef, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useT } from "../store/i18n";
import type { Collection } from "../lib/types";

export interface CommandAction {
  label: string;
  hint?: string;
  run: () => void;
}

interface ReqItem {
  collectionId: string;
  nodeId: string;
  label: string;
  method: string;
}

function flattenRequests(collections: Collection[]): ReqItem[] {
  const out: ReqItem[] = [];
  const walk = (colId: string, nodes: Collection["nodes"], prefix: string) => {
    for (const n of nodes) {
      if (n.type === "request")
        out.push({ collectionId: colId, nodeId: n.id, label: prefix + n.name, method: n.request.method });
      else walk(colId, n.children, `${prefix}${n.name} / `);
    }
  };
  for (const c of collections) walk(c.id, c.nodes, `${c.name} / `);
  return out;
}

type Item =
  | { kind: "action"; label: string; hint?: string; run: () => void }
  | { kind: "request"; label: string; method: string; run: () => void };

/** Palet perintah (Ctrl/Cmd+K): cari request + aksi cepat. */
export function CommandPalette({
  open,
  onClose,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  actions: CommandAction[];
}) {
  const { collections, openRequestNode } = useWorkspace();
  const t = useT();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLUListElement>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setSel(0);
      setTimeout(() => inputRef.current?.focus(), 0);
    }
  }, [open]);

  const requests = useMemo(() => flattenRequests(collections), [collections]);

  const items = useMemo<Item[]>(() => {
    const all: Item[] = [
      ...actions.map((a) => ({ kind: "action" as const, label: a.label, hint: a.hint, run: a.run })),
      ...requests.map((r) => ({
        kind: "request" as const,
        label: r.label,
        method: r.method,
        run: () => openRequestNode(r.collectionId, r.nodeId),
      })),
    ];
    const query = q.trim().toLowerCase();
    const filtered = query ? all.filter((it) => it.label.toLowerCase().includes(query)) : all;
    return filtered.slice(0, 60);
  }, [actions, requests, q, openRequestNode]);

  useEffect(() => {
    setSel((s) => Math.min(s, Math.max(0, items.length - 1)));
  }, [items.length]);

  // Jaga item terpilih tetap terlihat saat navigasi keyboard.
  useEffect(() => {
    const el = listRef.current?.children[sel] as HTMLElement | undefined;
    el?.scrollIntoView({ block: "nearest" });
  }, [sel]);

  function onKey(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setSel((s) => Math.min(s + 1, items.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setSel((s) => Math.max(s - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      const it = items[sel];
      if (it) {
        it.run();
        onClose();
      }
    } else if (e.key === "Escape") {
      onClose();
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-start justify-center bg-black/50 p-4 pt-[12vh] backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setSel(0);
          }}
          onKeyDown={onKey}
          placeholder={t("cmdkPlaceholder")}
          className="w-full border-b border-neutral-800 bg-transparent px-4 py-3 text-sm outline-none placeholder:text-neutral-600"
        />
        <ul ref={listRef} className="max-h-[52vh] overflow-auto py-1">
          {items.length === 0 && (
            <li className="px-4 py-3 text-sm text-neutral-600">{t("cmdkNoResults")}</li>
          )}
          {items.map((it, i) => (
            <li key={i}>
              <button
                onMouseEnter={() => setSel(i)}
                onClick={() => {
                  it.run();
                  onClose();
                }}
                className={`flex w-full items-center gap-2 px-4 py-2 text-left text-sm ${
                  i === sel ? "bg-neutral-800" : "hover:bg-neutral-800/50"
                }`}
              >
                {it.kind === "request" ? (
                  <span className={`method-${it.method} w-10 shrink-0 font-mono text-[10px] font-bold`}>
                    {it.method}
                  </span>
                ) : (
                  <span className="w-10 shrink-0 text-center text-[9px] font-semibold uppercase text-brand-fg">
                    {t("cmdkGo")}
                  </span>
                )}
                <span className="flex-1 truncate">{it.label}</span>
                {it.kind === "action" && it.hint && (
                  <span className="shrink-0 text-xs text-neutral-600">{it.hint}</span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div className="border-t border-neutral-800 px-4 py-1.5 text-[11px] text-neutral-600">
          {t("cmdkHint")}
        </div>
      </div>
    </div>
  );
}
