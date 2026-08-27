import { uid, type TreeNode } from "../lib/types";

/** Sisipkan node ke dalam folder `parentId` (atau root bila null). */
export function insertNode(
  nodes: TreeNode[],
  parentId: string | null,
  node: TreeNode,
): TreeNode[] {
  if (parentId === null) return [...nodes, node];
  return nodes.map((n) => {
    if (n.id === parentId && n.type === "folder") {
      return { ...n, children: [...n.children, node] };
    }
    if (n.type === "folder") {
      return { ...n, children: insertNode(n.children, parentId, node) };
    }
    return n;
  });
}

/** Hapus node berdasarkan id (rekursif). */
export function removeNode(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes
    .filter((n) => n.id !== id)
    .map((n) =>
      n.type === "folder" ? { ...n, children: removeNode(n.children, id) } : n,
    );
}

/** Terapkan patch ke node dengan id tertentu. */
export function updateNode(
  nodes: TreeNode[],
  id: string,
  fn: (n: TreeNode) => TreeNode,
): TreeNode[] {
  return nodes.map((n) => {
    if (n.id === id) return fn(n);
    if (n.type === "folder") {
      return { ...n, children: updateNode(n.children, id, fn) };
    }
    return n;
  });
}

/** Sisipkan node tepat setelah node dengan id `targetId` (level yang sama). */
export function insertAfter(
  nodes: TreeNode[],
  targetId: string,
  node: TreeNode,
): TreeNode[] {
  const out: TreeNode[] = [];
  for (const n of nodes) {
    out.push(
      n.type === "folder"
        ? { ...n, children: insertAfter(n.children, targetId, node) }
        : n,
    );
    if (n.id === targetId) out.push(node);
  }
  return out;
}

/** Salin node beserta anaknya dengan id baru (untuk duplicate). */
export function cloneWithNewIds(node: TreeNode): TreeNode {
  if (node.type === "folder") {
    return { ...node, id: uid("node"), children: node.children.map(cloneWithNewIds) };
  }
  return {
    ...node,
    id: uid("node"),
    request: { ...structuredClone(node.request), id: uid("req") },
  };
}

/** Cari node berdasarkan id. */
export function findNode(nodes: TreeNode[], id: string): TreeNode | undefined {
  for (const n of nodes) {
    if (n.id === id) return n;
    if (n.type === "folder") {
      const found = findNode(n.children, id);
      if (found) return found;
    }
  }
  return undefined;
}
