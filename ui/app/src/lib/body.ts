import type { KeyValue, RequestBody } from "./types";

/** Serialize body GraphQL → string JSON {query, variables}. */
export function graphqlToJson(query: string, variables: string): string {
  let vars: unknown = undefined;
  const trimmed = variables.trim();
  if (trimmed) {
    try {
      vars = JSON.parse(trimmed);
    } catch {
      vars = variables; // biarkan mentah bila bukan JSON valid
    }
  }
  return JSON.stringify(vars === undefined ? { query } : { query, variables: vars });
}

/** Teks mentah body untuk text/json/graphql (dipakai signing, deskripsi, dll). Selain itu "". */
export function bodyRawText(body: RequestBody | undefined): string {
  if (!body) return "";
  if (body.kind === "text" || body.kind === "json") return body.content;
  if (body.kind === "graphql") return graphqlToJson(body.query, body.variables);
  return "";
}

/** Ubah body menjadi bentuk yang dimengerti engine: GraphQL → JSON. */
export function normalizeBody(body: RequestBody): RequestBody {
  if (body.kind === "graphql")
    return { kind: "json", content: graphqlToJson(body.query, body.variables) };
  return body;
}

/** Encode urlencoded items → "a=1&b=2" (hanya baris aktif berkunci). */
export function encodeUrlencoded(items: KeyValue[]): string {
  return items
    .filter((i) => i.enabled && i.key)
    .map((i) => `${encodeURIComponent(i.key)}=${encodeURIComponent(i.value)}`)
    .join("&");
}

/** Basename dari path (Windows/Unix). */
export function basename(p: string): string {
  return p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p;
}

/** Apakah content-type merupakan konten biner (bukan teks)? */
export function isBinaryContentType(ct: string): boolean {
  const t = ct.toLowerCase();
  if (!t) return false;
  if (
    t.startsWith("text/") ||
    t.includes("json") ||
    t.includes("xml") ||
    t.includes("javascript") ||
    t.includes("x-www-form-urlencoded") ||
    t.includes("csv") ||
    t.includes("html")
  )
    return false;
  return (
    t.startsWith("image/") ||
    t.startsWith("audio/") ||
    t.startsWith("video/") ||
    t.startsWith("font/") ||
    t.includes("pdf") ||
    t.includes("octet-stream") ||
    t.includes("zip") ||
    t.includes("protobuf")
  );
}

/** Encode Uint8Array → base64 (chunked agar aman untuk data besar). */
export function bytesToBase64(bytes: Uint8Array): string {
  let bin = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
}
