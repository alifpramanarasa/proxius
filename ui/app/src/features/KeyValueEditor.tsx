import type { KeyValue } from "../lib/types";
import { useT } from "../store/i18n";
import { IconKey } from "./icons";
import { VarInput } from "./VarInput";

interface Props {
  rows: KeyValue[];
  onChange: (rows: KeyValue[]) => void;
  keyPlaceholder?: string;
  valuePlaceholder?: string;
  /** Bila diberikan, key/value menyorot `{{variable}}` ala Postman. */
  vars?: Record<string, string>;
  /** Tampilkan kolom Description (mirip Postman). */
  withDescription?: boolean;
  /** Izinkan menandai baris sebagai rahasia (nilai ditutup). */
  allowSecret?: boolean;
}

/** Editor pasangan key-value dengan baris kosong otomatis di akhir. */
export function KeyValueEditor({
  rows,
  onChange,
  keyPlaceholder = "key",
  valuePlaceholder = "value",
  vars,
  withDescription,
  allowSecret,
}: Props) {
  const t = useT();
  // Pastikan selalu ada satu baris kosong di bawah.
  const ensured =
    rows.length === 0 || rows[rows.length - 1].key !== ""
      ? [...rows, { key: "", value: "", enabled: true }]
      : rows;

  function update(i: number, patch: Partial<KeyValue>) {
    const next = ensured.map((r, idx) => (idx === i ? { ...r, ...patch } : r));
    onChange(next.filter((r, idx) => r.key !== "" || idx === next.length - 1));
  }

  function remove(i: number) {
    onChange(ensured.filter((_, idx) => idx !== i));
  }

  return (
    <div className="divide-y divide-neutral-800 rounded-md border border-neutral-800">
      {withDescription && (
        <div className="flex items-center gap-2 bg-neutral-900/40 px-2 py-1 text-[11px] font-medium uppercase tracking-wide text-neutral-500">
          <span className="w-3.5 shrink-0" />
          <span className="w-1/4">{keyPlaceholder}</span>
          <span className="flex-1">{valuePlaceholder}</span>
          <span className="flex-1">Description</span>
          <span className="w-4 shrink-0" />
        </div>
      )}
      {ensured.map((row, i) => {
        const isLast = i === ensured.length - 1;
        return (
          <div key={i} className="flex items-center gap-2 px-2 py-1">
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(i, { enabled: e.target.checked })}
              className="accent-brand"
              aria-label={t("fieldEnabled")}
            />
            {vars ? (
              <>
                <VarInput
                  bare
                  className={withDescription ? "w-1/4" : "w-1/3"}
                  value={row.key}
                  onChange={(key) => update(i, { key })}
                  vars={vars}
                  placeholder={keyPlaceholder}
                />
                <VarInput
                  bare
                  className="flex-1"
                  value={row.value}
                  onChange={(value) => update(i, { value })}
                  vars={vars}
                  placeholder={valuePlaceholder}
                />
              </>
            ) : (
              <>
                <input
                  value={row.key}
                  onChange={(e) => update(i, { key: e.target.value })}
                  placeholder={keyPlaceholder}
                  className={`${withDescription ? "w-1/4" : "w-1/3"} bg-transparent px-1 py-1 font-mono text-sm outline-none placeholder:text-neutral-600`}
                />
                <input
                  type={allowSecret && row.secret ? "password" : "text"}
                  value={row.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={valuePlaceholder}
                  className="flex-1 bg-transparent px-1 py-1 font-mono text-sm outline-none placeholder:text-neutral-600"
                />
              </>
            )}
            {allowSecret && !isLast && (
              <button
                onClick={() => update(i, { secret: !row.secret })}
                title={t(row.secret ? "secretOn" : "secretOff")}
                aria-label={t(row.secret ? "secretOn" : "secretOff")}
                className={`px-1 text-xs ${
                  row.secret ? "text-brand-fg" : "text-neutral-600 hover:text-neutral-300"
                }`}
              >
                <IconKey />
              </button>
            )}
            {withDescription && (
              <input
                value={row.description ?? ""}
                onChange={(e) => update(i, { description: e.target.value })}
                placeholder="Description"
                className="flex-1 bg-transparent px-1 py-1 text-sm outline-none placeholder:text-neutral-700"
              />
            )}
            <button
              onClick={() => remove(i)}
              disabled={isLast}
              className="px-2 text-neutral-600 hover:text-rose-400 disabled:opacity-0"
              aria-label={t("removeRow")}
            >
              ×
            </button>
          </div>
        );
      })}
    </div>
  );
}
