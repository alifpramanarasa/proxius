// MCP client (arah kebalikan): Proxius menyambung ke server MCP eksternal dan
// memakai tool-nya di dalam agent internal. Transport: Streamable HTTP
// (JSON-RPC 2.0 lewat POST). Semua request lewat native engine (sendRequest)
// agar bebas CORS di app desktop.
//
// Balasan server bisa `application/json` (satu response) atau `text/event-stream`
// (SSE); keduanya ditangani.

import { sendRequest } from "../api";
import { emptyRequest, type HttpRequest, type HttpResponse, type KeyValue } from "../types";

export interface McpServer {
  id: string;
  name: string;
  /** Endpoint MCP Streamable-HTTP, mis. http://localhost:3000/mcp */
  url: string;
  /** Header tambahan (mis. Authorization). */
  headers?: { key: string; value: string }[];
  /** True bila server butuh login OAuth (mis. Atlassian). */
  oauth?: boolean;
}

export interface McpTool {
  name: string;
  description?: string;
  inputSchema?: Record<string, unknown>;
}

export interface McpHandshake {
  sessionId?: string;
  tools: McpTool[];
  serverName?: string;
}

const PROTOCOL = "2025-06-18";

function post(server: McpServer, sessionId: string | undefined, payload: unknown): HttpRequest {
  const headers: KeyValue[] = [
    { key: "Content-Type", value: "application/json", enabled: true },
    { key: "Accept", value: "application/json, text/event-stream", enabled: true },
  ];
  if (sessionId) headers.push({ key: "Mcp-Session-Id", value: sessionId, enabled: true });
  for (const h of server.headers ?? []) {
    if (h.key.trim()) headers.push({ key: h.key, value: h.value, enabled: true });
  }
  return {
    ...emptyRequest("mcp"),
    method: "POST",
    url: server.url,
    headers,
    query: [],
    body: { kind: "json", content: JSON.stringify(payload) },
  };
}

function headerVal(resp: HttpResponse, name: string): string | undefined {
  return resp.headers.find((h) => h.key.toLowerCase() === name.toLowerCase())?.value;
}

/** Parse balasan JSON-RPC dari body (JSON langsung atau SSE `data:`). */
function parseRpc(body: string): any {
  const trimmed = body.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return null;
    }
  }
  // SSE: ambil payload `data:` terakhir yang valid JSON.
  const dataLines = trimmed
    .split(/\r?\n/)
    .filter((l) => l.startsWith("data:"))
    .map((l) => l.slice(5).trim());
  for (let i = dataLines.length - 1; i >= 0; i--) {
    try {
      return JSON.parse(dataLines[i]);
    } catch {
      /* coba baris sebelumnya */
    }
  }
  return null;
}

async function rpc(
  server: McpServer,
  sessionId: string | undefined,
  payload: unknown,
): Promise<{ msg: any; resp: HttpResponse }> {
  const resp = await sendRequest(post(server, sessionId, payload));
  if (resp.status < 200 || resp.status >= 300) {
    const detail = resp.body?.trim().slice(0, 500);
    throw new Error(
      `HTTP ${resp.status} ${resp.statusText || ""}${detail ? " · " + detail : ""}`.trim(),
    );
  }
  return { msg: parseRpc(resp.body), resp };
}

/** Handshake: initialize → notifications/initialized → tools/list. */
export async function connectMcp(server: McpServer): Promise<McpHandshake> {
  if (!server.url.trim()) throw new Error("URL server MCP kosong.");
  const init = await rpc(server, undefined, {
    jsonrpc: "2.0",
    id: 1,
    method: "initialize",
    params: {
      protocolVersion: PROTOCOL,
      capabilities: {},
      clientInfo: { name: "proxius", version: "0.0.0" },
    },
  });
  if (init.msg?.error) throw new Error(init.msg.error.message ?? "initialize gagal");
  const sessionId = headerVal(init.resp, "mcp-session-id");
  const serverName = init.msg?.result?.serverInfo?.name;

  // Notifikasi initialized (tanpa id, tanpa balasan wajib).
  try {
    await sendRequest(post(server, sessionId, { jsonrpc: "2.0", method: "notifications/initialized" }));
  } catch {
    /* abaikan */
  }

  const list = await rpc(server, sessionId, { jsonrpc: "2.0", id: 2, method: "tools/list" });
  if (list.msg?.error) throw new Error(list.msg.error.message ?? "tools/list gagal");
  const tools: McpTool[] = list.msg?.result?.tools ?? [];
  return { sessionId, tools, serverName };
}

/** Panggil satu tool; kembalikan teks gabungan dari content. */
export async function callMcpTool(
  server: McpServer,
  sessionId: string | undefined,
  name: string,
  args: unknown,
): Promise<string> {
  const { msg } = await rpc(server, sessionId, {
    jsonrpc: "2.0",
    id: 100 + Math.floor(performance.now() % 100000),
    method: "tools/call",
    params: { name, arguments: args ?? {} },
  });
  if (msg?.error) throw new Error(msg.error.message ?? "tools/call gagal");
  const content: any[] = msg?.result?.content ?? [];
  const text = content
    .filter((c) => c?.type === "text")
    .map((c) => c.text)
    .join("\n");
  if (msg?.result?.isError) throw new Error(text || "tool melaporkan error");
  return text || JSON.stringify(msg?.result ?? {});
}
