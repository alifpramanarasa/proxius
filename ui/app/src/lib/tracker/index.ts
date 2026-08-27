// API publik modul tracker: satu fungsi createIssue yang memilih provider.

import { sendRequest } from "../api";
import type { HttpRequest } from "../types";
import { buildJiraRequest, parseJiraResult, validateJira } from "./jira";
import {
  buildLinearRequest,
  parseLinearResult,
  validateLinear,
} from "./linear";
import type { IssuePayload, IssueResult, TrackerConfig } from "./types";

export * from "./types";
export {
  issueTitle,
  testCaseMarkdown,
  toIssuePayload,
  exportMarkdown,
} from "./describe";
export { buildJiraRequest, parseJiraResult, validateJira } from "./jira";
export { buildLinearRequest, parseLinearResult, validateLinear } from "./linear";

export function defaultTrackerConfig(): TrackerConfig {
  return {
    provider: "jira",
    jira: { site: "", email: "", apiToken: "", projectKey: "", issueType: "Task" },
    linear: { apiKey: "", teamId: "" },
  };
}

/** Validasi config provider aktif; null bila valid. */
export function validateTracker(cfg: TrackerConfig): string | null {
  return cfg.provider === "jira"
    ? validateJira(cfg.jira)
    : validateLinear(cfg.linear);
}

export function trackerLabel(cfg: TrackerConfig): string {
  return cfg.provider === "jira" ? "Jira" : "Linear";
}

/** Buat satu issue di provider aktif. Melempar Error dengan pesan jelas. */
export async function createIssue(
  cfg: TrackerConfig,
  payload: IssuePayload,
): Promise<IssueResult> {
  const invalid = validateTracker(cfg);
  if (invalid) throw new Error(invalid);

  let req: HttpRequest;
  if (cfg.provider === "jira") req = buildJiraRequest(cfg.jira, payload);
  else req = buildLinearRequest(cfg.linear, payload);

  const resp = await sendRequest(req);
  return cfg.provider === "jira"
    ? parseJiraResult(cfg.jira, resp)
    : parseLinearResult(resp);
}
