import { useEffect } from "react";
import { useMcp } from "../store/mcp";
import { INTEGRATIONS, PRESET_URLS } from "../lib/integrations";
import { oauthSupported } from "../lib/oauth";
import { useT } from "../store/i18n";

/** Section "Integration": tombol connect per penyedia + status.
 * Semuanya lewat OAuth-MCP resmi penyedia — tanpa API token / project key. */
export function IntegrationSettings() {
  const { servers, conns, tokens, addServer, login, connect, removeServer } = useMcp();
  const t = useT();

  // Bersihkan server lama yang bukan preset (sisa endpoint /sse lama dll.).
  useEffect(() => {
    for (const s of useMcp.getState().servers) {
      if (!PRESET_URLS.has(s.url)) useMcp.getState().removeServer(s.id);
    }
  }, []);

  return (
    <div className="space-y-2">
      {INTEGRATIONS.map((p) => {
        const sv = servers.find((s) => s.url === p.url);
        const conn = sv ? conns[sv.id] : undefined;
        const loggedIn = sv ? !!tokens[sv.id] : false;

        let dot = "bg-neutral-600";
        let label = t("notConnected");
        if (conn?.status === "connected") {
          dot = "bg-emerald-400";
          label = t("connectedTools", { count: conn.tools.length });
        } else if (conn?.status === "connecting") {
          dot = "bg-amber-400 animate-pulse";
          label = t("connectingLabel");
        } else if (conn?.status === "error") {
          dot = "bg-rose-400";
          label = conn.error ?? t("errorWord");
        } else if (loggedIn) {
          dot = "bg-emerald-400/70";
          label = t("signedInLabel");
        }

        const action = () => {
          if (!sv) {
            const id = addServer(p.name, p.url, true);
            if (oauthSupported()) login(id);
          } else if (loggedIn) {
            connect(sv.id); // pakai token yang ada, tanpa consent ulang
          } else {
            login(sv.id);
          }
        };

        return (
          <div
            key={p.key}
            className="flex items-center gap-3 rounded-lg border border-neutral-800 p-2.5"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2">
                <span className="text-sm font-medium">{p.name}</span>
                <span className="text-[11px] text-neutral-600">{p.desc}</span>
              </div>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
                <span className="text-[11px] text-neutral-400">{label}</span>
              </div>
            </div>
            <button
              onClick={action}
              disabled={!oauthSupported()}
              title={oauthSupported() ? "" : t("loginDesktopOnly")}
              className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-3 py-1.5 text-xs text-brand-fg hover:bg-brand/20 disabled:opacity-40"
            >
              {sv ? (loggedIn ? t("reconnect") : t("loginWord")) : t("connectVerb")}
            </button>
            {sv && (
              <button
                onClick={() => removeServer(sv.id)}
                title={t("disconnect")}
                className="shrink-0 rounded px-1 text-neutral-500 hover:text-rose-400"
              >
                ×
              </button>
            )}
          </div>
        );
      })}
      <p className="text-[11px] text-neutral-600">{t("integrationHint")}</p>
    </div>
  );
}
