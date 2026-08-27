import { useState } from "react";
import type { Scripts } from "../lib/types";

/** Editor script pre-request / post-response (JavaScript, API `pm`). */
export function ScriptsPanel({
  scripts,
  onChange,
}: {
  scripts?: Scripts;
  onChange: (s: Scripts) => void;
}) {
  const [phase, setPhase] = useState<"pre" | "post">("post");
  const s = scripts ?? {};
  const value = phase === "pre" ? s.preRequest ?? "" : s.postResponse ?? "";
  const set = (code: string) =>
    onChange(phase === "pre" ? { ...s, preRequest: code } : { ...s, postResponse: code });

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-3 text-xs">
        {(["pre", "post"] as const).map((p) => (
          <button
            key={p}
            onClick={() => setPhase(p)}
            className={`${
              phase === p ? "text-neutral-100" : "text-neutral-500 hover:text-neutral-300"
            }`}
          >
            {p === "pre" ? "Pre-request" : "Post-response"}
          </button>
        ))}
        <span className="ml-auto text-[11px] text-neutral-600">
          JavaScript · pakai <span className="font-mono text-neutral-400">pm</span>
        </span>
      </div>

      <textarea
        value={value}
        onChange={(e) => set(e.target.value)}
        spellCheck={false}
        placeholder={
          phase === "post"
            ? 'pm.test("status 200", () => {\n  pm.expect(pm.response.code).to.equal(200);\n});\n// simpan variabel:\n// pm.environment.set("token", pm.response.json().token);'
            : '// dijalankan sebelum kirim\n// pm.environment.set("ts", String(Date.now()));'
        }
        className="h-52 w-full resize-none rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs leading-relaxed outline-none focus:border-brand"
      />

      <p className="text-[11px] text-neutral-600">
        Tersedia: <span className="font-mono text-neutral-400">pm.response</span> (code, status,
        responseTime, json(), text(), headers.get), <span className="font-mono text-neutral-400">pm.test(name, fn)</span>,{" "}
        <span className="font-mono text-neutral-400">pm.expect(x).to.equal/eql/include/be.above…</span>,{" "}
        <span className="font-mono text-neutral-400">pm.environment.set/get</span>,{" "}
        <span className="font-mono text-neutral-400">console.log</span>. Post-response jalan tiap
        habis Send.
      </p>
    </div>
  );
}
