import { useEffect, useRef, useState } from "react";
import { useAgent } from "../store/agent";
import { useT } from "../store/i18n";
import { toast } from "../store/ui";
import type { AgentMessage } from "../lib/agent/types";
import { AiSettings } from "./AiSettings";
import { Button } from "./Modal";

interface Attachment {
  name: string;
  /** File teks → isinya ikut ke pesan. */
  content?: string;
  /** Gambar → dikirim sebagai lampiran multimodal. */
  image?: { data: string; mime: string };
}

function readDataUrl(f: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(f);
  });
}

export function AgentPanel({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { history, busy, error, send, clear, config } = useAgent();
  const t = useT();
  const [input, setInput] = useState("");
  const [showSettings, setShowSettings] = useState(!config.apiKey);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const visible = history.filter((m) => m.role !== "system");

  // Auto-scroll ke pesan terbaru saat chat bertambah / AI mulai berpikir.
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTo({ top: el.scrollHeight, behavior: "smooth" });
  }, [visible.length, busy, open]);

  function submit(e?: { preventDefault: () => void }) {
    e?.preventDefault();
    const parts = [input.trim()];
    for (const a of attachments) {
      if (a.content != null) parts.push(`\n\n[File: ${a.name}]\n\`\`\`\n${a.content}\n\`\`\``);
    }
    const text = parts.filter(Boolean).join("");
    const images = attachments.filter((a) => a.image).map((a) => a.image!);
    if ((!text.trim() && images.length === 0) || busy) return;
    setInput("");
    setAttachments([]);
    send(text, images);
  }

  async function addFiles(files: FileList | null) {
    if (!files) return;
    const added: Attachment[] = [];
    for (const f of Array.from(files).slice(0, 5)) {
      if (f.type && f.type.startsWith("image/")) {
        if (f.size > 5_000_000) {
          toast.error(t("attachTooBig", { name: f.name }));
          continue;
        }
        try {
          const b64 = (await readDataUrl(f)).split(",")[1] ?? "";
          added.push({ name: f.name, image: { data: b64, mime: f.type } });
        } catch {
          toast.error(t("attachFailed", { name: f.name }));
        }
        continue;
      }
      if (f.size > 200_000) {
        toast.error(t("attachTooBig", { name: f.name }));
        continue;
      }
      try {
        added.push({ name: f.name, content: await f.text() });
      } catch {
        toast.error(t("attachFailed", { name: f.name }));
      }
    }
    if (added.length) setAttachments((a) => [...a, ...added]);
  }

  if (!open) return null;

  return (
    <>
      {/* Backdrop tipis — klik untuk menutup. */}
      <div className="fixed inset-0 z-40 bg-black/30" onClick={onClose} />
      {/* Panel dok di kanan. */}
      <aside className="fixed right-0 top-0 z-50 flex h-full w-full max-w-[440px] flex-col border-l border-neutral-800 bg-neutral-900 shadow-2xl">
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold">Proxius Agent</h2>
          <button
            onClick={onClose}
            aria-label={t("close")}
            title={t("close")}
            className="text-neutral-500 hover:text-neutral-200"
          >
            ×
          </button>
        </div>

        <div className="flex min-h-0 flex-1 flex-col p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-neutral-500">
            <span>
              {config.provider} · {config.model}
            </span>
            <div className="flex gap-2">
              <button onClick={() => setShowSettings((s) => !s)} className="hover:text-neutral-200">
                {t("settings")}
              </button>
              <button onClick={clear} className="hover:text-rose-400">
                {t("agentClear")}
              </button>
            </div>
          </div>

          {showSettings && (
            <div className="mb-2 rounded-md border border-neutral-800 p-3">
              <AiSettings />
            </div>
          )}

          <div
            ref={scrollRef}
            className="min-h-0 flex-1 space-y-3 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3"
          >
            {visible.length === 0 && (
              <p className="text-sm text-neutral-600">{t("agentEmptyHint")}</p>
            )}
            {visible.map((m, i) => (
              <MessageView key={i} msg={m} />
            ))}
            {busy && <TypingBubble label={t("agentWorking")} />}
            {error && <div className="text-sm text-rose-400">✕ {error}</div>}
          </div>

          <div className="mt-2 space-y-1.5">
            {attachments.length > 0 && (
              <div className="flex flex-wrap gap-1">
                {attachments.map((a, i) => (
                  <span
                    key={i}
                    className="flex items-center gap-1 rounded bg-neutral-800 px-2 py-0.5 text-[11px] text-neutral-300"
                  >
                    <span className="max-w-[160px] truncate">{a.name}</span>
                    <button
                      type="button"
                      onClick={() => setAttachments((x) => x.filter((_, j) => j !== i))}
                      className="text-neutral-500 hover:text-rose-400"
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <form onSubmit={submit} className="flex items-end gap-2">
              <input
                ref={fileRef}
                type="file"
                multiple
                accept="image/*,.json,.txt,.csv,.md,.yaml,.yml,.xml,.pxs,.har,.proto,.graphql,.gql,.sql,.log,text/*,application/json"
                className="hidden"
                onChange={(e) => {
                  addFiles(e.target.files);
                  e.target.value = "";
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                title={t("attachFile")}
                aria-label={t("attachFile")}
                className="shrink-0 rounded-md border border-neutral-800 px-2.5 py-2 text-sm text-neutral-400 hover:bg-neutral-800"
              >
                ＋
              </button>
              <textarea
                value={input}
                onChange={(e) => {
                  setInput(e.target.value);
                  e.target.style.height = "auto";
                  e.target.style.height = `${Math.min(e.target.scrollHeight, 160)}px`;
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    submit();
                  }
                }}
                placeholder={t("agentInputPlaceholder")}
                disabled={busy}
                rows={1}
                className="max-h-40 min-h-[38px] flex-1 resize-none rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-brand disabled:opacity-50"
              />
              <Button
                type="submit"
                variant="primary"
                disabled={busy || (!input.trim() && attachments.length === 0)}
              >
                {t("send")}
              </Button>
            </form>
          </div>
        </div>
      </aside>
    </>
  );
}

function Avatar({ who }: { who: "user" | "assistant" }) {
  const cls = who === "user" ? "bg-brand text-white" : "bg-neutral-700 text-neutral-200";
  return (
    <div
      className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${cls}`}
    >
      {who === "user" ? "U" : "AI"}
    </div>
  );
}

/** Indikator "sedang mengetik" — tiga titik memantul di gelembung asisten. */
function TypingBubble({ label }: { label: string }) {
  return (
    <div className="flex items-start justify-start gap-2" aria-label={label} title={label}>
      <Avatar who="assistant" />
      <div className="flex items-center gap-1 rounded-2xl rounded-bl-sm bg-neutral-800 px-3 py-3">
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.3s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400 [animation-delay:-0.15s]" />
        <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-neutral-400" />
      </div>
    </div>
  );
}

function MessageView({ msg }: { msg: AgentMessage }) {
  // Gelembung chat: user di kanan (brand) + avatar "U", asisten di kiri
  // (netral) + avatar "AI"; tool call/result sebagai chip abu-abu.
  if (msg.role === "user")
    return (
      <div className="flex items-start justify-end gap-2">
        <div className="max-w-[80%] space-y-1.5 rounded-2xl rounded-br-sm bg-brand px-3 py-2 text-sm text-white">
          {msg.images && msg.images.length > 0 && (
            <div className="flex flex-wrap gap-1.5">
              {msg.images.map((im, k) => (
                <img
                  key={k}
                  src={`data:${im.mime};base64,${im.data}`}
                  alt="attachment"
                  className="max-h-32 rounded-md border border-white/20"
                />
              ))}
            </div>
          )}
          {msg.content && <div className="whitespace-pre-wrap break-words">{msg.content}</div>}
        </div>
        <Avatar who="user" />
      </div>
    );
  if (msg.role === "assistant")
    return (
      <div className="space-y-1">
        {msg.content && (
          <div className="flex items-start justify-start gap-2">
            <Avatar who="assistant" />
            <div className="max-w-[80%] whitespace-pre-wrap break-words rounded-2xl rounded-bl-sm bg-neutral-800 px-3 py-2 text-sm text-neutral-100">
              {msg.content}
            </div>
          </div>
        )}
        {msg.toolCalls.map((c) => (
          <div
            key={c.id}
            className="ml-8 break-all rounded-md bg-neutral-900 px-2 py-1 font-mono text-[11px] text-sky-400"
          >
            → {c.name}({JSON.stringify(c.args).slice(0, 100)})
          </div>
        ))}
      </div>
    );
  if (msg.role === "tool")
    return (
      <div className="ml-8 break-all rounded-md bg-neutral-900/60 px-2 py-1 font-mono text-[11px] text-neutral-500">
        {msg.toolName}: {msg.content.slice(0, 160)}
      </div>
    );
  return null;
}
