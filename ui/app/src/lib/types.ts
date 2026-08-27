// Salinan manual dari model domain Rust (`crates/core`) + tipe khusus UI (workspace).
// Bagian request/response harus sinkron dengan crate core.

export type HttpMethod =
  | "GET"
  | "POST"
  | "PUT"
  | "PATCH"
  | "DELETE"
  | "HEAD"
  | "OPTIONS";

export const HTTP_METHODS: HttpMethod[] = [
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "HEAD",
  "OPTIONS",
];

export interface KeyValue {
  key: string;
  value: string;
  enabled: boolean;
  /** Keterangan opsional (kolom Description ala Postman). */
  description?: string;
  /** Tandai sebagai rahasia — nilainya ditutup (••••) di UI. */
  secret?: boolean;
}

/** Satu field pada body multipart/form-data. */
export interface FormField {
  id: string;
  key: string;
  /** Untuk type "text": nilai teks. Untuk "file": path file (native) yang dibaca engine. */
  value: string;
  type: "text" | "file";
  /** Nama file untuk tampilan/Content-Disposition (opsional; default basename path). */
  filename?: string;
  enabled: boolean;
}

export type RequestBody =
  | { kind: "none" }
  | { kind: "text"; content: string }
  | { kind: "json"; content: string }
  | { kind: "urlencoded"; items: KeyValue[] }
  | { kind: "form"; items: FormField[] }
  /** GraphQL: dikompilasi ke JSON {query, variables} saat dikirim/diekspor. */
  | { kind: "graphql"; query: string; variables: string };

export interface HttpRequest {
  id: string;
  name: string;
  method: HttpMethod;
  url: string;
  headers: KeyValue[];
  query: KeyValue[];
  body: RequestBody;
  assertions: Assertion[];
  extracts: Extract[];
  /** Otorisasi (diterapkan ke header/query saat kirim). */
  auth?: Auth;
  /** Script pre-request / post-response (JavaScript). */
  scripts?: Scripts;
  /** Pengaturan per-request (timeout, redirect, SSL). */
  settings?: RequestSettings;
  /** Suite QA: kasus test positif/negatif (opsional). */
  tests?: TestCase[];
  /** Contoh response tersimpan (mirip Postman "Save Example"). */
  examples?: ResponseExample[];
}

// ── Authorization ───────────────────────────────────────────────────

export type AuthType =
  | "inherit"
  | "none"
  | "basic"
  | "bearer"
  | "jwt"
  | "digest"
  | "oauth1"
  | "oauth2"
  | "hawk"
  | "aws"
  | "ntlm"
  | "apikey"
  | "akamai"
  | "asap";

export interface Auth {
  type: AuthType;
  /** bearer */
  token?: string;
  /** basic */
  username?: string;
  password?: string;
  /** apiKey */
  key?: string;
  value?: string;
  addTo?: "header" | "query";
  /** oauth2 (client credentials / password grant) */
  oauth2?: OAuth2Config;
  /** JWT Bearer (HS256/384/512) */
  jwt?: { algorithm: "HS256" | "HS384" | "HS512"; secret: string; payload: string };
  /** AWS Signature v4 */
  aws?: {
    accessKey: string;
    secretKey: string;
    region: string;
    service: string;
    sessionToken?: string;
  };
  /** OAuth 1.0 (HMAC-SHA1) */
  oauth1?: {
    consumerKey: string;
    consumerSecret: string;
    token?: string;
    tokenSecret?: string;
  };
}

export interface OAuth2Config {
  grantType: "client_credentials" | "password" | "authorization_code";
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  username?: string;
  password?: string;
  /** authorization_code: endpoint otorisasi + redirect URI. */
  authUrl?: string;
  redirectUri?: string;
  /** Diisi setelah "Get New Access Token". */
  accessToken?: string;
}

// ── Scripts ─────────────────────────────────────────────────────────

export interface Scripts {
  preRequest?: string;
  postResponse?: string;
}

// ── Per-request settings ────────────────────────────────────────────

export interface RequestSettings {
  timeoutMs?: number;
  /** default true */
  followRedirects?: boolean;
  /** default true */
  verifySsl?: boolean;
  /** URL proxy HTTP/HTTPS/SOCKS (hanya native/desktop). Kosong = tanpa proxy. */
  proxyUrl?: string;
  /** mTLS: path file sertifikat & kunci client (PEM, hanya native/desktop). */
  clientCertPath?: string;
  clientKeyPath?: string;
}

/** Snapshot response yang disimpan sebagai contoh, di bawah request. */
export interface ResponseExample {
  id: string;
  name: string;
  status: number;
  statusText: string;
  headers: KeyValue[];
  body: string;
  durationMs: number;
  sizeBytes: number;
  savedAt: number;
}

// ── Test cases (QA) ─────────────────────────────────────────────────

export type TestKind = "positive" | "negative";

/** Perubahan request khusus untuk sebuah test case (mis. hapus auth → 401). */
export interface TestOverride {
  method?: HttpMethod;
  url?: string;
  /** Header yang di-set/timpa untuk kasus ini. */
  headers?: KeyValue[];
  body?: RequestBody;
  /** Otorisasi khusus kasus (mis. { type: "none" } untuk uji 401). */
  auth?: Auth;
}

/** Cara sebuah input skenario dipetakan ke request saat dijalankan. */
export type TestInputTarget = "body" | "var";

/** Satu input skenario ("Diberikan"): mis. username=admin.
 * target "body" → set field JSON body; "var" → set nilai variabel {{key}}. */
export interface TestInput {
  key: string;
  value: string;
  target: TestInputTarget;
  enabled: boolean;
}

/** Narasi BDD (Given/When/Then) untuk keterbacaan & export Gherkin.
 * Semua opsional — bila kosong, diturunkan otomatis dari inputs + ekspektasi. */
export interface TestScenario {
  given?: string;
  when?: string;
  then?: string;
}

/** Satu skenario uji QA: judul + input ("Diberikan") + ekspektasi ("Maka").
 * `inputs` (terstruktur) dan `override` (mentah/lanjutan) sama-sama diterapkan;
 * `assertions` adalah ekspektasi terhadap response. */
export interface TestCase {
  id: string;
  /** Judul singkat kasus / nama skenario. */
  name: string;
  /** Deskripsi/tujuan kasus (opsional). */
  description?: string;
  kind: TestKind;
  /** Input terstruktur (Diberikan) — field body atau variabel. */
  inputs?: TestInput[];
  /** Narasi BDD opsional (untuk export Gherkin & ringkasan). */
  scenario?: TestScenario;
  /** Override request mentah (lanjutan). */
  override: TestOverride;
  assertions: Assertion[];
  /** Dataset data-driven (CSV/JSON). Setiap baris = 1 iterasi; kolomnya jadi
   * variabel (`{{kolom}}`) untuk URL/body/assertion. Kosong = jalan sekali. */
  dataset?: string;
}

// ── Testing (mirror crate core) ─────────────────────────────────────

export type AssertionSource =
  | { kind: "status" }
  | { kind: "responseTime" }
  | { kind: "header"; name: string }
  | { kind: "jsonPath"; path: string }
  | { kind: "body" };

export type AssertionOp =
  | "equals"
  | "notEquals"
  | "contains"
  | "notContains"
  | "exists"
  | "notExists"
  | "lessThan"
  | "greaterThan"
  | "matches"
  | "matchesSchema";

export const ASSERTION_OPS: AssertionOp[] = [
  "equals",
  "notEquals",
  "contains",
  "notContains",
  "exists",
  "notExists",
  "lessThan",
  "greaterThan",
  "matches",
  "matchesSchema",
];

export interface Assertion {
  id: string;
  source: AssertionSource;
  op: AssertionOp;
  value: string;
  enabled: boolean;
}

export interface AssertionResult {
  id: string;
  passed: boolean;
  description: string;
  actual: string;
  message: string;
}

export type ExtractFrom =
  | { kind: "jsonPath"; path: string }
  | { kind: "header"; name: string }
  | { kind: "status" }
  | { kind: "body" };

export interface Extract {
  id: string;
  var: string;
  from: ExtractFrom;
  enabled: boolean;
}

export interface RunDocument {
  name: string;
  variables: KeyValue[];
  requests: HttpRequest[];
}

export interface RequestReport {
  name: string;
  method: HttpMethod;
  url: string;
  status: number;
  durationMs: number;
  ok: boolean;
  error: string | null;
  assertions: AssertionResult[];
}

export interface RunReport {
  name: string;
  total: number;
  passedRequests: number;
  failedRequests: number;
  totalAssertions: number;
  passedAssertions: number;
  requests: RequestReport[];
}

export interface HttpResponse {
  status: number;
  statusText: string;
  headers: KeyValue[];
  body: string;
  /** Body mentah base64 untuk konten biner (gambar/PDF/dll). */
  bodyBase64?: string;
  durationMs: number;
  /** Time-to-first-byte (ms): start → header response tiba. */
  ttfbMs?: number;
  sizeBytes: number;
}

// ── Workspace (khusus UI, local-first) ──────────────────────────────

/** Node pohon collection: folder (punya anak) atau request. */
export type TreeNode =
  | { id: string; type: "folder"; name: string; children: TreeNode[]; auth?: Auth }
  | { id: string; type: "request"; name: string; request: HttpRequest };

export interface Collection {
  id: string;
  name: string;
  nodes: TreeNode[];
  /** Otorisasi level collection (diwariskan ke request "inherit"). */
  auth?: Auth;
  /** Script pre-request/post-response level collection — jalan mengelilingi
   * script tiap request di dalamnya (pre collection → pre request → kirim →
   * post request → post collection). */
  scripts?: Scripts;
}

export interface Environment {
  id: string;
  name: string;
  variables: KeyValue[];
}

// ── Flow (e2e lintas request) ───────────────────────────────────────

/** Satu langkah flow: referensi ke sebuah request di collection. */
export interface FlowStep {
  id: string;
  /** Label langkah (opsional; default nama request). */
  name: string;
  collectionId: string;
  nodeId: string;
  /** Ambil nilai dari response langkah ini ke variabel (untuk dipakai langkah
   * berikutnya via `{{var}}`). Didefinisikan di flow, bukan di request. */
  extracts?: Extract[];
}

/** Alur e2e: urutan request; variabel mengalir antar-langkah. */
export interface Flow {
  id: string;
  name: string;
  steps: FlowStep[];
}

export interface HistoryEntry {
  id: string;
  at: number; // epoch ms
  method: HttpMethod;
  url: string;
  status: number;
  durationMs: number;
  request: HttpRequest;
}

// ── Helpers ─────────────────────────────────────────────────────────

let seq = 0;
/** ID sederhana untuk sesi (UUID asli dibuat di sisi Rust saat disimpan). */
export function uid(prefix = "id"): string {
  seq += 1;
  return `${prefix}-${Date.now().toString(36)}-${seq.toString(36)}`;
}

export function emptyRequest(name = "Untitled"): HttpRequest {
  return {
    id: uid("req"),
    name,
    method: "GET",
    url: "",
    headers: [{ key: "", value: "", enabled: true }],
    query: [{ key: "", value: "", enabled: true }],
    body: { kind: "none" },
    assertions: [],
    extracts: [],
  };
}

export function sampleRequest(): HttpRequest {
  return { ...emptyRequest("Get IP"), url: "https://httpbin.org/get" };
}
