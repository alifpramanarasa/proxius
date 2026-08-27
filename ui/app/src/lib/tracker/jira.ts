// Klien Jira Cloud. Membuat issue lewat REST API v2 (deskripsi teks biasa,
// lebih sederhana daripada ADF v3). Auth: Basic email:apiToken.

import type { HttpRequest, HttpResponse } from "../types";
import { base64, jsonPost } from "./http";
import type { IssuePayload, IssueResult, JiraConfig } from "./types";

const trimSlash = (s: string) => s.replace(/\/+$/, "");

export function validateJira(c: JiraConfig): string | null {
  if (!c.site.trim()) return "Jira site URL kosong.";
  if (!/^https?:\/\//.test(c.site)) return "Jira site harus diawali http(s)://";
  if (!c.email.trim()) return "Email Jira kosong.";
  if (!c.apiToken.trim()) return "API token Jira kosong.";
  if (!c.projectKey.trim()) return "Project key Jira kosong.";
  return null;
}

/** Bangun request pembuatan issue (murni, mudah diuji). */
export function buildJiraRequest(c: JiraConfig, p: IssuePayload): HttpRequest {
  const url = `${trimSlash(c.site)}/rest/api/2/issue`;
  const auth = `Basic ${base64(`${c.email}:${c.apiToken}`)}`;
  const body = {
    fields: {
      project: { key: c.projectKey.trim() },
      summary: p.title,
      description: p.markdown,
      issuetype: { name: c.issueType?.trim() || "Task" },
      ...(p.labels?.length ? { labels: p.labels } : {}),
    },
  };
  return jsonPost(url, { Authorization: auth }, body);
}

/** Ubah response mentah menjadi IssueResult (atau lempar error jelas). */
export function parseJiraResult(c: JiraConfig, resp: HttpResponse): IssueResult {
  let data: any = {};
  try {
    data = JSON.parse(resp.body);
  } catch {
    /* body mungkin kosong/HTML saat error */
  }
  if (resp.status >= 200 && resp.status < 300 && data.key) {
    return { key: data.key, url: `${trimSlash(c.site)}/browse/${data.key}` };
  }
  const errors =
    data?.errorMessages?.join("; ") ||
    (data?.errors && Object.values(data.errors).join("; ")) ||
    resp.statusText ||
    `HTTP ${resp.status}`;
  throw new Error(`Jira ${resp.status}: ${errors}`);
}
