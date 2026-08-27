import {
  emptyRequest,
  type HttpMethod,
  type HttpRequest,
  HTTP_METHODS,
} from "./types";

/** Tokenisasi command shell sederhana (menghormati kutip ' dan "). */
function tokenize(input: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: '"' | "'" | null = null;
  let has = false;
  for (let i = 0; i < input.length; i++) {
    const c = input[i];
    if (quote) {
      if (c === quote) quote = null;
      else if (c === "\\" && quote === '"' && i + 1 < input.length) {
        cur += input[++i];
      } else cur += c;
    } else if (c === '"' || c === "'") {
      quote = c;
      has = true;
    } else if (c === "\\" && input[i + 1] === "\n") {
      i++; // line continuation
    } else if (/\s/.test(c)) {
      if (has || cur) out.push(cur);
      cur = "";
      has = false;
    } else {
      cur += c;
      has = true;
    }
  }
  if (has || cur) out.push(cur);
  return out;
}

/** Parse perintah `curl ...` menjadi HttpRequest. Melempar Error bila tak valid. */
export function parseCurl(input: string): HttpRequest {
  const raw = input.trim().replace(/^\$\s+/, "");
  const tokens = tokenize(raw);
  if (tokens[0] !== "curl") throw new Error("Bukan perintah curl.");

  const req = emptyRequest("Imported from cURL");
  req.headers = [];
  req.query = [];
  let method: HttpMethod | null = null;
  let url = "";
  const dataParts: string[] = [];

  for (let i = 1; i < tokens.length; i++) {
    const t = tokens[i];
    const next = () => tokens[++i] ?? "";
    switch (true) {
      case t === "-X" || t === "--request": {
        const m = next().toUpperCase();
        if (HTTP_METHODS.includes(m as HttpMethod)) method = m as HttpMethod;
        break;
      }
      case t === "-H" || t === "--header": {
        const h = next();
        const idx = h.indexOf(":");
        if (idx > 0) {
          req.headers.push({
            key: h.slice(0, idx).trim(),
            value: h.slice(idx + 1).trim(),
            enabled: true,
          });
        }
        break;
      }
      case t === "-d" ||
        t === "--data" ||
        t === "--data-raw" ||
        t === "--data-binary" ||
        t === "--data-ascii": {
        dataParts.push(next());
        break;
      }
      case t === "-u" || t === "--user": {
        const cred = next();
        req.headers.push({
          key: "Authorization",
          value: "Basic " + btoa(cred),
          enabled: true,
        });
        break;
      }
      case t === "--url": {
        url = next();
        break;
      }
      case t === "-A" || t === "--user-agent": {
        req.headers.push({ key: "User-Agent", value: next(), enabled: true });
        break;
      }
      case t === "-b" || t === "--cookie": {
        req.headers.push({ key: "Cookie", value: next(), enabled: true });
        break;
      }
      // Flag tanpa argumen yang kita abaikan.
      case t === "-L" ||
        t === "--location" ||
        t === "-k" ||
        t === "--insecure" ||
        t === "-s" ||
        t === "--silent" ||
        t === "-i" ||
        t === "--include" ||
        t === "--compressed":
        break;
      case t.startsWith("-"): {
        // Flag lain yang mengambil argumen — lewati argumennya.
        if (!t.includes("=")) i++;
        break;
      }
      default: {
        if (!url) url = t;
      }
    }
  }

  if (!url) throw new Error("URL tidak ditemukan di perintah curl.");

  // Pisahkan query string dari URL.
  try {
    const u = new URL(url);
    u.searchParams.forEach((value, key) =>
      req.query.push({ key, value, enabled: true }),
    );
    req.url = u.origin + u.pathname;
  } catch {
    req.url = url;
  }

  if (dataParts.length) {
    const body = dataParts.join("&");
    const isJson = /^\s*[[{]/.test(body);
    req.body = { kind: isJson ? "json" : "text", content: body };
    if (!method) method = "POST";
  }
  req.method = method ?? "GET";

  if (req.headers.length === 0) req.headers = [{ key: "", value: "", enabled: true }];
  if (req.query.length === 0) req.query = [{ key: "", value: "", enabled: true }];
  return req;
}
