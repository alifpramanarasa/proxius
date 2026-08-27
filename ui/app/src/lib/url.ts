// Sinkronisasi dua arah antara URL dan tabel Query Params (mirip Postman).
// Sumber kebenaran: `url` = base (tanpa query) + `query` = daftar param.
// Yang ditampilkan di URL bar = base + param aktif.

import type { KeyValue } from "./types";

/** Parse string setelah '?' menjadi pasangan key/value (tanpa decode). */
export function parseQuery(qs: string): { key: string; value: string }[] {
  if (!qs) return [];
  return qs
    .split("&")
    .filter((p) => p.length > 0)
    .map((pair) => {
      const i = pair.indexOf("=");
      return i < 0
        ? { key: pair, value: "" }
        : { key: pair.slice(0, i), value: pair.slice(i + 1) };
    });
}

/** Pisah URL penuh menjadi base + query params. */
export function splitUrl(full: string): {
  base: string;
  query: { key: string; value: string }[];
} {
  const i = full.indexOf("?");
  if (i < 0) return { base: full, query: [] };
  return { base: full.slice(0, i), query: parseQuery(full.slice(i + 1)) };
}

/** Bangun URL tampilan: base + param yang aktif. */
export function buildUrl(base: string, query: KeyValue[]): string {
  const active = query.filter((q) => q.enabled && q.key);
  if (active.length === 0) return base;
  const qs = active.map((q) => (q.value !== "" ? `${q.key}=${q.value}` : q.key)).join("&");
  return `${base}?${qs}`;
}

/** Gabungkan param hasil-parse (aktif) dengan param nonaktif yang sudah ada.
 * Param nonaktif dipertahankan (tak muncul di URL); description ikut lestari. */
export function syncQuery(
  existing: KeyValue[],
  parsed: { key: string; value: string }[],
): KeyValue[] {
  const disabled = existing.filter((q) => !q.enabled && q.key);
  const active: KeyValue[] = parsed.map((p) => {
    const prev = existing.find((q) => q.enabled && q.key === p.key);
    return { key: p.key, value: p.value, enabled: true, description: prev?.description };
  });
  return [...active, ...disabled];
}
