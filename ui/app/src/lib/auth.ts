// Terapkan Authorization ke request (async — beberapa tipe butuh tanda tangan
// crypto). Dipanggil SETELAH resolveRequest, jadi nilai auth di-interpolasi di
// sini dan tanda tangan dihitung atas request final.

import { interpolate } from "./vars";
import { signAws, signJwt, signOAuth1 } from "./authsign";
import type { HttpRequest, KeyValue } from "./types";

function setHeader(headers: KeyValue[], key: string, value: string): KeyValue[] {
  const out = headers.filter((h) => h.key.toLowerCase() !== key.toLowerCase());
  out.push({ key, value, enabled: true });
  return out;
}

function mergeHeaders(headers: KeyValue[], add: KeyValue[]): KeyValue[] {
  let out = headers;
  for (const h of add) out = setHeader(out, h.key, h.value);
  return out;
}

function b64(s: string): string {
  if (typeof btoa === "function") return btoa(s);
  const g = globalThis as unknown as { Buffer?: { from(x: string): { toString(e: string): string } } };
  return g.Buffer ? g.Buffer.from(s).toString("base64") : "";
}

/** Kembalikan salinan request dengan auth diterapkan. */
export async function applyAuth(
  req: HttpRequest,
  vars: Record<string, string>,
): Promise<HttpRequest> {
  const a = req.auth;
  if (!a || a.type === "none" || a.type === "inherit") return req;
  const I = (s?: string) => interpolate(s ?? "", vars);
  const setH = (key: string, value: string): HttpRequest => ({
    ...req,
    headers: setHeader(req.headers, key, value),
  });

  switch (a.type) {
    case "basic":
      return setH("Authorization", `Basic ${b64(`${I(a.username)}:${I(a.password)}`)}`);

    case "bearer":
      return setH("Authorization", `Bearer ${I(a.token)}`);

    case "apikey": {
      const key = a.key ?? "";
      const value = I(a.value);
      if (!key) return req;
      if (a.addTo === "query") {
        return { ...req, query: [...req.query.filter((q) => q.key !== key), { key, value, enabled: true }] };
      }
      return setH(key, value);
    }

    case "oauth2": {
      const tok = a.oauth2?.accessToken;
      return tok ? setH("Authorization", `Bearer ${tok}`) : req;
    }

    case "jwt":
      return a.jwt ? setH("Authorization", `Bearer ${await signJwt(a.jwt, vars)}`) : req;

    case "aws":
      return a.aws
        ? { ...req, headers: mergeHeaders(req.headers, await signAws(a.aws, req, vars, new Date())) }
        : req;

    case "oauth1":
      return a.oauth1 ? setH("Authorization", await signOAuth1(a.oauth1, req, vars)) : req;

    default:
      // digest / ntlm / hawk / akamai / asap — belum didukung.
      return req;
  }
}
