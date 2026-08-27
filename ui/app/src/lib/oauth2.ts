// OAuth 2.0 untuk otorisasi request (grant client_credentials & password).
// Ambil access token dari token endpoint lewat native engine (bebas CORS).

import { sendRequest } from "./api";
import { interpolate } from "./vars";
import { emptyRequest, type OAuth2Config } from "./types";

function form(pairs: [string, string][]): string {
  return pairs
    .filter(([, v]) => v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
}

/** URL otorisasi (authorization_code) untuk dibuka di browser. */
export function buildAuthUrl(cfg: OAuth2Config, vars: Record<string, string>): string {
  const I = (s?: string) => interpolate(s ?? "", vars);
  const p = new URLSearchParams({ response_type: "code", client_id: I(cfg.clientId) });
  if (cfg.redirectUri) p.set("redirect_uri", I(cfg.redirectUri));
  if (cfg.scope) p.set("scope", I(cfg.scope));
  const base = I(cfg.authUrl);
  return base + (base.includes("?") ? "&" : "?") + p.toString();
}

/** Ambil `code` dari URL redirect yang ditempel user. */
export function parseAuthCode(redirected: string): string | null {
  try {
    const u = new URL(redirected.trim());
    return u.searchParams.get("code");
  } catch {
    const m = redirected.match(/[?&]code=([^&\s]+)/);
    return m ? decodeURIComponent(m[1]) : null;
  }
}

/** Tukar authorization code → access token. */
export async function exchangeCode(
  cfg: OAuth2Config,
  code: string,
  vars: Record<string, string>,
): Promise<string> {
  const I = (s?: string) => interpolate(s ?? "", vars);
  const pairs: [string, string][] = [
    ["grant_type", "authorization_code"],
    ["code", code],
    ["redirect_uri", I(cfg.redirectUri)],
    ["client_id", I(cfg.clientId)],
    ["client_secret", I(cfg.clientSecret)],
  ];
  return postToken(I(cfg.tokenUrl), pairs);
}

/** Minta access token; kembalikan tokennya (atau lempar error jelas). */
export async function fetchOAuth2Token(
  cfg: OAuth2Config,
  vars: Record<string, string>,
): Promise<string> {
  const I = (s?: string) => interpolate(s ?? "", vars);
  const pairs: [string, string][] = [["grant_type", cfg.grantType]];
  if (cfg.scope) pairs.push(["scope", I(cfg.scope)]);
  if (cfg.grantType === "password") {
    pairs.push(["username", I(cfg.username)]);
    pairs.push(["password", I(cfg.password)]);
  }
  pairs.push(["client_id", I(cfg.clientId)]);
  pairs.push(["client_secret", I(cfg.clientSecret)]);
  return postToken(I(cfg.tokenUrl), pairs);
}

/** POST ke token endpoint (x-www-form-urlencoded) → access_token. */
async function postToken(tokenUrl: string, pairs: [string, string][]): Promise<string> {
  const req = {
    ...emptyRequest("oauth2-token"),
    method: "POST" as const,
    url: tokenUrl,
    headers: [
      { key: "Content-Type", value: "application/x-www-form-urlencoded", enabled: true },
      { key: "Accept", value: "application/json", enabled: true },
    ],
    query: [],
    body: { kind: "text" as const, content: form(pairs) },
  };

  const resp = await sendRequest(req);
  let data: any = {};
  try {
    data = JSON.parse(resp.body);
  } catch {
    /* biarkan */
  }
  if (resp.status >= 400 || !data.access_token) {
    const msg =
      data.error_description || data.error || resp.statusText || `HTTP ${resp.status}`;
    throw new Error(`Token gagal: ${msg}`);
  }
  return String(data.access_token);
}
