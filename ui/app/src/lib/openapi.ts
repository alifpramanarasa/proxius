import { parse as parseYaml } from "yaml";
import {
  emptyRequest,
  uid,
  type Collection,
  type HttpMethod,
  type TreeNode,
} from "./types";

const METHODS = ["get", "post", "put", "patch", "delete", "head", "options"];

interface OpenApiDoc {
  openapi?: string;
  swagger?: string;
  info?: { title?: string };
  servers?: { url: string }[];
  host?: string;
  basePath?: string;
  schemes?: string[];
  paths?: Record<string, Record<string, OpenApiOp>>;
}

interface OpenApiOp {
  summary?: string;
  operationId?: string;
  tags?: string[];
  parameters?: {
    name: string;
    in: string;
    required?: boolean;
    example?: unknown;
  }[];
  requestBody?: {
    content?: Record<string, { example?: unknown; schema?: unknown }>;
  };
}

function baseUrl(doc: OpenApiDoc): string {
  if (doc.servers?.[0]?.url) return doc.servers[0].url.replace(/\/$/, "");
  if (doc.host) {
    const scheme = doc.schemes?.[0] ?? "https";
    return `${scheme}://${doc.host}${doc.basePath ?? ""}`.replace(/\/$/, "");
  }
  return "";
}

/** Parse dokumen OpenAPI/Swagger (JSON atau YAML) menjadi satu Collection. */
export function parseOpenApi(input: string): Collection {
  let doc: OpenApiDoc;
  const trimmed = input.trim();
  try {
    doc = trimmed.startsWith("{") ? JSON.parse(trimmed) : parseYaml(trimmed);
  } catch (e) {
    throw new Error("Gagal parse dokumen (bukan JSON/YAML valid).");
  }
  if (!doc.paths || typeof doc.paths !== "object") {
    throw new Error("Dokumen OpenAPI tidak punya `paths`.");
  }

  const base = baseUrl(doc);
  const byTag = new Map<string, TreeNode[]>();

  for (const [path, ops] of Object.entries(doc.paths)) {
    for (const [method, op] of Object.entries(ops)) {
      if (!METHODS.includes(method.toLowerCase())) continue;
      const req = emptyRequest(
        op.summary || op.operationId || `${method.toUpperCase()} ${path}`,
      );
      req.method = method.toUpperCase() as HttpMethod;
      req.url = base + path;
      req.headers = [];
      req.query = [];

      for (const p of op.parameters ?? []) {
        const example = p.example != null ? String(p.example) : "";
        if (p.in === "query") {
          req.query.push({ key: p.name, value: example, enabled: !!p.required });
        } else if (p.in === "header") {
          req.headers.push({ key: p.name, value: example, enabled: !!p.required });
        }
        // path params dibiarkan inline sebagai {name} pada URL.
      }

      const json = op.requestBody?.content?.["application/json"];
      if (json?.example != null) {
        req.body = {
          kind: "json",
          content: JSON.stringify(json.example, null, 2),
        };
      }

      if (req.headers.length === 0)
        req.headers = [{ key: "", value: "", enabled: true }];
      if (req.query.length === 0)
        req.query = [{ key: "", value: "", enabled: true }];

      const tag = op.tags?.[0] ?? "default";
      const node: TreeNode = { id: uid("node"), type: "request", name: req.name, request: req };
      if (!byTag.has(tag)) byTag.set(tag, []);
      byTag.get(tag)!.push(node);
    }
  }

  const nodes: TreeNode[] =
    byTag.size <= 1
      ? [...byTag.values()].flat()
      : [...byTag.entries()].map(([tag, children]) => ({
          id: uid("node"),
          type: "folder",
          name: tag,
          children,
        }));

  return { id: uid("col"), name: doc.info?.title || "Imported API", nodes };
}
