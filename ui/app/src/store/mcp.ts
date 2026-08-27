import { create } from "zustand";
import { persist } from "zustand/middleware";
import {
  callMcpTool,
  connectMcp,
  type McpServer,
  type McpTool,
} from "../lib/mcp/client";
import {
  oauthLogin,
  oauthRefresh,
  toStored,
  type StoredToken,
} from "../lib/oauth";
import type { ToolDef } from "../lib/agent/types";
import { uid } from "../lib/types";
import { toast } from "./ui";

type Status = "idle" | "connecting" | "connected" | "error";

interface Conn {
  status: Status;
  error?: string;
  sessionId?: string;
  tools: McpTool[];
  serverName?: string;
}

interface McpState {
  servers: McpServer[];
  conns: Record<string, Conn>;
  /** Token OAuth per server (bila server ditandai oauth). */
  tokens: Record<string, StoredToken>;

  addServer: (name: string, url: string, oauth?: boolean) => string;
  updateServer: (id: string, patch: Partial<McpServer>) => void;
  removeServer: (id: string) => void;
  login: (id: string) => Promise<void>;
  connect: (id: string) => Promise<void>;
  connectAll: () => Promise<void>;

  /** Tool dari semua server terhubung, siap dipakai agent internal. */
  remoteTools: () => ToolDef[];
}

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e));

/** Nama tool aman untuk provider: mcp__<server>__<tool>, hanya [A-Za-z0-9_-]. */
function safeName(server: string, tool: string): string {
  const slug = (s: string) => s.replace(/[^A-Za-z0-9_-]+/g, "_");
  return `mcp__${slug(server)}__${slug(tool)}`.slice(0, 64);
}

type Get = () => McpState;
type Set = (partial: Partial<McpState> | ((s: McpState) => Partial<McpState>)) => void;

/** Pastikan token OAuth (bila perlu) segar, kembalikan server dengan header Bearer. */
async function ensureAuthedServer(
  get: Get,
  set: Set,
  server: McpServer,
): Promise<McpServer> {
  if (!server.oauth) return server;

  let token = get().tokens[server.id];
  if (!token) throw new Error(`Belum login ke "${server.name}". Klik Login dulu.`);

  // Refresh proaktif bila kedaluwarsa < 60 dtk lagi.
  const soon = token.expiresAt !== undefined && token.expiresAt - Date.now() < 60_000;
  if (soon && token.refreshToken) {
    try {
      const fresh = await oauthRefresh(token.tokenEndpoint, token.clientId, token.refreshToken);
      token = toStored(fresh);
      set((s) => ({ tokens: { ...s.tokens, [server.id]: token! } }));
    } catch {
      /* pakai token lama; kalau sudah invalid, panggilan akan gagal & user login ulang */
    }
  }

  const headers = [
    ...(server.headers ?? []),
    { key: "Authorization", value: `Bearer ${token.accessToken}` },
  ];
  return { ...server, headers };
}

export const useMcp = create<McpState>()(
  persist(
    (set, get) => ({
      servers: [],
      conns: {},
      tokens: {},

      addServer: (name, url, oauth) => {
        const id = uid("mcp");
        set((s) => ({ servers: [...s.servers, { id, name, url, oauth }] }));
        return id;
      },
      updateServer: (id, patch) =>
        set((s) => ({
          servers: s.servers.map((sv) => (sv.id === id ? { ...sv, ...patch } : sv)),
        })),
      removeServer: (id) =>
        set((s) => {
          const conns = { ...s.conns };
          const tokens = { ...s.tokens };
          delete conns[id];
          delete tokens[id];
          return { servers: s.servers.filter((sv) => sv.id !== id), conns, tokens };
        }),

      login: async (id) => {
        const server = get().servers.find((s) => s.id === id);
        if (!server) return;
        try {
          const t = await oauthLogin(server.url);
          set((s) => ({ tokens: { ...s.tokens, [id]: toStored(t) } }));
          toast.success(`Login "${server.name}" berhasil.`);
          await get().connect(id);
        } catch (e) {
          toast.error(`Login "${server.name}": ${msg(e)}`);
        }
      },

      connect: async (id) => {
        const server = get().servers.find((s) => s.id === id);
        if (!server) return;
        set((s) => ({ conns: { ...s.conns, [id]: { status: "connecting", tools: [] } } }));
        try {
          const authed = await ensureAuthedServer(get, set, server);
          const hs = await connectMcp(authed);
          set((s) => ({
            conns: {
              ...s.conns,
              [id]: {
                status: "connected",
                sessionId: hs.sessionId,
                tools: hs.tools,
                serverName: hs.serverName,
              },
            },
          }));
          toast.success(`MCP "${server.name}": ${hs.tools.length} tool.`);
        } catch (e) {
          set((s) => ({
            conns: { ...s.conns, [id]: { status: "error", error: msg(e), tools: [] } },
          }));
          toast.error(`MCP "${server.name}": ${msg(e)}`);
        }
      },

      connectAll: async () => {
        await Promise.all(get().servers.map((s) => get().connect(s.id)));
      },

      remoteTools: () => {
        const { servers, conns } = get();
        const out: ToolDef[] = [];
        for (const server of servers) {
          const conn = conns[server.id];
          if (!conn || conn.status !== "connected") continue;
          for (const tool of conn.tools) {
            const sv = server;
            out.push({
              name: safeName(conn.serverName ?? sv.name, tool.name),
              description: `[MCP ${sv.name}] ${tool.description ?? tool.name}`,
              parameters: tool.inputSchema ?? { type: "object", properties: {} },
              run: async (args) => {
                const authed = await ensureAuthedServer(get, set, sv);
                return callMcpTool(authed, get().conns[sv.id]?.sessionId, tool.name, args);
              },
            });
          }
        }
        return out;
      },
    }),
    {
      name: "proxius-mcp",
      partialize: (s) => ({ servers: s.servers, tokens: s.tokens }),
    },
  ),
);
