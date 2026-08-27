// Import Postman Collection v2.x → Collection Proxius.
import {
  emptyRequest,
  uid,
  type Auth,
  type AuthType,
  type Collection,
  type FormField,
  type HttpMethod,
  type HttpRequest,
  type KeyValue,
  type RequestBody,
  type TreeNode,
} from "./types";

interface PmKV {
  key?: string;
  value?: string;
  disabled?: boolean;
  type?: string;
  src?: string;
}
interface PmUrl {
  raw?: string;
  query?: PmKV[];
}
interface PmBody {
  mode?: string;
  raw?: string;
  urlencoded?: PmKV[];
  formdata?: PmKV[];
  graphql?: { query?: string; variables?: unknown };
  options?: { raw?: { language?: string } };
}
interface PmAuth {
  type?: string;
  [k: string]: unknown;
}
interface PmRequest {
  method?: string;
  header?: PmKV[];
  url?: string | PmUrl;
  body?: PmBody;
  auth?: PmAuth;
}
interface PmItem {
  name?: string;
  item?: PmItem[];
  request?: PmRequest;
  auth?: PmAuth;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function kv(rows?: PmKV[]): KeyValue[] {
  return (rows ?? [])
    .filter((r) => r.key)
    .map((r) => ({ key: r.key!, value: r.value ?? "", enabled: !r.disabled }));
}

function mapAuth(a?: PmAuth): Auth | undefined {
  if (!a || !a.type) return undefined;
  const arr = (a[a.type] as PmKV[] | undefined) ?? [];
  const get = (k: string) => arr.find((x) => x.key === k)?.value ?? "";
  const type = a.type as AuthType;
  switch (a.type) {
    case "bearer":
      return { type: "bearer", token: get("token") };
    case "basic":
      return { type: "basic", username: get("username"), password: get("password") };
    case "apikey":
      return {
        type: "apikey",
        key: get("key"),
        value: get("value"),
        addTo: get("in") === "query" ? "query" : "header",
      };
    case "noauth":
      return { type: "none" };
    default:
      return { type };
  }
}

function mapBody(b?: PmBody): RequestBody {
  if (!b || !b.mode) return { kind: "none" };
  switch (b.mode) {
    case "raw": {
      const lang = b.options?.raw?.language;
      const content = b.raw ?? "";
      return lang === "json" ? { kind: "json", content } : { kind: "text", content };
    }
    case "urlencoded":
      return { kind: "urlencoded", items: kv(b.urlencoded) };
    case "formdata":
      return {
        kind: "form",
        items: (b.formdata ?? [])
          .filter((f) => f.key)
          .map<FormField>((f) => ({
            id: uid("ff"),
            key: f.key!,
            value: f.type === "file" ? f.src ?? "" : f.value ?? "",
            type: f.type === "file" ? "file" : "text",
            enabled: !f.disabled,
          })),
      };
    case "graphql":
      return {
        kind: "graphql",
        query: b.graphql?.query ?? "",
        variables:
          typeof b.graphql?.variables === "string"
            ? b.graphql.variables
            : b.graphql?.variables
              ? JSON.stringify(b.graphql.variables, null, 2)
              : "",
      };
    default:
      return { kind: "none" };
  }
}

function urlOf(u?: string | PmUrl): { url: string; query: KeyValue[] } {
  if (!u) return { url: "", query: [] };
  if (typeof u === "string") return { url: u, query: [] };
  const raw = (u.raw ?? "").split("?")[0];
  return { url: raw, query: kv(u.query) };
}

function toRequest(it: PmItem): HttpRequest {
  const r = it.request ?? {};
  const base = emptyRequest(it.name || "Request");
  const { url, query } = urlOf(r.url);
  const method = (r.method ?? "GET").toUpperCase();
  return {
    ...base,
    name: it.name || "Request",
    method: (METHODS.includes(method) ? method : "GET") as HttpMethod,
    url,
    query,
    headers: kv(r.header),
    body: mapBody(r.body),
    auth: mapAuth(r.auth),
  };
}

function toNode(it: PmItem): TreeNode {
  if (Array.isArray(it.item)) {
    return {
      id: uid("node"),
      type: "folder",
      name: it.name || "Folder",
      children: it.item.map(toNode),
      auth: mapAuth(it.auth),
    };
  }
  return { id: uid("node"), type: "request", name: it.name || "Request", request: toRequest(it) };
}

/** Parse teks Postman Collection v2.x menjadi Collection Proxius. */
export function parsePostman(text: string): Collection {
  let doc: { info?: { name?: string }; item?: PmItem[]; auth?: PmAuth };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("JSON tidak valid.");
  }
  if (!doc || !Array.isArray(doc.item)) {
    throw new Error("Bukan Postman Collection v2 yang valid (butuh field `item`).");
  }
  return {
    id: uid("col"),
    name: doc.info?.name || "Imported",
    nodes: doc.item.map(toNode),
    auth: mapAuth(doc.auth),
  };
}
