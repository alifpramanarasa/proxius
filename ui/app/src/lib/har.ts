// Import HAR (HTTP Archive, dari DevTools/proxy) → Collection Proxius.
// Setiap entry.request menjadi satu request; dikelompokkan per host (folder).
import {
  emptyRequest,
  uid,
  type Collection,
  type HttpMethod,
  type KeyValue,
  type RequestBody,
  type TreeNode,
} from "./types";

interface HarNameValue {
  name: string;
  value?: string;
}
interface HarPostData {
  mimeType?: string;
  text?: string;
  params?: { name: string; value?: string }[];
}
interface HarRequest {
  method?: string;
  url?: string;
  headers?: HarNameValue[];
  queryString?: HarNameValue[];
  postData?: HarPostData;
}
interface HarEntry {
  request?: HarRequest;
}
interface Har {
  log?: { entries?: HarEntry[] };
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

// Header yang di-set browser otomatis — jangan ikut diimpor.
const SKIP_HEADERS = new Set([
  "host",
  "content-length",
  "connection",
  "accept-encoding",
]);

function kv(rows?: HarNameValue[], skip?: Set<string>): KeyValue[] {
  return (rows ?? [])
    .filter((r) => r.name && !r.name.startsWith(":") && !(skip && skip.has(r.name.toLowerCase())))
    .map((r) => ({ key: r.name, value: r.value ?? "", enabled: true }));
}

function mapBody(pd?: HarPostData): RequestBody {
  if (!pd || (!pd.text && !pd.params)) return { kind: "none" };
  const mime = (pd.mimeType ?? "").toLowerCase();
  if (mime.includes("x-www-form-urlencoded")) {
    return {
      kind: "urlencoded",
      items: (pd.params ?? []).map((p) => ({ key: p.name, value: p.value ?? "", enabled: true })),
    };
  }
  if (mime.includes("json")) return { kind: "json", content: pd.text ?? "" };
  if (pd.text) return { kind: "text", content: pd.text };
  return { kind: "none" };
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "requests";
  }
}

function pathLabel(url: string, method: string): string {
  try {
    const u = new URL(url);
    return `${method} ${u.pathname || "/"}`;
  } catch {
    return `${method} ${url}`;
  }
}

/** Parse teks HAR menjadi Collection Proxius (folder per host). */
export function parseHar(text: string): Collection {
  let doc: Har;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("JSON tidak valid.");
  }
  const entries = doc.log?.entries;
  if (!Array.isArray(entries)) {
    throw new Error("Bukan file HAR yang valid (butuh `log.entries`).");
  }

  // Kelompokkan per host.
  const byHost = new Map<string, TreeNode[]>();
  for (const entry of entries) {
    const r = entry.request;
    if (!r || !r.url) continue;
    const method = (r.method ?? "GET").toUpperCase();
    const base = emptyRequest(pathLabel(r.url, method));
    const node: TreeNode = {
      id: uid("node"),
      type: "request",
      name: base.name,
      request: {
        ...base,
        method: (METHODS.includes(method) ? method : "GET") as HttpMethod,
        url: r.url.split("?")[0],
        query: kv(r.queryString),
        headers: kv(r.headers, SKIP_HEADERS),
        body: mapBody(r.postData),
      },
    };
    const host = hostOf(r.url);
    if (!byHost.has(host)) byHost.set(host, []);
    byHost.get(host)!.push(node);
  }

  if (byHost.size === 0) throw new Error("Tidak ada request pada HAR.");

  // Satu host → langsung di root; banyak host → folder per host.
  const nodes: TreeNode[] =
    byHost.size === 1
      ? [...byHost.values()][0]
      : [...byHost.entries()].map(([host, children]) => ({
          id: uid("node"),
          type: "folder" as const,
          name: host,
          children,
        }));

  return { id: uid("col"), name: "HAR import", nodes };
}
