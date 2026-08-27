// Adapter LLM. Semua request LLM lewat native engine (sendRequest) → bebas CORS
// di desktop & mendukung endpoint lokal (Ollama).
import { sendRequest } from "../api";
import { emptyRequest, type HttpRequest } from "../types";
import type { AgentMessage, AgentProvider, ProviderReply, ToolCall, ToolDef } from "./types";

export interface AgentConfig {
  provider: "anthropic" | "openai" | "ollama";
  model: string;
  apiKey: string;
  baseUrl?: string;
}

const MAX_TOKENS = 4096;

function req(
  url: string,
  headers: Record<string, string>,
  body: unknown,
): HttpRequest {
  return {
    ...emptyRequest("llm"),
    method: "POST",
    url,
    headers: Object.entries(headers).map(([key, value]) => ({
      key,
      value,
      enabled: true,
    })),
    body: { kind: "json", content: JSON.stringify(body) },
  };
}

async function post(request: HttpRequest): Promise<any> {
  const res = await sendRequest(request);
  let data: any;
  try {
    data = JSON.parse(res.body);
  } catch {
    throw new Error(`respons non-JSON (status ${res.status}): ${res.body.slice(0, 300)}`);
  }
  if (res.status < 200 || res.status >= 300) {
    const msg = data?.error?.message ?? data?.error ?? res.body.slice(0, 300);
    throw new Error(`LLM ${res.status}: ${msg}`);
  }
  return data;
}

const systemOf = (m: AgentMessage[]) =>
  m.filter((x) => x.role === "system").map((x) => (x as any).content).join("\n");

// ── Anthropic (Claude) ──────────────────────────────────────────────

function anthropicMessages(msgs: AgentMessage[]): any[] {
  const out: any[] = [];
  for (const m of msgs) {
    if (m.role === "system") continue;
    if (m.role === "user") {
      const content: any[] = [{ type: "text", text: m.content }];
      for (const im of m.images ?? [])
        content.push({ type: "image", source: { type: "base64", media_type: im.mime, data: im.data } });
      out.push({ role: "user", content });
    } else if (m.role === "assistant") {
      const content: any[] = [];
      if (m.content) content.push({ type: "text", text: m.content });
      for (const c of m.toolCalls)
        content.push({ type: "tool_use", id: c.id, name: c.name, input: c.args });
      out.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      const block = { type: "tool_result", tool_use_id: m.toolCallId, content: m.content };
      const last = out[out.length - 1];
      if (last && last.role === "user" && Array.isArray(last.content) && last.content[0]?.type === "tool_result")
        last.content.push(block);
      else out.push({ role: "user", content: [block] });
    }
  }
  return out;
}

function anthropicProvider(cfg: AgentConfig): AgentProvider {
  const base = cfg.baseUrl?.replace(/\/$/, "") || "https://api.anthropic.com";
  return {
    id: "anthropic",
    chat: async (messages, tools) => {
      const data = await post(
        req(
          `${base}/v1/messages`,
          {
            "x-api-key": cfg.apiKey,
            "anthropic-version": "2023-06-01",
            "anthropic-dangerous-direct-browser-access": "true",
            "content-type": "application/json",
          },
          {
            model: cfg.model,
            max_tokens: MAX_TOKENS,
            system: systemOf(messages),
            messages: anthropicMessages(messages),
            tools: tools.map((t) => ({
              name: t.name,
              description: t.description,
              input_schema: t.parameters,
            })),
          },
        ),
      );
      const reply: ProviderReply = { text: "", toolCalls: [] };
      for (const block of data.content ?? []) {
        if (block.type === "text") reply.text += block.text;
        else if (block.type === "tool_use")
          reply.toolCalls.push({ id: block.id, name: block.name, args: block.input ?? {} });
      }
      return reply;
    },
  };
}

// ── OpenAI-compatible ───────────────────────────────────────────────

function openaiMessages(msgs: AgentMessage[]): any[] {
  return msgs.map((m) => {
    if (m.role === "system") return { role: "system", content: m.content };
    if (m.role === "user") {
      if (m.images && m.images.length)
        return {
          role: "user",
          content: [
            { type: "text", text: m.content },
            ...m.images.map((im) => ({
              type: "image_url",
              image_url: { url: `data:${im.mime};base64,${im.data}` },
            })),
          ],
        };
      return { role: "user", content: m.content };
    }
    if (m.role === "tool")
      return { role: "tool", tool_call_id: m.toolCallId, content: m.content };
    return {
      role: "assistant",
      content: m.content || null,
      ...(m.toolCalls.length
        ? {
            tool_calls: m.toolCalls.map((c) => ({
              id: c.id,
              type: "function",
              function: { name: c.name, arguments: JSON.stringify(c.args) },
            })),
          }
        : {}),
    };
  });
}

const openaiTools = (tools: ToolDef[]) =>
  tools.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description, parameters: t.parameters },
  }));

function parseOpenAiReply(data: any): ProviderReply {
  const msg = data.choices?.[0]?.message ?? data.message ?? {};
  const toolCalls: ToolCall[] = (msg.tool_calls ?? []).map((tc: any, i: number) => ({
    id: tc.id ?? `call-${i}`,
    name: tc.function?.name ?? "unknown",
    args:
      typeof tc.function?.arguments === "string"
        ? safeJson(tc.function.arguments)
        : (tc.function?.arguments ?? {}),
  }));
  return { text: msg.content ?? "", toolCalls };
}

function safeJson(s: string): Record<string, unknown> {
  try {
    return JSON.parse(s);
  } catch {
    return {};
  }
}

function openaiProvider(cfg: AgentConfig): AgentProvider {
  const base = cfg.baseUrl?.replace(/\/$/, "") || "https://api.openai.com";
  return {
    id: "openai",
    chat: async (messages, tools) => {
      const data = await post(
        req(
          `${base}/v1/chat/completions`,
          { Authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json" },
          {
            model: cfg.model,
            messages: openaiMessages(messages),
            tools: openaiTools(tools),
            tool_choice: "auto",
          },
        ),
      );
      return parseOpenAiReply(data);
    },
  };
}

function ollamaProvider(cfg: AgentConfig): AgentProvider {
  const base = cfg.baseUrl?.replace(/\/$/, "") || "http://localhost:11434";
  return {
    id: "ollama",
    chat: async (messages, tools) => {
      const data = await post(
        req(
          `${base}/api/chat`,
          { "content-type": "application/json" },
          {
            model: cfg.model,
            messages: openaiMessages(messages),
            tools: openaiTools(tools),
            stream: false,
          },
        ),
      );
      return parseOpenAiReply(data);
    },
  };
}

export function makeProvider(cfg: AgentConfig): AgentProvider {
  switch (cfg.provider) {
    case "anthropic":
      return anthropicProvider(cfg);
    case "openai":
      return openaiProvider(cfg);
    case "ollama":
      return ollamaProvider(cfg);
  }
}

/** Provider tiruan untuk pengujian: putar skrip balasan. */
export function mockProvider(script: ProviderReply[]): AgentProvider {
  let i = 0;
  return {
    id: "mock",
    chat: async () => script[Math.min(i++, script.length - 1)] ?? { text: "", toolCalls: [] },
  };
}
