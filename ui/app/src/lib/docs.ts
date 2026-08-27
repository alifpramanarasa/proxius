// Generate dokumentasi API (halaman HTML mandiri) dari sebuah collection —
// mirip Postman/Bruno docs. Tanpa dependency; bisa langsung di-share/di-host.
import type { Collection, KeyValue, RequestBody, TreeNode } from "./types";

const esc = (s: string) =>
  s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]!);

const slug = (s: string) =>
  s.toLowerCase().replace(/[^\w]+/g, "-").replace(/^-|-$/g, "") || "req";

function bodyText(body: RequestBody): { lang: string; text: string } | null {
  switch (body.kind) {
    case "json": {
      try {
        return { lang: "json", text: JSON.stringify(JSON.parse(body.content), null, 2) };
      } catch {
        return { lang: "json", text: body.content };
      }
    }
    case "text":
      return { lang: "text", text: body.content };
    case "graphql":
      return { lang: "graphql", text: body.query };
    case "urlencoded":
      return {
        lang: "form",
        text: body.items
          .filter((i) => i.enabled && i.key)
          .map((i) => `${i.key}=${i.value}`)
          .join("\n"),
      };
    case "form":
      return {
        lang: "form",
        text: body.items
          .filter((i) => i.enabled && i.key)
          .map((i) => `${i.key}: ${i.type === "file" ? `(file) ${i.filename ?? i.value}` : i.value}`)
          .join("\n"),
      };
    default:
      return null;
  }
}

function kvTable(title: string, rows: KeyValue[]): string {
  const on = rows.filter((r) => r.enabled && r.key);
  if (on.length === 0) return "";
  const body = on
    .map(
      (r) =>
        `<tr><td class="k">${esc(r.key)}</td><td class="v">${esc(r.value)}</td><td class="d">${esc(
          r.description ?? "",
        )}</td></tr>`,
    )
    .join("");
  return `<h4>${esc(title)}</h4><table><thead><tr><th>Key</th><th>Value</th><th>Description</th></tr></thead><tbody>${body}</tbody></table>`;
}

function authLine(req: { auth?: { type: string } }): string {
  const type = req.auth?.type;
  if (!type || type === "none") return "";
  const label =
    type === "inherit"
      ? "Inherited"
      : type === "bearer"
        ? "Bearer token"
        : type === "basic"
          ? "Basic auth"
          : type === "apikey"
            ? "API key"
            : type === "oauth2"
              ? "OAuth 2.0"
              : type;
  return `<p class="auth"><span>Auth</span> ${esc(label)}</p>`;
}

function requestCard(name: string, node: Extract<TreeNode, { type: "request" }>): string {
  const r = node.request;
  const id = slug(name + "-" + r.method);
  const parts: string[] = [];
  parts.push(`<section id="${id}" class="req">`);
  parts.push(
    `<div class="reqhead"><span class="m m-${esc(r.method)}">${esc(r.method)}</span><h3>${esc(
      name,
    )}</h3></div>`,
  );
  parts.push(`<code class="url">${esc(r.url)}</code>`);
  parts.push(authLine(r));
  parts.push(kvTable("Query params", r.query));
  parts.push(kvTable("Headers", r.headers));
  const b = bodyText(r.body);
  if (b && b.text.trim()) {
    parts.push(`<h4>Body <span class="tag">${esc(b.lang)}</span></h4><pre>${esc(b.text)}</pre>`);
  }
  for (const ex of r.examples ?? []) {
    const ok = ex.status >= 200 && ex.status < 300;
    parts.push(
      `<h4>Example: ${esc(ex.name)} <span class="st ${ok ? "ok" : "bad"}">${ex.status} ${esc(
        ex.statusText,
      )}</span></h4>`,
    );
    let bodyStr = ex.body ?? "";
    try {
      bodyStr = JSON.stringify(JSON.parse(bodyStr), null, 2);
    } catch {
      /* biarkan apa adanya */
    }
    if (bodyStr.trim()) parts.push(`<pre>${esc(bodyStr)}</pre>`);
  }
  parts.push(`</section>`);
  return parts.join("\n");
}

function walk(nodes: TreeNode[], depth: number, toc: string[], out: string[]) {
  for (const n of nodes) {
    if (n.type === "folder") {
      out.push(`<h2 class="folder">${esc(n.name)}</h2>`);
      walk(n.children, depth + 1, toc, out);
    } else {
      const id = slug(n.name + "-" + n.request.method);
      toc.push(
        `<li><a href="#${id}"><span class="m m-${esc(n.request.method)}">${esc(
          n.request.method,
        )}</span>${esc(n.name)}</a></li>`,
      );
      out.push(requestCard(n.name, n));
    }
  }
}

/** Halaman HTML dokumentasi mandiri untuk satu collection. */
export function toDocsHtml(col: Collection): string {
  const toc: string[] = [];
  const body: string[] = [];
  walk(col.nodes, 0, toc, body);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>${esc(col.name)} — API docs</title>
<style>
  :root { color-scheme: light; --bg:#ffffff; --fg:#18181b; --mut:#71717a; --line:#e4e4e7; --card:#fafafa; --brand:#0000A8; }
  * { box-sizing: border-box; }
  body { margin:0; font:14px/1.6 ui-sans-serif,system-ui,-apple-system,Segoe UI,Roboto,sans-serif; color:var(--fg); background:var(--bg); }
  .wrap { display:grid; grid-template-columns:260px 1fr; max-width:1200px; margin:0 auto; }
  aside { position:sticky; top:0; align-self:start; height:100vh; overflow:auto; border-right:1px solid var(--line); padding:24px 16px; }
  aside h1 { font-size:16px; margin:0 0 4px; }
  aside .sub { color:var(--mut); font-size:12px; margin:0 0 16px; }
  aside ul { list-style:none; margin:0; padding:0; }
  aside li a { display:flex; align-items:center; gap:8px; padding:4px 6px; border-radius:6px; color:var(--fg); text-decoration:none; font-size:13px; }
  aside li a:hover { background:var(--card); }
  main { padding:24px 32px; min-width:0; }
  h2.folder { font-size:13px; text-transform:uppercase; letter-spacing:.05em; color:var(--mut); margin:28px 0 8px; }
  section.req { border:1px solid var(--line); border-radius:10px; padding:16px 18px; margin:0 0 20px; background:var(--card); }
  .reqhead { display:flex; align-items:center; gap:10px; }
  .reqhead h3 { margin:0; font-size:15px; }
  code.url { display:block; margin:10px 0; padding:8px 10px; background:#fff; border:1px solid var(--line); border-radius:6px; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; word-break:break-all; }
  h4 { margin:14px 0 6px; font-size:12px; text-transform:uppercase; letter-spacing:.04em; color:var(--mut); }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--mut); font-weight:600; font-size:11px; text-transform:uppercase; border-bottom:1px solid var(--line); padding:4px 8px; }
  td { border-bottom:1px solid var(--line); padding:5px 8px; vertical-align:top; }
  td.k { font-family:ui-monospace,Menlo,Consolas,monospace; white-space:nowrap; }
  td.d { color:var(--mut); }
  pre { margin:6px 0; padding:12px; background:#0a0a0a; color:#e5e5e5; border-radius:8px; overflow:auto; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:12.5px; }
  p.auth span { display:inline-block; font-size:11px; text-transform:uppercase; color:var(--mut); margin-right:6px; }
  .tag, .st { font-size:11px; padding:1px 6px; border-radius:999px; text-transform:none; letter-spacing:0; }
  .tag { background:#e4e4e7; color:#52525b; }
  .st.ok { background:#dcfce7; color:#166534; }
  .st.bad { background:#fee2e2; color:#991b1b; }
  .m { display:inline-block; min-width:44px; text-align:center; font-family:ui-monospace,Menlo,Consolas,monospace; font-size:10.5px; font-weight:700; padding:1px 4px; border-radius:4px; }
  .m-GET{color:#047857} .m-POST{color:#b45309} .m-PUT{color:#0369a1} .m-PATCH{color:#6d28d9} .m-DELETE{color:#be123c} .m-HEAD,.m-OPTIONS{color:#52525b}
  @media (max-width:820px){ .wrap{grid-template-columns:1fr} aside{position:static;height:auto;border-right:0;border-bottom:1px solid var(--line)} }
</style>
</head>
<body>
<div class="wrap">
  <aside>
    <h1>${esc(col.name)}</h1>
    <p class="sub">API documentation</p>
    <ul>${toc.join("\n")}</ul>
  </aside>
  <main>
${body.join("\n")}
  </main>
</div>
</body>
</html>`;
}
