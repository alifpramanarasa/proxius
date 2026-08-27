import { useEffect, useRef, useState } from "react";
import { useT } from "../store/i18n";
import { Button, Modal } from "./Modal";

type Dir = "sent" | "recv" | "sys";
interface Msg {
  id: number;
  dir: Dir;
  text: string;
}

/** Penguji realtime: WebSocket (dua arah) & SSE (EventSource, satu arah). */
export function RealtimeDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [mode, setMode] = useState<"ws" | "sse">("ws");
  const [url, setUrl] = useState("wss://echo.websocket.events");
  const [input, setInput] = useState("");
  const [status, setStatus] = useState<"closed" | "connecting" | "open">("closed");
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const sockRef = useRef<WebSocket | EventSource | null>(null);
  const idRef = useRef(0);

  const push = (dir: Dir, text: string) =>
    setMsgs((m) => [...m, { id: idRef.current++, dir, text }]);

  function disconnect() {
    sockRef.current?.close();
    sockRef.current = null;
    setStatus("closed");
  }

  // Tutup koneksi saat dialog ditutup / komponen dilepas.
  useEffect(() => {
    if (!open) disconnect();
  }, [open]);
  useEffect(() => () => disconnect(), []);

  function connect() {
    disconnect();
    setMsgs([]);
    setStatus("connecting");
    try {
      if (mode === "ws") {
        const ws = new WebSocket(url);
        ws.onopen = () => {
          setStatus("open");
          push("sys", `● ${t("wsConnected")}`);
        };
        ws.onmessage = (e) => push("recv", typeof e.data === "string" ? e.data : "[binary]");
        ws.onerror = () => push("sys", "✕ error");
        ws.onclose = () => {
          setStatus("closed");
          push("sys", `○ ${t("wsClosed")}`);
        };
        sockRef.current = ws;
      } else {
        const es = new EventSource(url);
        es.onopen = () => {
          setStatus("open");
          push("sys", `● ${t("wsConnected")}`);
        };
        es.onmessage = (e) => push("recv", e.data);
        es.onerror = () => push("sys", "✕ error");
        sockRef.current = es;
      }
    } catch (e) {
      setStatus("closed");
      push("sys", "✕ " + (e instanceof Error ? e.message : String(e)));
    }
  }

  function send() {
    const s = sockRef.current;
    if (s instanceof WebSocket && s.readyState === WebSocket.OPEN && input) {
      s.send(input);
      push("sent", input);
      setInput("");
    }
  }

  return (
    <Modal open={open} title={t("realtimeTitle")} onClose={onClose} wide>
      <div className="flex h-[60vh] flex-col gap-2">
        <div className="flex gap-2">
          <div className="flex overflow-hidden rounded-md border border-neutral-800 text-xs">
            {(["ws", "sse"] as const).map((m) => (
              <button
                key={m}
                onClick={() => {
                  setMode(m);
                  disconnect();
                }}
                className={`px-2.5 py-1 ${
                  mode === m ? "bg-brand text-white" : "text-neutral-400 hover:bg-neutral-800"
                }`}
              >
                {m === "ws" ? "WebSocket" : "SSE"}
              </button>
            ))}
          </div>
          <input
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            placeholder={mode === "ws" ? "wss://…" : "https://…/events"}
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand"
          />
          {status === "closed" ? (
            <Button variant="primary" onClick={connect} disabled={!url.trim()}>
              {t("connectVerb")}
            </Button>
          ) : (
            <Button variant="danger" onClick={disconnect}>
              {t("disconnect")}
            </Button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs">
          {msgs.length === 0 ? (
            <p className="p-2 text-neutral-600">{t("wsNoMessages")}</p>
          ) : (
            msgs.map((m) => (
              <div
                key={m.id}
                className={
                  m.dir === "sent"
                    ? "text-sky-300"
                    : m.dir === "recv"
                      ? "text-emerald-300"
                      : "text-neutral-500"
                }
              >
                <span className="select-none text-neutral-600">
                  {m.dir === "sent" ? "↑ " : m.dir === "recv" ? "↓ " : "  "}
                </span>
                {m.text}
              </div>
            ))
          )}
        </div>

        {mode === "ws" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              send();
            }}
            className="flex gap-2"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t("wsMessagePlaceholder")}
              disabled={status !== "open"}
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm outline-none focus:border-brand disabled:opacity-50"
            />
            <Button type="submit" variant="primary" disabled={status !== "open" || !input.trim()}>
              {t("send")}
            </Button>
          </form>
        )}
      </div>
    </Modal>
  );
}
