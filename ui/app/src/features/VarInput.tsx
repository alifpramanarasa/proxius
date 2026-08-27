import { useRef, useState, type ReactNode } from "react";
import { useT } from "../store/i18n";

// Input/textarea dengan sorotan `{{variable}}` ala Postman:
// hijau bila variabel ada di environment aktif, merah (garis putus) bila tidak.
// Hover ke variabel (single-line) → tooltip menampilkan nilainya.
//
// Teknik: overlay berwarna di belakang field berteks transparan (caret tetap
// terlihat), scroll disinkronkan.

const VAR_RE = /\{\{\s*([\w.-]+)\s*\}\}/g;

function tokens(text: string, vars: Record<string, string>): ReactNode[] {
  const out: ReactNode[] = [];
  let last = 0;
  let i = 0;
  let m: RegExpExecArray | null;
  VAR_RE.lastIndex = 0;
  while ((m = VAR_RE.exec(text))) {
    if (m.index > last) out.push(<span key={i++}>{text.slice(last, m.index)}</span>);
    const defined = m[1] in vars;
    out.push(
      <span
        key={i++}
        className={
          defined
            ? "rounded-sm bg-emerald-500/10 text-emerald-400"
            : "rounded-sm bg-rose-500/10 text-rose-400 underline decoration-dotted"
        }
      >
        {m[0]}
      </span>,
    );
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push(<span key={i++}>{text.slice(last)}</span>);
  return out;
}

interface Hover {
  name: string;
  value?: string;
  left: number;
}

export function VarInput({
  value,
  onChange,
  vars,
  placeholder,
  className = "",
  bare = false,
}: {
  value: string;
  onChange: (v: string) => void;
  vars: Record<string, string>;
  placeholder?: string;
  className?: string;
  /** Tanpa border/background (untuk sel di dalam tabel key-value). */
  bare?: boolean;
}) {
  const t = useT();
  const inputRef = useRef<HTMLInputElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const charWRef = useRef(0);
  const [hover, setHover] = useState<Hover | null>(null);

  const syncScroll = () => {
    if (overlayRef.current && inputRef.current) {
      overlayRef.current.scrollLeft = inputRef.current.scrollLeft;
    }
  };

  const charWidth = (input: HTMLInputElement): number => {
    if (charWRef.current) return charWRef.current;
    const cs = getComputedStyle(input);
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return 8;
    ctx.font = `${cs.fontSize} ${cs.fontFamily}`;
    charWRef.current = ctx.measureText("M").width || 8;
    return charWRef.current;
  };

  const onMove = (e: React.MouseEvent<HTMLInputElement>) => {
    const input = inputRef.current;
    if (!input) return;
    const rect = input.getBoundingClientRect();
    const padL = parseFloat(getComputedStyle(input).paddingLeft) || 12;
    const cw = charWidth(input);
    const idx = Math.floor((e.clientX - rect.left - padL + input.scrollLeft) / cw);

    VAR_RE.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = VAR_RE.exec(value))) {
      if (idx >= m.index && idx < m.index + m[0].length) {
        const name = m[1];
        setHover({
          name,
          value: name in vars ? vars[name] : undefined,
          left: Math.max(4, m.index * cw + padL - input.scrollLeft),
        });
        return;
      }
    }
    if (hover) setHover(null);
  };

  const padX = bare ? "px-1" : "px-3";
  const chrome = bare
    ? ""
    : "rounded-md border border-neutral-800 bg-neutral-900 focus-within:border-brand";
  const sizeY = bare ? "py-1" : "h-full";

  return (
    <div className={`relative ${chrome} ${className}`}>
      {/* Lapisan sorotan (di belakang). */}
      <div
        ref={overlayRef}
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center overflow-hidden ${padX}`}
      >
        <span className="whitespace-pre font-mono text-sm text-neutral-200">
          {value ? tokens(value, vars) : <span className="text-neutral-600">{placeholder}</span>}
        </span>
      </div>
      {/* Field asli (teks transparan, caret terlihat). */}
      <input
        ref={inputRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
        placeholder={placeholder}
        spellCheck={false}
        className={`relative w-full bg-transparent ${padX} ${sizeY} font-mono text-sm text-transparent caret-neutral-100 outline-none placeholder:text-transparent`}
      />
      {/* Tooltip nilai variabel yang di-hover. */}
      {hover && (
        <div
          className="pointer-events-none absolute bottom-full z-40 mb-1 max-w-xs whitespace-nowrap rounded-md border border-neutral-700 bg-neutral-950 px-2 py-1 text-xs shadow-lg"
          style={{ left: hover.left }}
        >
          <span className="font-mono text-neutral-400">{hover.name}</span>
          <span className="mx-1 text-neutral-600">=</span>
          {hover.value !== undefined ? (
            <span className="font-mono text-emerald-400">{hover.value || t("emptyValue")}</span>
          ) : (
            <span className="text-rose-400">{t("notInEnv")}</span>
          )}
        </div>
      )}
    </div>
  );
}

/** Versi multi-baris (body). Sorotan variabel; tanpa hover per-variabel. */
export function VarTextarea({
  value,
  onChange,
  vars,
  placeholder,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  vars: Record<string, string>;
  placeholder?: string;
  className?: string;
}) {
  const taRef = useRef<HTMLTextAreaElement>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const syncScroll = () => {
    if (overlayRef.current && taRef.current) {
      overlayRef.current.scrollTop = taRef.current.scrollTop;
      overlayRef.current.scrollLeft = taRef.current.scrollLeft;
    }
  };

  return (
    <div
      className={`relative rounded-md border border-neutral-800 bg-neutral-900 focus-within:border-brand ${className}`}
    >
      <div
        ref={overlayRef}
        aria-hidden
        className="pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words p-3 font-mono text-sm leading-normal text-neutral-200"
      >
        {value ? tokens(value, vars) : <span className="text-neutral-600">{placeholder}</span>}
      </div>
      <textarea
        ref={taRef}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onScroll={syncScroll}
        placeholder={placeholder}
        spellCheck={false}
        className="relative h-full w-full resize-none bg-transparent p-3 font-mono text-sm leading-normal text-transparent caret-neutral-100 outline-none placeholder:text-transparent"
      />
    </div>
  );
}
