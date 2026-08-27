// Resolusi pewarisan Authorization: request "inherit" mengambil auth dari
// folder induk terdekat, lalu collection. Bila tak ada → No Auth.

import type { Auth, Collection, TreeNode } from "./types";

/** Kembalikan folder-folder leluhur (terdalam → terluar) untuk sebuah nodeId. */
function ancestorFolders(nodes: TreeNode[], nodeId: string, trail: TreeNode[] = []): TreeNode[] | null {
  for (const n of nodes) {
    if (n.id === nodeId) return trail;
    if (n.type === "folder") {
      const found = ancestorFolders(n.children, nodeId, [...trail, n]);
      if (found) return found;
    }
  }
  return null;
}

const concrete = (a?: Auth): boolean => !!a && a.type !== "inherit";

/** Auth efektif untuk sebuah request. */
export function resolveAuth(
  requestAuth: Auth | undefined,
  collection: Collection | undefined,
  nodeId: string | undefined,
): Auth {
  if (concrete(requestAuth)) return requestAuth as Auth;
  // requestAuth undefined juga diperlakukan seperti "inherit".
  if (!collection) return { type: "none" };

  const folders = nodeId ? ancestorFolders(collection.nodes, nodeId) ?? [] : [];
  // Terdalam dulu.
  for (const f of [...folders].reverse()) {
    if (f.type === "folder" && concrete(f.auth)) return f.auth as Auth;
  }
  if (concrete(collection.auth)) return collection.auth as Auth;
  return { type: "none" };
}
