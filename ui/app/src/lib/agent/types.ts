// Model agen: pesan, tool, event, dan provider LLM.

export interface ToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

/** Gambar terlampir (base64) untuk pesan user — provider vision. */
export interface ImagePart {
  data: string; // base64 tanpa prefix data:
  mime: string;
}

/** Pesan internal, netral-provider. */
export type AgentMessage =
  | { role: "system"; content: string }
  | { role: "user"; content: string; images?: ImagePart[] }
  | { role: "assistant"; content: string; toolCalls: ToolCall[] }
  | { role: "tool"; toolCallId: string; toolName: string; content: string };

/** Definisi tool yang bisa dipanggil agen. */
export interface ToolDef {
  name: string;
  description: string;
  /** JSON Schema untuk argumen. */
  parameters: Record<string, unknown>;
  run: (args: Record<string, unknown>) => Promise<unknown>;
}

/** Balasan satu putaran dari provider. */
export interface ProviderReply {
  text: string;
  toolCalls: ToolCall[];
}

/** Adapter LLM (bring-your-own-agent). */
export interface AgentProvider {
  id: string;
  chat: (messages: AgentMessage[], tools: ToolDef[]) => Promise<ProviderReply>;
}

/** Event streaming ke UI selama agen berjalan. */
export type AgentEvent =
  | { type: "text"; text: string }
  | { type: "tool_call"; call: ToolCall }
  | { type: "tool_result"; id: string; name: string; result: string }
  | { type: "done" }
  | { type: "error"; error: string };
