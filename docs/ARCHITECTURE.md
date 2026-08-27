# Proxius — Arsitektur

> Postman alternatif, **self-hosted & gratis**. Desktop app (Tauri) dengan model **local-first** dan **optional sync/collaboration server** (Rust/Axum + Postgres). UI adalah SPA Vite + React.

Dokumen ini adalah sumber kebenaran arsitektur. Kode belum ditulis — ini blueprint yang kita sepakati dulu.

**Keputusan stack (2026-08-10):** Backend **full Rust (Axum)**. UI **Vite + React** (Next.js dibuang — tak perlu SSR utk SPA di webview). Domain logic hidup di **crate Rust** yang dipakai ulang di desktop, server, dan CLI. TS hanya untuk UI.

---

## 1. Prinsip Desain

1. **Local-first.** Aplikasi 100% berguna tanpa server & tanpa internet (kecuali hit API target). Data di mesin user (SQLite). Server itu *opsional*, hanya untuk kolaborasi & fitur tim.
2. **Gratis & self-hostable.** Tidak ada dependency berbayar wajib. Server = satu binary Rust + Postgres, `docker compose up`. Solo user tak perlu server.
3. **Satu bahasa sistem.** Rust dari HTTP engine → server → CLI. Tauri sudah Rust; kita perluas ke seluruh backend. Footprint kecil, satu mental model.
4. **Domain logic dikompilasi, bukan di-publish.** `core`/`engine`/`runner`/`agent` adalah crate Rust yang di-*link* langsung ke tiap konsumer. Ubah sekali → semua ikut, dicek compiler.
5. **CRDT untuk kolaborasi.** Sync & multiplayer pakai CRDT (`yrs`, port Yjs ke Rust). Offline edit + merge otomatis.
6. **Native HTTP engine.** Request via `reqwest` (Rust), bukan `fetch` browser — bebas CORS, method/header arbitrer, mTLS, client cert, streaming, timing granular.
7. **Agent sebagai warga kelas satu.** Agentic & "bring your own agent" lewat satu abstraksi (Agent Runtime + Tool Registry + MCP), dirancang sejak awal.

---

## 2. Bentuk & Mode Deployment

Satu codebase, dua mode.

### Mode Solo (default, tanpa server)
```
┌─────────────────────────────────────┐
│  Proxius Desktop (Tauri)             │
│  ┌────────────────┐  ┌────────────┐  │
│  │ UI React (Vite) │  │ Rust core  │  │
│  │  di webview     │◄─┤ engine     │  │
│  │                 │  │ runner     │  │
│  └────────────────┘  │ SQLite     │  │
│    IPC (Tauri cmd)    │ keychain   │  │
│                       └────────────┘  │
└─────────────────────────────────────┘
        │ HTTP native (reqwest)
        ▼   API target user
```
Semua data di SQLite lokal. Tanpa akun, tanpa cloud. Langsung jalan.

### Mode Tim (self-hosted server aktif)
```
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│ Desktop A     │   │ Desktop B     │   │ Browser (SPA) │
└──────┬───────┘   └──────┬───────┘   └──────┬───────┘
       │  HTTP/JSON + WebSocket (yrs sync)    │
       └───────────┬──────────────┴───────────┘
                   ▼
        ┌────────────────────────────┐
        │  Proxius Server (Axum/Rust)│
        │  - REST API (typed)        │
        │  - WS sync (yrs CRDT)      │
        │  - Agent Runtime           │
        │  - e2e scheduler/monitor   │  ← reuse crate `engine` + `runner`
        │  - Admin CMS API (§12)     │  ← lihat/kelola user, workspace, dll
        └───────────┬────────────────┘
                    ▼   Postgres (sqlx)
```
Desktop tetap local-first; server = titik sync, RBAC, kolaborasi realtime, agent terjadwal, e2e monitor, dan **Admin CMS** (§12) untuk operator. UI SPA utama juga bisa diakses via browser (file static dilayani server); Admin CMS adalah SPA terpisah di `/admin`.

**Konsekuensi kunci:** UI ditulis sekali (Vite + React). Data layer-nya berbicara ke **Tauri command** (lokal, mode solo) atau **REST/WS server** (mode tim) lewat satu client abstraction — transparan bagi komponen UI. Crate `engine`/`runner` yang sama dipakai desktop (via Tauri) *dan* server (via Axum) — jadi request yang dijalankan interaktif, di CI, dan terjadwal, benar-benar identik.

---

## 3. Struktur Monorepo (polyglot)

Satu **Cargo workspace** (Rust, mayoritas kode) + satu **pnpm workspace** kecil (UI saja).

```
proxius/
├─ crates/                    # ── Rust (Cargo workspace) ──
│  ├─ core/                   # Domain model: Request, Collection, Environment,
│  │                          #   Assertion, TestCase. Derive `ts-rs` → TS types.
│  ├─ engine/                 # HTTP engine (reqwest): send/stream/cancel, mTLS,
│  │                          #   cookie jar, proxy, timing. Dipakai desktop+server+cli.
│  ├─ runner/                 # Eksekusi test/collection/skenario + reporter (JSON/JUnit/HTML)
│  ├─ agent/                  # Agent Runtime, Tool Registry, MCP client (rmcp), LLM adapter
│  ├─ collab/                 # CRDT (yrs): dokumen, sync, presence, RBAC map
│  ├─ db/                     # sqlx: SQLite (lokal) + Postgres (server) + migrasi + sync
│  ├─ script/                 # Sandbox pre/post-request script (rquickjs / QuickJS)
│  ├─ server/                 # [bin] Axum: REST + WS + auth + scheduler
│  └─ cli/                    # [bin] `proxius run` — headless runner utk CI
├─ apps/
│  └─ desktop/
│     └─ src-tauri/           # Tauri shell → depend crate core/engine/runner/db/agent
├─ ui/                        # ── TypeScript (pnpm) ──
│  ├─ app/                    # SPA utama: request builder dsb (desktop webview + browser)
│  ├─ admin/                  # Admin CMS: kelola user/workspace/dll (mode tim, §12)
│  └─ kit/                    # Komponen & util React bersama (dipakai app + admin)
├─ bindings/                  # Tipe TS hasil-generate dari Rust (ts-rs) → dipakai app + admin
├─ docs/
├─ docker-compose.yml         # server + Postgres (mode tim, one-command)
├─ Cargo.toml                 # Rust workspace root
└─ pnpm-workspace.yaml        # ui/ (+ tooling)
```

Kenapa begini: `core`/`engine`/`runner`/`agent` adalah **library crate** yang di-*link* ke tiga binary berbeda (Tauri desktop, Axum server, CLI). Tidak ada publish/versioning internal — ubah `Request` sekali, compiler menandai semua tempat yang perlu disesuaikan. Inilah alasan monorepo di sini bukan sekadar preferensi: sharing-nya di level kompilasi.

---

## 4. Tech Stack

| Layer | Pilihan | Alasan |
|---|---|---|
| Desktop shell | **Tauri 2** (Rust) | Ringan, HTTP native, keychain OS, auto-update |
| UI | **Vite + React**, TailwindCSS, Radix UI | SPA ringan; satu UI utk desktop & web; tanpa beban SSR |
| Routing | **TanStack Router** | Type-safe routing, client-side (bukan TanStack Start — SSR tak perlu, backend Rust) |
| Data fetching | **TanStack Query** | Cache/async state panggilan API (Tauri cmd / REST) |
| Tabel & grid | **TanStack Table** + **TanStack Virtual** | History, hasil test, grid data-driven — virtualized utk data besar |
| Form | **TanStack Form** | Editor request/env/assertion, type-safe |
| State lokal | **Zustand** | State UI ringan di luar server-state (mis. tab aktif, panel) |
| Backend | **Rust + Axum** | Satu bahasa dgn Tauri, footprint kecil, reuse crate engine/runner |
| API contract | **REST/JSON + `ts-rs`** (types) + **`utoipa`** (OpenAPI) | Type-safe Rust→TS tanpa tRPC; client TS di-generate |
| DB server | **Postgres 16** + **`sqlx`** | Self-host mudah, query compile-time-checked |
| DB lokal | **SQLite** via `sqlx`/`rusqlite` (Tauri) | Local-first store |
| Realtime/CRDT | **`yrs`** (y-crdt) + WebSocket (Axum) | Port Yjs resmi ke Rust; offline-first merge |
| Editor | **CodeMirror 6** (di UI) | Body/JSON/script editor |
| Script sandbox | **`rquickjs`** (QuickJS) | Jalankan script user aman, timeout & memory cap |
| Agent/LLM | **`reqwest`** ke provider + adapter | Multi-provider; default Claude, tapi BYO |
| Agent tools | **MCP** via **`rmcp`** (Rust SDK resmi) | Standar "bring your own agent"/tool |
| Test runner | crate **`runner`** | Dipakai UI (via Tauri), CLI, scheduler |
| Auth (tim) | JWT/session + Argon2 (`axum` middleware) | Self-host, tanpa vendor lock |
| Packaging | Tauri bundler + Docker | Desktop installer + server image |

Semua open-source & bebas biaya.

### Catatan: jembatan tipe Rust ↔ TS (pengganti tRPC)
Karena backend Rust, kita kehilangan type-safety otomatis ala tRPC. Gantinya:
- **`ts-rs`**: derive macro pada struct domain (`core`) meng-generate definisi TS ke `bindings/`. UI meng-impor tipe ini — jadi model tetap satu sumber.
- **`utoipa`**: anotasi handler Axum → hasilkan spec OpenAPI → generate typed API client TS.
- Hasil akhirnya mirip pengalaman tRPC (ubah struct Rust → tipe TS ikut berubah, mismatch ketahuan saat build UI), hanya dengan langkah codegen eksplisit.

---

## 5. Model Domain (inti)

Didefinisikan di crate `core` (Rust), di-*derive* ke TS via `ts-rs`. ID = UUID v7 (sortable, aman utk offline-generate).

```
Workspace 1─┬─* Collection 1─┬─* Request
            │                └─* Folder (nested)
            ├─* Environment ─* Variable (key, value, secret?)
            ├─* Member (mode tim: role = owner|editor|viewer)
            └─* AgentConfig (BYO agent)

Request ─┬─ method, url, headers[], query[], auth, body
         ├─* Assertion (test case, §8.4)
         ├─* Script (pre-request, post-response) — rquickjs
         └─* ExampleResponse[]

RunResult ─┬─ request snapshot, response, timings
           ├─* AssertionResult (pass/fail)
           └─ env snapshot
```

Field sensitif (secret, token, client cert) **tidak** plaintext: dienkripsi dengan kunci dari OS keychain (desktop) / KMS server. Lihat §9.

---

## 6. HTTP Engine — jantung aplikasi (crate `engine`)

Satu crate Rust, dipakai ulang di **desktop (Tauri command)**, **server (scheduler/e2e)**, dan **CLI**.

```rust
#[async_trait]
pub trait HttpEngine {
    async fn send(&self, req: PreparedRequest, opts: SendOptions) -> Result<HttpResponse>;
    fn stream(&self, req: PreparedRequest) -> impl Stream<Item = Chunk>; // SSE/chunked
    fn cancel(&self, id: RequestId);
}
```

Berbasis `reqwest`/`hyper`: redirect control, cookie jar, mTLS/client cert, custom CA, proxy, HTTP/2, timing granular (DNS/TCP/TLS/TTFB), method & header apa pun, **bebas CORS**.

UI memanggilnya lewat Tauri command (mode solo) atau lewat server (mode tim), tapi **implementasinya satu**. Inilah yang membuat request identik saat dijalankan interaktif, di CI, dan terjadwal — prasyarat untuk automate & e2e.

---

## 7. Local-first & Strategi Sync

- **Sumber kebenaran lokal:** SQLite (crate `db`). UI selalu baca/tulis lokal → instan, offline-proof.
- **Dokumen kolaboratif sebagai CRDT (`yrs`).** Collection & environment direpresentasikan sebagai dokumen yrs; perubahan lokal masuk ke SQLite *dan* update log yrs.
- **Sync engine** (`collab` + `db`): saat online & login ke server tim, update yrs dikirim via WebSocket; merge CRDT menyelesaikan konflik otomatis. Postgres menyimpan snapshot + update log per workspace.
- **RunResult/history:** lokal-only default (besar & sensitif); opsional push ke server utk shared history.

Mode solo = yrs jalan lokal tanpa provider jaringan. Beralih ke tim = *attach* data lokal ke workspace server, tanpa migrasi menyakitkan.

---

## 8. Modul Roadmap — desain teknis

Semua bertumpu pada tiga fondasi: **model domain (§5)**, **engine (§6)**, dan **runner headless**.

### 8.1 Collaboration
- **CRDT (`yrs`)** utk edit bersama collection/environment; **presence** (kursor, siapa buka apa) via awareness.
- **RBAC**: owner/editor/viewer per workspace, dicek di handler Axum + difilter di room WS.
- **Comments & activity log** per request. **Fork & merge** ala PR (fase lanjut).
- Server: satu WS room per workspace; token auth → izin join.

### 8.2 Agentic System
- **Agent Runtime** (crate `agent`): loop tool-calling (plan → call tool → observe → repeat).
- **Tool Registry** — agent diberi tool = primitif aplikasi: `http.send`, `collection.read/write`, `env.get/set`, `test.generate`, `runner.run`, `docs.read`.
- Use case: "Import OpenAPI → buat collection + happy-path test", "Kenapa 401? Perbaiki auth", "Generate test regresi dari 10 request terakhir".
- Jalan di **client** (interaktif, API key user) atau **server** (terjadwal/tim).

### 8.3 Bring Your Own Agent
- Satu trait `AgentProvider { async fn chat(msgs, tools) -> impl Stream<AgentEvent> }`.
- Adapter bawaan: Anthropic (Claude), OpenAI, **Ollama** (lokal/gratis), endpoint OpenAI-compatible generik.
- **MCP client (`rmcp`)**: user colok MCP server sendiri → tool eksternal masuk Tool Registry. Bentuk paling murni "bring your own agent/tool".
- API key disimpan terenkripsi (keychain / KMS), tak pernah plaintext.

### 8.4 Buat Unit Test
- Dari response, generator usulkan **Assertion** deklaratif: `status == 200`, `header[content-type] ~ json`, `jsonpath($.data.id) exists`, `responseTime < 500ms`, schema match (JSON Schema auto-infer).
- Assertion = data (bukan skrip) → bisa diedit di UI *dan* dieksekusi headless. Escape hatch script kompleks lewat `rquickjs`.
- Agent (§8.2) bisa meng-generate; user approve.

### 8.5 Buat Test Case
- **Test case = skenario** = urutan request + data + expected outcome, di atas layer assertion.
- **Data-driven** (tabel CSV/JSON) + **chaining** (token dari response A → request B).
- Generator skenario dari OpenAPI/collection: happy-path, boundary, negative.

### 8.6 Automate Test (test runner)
- Crate `runner` eksekusi collection/skenario headless → hasil + reporter (JSON, JUnit XML, HTML).
- **`crates/cli`** (`proxius run collection.pxs -e staging`) utk **CI/CD** — setara Newman, native ke format kita, satu binary.
- Server jalankan run terjadwal (cron) → notifikasi hasil.

### 8.7 e2e Live Test
- **Monitor**: jadwalkan skenario e2e berkala terhadap endpoint live (staging/prod). Di sinilah backend Rust paling untung — long-running, banyak request konkuren, reuse `engine`.
- Multi-step, multi-environment, setup/teardown.
- **Assertion SLA** (latency, uptime, correctness) + **alerting** (webhook/email/Slack).
- Riwayat run + dashboard status (uptime, p95) di UI.

---

## 8b. Admin CMS (mode tim — untuk operator server)

SPA terpisah (`ui/admin/`, Vite + React + TanStack) yang dilayani server Axum di `/admin`, di belakang auth khusus role **admin/operator**. **Hanya ada di mode tim** — tidak dibundel ke desktop/solo. Tujuannya: satu tempat untuk *handle* seluruh instance yang di-self-host.

Yang bisa dikelola:
- **Users** — daftar user, undang/nonaktifkan/hapus, reset password, atur role global (admin/member), lihat sesi aktif & last-active.
- **Workspaces / Projects** — daftar semua workspace, pemilik & anggota, ukuran/storage, transfer ownership, arsip/hapus.
- **Members & RBAC** — kelola peran per workspace (owner/editor/viewer), undangan tertunda.
- **Monitoring & usage** — status e2e monitor (§8.7), jumlah request, storage Postgres, health server.
- **Audit log** — jejak aksi tim (siapa mengubah apa & kapan).
- **Pengaturan server** — konfigurasi auth (SSO/SMTP untuk undangan & alert), default agent/LLM & MCP tingkat-organisasi, rate limit, retensi history.
- **Agent/MCP org-level** — daftar MCP server terdaftar, kunci provider default (terenkripsi), kuota.

Teknis:
- Frontend: **TanStack Router + Query + Table** (grid user/workspace, filter, pagination server-side), berbagi `ui/kit/` & tipe `bindings/` dengan SPA utama.
- Backend: modul `admin` di crate `server` — endpoint REST khusus admin (guard role), reuse `db` & model `core`. Tidak ada logika domain baru — hanya *view* & *management* atas data yang sudah ada.
- Keamanan: semua endpoint admin di belakang guard role + audit-logged; aksi destruktif (hapus user/workspace) minta konfirmasi & tercatat.

---

## 9. Keamanan

- **Secret storage:** OS keychain (Tauri keyring/Stronghold) di desktop; envelope-encryption (`age`/KMS) di server. Value secret di DB selalu ciphertext.
- **Script sandbox:** pre/post script user jalan di **`rquickjs` terisolasi** (no fs, no net kecuali lewat API terkontrol), timeout & memory cap. Bukan `eval` di konteks utama.
- **Agent guardrails:** tool mutating (write collection, kirim ke domain baru) minta konfirmasi; API key agent per-user, tak di-share lewat sync.
- **Server:** RBAC per workspace, rate-limit, audit log aksi tim.
- **Prinsip:** data request bisa sangat sensitif (token produksi). Default = lokal & terenkripsi; sharing selalu opt-in eksplisit.

---

## 10. Roadmap Bertahap (milestone)

| Fase | Isi | Hasil yang bisa dipakai |
|---|---|---|
| **M0 — Fondasi** | Cargo+pnpm workspace, crate `core` (+ts-rs), `engine`, shell Tauri + SQLite, UI Vite kosong | Kirim 1 request & lihat response |
| **M1 — MVP Postman** | Request builder, collections/folders, environments/variables, history, import cURL/OpenAPI | API client harian layak pakai |
| **M2 — Testing core** | Assertion model, unit test (§8.4), test case/skenario (§8.5), `runner` + CLI (§8.6) | Automate test di CI |
| **M3 — Server tim + Admin CMS** | Server Axum, Postgres (sqlx), auth, sync SQLite↔Postgres, **Admin CMS** kelola user/workspace (§8b) | Multi-device, backup terpusat, operator bisa handle instance |
| **M4 — Collaboration** | `yrs` realtime, presence, RBAC, comments (§8.1) | Kerja tim realtime |
| **M5 — Agentic** | Agent Runtime + Tool Registry, BYO agent + MCP (§8.2–8.3) | Asisten agentic di dalam app |
| **M6 — e2e & Monitoring** | Scheduler, monitor live, alerting, dashboard (§8.7) | Observability API |

Tiap fase menghasilkan sesuatu yang benar-benar bisa dipakai.

---

## 11. Keputusan Terbuka (perlu dibahas)

1. **Kontrak API:** REST + `ts-rs`/`utoipa` (rekomendasi, sederhana) vs. gRPC/`tonic` (lebih ketat, lebih berat). Rekomendasi: REST dulu.
2. **Runtime async:** Tokio (default de-facto, dipakai Axum & reqwest). Praktis tak ada alternatif serius — pakai Tokio.
3. **Format file collection:** format sendiri (`.pxs`, bersih) + importer/exporter Postman v2.1 & OpenAPI. Rekomendasi: format sendiri + interop.
4. **LLM default agent:** Claude (kualitas) + BYO + Ollama (100% gratis/offline).
5. **Lisensi:** AGPL agar tetap open untuk self-host (perlu keputusanmu).

---

*Langkah berikutnya yang disarankan: setujui/koreksi dokumen ini, lalu scaffold **M0** — Cargo+pnpm workspace, crate `core` + `engine`, shell Tauri yang bisa kirim satu request dari UI React.*
