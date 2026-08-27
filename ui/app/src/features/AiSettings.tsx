import { useAgent } from "../store/agent";

// Pilihan model per provider — biar tak perlu hafal/ketik ID manual.
// "Custom…" tetap ada untuk model spesifik.
const MODELS = {
  anthropic: [
    { id: "claude-opus-5", label: "Claude Opus 5" },
    { id: "claude-sonnet-5", label: "Claude Sonnet 5" },
    { id: "claude-haiku-4-5", label: "Claude Haiku 4.5" },
    { id: "claude-fable-5", label: "Claude Fable 5" },
    { id: "claude-opus-4-8", label: "Claude Opus 4.8" },
    { id: "claude-opus-4-7", label: "Claude Opus 4.7" },
    { id: "claude-opus-4-6", label: "Claude Opus 4.6" },
    { id: "claude-sonnet-4-6", label: "Claude Sonnet 4.6" },
  ],
  openai: [
    { id: "gpt-4o", label: "GPT-4o" },
    { id: "gpt-4o-mini", label: "GPT-4o mini" },
    { id: "gpt-4.1", label: "GPT-4.1" },
    { id: "gpt-4.1-mini", label: "GPT-4.1 mini" },
    { id: "o3", label: "o3" },
    { id: "o4-mini", label: "o4-mini" },
  ],
  ollama: [
    { id: "llama3.3", label: "Llama 3.3" },
    { id: "llama3.2", label: "Llama 3.2" },
    { id: "llama3.1", label: "Llama 3.1" },
    { id: "qwen2.5", label: "Qwen 2.5" },
    { id: "qwen2.5-coder", label: "Qwen 2.5 Coder" },
    { id: "deepseek-r1", label: "DeepSeek-R1" },
    { id: "mistral", label: "Mistral" },
    { id: "gemma2", label: "Gemma 2" },
  ],
} as const;

/** Pengaturan AI (bring-your-own-agent). Multi-provider: key tiap provider
 * disimpan terpisah, jadi ganti provider tak menghapus key sebelumnya. */
export function AiSettings() {
  const { config, setConfig } = useAgent();
  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-brand";

  const models = MODELS[config.provider];
  const isCustom = !models.some((m) => m.id === config.model);

  return (
    <div className="space-y-2">
      <div className="grid grid-cols-2 gap-2">
        <label className="text-xs text-neutral-500">
          Provider
          <select
            value={config.provider}
            onChange={(e) => setConfig({ provider: e.target.value as typeof config.provider })}
            className={field}
          >
            <option value="anthropic">Anthropic (Claude)</option>
            <option value="openai">OpenAI</option>
            <option value="ollama">Ollama (lokal, gratis)</option>
          </select>
        </label>
        <label className="text-xs text-neutral-500">
          Model
          <select
            value={isCustom ? "__custom" : config.model}
            onChange={(e) =>
              setConfig({ model: e.target.value === "__custom" ? "" : e.target.value })
            }
            className={field}
          >
            {models.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
            <option value="__custom">Custom…</option>
          </select>
        </label>
      </div>

      {isCustom && (
        <label className="block text-xs text-neutral-500">
          Custom model ID
          <input
            value={config.model}
            onChange={(e) => setConfig({ model: e.target.value })}
            placeholder="mis. gpt-4.1-mini"
            className={`${field} font-mono`}
          />
        </label>
      )}

      {config.provider !== "ollama" && (
        <label className="block text-xs text-neutral-500">
          API Key
          <input
            type="password"
            value={config.apiKey}
            onChange={(e) => setConfig({ apiKey: e.target.value })}
            placeholder={config.provider === "anthropic" ? "sk-ant-…" : "sk-…"}
            className={`${field} font-mono`}
          />
        </label>
      )}
      <label className="block text-xs text-neutral-500">
        Base URL (optional)
        <input
          value={config.baseUrl ?? ""}
          onChange={(e) => setConfig({ baseUrl: e.target.value })}
          placeholder={config.provider === "ollama" ? "http://localhost:11434" : ""}
          className={`${field} font-mono`}
        />
      </label>
    </div>
  );
}
