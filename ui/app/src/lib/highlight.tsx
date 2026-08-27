import type { ReactNode } from "react";

// Pewarnaan sintaks JSON ringan (tanpa dependensi). Best-effort; token yang
// tak dikenali dibiarkan apa adanya.
const JSON_RE =
  /("(?:\\.|[^"\\])*")(\s*:)?|\b(true|false|null)\b|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/g;

export function highlightJson(src: string): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  JSON_RE.lastIndex = 0;
  while ((m = JSON_RE.exec(src))) {
    if (m.index > last) out.push(src.slice(last, m.index));
    let cls = "";
    if (m[1]) cls = m[2] ? "text-sky-300" : "text-emerald-300"; // key vs string
    else if (m[3]) cls = "text-violet-300"; // true/false/null
    else if (m[4]) cls = "text-amber-300"; // number
    out.push(
      <span key={i++} className={cls}>
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < src.length) out.push(src.slice(last));
  return out;
}

/** Bungkus kecocokan pencarian (case-insensitive) dengan <mark>. */
export function searchMarks(text: string, query: string): ReactNode[] {
  if (!query) return [text];
  const out: ReactNode[] = [];
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  let idx = 0;
  let i = 0;
  let pos: number;
  while ((pos = lower.indexOf(q, idx)) !== -1) {
    if (pos > idx) out.push(text.slice(idx, pos));
    out.push(
      <mark key={i++} className="rounded bg-amber-400/40 text-inherit">
        {text.slice(pos, pos + q.length)}
      </mark>,
    );
    idx = pos + q.length;
  }
  out.push(text.slice(idx));
  return out;
}

/** Jumlah kemunculan query (case-insensitive). */
export function countMatches(text: string, query: string): number {
  if (!query) return 0;
  const q = query.toLowerCase();
  const lower = text.toLowerCase();
  let n = 0;
  let idx = 0;
  let pos: number;
  while ((pos = lower.indexOf(q, idx)) !== -1) {
    n++;
    idx = pos + q.length;
  }
  return n;
}
