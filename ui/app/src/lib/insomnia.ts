// Import ekspor Insomnia (v4) → Collection Proxius.
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

interface InsoKV {
  name?: string;
  value?: string;
  disabled?: boolean;
  type?: string;
  fileName?: string;
}
interface InsoBody {
  mimeType?: string;
  text?: string;
  params?: InsoKV[];
}
interface InsoAuth {
  type?: string;
  disabled?: boolean;
  token?: string;
  username?: string;
  password?: string;
  key?: string;
  value?: string;
  addTo?: string;
}
interface InsoRes {
  _id?: string;
  _type?: string;
  parentId?: string;
  name?: string;
  method?: string;
  url?: string;
  headers?: InsoKV[];
  parameters?: InsoKV[];
  body?: InsoBody;
  authentication?: InsoAuth;
}

const METHODS = ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"];

function kv(rows?: InsoKV[]): KeyValue[] {
  return (rows ?? [])
    .filter((r) => r.name)
    .map((r) => ({ key: r.name!, value: r.value ?? "", enabled: !r.disabled }));
}

function mapAuth(a?: InsoAuth): Auth | undefined {
  if (!a || !a.type || a.disabled) return undefined;
  switch (a.type) {
    case "bearer":
      return { type: "bearer", token: a.token ?? "" };
    case "basic":
      return { type: "basic", username: a.username ?? "", password: a.password ?? "" };
    case "apikey":
      return {
        type: "apikey",
        key: a.key ?? "",
        value: a.value ?? "",
        addTo: a.addTo === "queryParams" ? "query" : "header",
      };
    default:
      return { type: a.type as AuthType };
  }
}

function mapBody(b?: InsoBody): RequestBody {
  if (!b || (!b.mimeType && !b.text && !b.params)) return { kind: "none" };
  const mime = (b.mimeType ?? "").toLowerCase();
  const text = b.text ?? "";
  if (mime.includes("graphql")) {
    try {
      const parsed = JSON.parse(text) as { query?: string; variables?: unknown };
      return {
        kind: "graphql",
        query: parsed.query ?? "",
        variables: parsed.variables ? JSON.stringify(parsed.variables, null, 2) : "",
      };
    } catch {
      return { kind: "graphql", query: text, variables: "" };
    }
  }
  if (mime.includes("x-www-form-urlencoded")) return { kind: "urlencoded", items: kv(b.params) };
  if (mime.includes("form-data")) {
    return {
      kind: "form",
      items: (b.params ?? [])
        .filter((p) => p.name)
        .map<FormField>((p) => ({
          id: uid("ff"),
          key: p.name!,
          value: p.type === "file" ? p.fileName ?? "" : p.value ?? "",
          type: p.type === "file" ? "file" : "text",
          enabled: !p.disabled,
        })),
    };
  }
  if (mime.includes("json")) return { kind: "json", content: text };
  if (text) return { kind: "text", content: text };
  return { kind: "none" };
}

function toRequest(r: InsoRes): HttpRequest {
  const base = emptyRequest(r.name || "Request");
  const method = (r.method ?? "GET").toUpperCase();
  return {
    ...base,
    name: r.name || "Request",
    method: (METHODS.includes(method) ? method : "GET") as HttpMethod,
    url: (r.url ?? "").split("?")[0],
    query: kv(r.parameters),
    headers: kv(r.headers),
    body: mapBody(r.body),
    auth: mapAuth(r.authentication),
  };
}

/** Parse teks ekspor Insomnia v4 menjadi Collection Proxius. */
export function parseInsomnia(text: string): Collection {
  let doc: { resources?: InsoRes[] };
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("JSON tidak valid.");
  }
  const resources = doc.resources;
  if (!Array.isArray(resources)) {
    throw new Error("Bukan ekspor Insomnia yang valid (butuh field `resources`).");
  }
  const workspace = resources.find((r) => r._type === "workspace");
  const rootId = workspace?._id;

  const buildNodes = (parentId?: string): TreeNode[] =>
    resources
      .filter(
        (r) => r.parentId === parentId && (r._type === "request" || r._type === "request_group"),
      )
      .map((r) =>
        r._type === "request_group"
          ? {
              id: uid("node"),
              type: "folder" as const,
              name: r.name || "Folder",
              children: buildNodes(r._id),
            }
          : {
              id: uid("node"),
              type: "request" as const,
              name: r.name || "Request",
              request: toRequest(r),
            },
      );

  return {
    id: uid("col"),
    name: workspace?.name || "Imported",
    nodes: buildNodes(rootId),
  };
}
