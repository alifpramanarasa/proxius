// Klien Linear. Membuat issue lewat GraphQL (mutation issueCreate).
// Auth: header Authorization berisi personal API key (tanpa prefiks Bearer).

import type { HttpRequest, HttpResponse } from "../types";
import { jsonPost } from "./http";
import type { IssuePayload, IssueResult, LinearConfig } from "./types";

const ENDPOINT = "https://api.linear.app/graphql";

const MUTATION = `mutation ProxiusIssueCreate($input: IssueCreateInput!) {
  issueCreate(input: $input) {
    success
    issue { identifier url }
  }
}`;

export function validateLinear(c: LinearConfig): string | null {
  if (!c.apiKey.trim()) return "API key Linear kosong.";
  if (!c.teamId.trim()) return "Team ID Linear kosong.";
  return null;
}

/** Bangun request pembuatan issue (murni, mudah diuji). */
export function buildLinearRequest(c: LinearConfig, p: IssuePayload): HttpRequest {
  const body = {
    query: MUTATION,
    variables: {
      input: {
        teamId: c.teamId.trim(),
        title: p.title,
        description: p.markdown,
      },
    },
  };
  return jsonPost(ENDPOINT, { Authorization: c.apiKey.trim() }, body);
}

/** Ubah response GraphQL menjadi IssueResult (atau lempar error jelas). */
export function parseLinearResult(resp: HttpResponse): IssueResult {
  let data: any = {};
  try {
    data = JSON.parse(resp.body);
  } catch {
    /* biarkan tervalidasi di bawah */
  }
  if (data?.errors?.length) {
    throw new Error(`Linear: ${data.errors.map((e: any) => e.message).join("; ")}`);
  }
  const created = data?.data?.issueCreate;
  if (resp.status >= 200 && resp.status < 300 && created?.success && created.issue) {
    return { key: created.issue.identifier, url: created.issue.url };
  }
  throw new Error(`Linear ${resp.status}: ${resp.statusText || "gagal membuat issue"}`);
}
