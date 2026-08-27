// Import file .pxs (RunDocument JSON hasil "Export .pxs") kembali ke workspace.
import {
  emptyRequest,
  uid,
  type Collection,
  type Environment,
  type HttpRequest,
  type RunDocument,
  type TreeNode,
} from "./types";

/** Parse teks .pxs → collection (request datar) + environment opsional dari variables. */
export function parsePxs(text: string): { collection: Collection; environment?: Environment } {
  let doc: Partial<RunDocument>;
  try {
    doc = JSON.parse(text);
  } catch {
    throw new Error("JSON tidak valid.");
  }
  if (!doc || !Array.isArray(doc.requests)) {
    throw new Error("Bukan file .pxs valid (butuh field `requests`).");
  }
  const name = doc.name || "Imported";

  const nodes: TreeNode[] = doc.requests.map((r: HttpRequest) => {
    const req: HttpRequest = { ...emptyRequest(r.name || r.method || "Request"), ...r, id: uid("req") };
    return { id: uid("node"), type: "request", name: req.name, request: req };
  });
  const collection: Collection = { id: uid("col"), name, nodes };

  let environment: Environment | undefined;
  if (Array.isArray(doc.variables) && doc.variables.some((v) => v.key)) {
    environment = {
      id: uid("env"),
      name: `${name} vars`,
      variables: doc.variables.filter((v) => v.key),
    };
  }
  return { collection, environment };
}
