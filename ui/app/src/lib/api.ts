import { invoke } from "@tauri-apps/api/core";
import { bytesToBase64, encodeUrlencoded, isBinaryContentType, normalizeBody } from "./body";
import { getFieldFile } from "./fileStore";
import type { HttpRequest, HttpResponse, KeyValue, RequestSettings } from "./types";

/** True bila berjalan di dalam shell Tauri (native engine tersedia). */
export const isTauri = (): boolean =>
  typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

export interface SendOptions {
  timeoutMs?: number;
  followRedirects?: boolean;
  verifySsl?: boolean;
  proxyUrl?: string;
  clientCertPath?: string;
  clientKeyPath?: string;
}

function toOptions(s?: RequestSettings): SendOptions | undefined {
  if (!s) return undefined;
  return {
    timeoutMs: s.timeoutMs,
    followRedirects: s.followRedirects,
    verifySsl: s.verifySsl,
    proxyUrl: s.proxyUrl,
    clientCertPath: s.clientCertPath,
    clientKeyPath: s.clientKeyPath,
  };
}

/**
 * Kirim request. Di desktop → native engine Rust (bebas CORS).
 * Di browser dev → fallback `fetch` (terbatas CORS, cukup untuk demo M0).
 */
export interface ConnTiming {
  dnsMs: number;
  connectMs: number;
  address: string;
}

/** Ukur fase koneksi (DNS + TCP connect) ke host URL. Native/desktop saja. */
export async function probeConnection(url: string): Promise<ConnTiming> {
  return invoke<ConnTiming>("probe_connection", { url });
}

export async function sendRequest(
  req: HttpRequest,
  settings?: RequestSettings,
): Promise<HttpResponse> {
  const options = toOptions(settings);
  // GraphQL dikompilasi ke JSON sebelum menyentuh engine (native/browser).
  const prepared: HttpRequest = { ...req, body: normalizeBody(req.body) };
  if (isTauri()) {
    return invoke<HttpResponse>("send_request", { req: prepared, options });
  }
  return sendViaFetch(prepared, options);
}

async function sendViaFetch(req: HttpRequest, options?: SendOptions): Promise<HttpResponse> {
  const url = new URL(req.url);
  for (const q of req.query) {
    if (q.enabled && q.key) url.searchParams.append(q.key, q.value);
  }

  const headers = new Headers();
  for (const h of req.headers) {
    if (h.enabled && h.key) headers.set(h.key, h.value);
  }

  let body: BodyInit | undefined;
  const b = req.body;
  if (b.kind === "text") {
    body = b.content;
  } else if (b.kind === "json") {
    body = b.content;
    if (!headers.has("content-type")) headers.set("content-type", "application/json");
  } else if (b.kind === "urlencoded") {
    body = encodeUrlencoded(b.items);
    if (!headers.has("content-type"))
      headers.set("content-type", "application/x-www-form-urlencoded");
  } else if (b.kind === "form") {
    const fd = new FormData();
    for (const f of b.items) {
      if (!f.enabled || !f.key) continue;
      if (f.type === "file") {
        const file = getFieldFile(f.id);
        if (file) fd.append(f.key, file, f.filename || file.name);
        // Tanpa objek File (mis. path dari sesi desktop) → dilewati di browser.
      } else {
        fd.append(f.key, f.value);
      }
    }
    // Jangan set content-type: browser menambahkan boundary multipart otomatis.
    headers.delete("content-type");
    body = fd;
  }

  const noBody = req.method === "GET" || req.method === "HEAD";

  const started = performance.now();
  const ctrl = new AbortController();
  const timer =
    options?.timeoutMs && options.timeoutMs > 0
      ? setTimeout(() => ctrl.abort(), options.timeoutMs)
      : undefined;
  let res: Response;
  try {
    res = await fetch(url.toString(), {
      method: req.method,
      headers,
      body: noBody ? undefined : body,
      redirect: options?.followRedirects === false ? "manual" : "follow",
      signal: ctrl.signal,
    });
  } finally {
    if (timer) clearTimeout(timer);
  }
  // fetch() resolve saat header response tiba ≈ TTFB; body dibaca setelahnya.
  const ttfbMs = Math.round(performance.now() - started);
  const buf = new Uint8Array(await res.arrayBuffer());
  const durationMs = Math.round(performance.now() - started);

  const respHeaders: KeyValue[] = [];
  res.headers.forEach((value, key) =>
    respHeaders.push({ key, value, enabled: true }),
  );

  // Konten biner (gambar/PDF/dll) → base64 untuk preview; teks → utf8.
  const ct = res.headers.get("content-type") ?? "";
  const binary = isBinaryContentType(ct);
  return {
    status: res.status,
    statusText: res.statusText,
    headers: respHeaders,
    body: binary ? "" : new TextDecoder().decode(buf),
    bodyBase64: binary ? bytesToBase64(buf) : undefined,
    durationMs,
    ttfbMs,
    sizeBytes: buf.length,
  };
}

// ── Mock server (desktop) ────────────────────────────────────────────────
import type { MockRoute } from "./mock";

/** Jalankan mock server di backend Tauri. Mengembalikan port yang dipakai. */
export async function mockStart(routes: MockRoute[], port: number): Promise<number> {
  return invoke<number>("mock_start", { routes, port });
}

/** Hentikan mock server yang sedang berjalan. */
export async function mockStop(): Promise<void> {
  await invoke("mock_stop");
}

/** Port mock server aktif, atau null bila tidak berjalan. */
export async function mockStatus(): Promise<number | null> {
  return invoke<number | null>("mock_status");
}
