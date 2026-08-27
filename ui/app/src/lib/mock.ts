// Bangun file route mock (dari example response tersimpan) untuk dijalankan
// dengan `proxius mock <file> --port 9090`.
import { flatten } from "./run";
import type { Collection } from "./types";

function pathOf(url: string): string {
  try {
    return new URL(url).pathname || "/";
  } catch {
    const stripped = url.replace(/^[a-z]+:\/\/[^/]+/i, "").split("?")[0];
    return stripped.startsWith("/") ? stripped : "/" + stripped;
  }
}

export interface MockRoute {
  method: string;
  path: string;
  status: number;
  headers: Record<string, string>;
  body: string;
}

/** Route mock (objek) dari example pertama tiap request. */
export function mockRoutes(col: Collection): MockRoute[] {
  return flatten(col.nodes).flatMap((req) => {
    const ex = (req.examples ?? [])[0];
    if (!ex) return [];
    const headers: Record<string, string> = {};
    for (const h of ex.headers) if (h.enabled && h.key) headers[h.key] = h.value;
    return [
      {
        method: req.method,
        path: pathOf(req.url),
        status: ex.status || 200,
        headers,
        body: ex.body ?? "",
      },
    ];
  });
}

/** JSON route mock dari example pertama tiap request. */
export function toMockRoutes(col: Collection): string {
  return JSON.stringify({ routes: mockRoutes(col) }, null, 2);
}
