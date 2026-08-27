import { useState } from "react";
import { useMcp } from "../store/mcp";
import { oauthSupported } from "../lib/oauth";
import { PRESET_URLS } from "../lib/integrations";
import { useT } from "../store/i18n";

/** Server MCP custom (di luar integrasi resmi) untuk agent internal Proxius. */
export function McpClientSettings() {
  const { servers, conns, tokens, addServer, updateServer, removeServer, connect, login } =
    useMcp();
  const t = useT();
  const [name, setName] = useState("");
  const [url, setUrl] = useState("");
  // Sembunyikan server preset (Atlassian/Linear) — sudah dikelola di Integration.
  const custom = servers.filter((s) => !PRESET_URLS.has(s.url));
  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-brand";

  function add(oauth?: boolean) {
    if (!name.trim() || !url.trim()) return;
    const id = addServer(name.trim(), url.trim(), oauth);
    setName("");
    setUrl("");
    if (!oauth) connect(id);
  }

  const dot: Record<string, string> = {
    idle: "bg-neutral-600",
    connecting: "bg-amber-400 animate-pulse",
    connected: "bg-emerald-400",
    error: "bg-rose-400",
  };

  return (
    <div className="space-y-2">
      {custom.length === 0 && (
        <p className="text-[11px] text-neutral-600">{t("mcpCustomIntro")}</p>
      )}

      {custom.map((sv) => {
        const c = conns[sv.id];
        const loggedIn = !!tokens[sv.id];
        return (
          <div key={sv.id} className="rounded-md border border-neutral-800 p-2">
            <div className="flex items-center gap-2">
              <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot[c?.status ?? "idle"]}`} />
              <input
                value={sv.name}
                onChange={(e) => updateServer(sv.id, { name: e.target.value })}
                className="w-24 shrink-0 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-1 text-xs outline-none focus:border-brand"
              />
              <input
                value={sv.url}
                onChange={(e) => updateServer(sv.id, { url: e.target.value })}
                placeholder="http://localhost:3000/mcp"
                className="flex-1 rounded border border-neutral-800 bg-neutral-950 px-1.5 py-1 font-mono text-xs outline-none focus:border-brand"
              />
              {sv.oauth ? (
                <button
                  onClick={() => login(sv.id)}
                  disabled={!oauthSupported()}
                  title={oauthSupported() ? t("oauthLoginTitle") : t("desktopOnlyTitle")}
                  className="shrink-0 rounded border border-brand/40 bg-brand/10 px-2 py-1 text-xs text-brand-fg hover:bg-brand/20 disabled:opacity-40"
                >
                  {loggedIn ? t("reLogin") : t("loginWord")}
                </button>
              ) : (
                <button
                  onClick={() => connect(sv.id)}
                  className="shrink-0 rounded border border-neutral-700 px-2 py-1 text-xs hover:bg-neutral-800"
                >
                  {c?.status === "connecting" ? "…" : t("connectWord")}
                </button>
              )}
              <label className="flex shrink-0 items-center gap-1 text-[11px] text-neutral-500">
                <input
                  type="checkbox"
                  checked={!!sv.oauth}
                  onChange={(e) => updateServer(sv.id, { oauth: e.target.checked })}
                />
                OAuth
              </label>
              <button
                onClick={() => removeServer(sv.id)}
                className="shrink-0 rounded px-1 text-xs text-neutral-500 hover:text-rose-400"
                title={t("delete")}
              >
                ×
              </button>
            </div>
            <div className="mt-1 pl-3.5 text-[11px]">
              {sv.oauth && !loggedIn && <span className="text-neutral-500">{t("notLoggedIn")}</span>}
              {sv.oauth && loggedIn && <span className="text-emerald-400/80">{t("loggedInWord")}</span>}
              {c?.status === "connected" && (
                <span className="text-emerald-400">
                  {c.tools.length} tool{c.serverName ? ` · ${c.serverName}` : ""}
                  {c.tools.length > 0 && (
                    <span className="text-neutral-500">
                      {" "}
                      ({c.tools.slice(0, 6).map((t) => t.name).join(", ")}
                      {c.tools.length > 6 ? "…" : ""})
                    </span>
                  )}
                </span>
              )}
              {c?.status === "error" && <span className="text-rose-400">✕ {c.error}</span>}
            </div>
          </div>
        );
      })}

      <div className="flex gap-2">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t("mcpNamePh")}
          className={`${field} w-24 shrink-0`}
        />
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="http://localhost:3000/mcp"
          onKeyDown={(e) => e.key === "Enter" && add()}
          className={`${field} flex-1 font-mono`}
        />
        <button
          onClick={() => add()}
          disabled={!name.trim() || !url.trim()}
          className="shrink-0 rounded-md border border-neutral-700 px-2 text-sm hover:bg-neutral-800 disabled:opacity-40"
          title={t("addHttpTitle")}
        >
          ＋
        </button>
        <button
          onClick={() => add(true)}
          disabled={!name.trim() || !url.trim()}
          className="shrink-0 rounded-md border border-brand/40 bg-brand/10 px-2 text-xs text-brand-fg hover:bg-brand/20 disabled:opacity-40"
          title={t("addOAuthTitle")}
        >
          ＋OAuth
        </button>
      </div>
    </div>
  );
}
