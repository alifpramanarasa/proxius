// Perhitungan tanda tangan auth (crypto murni via Web Crypto). Semua async.
// Diverifikasi terhadap test vector resmi (lihat scratchpad tests).

import { interpolate } from "./vars";
import { bodyRawText } from "./body";
import type { Auth, HttpRequest, KeyValue } from "./types";

const enc = new TextEncoder();

type Hash = "SHA-1" | "SHA-256" | "SHA-384" | "SHA-512";

async function hmac(hash: Hash, key: Uint8Array, data: Uint8Array): Promise<Uint8Array> {
  const k = await crypto.subtle.importKey("raw", key as BufferSource, { name: "HMAC", hash }, false, [
    "sign",
  ]);
  return new Uint8Array(await crypto.subtle.sign("HMAC", k, data as BufferSource));
}
async function sha256(data: Uint8Array): Promise<Uint8Array> {
  return new Uint8Array(await crypto.subtle.digest("SHA-256", data as BufferSource));
}
function hex(b: Uint8Array): string {
  return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}
function b64(b: Uint8Array): string {
  let s = "";
  for (const x of b) s += String.fromCharCode(x);
  return btoa(s);
}
function b64url(b: Uint8Array): string {
  return b64(b).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
/** Percent-encode RFC 3986 (untuk OAuth1). */
function pct(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase());
}

const bodyContent = (req: HttpRequest): string => bodyRawText(req.body);

// ── JWT Bearer (HS256/384/512) ──────────────────────────────────────

export async function signJwt(cfg: NonNullable<Auth["jwt"]>, vars: Record<string, string>): Promise<string> {
  const hash: Hash = cfg.algorithm === "HS384" ? "SHA-384" : cfg.algorithm === "HS512" ? "SHA-512" : "SHA-256";
  const header = b64url(enc.encode(JSON.stringify({ alg: cfg.algorithm, typ: "JWT" })));
  let payloadObj: unknown = {};
  try {
    payloadObj = JSON.parse(interpolate(cfg.payload || "{}", vars));
  } catch {
    payloadObj = {};
  }
  const payload = b64url(enc.encode(JSON.stringify(payloadObj)));
  const signingInput = `${header}.${payload}`;
  const sig = await hmac(hash, enc.encode(interpolate(cfg.secret, vars)), enc.encode(signingInput));
  return `${signingInput}.${b64url(sig)}`;
}

// ── AWS Signature v4 ────────────────────────────────────────────────

function awsUriEncode(s: string, encodeSlash: boolean): string {
  let out = "";
  for (const byte of enc.encode(s)) {
    const ch = String.fromCharCode(byte);
    if (/[A-Za-z0-9\-._~]/.test(ch)) out += ch;
    else if (ch === "/" && !encodeSlash) out += "/";
    else out += "%" + byte.toString(16).toUpperCase().padStart(2, "0");
  }
  return out;
}

function amzDate(d: Date): { amz: string; stamp: string } {
  const iso = d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
  return { amz: iso, stamp: iso.slice(0, 8) };
}

export async function signAws(
  cfg: NonNullable<Auth["aws"]>,
  req: HttpRequest,
  vars: Record<string, string>,
  now: Date,
): Promise<KeyValue[]> {
  const I = (s?: string) => interpolate(s ?? "", vars);
  const url = new URL(req.url);
  const { amz, stamp } = amzDate(now);
  const region = I(cfg.region) || "us-east-1";
  const service = I(cfg.service);
  const sessionToken = I(cfg.sessionToken);

  const headers: Record<string, string> = {
    host: url.host,
    "x-amz-date": amz,
  };
  if (sessionToken) headers["x-amz-security-token"] = sessionToken;

  const payloadHash = hex(await sha256(enc.encode(bodyContent(req))));

  const sortedNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedNames.map((n) => `${n}:${headers[n].trim()}\n`).join("");
  const signedHeaders = sortedNames.join(";");

  const qp = [...url.searchParams.entries()]
    .map(([k, v]) => [awsUriEncode(k, true), awsUriEncode(v, true)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [
    req.method,
    awsUriEncode(url.pathname || "/", false),
    qp,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const scope = `${stamp}/${region}/${service}/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amz,
    scope,
    hex(await sha256(enc.encode(canonicalRequest))),
  ].join("\n");

  const kDate = await hmac("SHA-256", enc.encode("AWS4" + I(cfg.secretKey)), enc.encode(stamp));
  const kRegion = await hmac("SHA-256", kDate, enc.encode(region));
  const kService = await hmac("SHA-256", kRegion, enc.encode(service));
  const kSigning = await hmac("SHA-256", kService, enc.encode("aws4_request"));
  const signature = hex(await hmac("SHA-256", kSigning, enc.encode(stringToSign)));

  const authorization =
    `AWS4-HMAC-SHA256 Credential=${I(cfg.accessKey)}/${scope}, ` +
    `SignedHeaders=${signedHeaders}, Signature=${signature}`;

  const out: KeyValue[] = [
    { key: "X-Amz-Date", value: amz, enabled: true },
    { key: "Authorization", value: authorization, enabled: true },
  ];
  if (sessionToken) out.push({ key: "X-Amz-Security-Token", value: sessionToken, enabled: true });
  return out;
}

// ── OAuth 1.0 (HMAC-SHA1) ───────────────────────────────────────────

export async function signOAuth1(
  cfg: NonNullable<Auth["oauth1"]>,
  req: HttpRequest,
  vars: Record<string, string>,
  fixed?: { nonce: string; timestamp: string },
): Promise<string> {
  const I = (s?: string) => interpolate(s ?? "", vars);
  const url = new URL(req.url);
  const baseUrl = `${url.protocol}//${url.host}${url.pathname}`;

  const oauth: Record<string, string> = {
    oauth_consumer_key: I(cfg.consumerKey),
    oauth_nonce: fixed?.nonce ?? b64url(crypto.getRandomValues(new Uint8Array(16))),
    oauth_signature_method: "HMAC-SHA1",
    oauth_timestamp: fixed?.timestamp ?? String(Math.floor(Date.now() / 1000)),
    oauth_version: "1.0",
  };
  if (I(cfg.token)) oauth.oauth_token = I(cfg.token);

  // Kumpulkan semua parameter: oauth + query + body form.
  const params: [string, string][] = Object.entries(oauth);
  for (const [k, v] of url.searchParams.entries()) params.push([k, v]);
  const ct = req.headers.find((h) => h.key.toLowerCase() === "content-type")?.value ?? "";
  if (/x-www-form-urlencoded/.test(ct)) {
    const dec = (s: string) => {
      try {
        return decodeURIComponent(s.replace(/\+/g, " "));
      } catch {
        return s;
      }
    };
    for (const pair of bodyContent(req).split("&").filter(Boolean)) {
      const i = pair.indexOf("=");
      params.push(i < 0 ? [dec(pair), ""] : [dec(pair.slice(0, i)), dec(pair.slice(i + 1))]);
    }
  }

  const paramString = params
    .map(([k, v]) => [pct(k), pct(v)] as [string, string])
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const baseString = `${req.method.toUpperCase()}&${pct(baseUrl)}&${pct(paramString)}`;
  const signingKey = `${pct(I(cfg.consumerSecret))}&${pct(I(cfg.tokenSecret))}`;
  const signature = b64(await hmac("SHA-1", enc.encode(signingKey), enc.encode(baseString)));

  const headerParams = { ...oauth, oauth_signature: signature };
  const header =
    "OAuth " +
    Object.entries(headerParams)
      .sort((a, b) => (a[0] < b[0] ? -1 : 1))
      .map(([k, v]) => `${pct(k)}="${pct(v)}"`)
      .join(", ");
  return header;
}
