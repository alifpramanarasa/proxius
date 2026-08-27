// Loop tool-calling agen: plan → panggil tool → observasi → ulangi.
import type {
  AgentEvent,
  AgentMessage,
  AgentProvider,
  ToolDef,
} from "./types";

const MAX_STEPS = 12;

/**
 * Jalankan agen sampai selesai (tanpa tool call) atau batas langkah.
 * Mengirim event via `onEvent`. `history` dimutasi dengan pesan baru.
 */
export async function runAgent(
  provider: AgentProvider,
  tools: ToolDef[],
  history: AgentMessage[],
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const reply = await provider.chat(history, tools);

      if (reply.text) onEvent({ type: "text", text: reply.text });
      history.push({
        role: "assistant",
        content: reply.text,
        toolCalls: reply.toolCalls,
      });

      if (reply.toolCalls.length === 0) {
        onEvent({ type: "done" });
        return;
      }

      // Eksekusi semua tool call putaran ini.
      for (const call of reply.toolCalls) {
        onEvent({ type: "tool_call", call });
        const tool = tools.find((t) => t.name === call.name);
        let result: string;
        try {
          const out = tool
            ? await tool.run(call.args)
            : { error: `tool tidak dikenal: ${call.name}` };
          result = typeof out === "string" ? out : JSON.stringify(out);
        } catch (e) {
          result = JSON.stringify({
            error: e instanceof Error ? e.message : String(e),
          });
        }
        onEvent({ type: "tool_result", id: call.id, name: call.name, result });
        history.push({
          role: "tool",
          toolCallId: call.id,
          toolName: call.name,
          content: result,
        });
      }
    }
    onEvent({ type: "error", error: `Melebihi ${MAX_STEPS} langkah.` });
  } catch (e) {
    onEvent({ type: "error", error: e instanceof Error ? e.message : String(e) });
  }
}
