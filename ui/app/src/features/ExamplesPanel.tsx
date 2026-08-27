import { useState } from "react";
import type { HttpRequest, ResponseExample } from "../lib/types";
import { useT } from "../store/i18n";
import { KeyValueEditor } from "./KeyValueEditor";

/** Editor contoh (example) yang tersimpan di bawah sebuah request.
 * Tiap contoh punya response yang bisa diedit (status, header, body).
 * Dibuat via "Add example" (kosong) atau "＋ Contoh" dari hasil Send. */
export function ExamplesPanel({
  req,
  examples,
  onChange,
  onAdd,
}: {
  req: HttpRequest;
  examples: ResponseExample[];
  onChange: (examples: ResponseExample[]) => void;
  onAdd: () => void;
}) {
  const [openId, setOpenId] = useState<string | null>(examples[examples.length - 1]?.id ?? null);
  const t = useT();

  const patch = (id: string, p: Partial<ResponseExample>) =>
    onChange(examples.map((e) => (e.id === id ? { ...e, ...p } : e)));
  const remove = (id: string) => onChange(examples.filter((e) => e.id !== id));

  const ok = (s: number) => s >= 200 && s < 300;

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-500">
          {t("exampleResponsesFor")}{" "}
          <span className="font-mono text-neutral-300">
            {req.method} {req.url || "(url)"}
          </span>
        </span>
        <button
          onClick={onAdd}
          className="rounded-md border border-brand/40 bg-brand/10 px-2.5 py-1 text-xs text-brand-fg hover:bg-brand/20"
        >
          ＋ {t("addExample")}
        </button>
      </div>

      {examples.length === 0 && (
        <p className="rounded-md border border-dashed border-neutral-800 px-3 py-6 text-center text-xs text-neutral-600">
          {t("examplesEmptyHint")}
        </p>
      )}

      {examples.map((ex) => {
        const open = openId === ex.id;
        return (
          <div key={ex.id} className="rounded-md border border-neutral-800">
            <div className="flex items-center gap-2 px-2 py-1.5">
              <span
                className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] font-bold ${
                  ok(ex.status) ? "bg-emerald-500/15 text-emerald-400" : "bg-rose-500/15 text-rose-400"
                }`}
              >
                {ex.status || "—"}
              </span>
              <input
                value={ex.name}
                onChange={(e) => patch(ex.id, { name: e.target.value })}
                className="flex-1 bg-transparent text-sm outline-none placeholder:text-neutral-600"
                placeholder={t("exampleNamePh")}
              />
              <button
                onClick={() => setOpenId(open ? null : ex.id)}
                className="shrink-0 px-1 text-neutral-500 hover:text-neutral-200"
              >
                {open ? "▾" : "▸"}
              </button>
              <button
                onClick={() => remove(ex.id)}
                className="shrink-0 px-1 text-neutral-600 hover:text-rose-400"
              >
                ×
              </button>
            </div>

            {open && (
              <div className="space-y-3 border-t border-neutral-800 p-3">
                <div className="flex items-center gap-2">
                  <span className="text-xs text-neutral-500">{t("statusCodeLabel")}</span>
                  <input
                    type="number"
                    value={ex.status || ""}
                    onChange={(e) => patch(ex.id, { status: Number(e.target.value) || 0 })}
                    className="w-20 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-sm outline-none focus:border-brand"
                  />
                  <input
                    value={ex.statusText}
                    onChange={(e) => patch(ex.id, { statusText: e.target.value })}
                    placeholder="OK"
                    className="w-40 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <span className="text-xs text-neutral-500">{t("responseBodyLabel")}</span>
                  <textarea
                    value={ex.body}
                    onChange={(e) => patch(ex.id, { body: e.target.value })}
                    spellCheck={false}
                    placeholder={'{\n  "data": []\n}'}
                    className="mt-1 h-40 w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs outline-none focus:border-brand"
                  />
                </div>

                <div>
                  <span className="text-xs text-neutral-500">{t("responseHeadersLabel")}</span>
                  <div className="mt-1">
                    <KeyValueEditor
                      rows={ex.headers}
                      onChange={(headers) => patch(ex.id, { headers })}
                      keyPlaceholder="Header"
                      valuePlaceholder="Value"
                    />
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
