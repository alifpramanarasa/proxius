import { useEffect, useRef, useState } from "react";
import type { KeyValue } from "../lib/types";
import { buildUrl, splitUrl, syncQuery } from "../lib/url";
import { VarInput } from "./VarInput";

/** URL bar yang tersinkron dua arah dengan tabel Query Params (auto-detect).
 * Mengetik `?a=1&b=2` di sini otomatis mengisi Params; mengubah Params
 * memperbarui URL. */
export function UrlField({
  url,
  query,
  onChange,
  vars,
  placeholder,
}: {
  url: string;
  query: KeyValue[];
  onChange: (patch: { url: string; query: KeyValue[] }) => void;
  vars: Record<string, string>;
  placeholder?: string;
}) {
  const [text, setText] = useState(() => buildUrl(url, query));
  const last = useRef(text);

  // Resync tampilan bila url/query berubah dari luar (edit tabel, ganti tab).
  useEffect(() => {
    const computed = buildUrl(url, query);
    if (computed !== last.current) {
      setText(computed);
      last.current = computed;
    }
  }, [url, query]);

  // Normalisasi request lama: bila `url` masih memuat query, pindahkan ke Params.
  useEffect(() => {
    if (url.includes("?")) {
      const { base, query: parsed } = splitUrl(url);
      onChange({ url: base, query: syncQuery(query, parsed) });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url]);

  function handle(v: string) {
    setText(v);
    const { base, query: parsed } = splitUrl(v);
    const merged = syncQuery(query, parsed);
    last.current = buildUrl(base, merged);
    onChange({ url: base, query: merged });
  }

  return (
    <VarInput
      className="flex-1"
      value={text}
      onChange={handle}
      vars={vars}
      placeholder={placeholder}
    />
  );
}
