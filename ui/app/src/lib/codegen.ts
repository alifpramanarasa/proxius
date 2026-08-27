import type { HttpRequest, KeyValue } from "./types";
import { encodeUrlencoded, normalizeBody } from "./body";

export type CodeLang =
  | "curl"
  | "fetch"
  | "python"
  | "go"
  | "java"
  | "csharp"
  | "php"
  | "httpie";

export const CODE_LANGS: { id: CodeLang; label: string }[] = [
  { id: "curl", label: "cURL" },
  { id: "httpie", label: "HTTPie" },
  { id: "fetch", label: "JavaScript (fetch)" },
  { id: "python", label: "Python (requests)" },
  { id: "go", label: "Go (net/http)" },
  { id: "java", label: "Java (HttpClient)" },
  { id: "csharp", label: "C# (HttpClient)" },
  { id: "php", label: "PHP (curl)" },
];

const active = (rows: KeyValue[]) => rows.filter((r) => r.enabled && r.key);

/** URL lengkap + query string dari param aktif. */
function fullUrl(req: HttpRequest): string {
  const q = active(req.query)
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join("&");
  if (!q) return req.url;
  return req.url + (req.url.includes("?") ? "&" : "?") + q;
}

function headerPairs(req: HttpRequest): [string, string][] {
  return active(req.headers).map((h) => [h.key, h.value]);
}

const sq = (s: string) => `'${s.replace(/'/g, "'\\''")}'`; // single-quote untuk shell
const jstr = (s: string) => JSON.stringify(s);

// ── cURL ────────────────────────────────────────────────────────────

function curl(req: HttpRequest): string {
  const lines = [`curl -X ${req.method} ${sq(fullUrl(req))}`];
  for (const [k, v] of headerPairs(req)) lines.push(`  -H ${sq(`${k}: ${v}`)}`);
  const b = req.body;
  if (b.kind === "json" || b.kind === "text") {
    if (b.content) lines.push(`  --data ${sq(b.content)}`);
  } else if (b.kind === "urlencoded") {
    for (const i of active(b.items)) lines.push(`  --data-urlencode ${sq(`${i.key}=${i.value}`)}`);
  } else if (b.kind === "form") {
    for (const f of b.items.filter((f) => f.enabled && f.key)) {
      lines.push(
        `  -F ${sq(f.type === "file" ? `${f.key}=@${f.value}` : `${f.key}=${f.value}`)}`,
      );
    }
  }
  return lines.join(" \\\n");
}

// ── JavaScript fetch ────────────────────────────────────────────────

function fetchJs(req: HttpRequest): string {
  const headers = headerPairs(req);
  const opts: string[] = [`  method: ${jstr(req.method)},`];
  if (headers.length) {
    const hs = headers.map(([k, v]) => `    ${jstr(k)}: ${jstr(v)},`).join("\n");
    opts.push(`  headers: {\n${hs}\n  },`);
  }
  const b = req.body;
  let pre = "";
  if (b.kind === "json") {
    opts.push(`  body: ${jstr(b.content)},`);
  } else if (b.kind === "text") {
    opts.push(`  body: ${jstr(b.content)},`);
  } else if (b.kind === "urlencoded") {
    const entries = active(b.items).map((i) => `  [${jstr(i.key)}, ${jstr(i.value)}],`).join("\n");
    pre = `const body = new URLSearchParams([\n${entries}\n]);\n\n`;
    opts.push(`  body,`);
  } else if (b.kind === "form") {
    const rows = b.items.filter((f) => f.enabled && f.key);
    const appends = rows
      .map((f) =>
        f.type === "file"
          ? `form.append(${jstr(f.key)}, /* File: ${f.filename || f.value} */);`
          : `form.append(${jstr(f.key)}, ${jstr(f.value)});`,
      )
      .join("\n");
    pre = `const form = new FormData();\n${appends}\n\n`;
    opts.push(`  body: form,`);
  }
  return `${pre}const res = await fetch(${jstr(fullUrl(req))}, {\n${opts.join("\n")}\n});\nconst data = await res.text();`;
}

// ── Python requests ─────────────────────────────────────────────────

function pydict(pairs: [string, string][]): string {
  if (!pairs.length) return "{}";
  return `{\n${pairs.map(([k, v]) => `    ${jstr(k)}: ${jstr(v)},`).join("\n")}\n}`;
}

function python(req: HttpRequest): string {
  const headers = headerPairs(req);
  const args: string[] = [jstr(fullUrl(req))];
  if (headers.length) args.push(`headers=${pydict(headers)}`);
  const b = req.body;
  if (b.kind === "json") args.push(`data=${jstr(b.content)}`);
  else if (b.kind === "text") args.push(`data=${jstr(b.content)}`);
  else if (b.kind === "urlencoded")
    args.push(`data=${pydict(active(b.items).map((i) => [i.key, i.value]))}`);
  else if (b.kind === "form") {
    const rows = b.items.filter((f) => f.enabled && f.key);
    const data = rows.filter((f) => f.type === "text");
    const files = rows.filter((f) => f.type === "file");
    if (data.length) args.push(`data=${pydict(data.map((f) => [f.key, f.value]))}`);
    if (files.length)
      args.push(
        `files={\n${files.map((f) => `    ${jstr(f.key)}: open(${jstr(f.value)}, "rb"),`).join("\n")}\n}`,
      );
  }
  const method = req.method.toLowerCase();
  return `import requests\n\nres = requests.${method}(\n    ${args.join(",\n    ")},\n)\nprint(res.text)`;
}

// ── Body mentah (text/json/urlencoded) untuk bahasa string-body ─────
// Mengembalikan null bila tak ada body sederhana (none/form → ditangani khusus).
function bodyString(req: HttpRequest): string | null {
  const b = req.body;
  if (b.kind === "json" || b.kind === "text") return b.content || null;
  if (b.kind === "urlencoded") return encodeUrlencoded(b.items);
  return null; // none | form
}
const hasFormBody = (req: HttpRequest) => req.body.kind === "form";
const formNote = "// multipart/form-data omitted — set the body manually";

// ── Go (net/http) ───────────────────────────────────────────────────

function go(req: HttpRequest): string {
  const body = bodyString(req);
  const imports = ["net/http", "io", "fmt"];
  if (body != null) imports.push("strings");
  const bodyArg = body != null ? `strings.NewReader(${jstr(body)})` : "nil";
  const lines = [
    "package main",
    "",
    `import (\n${imports.map((i) => `\t${jstr(i)}`).join("\n")}\n)`,
    "",
    "func main() {",
    hasFormBody(req) ? `\t${formNote}` : "",
    `\treq, _ := http.NewRequest(${jstr(req.method)}, ${jstr(fullUrl(req))}, ${bodyArg})`,
  ].filter(Boolean);
  for (const [k, v] of headerPairs(req)) lines.push(`\treq.Header.Set(${jstr(k)}, ${jstr(v)})`);
  lines.push(
    "",
    "\tres, err := http.DefaultClient.Do(req)",
    "\tif err != nil {\n\t\tpanic(err)\n\t}",
    "\tdefer res.Body.Close()",
    "\tb, _ := io.ReadAll(res.Body)",
    "\tfmt.Println(string(b))",
    "}",
  );
  return lines.join("\n");
}

// ── Java (java.net.http) ────────────────────────────────────────────

function java(req: HttpRequest): string {
  const body = bodyString(req);
  const pub = body != null ? `BodyPublishers.ofString(${jstr(body)})` : "BodyPublishers.noBody()";
  const lines = [
    "HttpClient client = HttpClient.newHttpClient();",
    "HttpRequest request = HttpRequest.newBuilder()",
    `    .uri(URI.create(${jstr(fullUrl(req))}))`,
  ];
  for (const [k, v] of headerPairs(req)) lines.push(`    .header(${jstr(k)}, ${jstr(v)})`);
  lines.push(`    .method(${jstr(req.method)}, ${pub})`);
  lines.push("    .build();");
  lines.push("");
  if (hasFormBody(req)) lines.push(formNote.replace("//", "//"));
  lines.push(
    "HttpResponse<String> response = client.send(request, BodyHandlers.ofString());",
    "System.out.println(response.body());",
  );
  return lines.join("\n");
}

// ── C# (HttpClient) ─────────────────────────────────────────────────

function csharp(req: HttpRequest): string {
  const body = bodyString(req);
  const lines = [
    "using var client = new HttpClient();",
    `var request = new HttpRequestMessage(new HttpMethod(${jstr(req.method)}), ${jstr(fullUrl(req))});`,
  ];
  if (body != null) {
    const ct = active(req.headers).find((h) => h.key.toLowerCase() === "content-type")?.value;
    lines.push(
      `request.Content = new StringContent(${jstr(body)}, System.Text.Encoding.UTF8${ct ? `, ${jstr(ct)}` : ""});`,
    );
  }
  for (const [k, v] of headerPairs(req)) {
    if (k.toLowerCase() === "content-type") continue; // sudah di StringContent
    lines.push(`request.Headers.TryAddWithoutValidation(${jstr(k)}, ${jstr(v)});`);
  }
  if (hasFormBody(req)) lines.push(formNote);
  lines.push(
    "",
    "var response = await client.SendAsync(request);",
    "Console.WriteLine(await response.Content.ReadAsStringAsync());",
  );
  return lines.join("\n");
}

// ── PHP (curl) ──────────────────────────────────────────────────────

function php(req: HttpRequest): string {
  const body = bodyString(req);
  const headers = headerPairs(req).map(([k, v]) => `    ${jstr(`${k}: ${v}`)},`).join("\n");
  const lines = [
    "<?php",
    "$ch = curl_init();",
    `curl_setopt($ch, CURLOPT_URL, ${jstr(fullUrl(req))});`,
    "curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);",
    `curl_setopt($ch, CURLOPT_CUSTOMREQUEST, ${jstr(req.method)});`,
  ];
  if (headers) lines.push(`curl_setopt($ch, CURLOPT_HTTPHEADER, [\n${headers}\n]);`);
  if (body != null) lines.push(`curl_setopt($ch, CURLOPT_POSTFIELDS, ${jstr(body)});`);
  if (hasFormBody(req)) lines.push(`# ${formNote.replace("// ", "")}`);
  lines.push("", "$response = curl_exec($ch);", "curl_close($ch);", "echo $response;");
  return lines.join("\n");
}

// ── HTTPie ──────────────────────────────────────────────────────────

function httpie(req: HttpRequest): string {
  const b = req.body;
  const parts = ["http", req.method];
  parts.push(sq(fullUrl(req)));
  for (const [k, v] of headerPairs(req)) parts.push(sq(`${k}:${v}`));
  const line = parts.join(" ");
  if (b.kind === "json") {
    // HTTPie kirim JSON via stdin agar struktur utuh.
    return `echo ${sq(b.content || "{}")} | ${line}`;
  }
  if (b.kind === "text") {
    return `echo ${sq(b.content)} | ${line}`;
  }
  if (b.kind === "urlencoded") {
    const fields = active(b.items).map((i) => sq(`${i.key}=${i.value}`));
    return `${line} --form ${fields.join(" ")}`;
  }
  if (b.kind === "form") {
    const fields = b.items
      .filter((f) => f.enabled && f.key)
      .map((f) => sq(f.type === "file" ? `${f.key}@${f.value}` : `${f.key}=${f.value}`));
    return `${line} --form ${fields.join(" ")}`;
  }
  return line;
}

export function generateCode(req: HttpRequest, lang: CodeLang): string {
  const r: HttpRequest = { ...req, body: normalizeBody(req.body) };
  switch (lang) {
    case "curl":
      return curl(r);
    case "fetch":
      return fetchJs(r);
    case "python":
      return python(r);
    case "go":
      return go(r);
    case "java":
      return java(r);
    case "csharp":
      return csharp(r);
    case "php":
      return php(r);
    case "httpie":
      return httpie(r);
  }
}
