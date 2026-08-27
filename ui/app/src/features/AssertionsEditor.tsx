import {
  ASSERTION_OPS,
  uid,
  type Assertion,
  type AssertionOp,
  type AssertionResult,
  type AssertionSource,
  type HttpResponse,
} from "../lib/types";
import { inferSchema } from "../lib/schema";
import { useT } from "../store/i18n";

const SOURCE_KINDS: AssertionSource["kind"][] = [
  "status",
  "responseTime",
  "header",
  "jsonPath",
  "body",
];

function defaultSource(kind: AssertionSource["kind"]): AssertionSource {
  switch (kind) {
    case "header":
      return { kind: "header", name: "" };
    case "jsonPath":
      return { kind: "jsonPath", path: "$." };
    case "status":
      return { kind: "status" };
    case "responseTime":
      return { kind: "responseTime" };
    case "body":
      return { kind: "body" };
  }
}

export function AssertionsEditor({
  assertions,
  onChange,
  results,
  response,
}: {
  assertions: Assertion[];
  onChange: (a: Assertion[]) => void;
  results?: AssertionResult[];
  response?: HttpResponse;
}) {
  const t = useT();
  function update(i: number, patch: Partial<Assertion>) {
    onChange(assertions.map((a, idx) => (idx === i ? { ...a, ...patch } : a)));
  }
  function remove(i: number) {
    onChange(assertions.filter((_, idx) => idx !== i));
  }
  function add() {
    // Default berupa cek body (jsonPath exists) — bukan status/equals, yang
    // dikelola terpisah oleh kartu skenario dan akan tersembunyi di editor ini.
    onChange([
      ...assertions,
      {
        id: uid("as"),
        source: { kind: "jsonPath", path: "$." },
        op: "exists",
        value: "",
        enabled: true,
      },
    ]);
  }

  const resById = new Map(results?.map((r) => [r.id, r]));

  return (
    <div className="space-y-2">
      <div className="space-y-1">
        {assertions.map((a, i) => {
          const res = resById.get(a.id);
          const isSchema = a.op === "matchesSchema";
          const needsValue = a.op !== "exists" && a.op !== "notExists" && !isSchema;
          return (
            <div key={a.id} className="space-y-1">
            <div className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={a.enabled}
                onChange={(e) => update(i, { enabled: e.target.checked })}
                className="accent-brand"
              />
              <select
                value={a.source.kind}
                onChange={(e) =>
                  update(i, {
                    source: defaultSource(e.target.value as AssertionSource["kind"]),
                  })
                }
                className="rounded border border-neutral-800 bg-neutral-900 px-1 py-1 text-xs outline-none"
              >
                {SOURCE_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {k}
                  </option>
                ))}
              </select>
              {a.source.kind === "header" && (
                <input
                  value={a.source.name}
                  onChange={(e) =>
                    update(i, { source: { kind: "header", name: e.target.value } })
                  }
                  placeholder="Header-Name"
                  className="w-28 rounded border border-neutral-800 bg-neutral-900 px-1 py-1 font-mono text-xs outline-none"
                />
              )}
              {a.source.kind === "jsonPath" && (
                <input
                  value={a.source.path}
                  onChange={(e) =>
                    update(i, { source: { kind: "jsonPath", path: e.target.value } })
                  }
                  placeholder="$.data.id"
                  className="w-32 rounded border border-neutral-800 bg-neutral-900 px-1 py-1 font-mono text-xs outline-none"
                />
              )}
              <select
                value={a.op}
                onChange={(e) => update(i, { op: e.target.value as AssertionOp })}
                className="rounded border border-neutral-800 bg-neutral-900 px-1 py-1 text-xs outline-none"
              >
                {ASSERTION_OPS.map((op) => (
                  <option key={op} value={op}>
                    {op}
                  </option>
                ))}
              </select>
              {isSchema ? (
                <span className="flex-1 text-xs text-neutral-500">{t("jsonSchemaLabel")}</span>
              ) : (
                <input
                  value={a.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  disabled={!needsValue}
                  placeholder={needsValue ? t("expected") : "—"}
                  className="flex-1 rounded border border-neutral-800 bg-neutral-900 px-1 py-1 font-mono text-xs outline-none disabled:opacity-40"
                />
              )}
              {res && (
                <span
                  title={res.message || `actual: ${res.actual}`}
                  className={res.passed ? "text-emerald-400" : "text-rose-400"}
                >
                  {res.passed ? "✓" : "✗"}
                </span>
              )}
              <button
                onClick={() => remove(i)}
                className="px-1 text-neutral-600 hover:text-rose-400"
              >
                ×
              </button>
            </div>
            {isSchema && (
              <div className="ml-6 space-y-1">
                <textarea
                  value={a.value}
                  onChange={(e) => update(i, { value: e.target.value })}
                  placeholder={'{ "type": "object", "required": ["id"] }'}
                  rows={5}
                  className="w-full rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs outline-none focus:border-brand"
                />
                <button
                  onClick={() => {
                    try {
                      update(i, {
                        value: JSON.stringify(inferSchema(JSON.parse(response!.body)), null, 2),
                      });
                    } catch {
                      /* body bukan JSON — biarkan */
                    }
                  }}
                  disabled={!response?.body}
                  className="rounded border border-neutral-700 px-2 py-0.5 text-xs text-neutral-300 hover:bg-neutral-800 disabled:opacity-40"
                >
                  {t("inferSchema")}
                </button>
              </div>
            )}
            </div>
          );
        })}
        {assertions.length === 0 && (
          <p className="py-2 text-xs text-neutral-600">{t("noAssertions")}</p>
        )}
      </div>
      <button
        onClick={add}
        className="rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
      >
        ＋ {t("addAssertion")}
      </button>
    </div>
  );
}
