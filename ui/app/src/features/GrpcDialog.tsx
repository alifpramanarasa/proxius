import { useState } from "react";
import {
  grpcAvailable,
  grpcMethods,
  grpcReflectMethods,
  grpcUnary,
  grpcUnaryReflect,
} from "../lib/grpc";
import { useT } from "../store/i18n";
import { Button, Modal } from "./Modal";

const SAMPLE_PROTO = `syntax = "proto3";
package greet;
message HelloRequest { string name = 1; }
message HelloReply { string message = 1; }
service Greeter {
  rpc SayHello(HelloRequest) returns (HelloReply);
}`;

/** Penguji gRPC unary (desktop): paste .proto, pilih method, kirim JSON. */
export function GrpcDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const [endpoint, setEndpoint] = useState("http://localhost:50051");
  const [proto, setProto] = useState(SAMPLE_PROTO);
  const [symbol, setSymbol] = useState("");
  const [reflected, setReflected] = useState(false);
  const [methods, setMethods] = useState<string[]>([]);
  const [method, setMethod] = useState("");
  const [message, setMessage] = useState('{\n  "name": "world"\n}');
  const [response, setResponse] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-xs outline-none focus:border-brand";

  async function loadMethods() {
    setError("");
    try {
      const ms = await grpcMethods(proto);
      setMethods(ms);
      setReflected(false);
      if (ms.length) setMethod(ms[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  async function reflect() {
    setError("");
    setBusy(true);
    try {
      const ms = await grpcReflectMethods(endpoint, symbol.trim());
      setMethods(ms);
      setReflected(true);
      if (ms.length) setMethod(ms[0]);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function invokeCall() {
    setError("");
    setResponse("");
    setBusy(true);
    try {
      const raw = reflected
        ? await grpcUnaryReflect(endpoint, symbol.trim(), method, message)
        : await grpcUnary(endpoint, proto, method, message);
      try {
        setResponse(JSON.stringify(JSON.parse(raw), null, 2));
      } catch {
        setResponse(raw);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open={open} title={t("grpcTitle")} onClose={onClose} wide>
      {!grpcAvailable() ? (
        <p className="p-3 text-sm text-neutral-400">{t("grpcDesktopOnly")}</p>
      ) : (
        <div className="flex max-h-[70vh] flex-col gap-2 overflow-auto">
          <input
            value={endpoint}
            onChange={(e) => setEndpoint(e.target.value)}
            placeholder="http://localhost:50051"
            className={`${field} font-mono`}
          />

          {/* Server reflection: ambil method tanpa paste proto */}
          <div className="flex items-center gap-2">
            <input
              value={symbol}
              onChange={(e) => setSymbol(e.target.value)}
              placeholder={t("grpcSymbolPh")}
              className={`${field} flex-1 font-mono`}
            />
            <Button onClick={reflect} disabled={busy || !symbol.trim()}>
              {t("grpcReflect")}
            </Button>
          </div>

          <div className="text-xs font-medium text-neutral-400">{t("grpcProtoLabel")}</div>
          <textarea
            value={proto}
            onChange={(e) => setProto(e.target.value)}
            spellCheck={false}
            className={`${field} h-32 resize-none font-mono`}
          />

          <div className="flex items-center gap-2">
            <span className="text-xs font-medium text-neutral-400">{t("grpcMethodLabel")}</span>
            <select
              value={method}
              onChange={(e) => setMethod(e.target.value)}
              className="min-w-0 flex-1 rounded border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs outline-none"
            >
              {methods.length === 0 && <option value="">—</option>}
              {methods.map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
            <Button onClick={loadMethods}>{t("grpcLoadMethods")}</Button>
          </div>

          <div className="text-xs font-medium text-neutral-400">{t("grpcRequestLabel")}</div>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            spellCheck={false}
            className={`${field} h-24 resize-none font-mono`}
          />
          <p className="text-[11px] text-neutral-600">{t("grpcStreamHint")}</p>

          <div>
            <Button variant="primary" onClick={invokeCall} disabled={busy || !method}>
              {busy ? "…" : `▶ ${t("grpcInvoke")}`}
            </Button>
          </div>

          {error && (
            <p className="rounded bg-rose-500/10 px-2 py-1.5 text-xs text-rose-400">{error}</p>
          )}
          {response && (
            <>
              <div className="text-xs font-medium text-neutral-400">{t("grpcResponseLabel")}</div>
              <pre className="max-h-48 overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-xs text-emerald-300">
                {response}
              </pre>
            </>
          )}
        </div>
      )}
    </Modal>
  );
}
