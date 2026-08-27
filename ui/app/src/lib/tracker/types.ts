// Integrasi pelacak isu (Jira / Linear) untuk mengekspor test case.
//
// Sebuah "test case" di Proxius = satu request + assertion-nya. Saat di-sync,
// kita membuat satu issue yang mendeskripsikan request dan hasil yang
// diharapkan, sehingga tim QA/dev bisa melacaknya di Jira/Linear.
//
// Semua panggilan HTTP lewat native engine (sendRequest) agar bebas CORS,
// sama seperti request user lainnya.

export type TrackerProvider = "jira" | "linear";

export interface JiraConfig {
  /** URL situs, mis. https://acme.atlassian.net (tanpa trailing slash). */
  site: string;
  /** Email akun Atlassian (untuk Basic auth). */
  email: string;
  /** API token dari id.atlassian.com/manage-profile/security/api-tokens. */
  apiToken: string;
  /** Kunci project tujuan, mis. "QA". */
  projectKey: string;
  /** Tipe issue, mis. "Task" | "Bug" | "Test". Default "Task". */
  issueType: string;
}

export interface LinearConfig {
  /** Personal API key dari linear.app/settings/api. */
  apiKey: string;
  /** ID team tujuan (UUID). */
  teamId: string;
}

export interface TrackerConfig {
  provider: TrackerProvider;
  jira: JiraConfig;
  linear: LinearConfig;
}

/** Payload netral-provider untuk satu test case. */
export interface IssuePayload {
  title: string;
  /** Deskripsi dalam Markdown. */
  markdown: string;
  /** Label opsional (mis. ["proxius", "api-test"]). */
  labels?: string[];
}

/** Hasil pembuatan issue. */
export interface IssueResult {
  /** Kunci/identifier yang terlihat user, mis. "QA-123" atau "ENG-45". */
  key: string;
  /** URL langsung ke issue. */
  url: string;
}
