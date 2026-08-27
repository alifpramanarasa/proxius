import { useState } from "react";
import type { Auth, AuthType, OAuth2Config } from "../lib/types";
import { fetchOAuth2Token, buildAuthUrl, parseAuthCode, exchangeCode } from "../lib/oauth2";
import { promptDialog, toast } from "../store/ui";
import { useT } from "../store/i18n";
import { VarInput } from "./VarInput";

const TYPES: { v: AuthType; label: string }[] = [
  { v: "inherit", label: "Inherit auth from parent" },
  { v: "none", label: "No Auth" },
  { v: "basic", label: "Basic Auth" },
  { v: "bearer", label: "Bearer Token" },
  { v: "jwt", label: "JWT Bearer" },
  { v: "oauth1", label: "OAuth 1.0" },
  { v: "oauth2", label: "OAuth 2.0" },
  { v: "aws", label: "AWS Signature" },
  { v: "apikey", label: "API Key" },
];

const DESC_KEY: Partial<Record<AuthType, string>> = {
  inherit: "authDescInherit",
  none: "authDescNone",
  basic: "authDescBasic",
  bearer: "authDescBearer",
  apikey: "authDescApikey",
  oauth2: "authDescOauth2",
  jwt: "authDescJwt",
  aws: "authDescAws",
  oauth1: "authDescOauth1",
};

export function AuthPanel({
  auth,
  onChange,
  vars,
}: {
  auth?: Auth;
  onChange: (a: Auth) => void;
  vars: Record<string, string>;
}) {
  const a = auth ?? { type: "none" as AuthType };
  const set = (patch: Partial<Auth>) => onChange({ ...a, ...patch });
  const [busy, setBusy] = useState(false);
  const t = useT();

  const o: OAuth2Config = a.oauth2 ?? {
    grantType: "client_credentials",
    tokenUrl: "",
    clientId: "",
    clientSecret: "",
  };
  const setO = (patch: Partial<OAuth2Config>) => set({ oauth2: { ...o, ...patch } });

  const jwt = a.jwt ?? { algorithm: "HS256" as const, secret: "", payload: '{\n  "sub": "1234567890"\n}' };
  const setJ = (patch: Partial<NonNullable<Auth["jwt"]>>) => set({ jwt: { ...jwt, ...patch } });
  const aws = a.aws ?? { accessKey: "", secretKey: "", region: "us-east-1", service: "" };
  const setA = (patch: Partial<NonNullable<Auth["aws"]>>) => set({ aws: { ...aws, ...patch } });
  const o1 = a.oauth1 ?? { consumerKey: "", consumerSecret: "" };
  const setO1 = (patch: Partial<NonNullable<Auth["oauth1"]>>) => set({ oauth1: { ...o1, ...patch } });

  async function getToken() {
    if (!o.tokenUrl.trim() || !o.clientId.trim()) {
      toast.error(t("fillTokenUrlClientId"));
      return;
    }
    // Authorization Code: buka URL otorisasi, minta user tempel URL redirect.
    if (o.grantType === "authorization_code") {
      if (!o.authUrl?.trim()) {
        toast.error(t("fillAuthUrl"));
        return;
      }
      try {
        window.open(buildAuthUrl(o, vars), "_blank", "noopener");
      } catch {
        /* pop-up mungkin diblok — user bisa buka manual */
      }
      const redirected = await promptDialog({
        title: t("oauthPasteRedirect"),
        placeholder: "https://app/callback?code=…",
      });
      if (!redirected) return;
      const code = parseAuthCode(redirected);
      if (!code) {
        toast.error(t("oauthNoCode"));
        return;
      }
      setBusy(true);
      try {
        setO({ accessToken: await exchangeCode(o, code, vars) });
        toast.success(t("accessTokenObtained"));
      } catch (e) {
        toast.error(e instanceof Error ? e.message : String(e));
      } finally {
        setBusy(false);
      }
      return;
    }
    setBusy(true);
    try {
      const token = await fetchOAuth2Token(o, vars);
      setO({ accessToken: token });
      toast.success(t("accessTokenObtained"));
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  const label = "block text-xs text-neutral-500";
  const plain =
    "w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 font-mono text-sm outline-none focus:border-brand";

  return (
    <div className="flex gap-6">
      {/* Kolom kiri: tipe + penjelasan */}
      <div className="w-56 shrink-0 space-y-2 border-r border-neutral-800 pr-4">
        <div>
          <span className="mb-1 block text-xs font-medium text-neutral-400">Auth Type</span>
          <select
            value={a.type}
            onChange={(e) => set({ type: e.target.value as AuthType })}
            className="w-full rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1.5 text-sm outline-none focus:border-brand"
          >
            {TYPES.map((t) => (
              <option key={t.v} value={t.v}>
                {t.label}
              </option>
            ))}
          </select>
        </div>
        <p className="text-[11px] leading-relaxed text-neutral-500">
          {DESC_KEY[a.type] ? t(DESC_KEY[a.type]!) : t("authDescFallback")}
        </p>
      </div>

      {/* Kolom kanan: field per tipe */}
      <div className="min-w-0 flex-1 space-y-3">
        {a.type === "bearer" && (
          <label className={label}>
            Token
            <VarInput
              className="mt-1"
              value={a.token ?? ""}
              onChange={(token) => set({ token })}
              vars={vars}
              placeholder="{{token}}"
            />
          </label>
        )}

        {a.type === "basic" && (
          <div className="max-w-lg space-y-2">
            <label className={label}>
              Username
              <input
                value={a.username ?? ""}
                onChange={(e) => set({ username: e.target.value })}
                className={`${plain} mt-1`}
              />
            </label>
            <label className={label}>
              Password
              <input
                type="password"
                value={a.password ?? ""}
                onChange={(e) => set({ password: e.target.value })}
                className={`${plain} mt-1`}
              />
            </label>
          </div>
        )}

        {a.type === "apikey" && (
          <div className="max-w-lg space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Key
                <input
                  value={a.key ?? ""}
                  onChange={(e) => set({ key: e.target.value })}
                  placeholder="X-API-Key"
                  className={`${plain} mt-1`}
                />
              </label>
              <label className={label}>
                Value
                <VarInput
                  className="mt-1"
                  value={a.value ?? ""}
                  onChange={(value) => set({ value })}
                  vars={vars}
                  placeholder="{{apiKey}}"
                />
              </label>
            </div>
            <label className={label}>
              Add to
              <select
                value={a.addTo ?? "header"}
                onChange={(e) => set({ addTo: e.target.value as "header" | "query" })}
                className="ml-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm outline-none"
              >
                <option value="header">Header</option>
                <option value="query">Query param</option>
              </select>
            </label>
          </div>
        )}

        {a.type === "oauth2" && (
          <div className="max-w-lg space-y-2">
            {o.accessToken && (
              <div className="rounded-md border border-emerald-500/30 bg-emerald-500/5 px-2 py-1.5 text-xs">
                <span className="text-emerald-400">Access token aktif</span>
                <span className="ml-2 font-mono text-neutral-500">
                  {o.accessToken.slice(0, 12)}…{o.accessToken.slice(-6)}
                </span>
              </div>
            )}
            <label className={label}>
              Grant type
              <select
                value={o.grantType}
                onChange={(e) => setO({ grantType: e.target.value as OAuth2Config["grantType"] })}
                className="ml-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm outline-none"
              >
                <option value="client_credentials">Client Credentials</option>
                <option value="password">Password</option>
                <option value="authorization_code">Authorization Code</option>
              </select>
            </label>
            {o.grantType === "authorization_code" && (
              <>
                <label className={label}>
                  Auth URL
                  <VarInput
                    className="mt-1"
                    value={o.authUrl ?? ""}
                    onChange={(authUrl) => setO({ authUrl })}
                    vars={vars}
                    placeholder="https://auth.example.com/oauth/authorize"
                  />
                </label>
                <label className={label}>
                  Redirect URI
                  <VarInput
                    className="mt-1"
                    value={o.redirectUri ?? ""}
                    onChange={(redirectUri) => setO({ redirectUri })}
                    vars={vars}
                    placeholder="https://app.example.com/callback"
                  />
                </label>
              </>
            )}
            <label className={label}>
              Access Token URL
              <VarInput
                className="mt-1"
                value={o.tokenUrl}
                onChange={(tokenUrl) => setO({ tokenUrl })}
                vars={vars}
                placeholder="https://auth.example.com/oauth/token"
              />
            </label>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Client ID
                <input
                  value={o.clientId}
                  onChange={(e) => setO({ clientId: e.target.value })}
                  className={`${plain} mt-1`}
                />
              </label>
              <label className={label}>
                Client Secret
                <input
                  type="password"
                  value={o.clientSecret}
                  onChange={(e) => setO({ clientSecret: e.target.value })}
                  className={`${plain} mt-1`}
                />
              </label>
            </div>
            {o.grantType === "password" && (
              <div className="grid grid-cols-2 gap-2">
                <label className={label}>
                  Username
                  <input
                    value={o.username ?? ""}
                    onChange={(e) => setO({ username: e.target.value })}
                    className={`${plain} mt-1`}
                  />
                </label>
                <label className={label}>
                  Password
                  <input
                    type="password"
                    value={o.password ?? ""}
                    onChange={(e) => setO({ password: e.target.value })}
                    className={`${plain} mt-1`}
                  />
                </label>
              </div>
            )}
            <label className={label}>
              Scope (opsional)
              <input
                value={o.scope ?? ""}
                onChange={(e) => setO({ scope: e.target.value })}
                placeholder="read write"
                className={`${plain} mt-1`}
              />
            </label>
            <button
              onClick={getToken}
              disabled={busy}
              className="rounded-md bg-brand px-3 py-1.5 text-xs font-semibold text-white hover:opacity-90 disabled:opacity-50"
            >
              {busy ? "Meminta…" : "Get New Access Token"}
            </button>
          </div>
        )}

        {a.type === "jwt" && (
          <div className="max-w-lg space-y-2">
            <label className={label}>
              Algorithm
              <select
                value={jwt.algorithm}
                onChange={(e) => setJ({ algorithm: e.target.value as typeof jwt.algorithm })}
                className="ml-2 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm outline-none"
              >
                <option value="HS256">HS256</option>
                <option value="HS384">HS384</option>
                <option value="HS512">HS512</option>
              </select>
            </label>
            <label className={label}>
              Secret
              <VarInput
                className="mt-1"
                value={jwt.secret}
                onChange={(secret) => setJ({ secret })}
                vars={vars}
                placeholder="{{jwtSecret}}"
              />
            </label>
            <label className={label}>
              Payload (JSON)
              <textarea
                value={jwt.payload}
                onChange={(e) => setJ({ payload: e.target.value })}
                spellCheck={false}
                className={`${plain} mt-1 h-28 resize-none`}
              />
            </label>
          </div>
        )}

        {a.type === "aws" && (
          <div className="max-w-lg space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Access Key
                <input value={aws.accessKey} onChange={(e) => setA({ accessKey: e.target.value })} className={`${plain} mt-1`} />
              </label>
              <label className={label}>
                Secret Key
                <input type="password" value={aws.secretKey} onChange={(e) => setA({ secretKey: e.target.value })} className={`${plain} mt-1`} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Region
                <input value={aws.region} onChange={(e) => setA({ region: e.target.value })} placeholder="us-east-1" className={`${plain} mt-1`} />
              </label>
              <label className={label}>
                Service
                <input value={aws.service} onChange={(e) => setA({ service: e.target.value })} placeholder="execute-api" className={`${plain} mt-1`} />
              </label>
            </div>
            <label className={label}>
              Session Token (opsional)
              <input value={aws.sessionToken ?? ""} onChange={(e) => setA({ sessionToken: e.target.value })} className={`${plain} mt-1`} />
            </label>
          </div>
        )}

        {a.type === "oauth1" && (
          <div className="max-w-lg space-y-2">
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Consumer Key
                <input value={o1.consumerKey} onChange={(e) => setO1({ consumerKey: e.target.value })} className={`${plain} mt-1`} />
              </label>
              <label className={label}>
                Consumer Secret
                <input type="password" value={o1.consumerSecret} onChange={(e) => setO1({ consumerSecret: e.target.value })} className={`${plain} mt-1`} />
              </label>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <label className={label}>
                Access Token
                <input value={o1.token ?? ""} onChange={(e) => setO1({ token: e.target.value })} className={`${plain} mt-1`} />
              </label>
              <label className={label}>
                Token Secret
                <input type="password" value={o1.tokenSecret ?? ""} onChange={(e) => setO1({ tokenSecret: e.target.value })} className={`${plain} mt-1`} />
              </label>
            </div>
          </div>
        )}

        {a.type === "none" && (
          <div className="flex h-full items-center justify-center py-10 text-sm text-neutral-600">
            This request does not use any authorization.
          </div>
        )}

        {a.type === "inherit" && (
          <div className="flex h-full items-center justify-center py-10 text-center text-sm text-neutral-600">
            Otorisasi diwariskan dari folder/collection induk.
          </div>
        )}
      </div>
    </div>
  );
}
