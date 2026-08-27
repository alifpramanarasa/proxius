import type { Environment, HttpRequest, KeyValue, RequestBody } from "./types";

/** Ubah daftar variabel environment jadi map key→value (yang aktif saja). */
export function envMap(env: Environment | undefined): Record<string, string> {
  const m: Record<string, string> = {};
  if (!env) return m;
  for (const v of env.variables) {
    if (v.enabled && v.key) m[v.key] = v.value;
  }
  return m;
}

/** Ganti semua `{{key}}` pada string dengan nilai dari map. */
export function interpolate(input: string, vars: Record<string, string>): string {
  return input.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key) =>
    key in vars ? vars[key] : whole,
  );
}

function resolveKV(rows: KeyValue[], vars: Record<string, string>): KeyValue[] {
  return rows.map((r) => ({
    ...r,
    key: interpolate(r.key, vars),
    value: interpolate(r.value, vars),
  }));
}

/** Terapkan variabel ke body sesuai tipenya (path file tidak diinterpolasi). */
function resolveBody(body: RequestBody, vars: Record<string, string>): RequestBody {
  switch (body.kind) {
    case "none":
      return body;
    case "text":
    case "json":
      return { ...body, content: interpolate(body.content, vars) };
    case "urlencoded":
      return { ...body, items: resolveKV(body.items, vars) };
    case "form":
      return {
        ...body,
        items: body.items.map((f) => ({
          ...f,
          key: interpolate(f.key, vars),
          value: f.type === "file" ? f.value : interpolate(f.value, vars),
        })),
      };
    case "graphql":
      return {
        ...body,
        query: interpolate(body.query, vars),
        variables: interpolate(body.variables, vars),
      };
  }
}

/** Terapkan variabel environment ke seluruh request sebelum dikirim. */
export function resolveRequest(
  req: HttpRequest,
  vars: Record<string, string>,
): HttpRequest {
  return {
    ...req,
    url: interpolate(req.url, vars),
    headers: resolveKV(req.headers, vars),
    query: resolveKV(req.query, vars),
    body: resolveBody(req.body, vars),
    assertions: req.assertions.map((a) => ({
      ...a,
      value: interpolate(a.value, vars),
    })),
  };
}

/** Daftar nama variabel yang dipakai request tapi tak ada di environment. */
export function missingVars(
  req: HttpRequest,
  vars: Record<string, string>,
): string[] {
  const used = new Set<string>();
  const scan = (s: string) => {
    for (const m of s.matchAll(/\{\{\s*([\w.-]+)\s*\}\}/g)) used.add(m[1]);
  };
  scan(req.url);
  req.headers.forEach((h) => (scan(h.key), scan(h.value)));
  req.query.forEach((q) => (scan(q.key), scan(q.value)));
  const b = req.body;
  if (b.kind === "text" || b.kind === "json") scan(b.content);
  else if (b.kind === "urlencoded") b.items.forEach((i) => (scan(i.key), scan(i.value)));
  else if (b.kind === "form")
    b.items.forEach((f) => (scan(f.key), f.type === "text" && scan(f.value)));
  else if (b.kind === "graphql") (scan(b.query), scan(b.variables));
  return [...used].filter((k) => !(k in vars));
}
