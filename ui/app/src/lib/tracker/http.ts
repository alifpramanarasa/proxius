// Helper untuk membangun HttpRequest POST-JSON yang dijalankan lewat native
// engine (bebas CORS), dipakai oleh klien Jira & Linear.

import { emptyRequest, type HttpRequest, type KeyValue } from "../types";
import { tr } from "../../store/i18n";

export function jsonPost(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): HttpRequest {
  const h: KeyValue[] = Object.entries(headers).map(([key, value]) => ({
    key,
    value,
    enabled: true,
  }));
  h.push({ key: "Content-Type", value: "application/json", enabled: true });
  h.push({ key: "Accept", value: "application/json", enabled: true });
  return {
    ...emptyRequest("tracker"),
    method: "POST",
    url,
    headers: h,
    query: [],
    body: { kind: "json", content: JSON.stringify(body) },
  };
}

/** Base64 dari string ASCII (btoa di browser/desktop; Buffer di Node/test). */
export function base64(s: string): string {
  if (typeof btoa === "function") return btoa(s);
  // Fallback untuk lingkungan non-browser (test headless).
  const g = globalThis as unknown as {
    Buffer?: { from(s: string, enc: string): { toString(enc: string): string } };
  };
  if (g.Buffer) return g.Buffer.from(s, "utf-8").toString("base64");
  throw new Error(tr("base64Unavailable"));
}
