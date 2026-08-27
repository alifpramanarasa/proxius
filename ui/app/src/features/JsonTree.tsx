import { useState } from "react";

/** Penampil pohon JSON yang bisa dilipat (mirip Bruno/Postman). */
export function JsonTree({ data }: { data: unknown }) {
  return (
    <div className="font-mono text-xs leading-relaxed">
      <TreeNode label={null} value={data} depth={0} defaultOpen />
    </div>
  );
}

function TreeNode({
  label,
  value,
  depth,
  defaultOpen,
}: {
  label: string | number | null;
  value: unknown;
  depth: number;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen ?? depth < 2);
  const isArray = Array.isArray(value);
  const isObject = value !== null && typeof value === "object";
  const keyEl =
    label !== null ? <span className="text-sky-300">{label}</span> : null;
  const sep = label !== null ? <span className="text-neutral-600">: </span> : null;

  if (!isObject) {
    return (
      <div style={{ paddingLeft: depth * 14 }}>
        {keyEl}
        {sep}
        <Leaf value={value} />
      </div>
    );
  }

  const entries: [string | number, unknown][] = isArray
    ? (value as unknown[]).map((v, i) => [i, v])
    : Object.entries(value as Record<string, unknown>);
  const open2close = isArray ? ["[", "]"] : ["{", "}"];
  const count = entries.length;

  return (
    <div style={{ paddingLeft: depth * 14 }}>
      <div className="cursor-pointer hover:bg-neutral-800/40" onClick={() => setOpen((o) => !o)}>
        <span className="mr-1 inline-block w-3 text-neutral-500">{open ? "▾" : "▸"}</span>
        {keyEl}
        {sep}
        <span className="text-neutral-500">{open2close[0]}</span>
        {!open && (
          <span className="text-neutral-600">
            {" "}
            {count} {isArray ? "item" : "key"}
            {count === 1 ? "" : "s"} {open2close[1]}
          </span>
        )}
      </div>
      {open && (
        <>
          {entries.map(([k, v]) => (
            <TreeNode key={k} label={k} value={v} depth={depth + 1} />
          ))}
          <div style={{ paddingLeft: depth * 14 }} className="text-neutral-500">
            <span className="mr-1 inline-block w-3" />
            {open2close[1]}
          </div>
        </>
      )}
    </div>
  );
}

function Leaf({ value }: { value: unknown }) {
  if (typeof value === "string")
    return <span className="text-emerald-300">"{value}"</span>;
  if (typeof value === "number") return <span className="text-amber-300">{value}</span>;
  if (typeof value === "boolean" || value === null)
    return <span className="text-violet-300">{String(value)}</span>;
  return <span className="text-neutral-300">{String(value)}</span>;
}
