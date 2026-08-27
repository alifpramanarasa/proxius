# Proxius sebagai MCP Server

Proxius bisa jalan sebagai **MCP (Model Context Protocol) server** lewat stdio,
sehingga **Claude Code** (atau MCP client lain: Claude Desktop, Cursor, dll.)
bisa memakai engine API-testing Proxius langsung: menembak request, memeriksa
assertion, dan menjalankan collection — semua headless, tanpa membuka UI.

Transport: **stdio, JSON-RPC 2.0** (satu pesan per baris). Semua diproses oleh
engine + runner Rust yang sama dengan yang dipakai desktop app & CLI.

## 1. Build binary

```bash
cargo build --release -p proxius-cli
```

Hasilnya: `target/release/proxius` (Windows: `target\release\proxius.exe`).
Server dijalankan dengan subcommand:

```bash
proxius mcp
```

(Server membaca JSON-RPC dari stdin dan membalas ke stdout; diagnostik ke stderr.)

## 2. Sambungkan ke Claude Code

Cara termudah — daftarkan lewat CLI Claude Code:

```bash
claude mcp add proxius -- /ABSOLUTE/PATH/target/release/proxius mcp
```

Atau tulis manual di `.mcp.json` (level project) / konfigurasi MCP client:

```json
{
  "mcpServers": {
    "proxius": {
      "command": "/ABSOLUTE/PATH/target/release/proxius",
      "args": ["mcp"]
    }
  }
}
```

Setelah tersambung, Claude Code akan melihat tiga tool di bawah.

## 3. Tools yang tersedia

| Tool | Fungsi | Argumen utama |
|------|--------|---------------|
| `http_send` | Kirim satu request HTTP, kembalikan status/header/waktu/body. | `url` (wajib), `method`, `headers`, `query`, `body`, `bodyKind` |
| `assert_request` | Kirim request lalu evaluasi assertion; balikan lulus/gagal tiap check. | `url`, `assertions[]` (`{source, op, value}`) |
| `run_document` | Jalankan file collection `.pxs` (RunDocument JSON) beserta seluruh test-nya. | `file` (path), `env`, `vars` |
| `list_documents` | Pindai folder untuk menemukan dokumen `.pxs`/RunDocument + ringkasan request-nya. | `dir`, `recursive` |

### Format assertion

- `source`: `status` · `responseTime` · `body` · `jsonpath:$.path` · `header:Name`
- `op`: `equals` · `notEquals` · `contains` · `notContains` · `exists` · `notExists` · `lessThan` · `greaterThan` · `matches`

### Contoh (yang akan dipanggil Claude Code)

`assert_request`:

```json
{
  "url": "https://api.example.com/users/42",
  "assertions": [
    { "source": "status", "op": "equals", "value": "200" },
    { "source": "jsonpath:$.id", "op": "equals", "value": "42" },
    { "source": "header:content-type", "op": "contains", "value": "application/json" },
    { "source": "responseTime", "op": "lessThan", "value": "500" }
  ]
}
```

`run_document` menjalankan collection yang sudah diekspor dari Proxius (tombol
Export `.pxs` pada collection), termasuk chaining variabel `{{var}}` dan
interpolasi environment lewat argumen `env` / `vars`.

## 4. Alur khas dengan Claude Code

1. Developer mengekspor collection dari Proxius (`.pxs`), atau cukup arahkan
   Claude Code ke endpoint yang mau diuji.
2. Di Claude Code: *"tembak GET /health, pastikan 200 dan field status = ok"* →
   Claude memanggil `assert_request`.
3. *"jalankan regresi collection ini"* → Claude memanggil `run_document` dan
   melaporkan request/assertion yang lulus & gagal.

Karena engine-nya sama dengan CLI (`proxius run`) dan desktop, hasil test
konsisten di ketiga permukaan.

## 5. Arah kebalikan: Proxius sebagai MCP *client*

Proxius juga bisa **menyambung ke server MCP eksternal** dan memakai tool-nya di
dalam agent AI internal. Buka **Settings (⚙) → 🧩 External MCP tools**, tambah
server (nama + URL Streamable-HTTP, mis. `http://localhost:3000/mcp`), lalu
*Connect*. Tool yang ditemukan otomatis muncul untuk agent Proxius dengan nama
`mcp__<server>__<tool>`.

Catatan transport: server `proxius mcp` di atas memakai **stdio** (untuk
diluncurkan Claude Code sebagai subprocess), sedangkan client internal ini
memakai **HTTP**. Keduanya arah yang berbeda — client internal ditujukan untuk
server MCP yang mengekspos endpoint HTTP.

### Login OAuth (mis. Atlassian) — tanpa API token / project key

Server MCP ber-OAuth (Atlassian Remote MCP, dll.) tidak perlu di-set project
key / issue type / token secara manual — cukup **login sekali**, dan tool-nya
meng-*auto-discover* project & issue type. Di Settings → 🧩 External MCP tools,
klik **⚡ Tambah Atlassian** lalu **Login**:

1. Proxius (Rust/Tauri) menjalankan OAuth 2.1: penemuan metadata →
   Dynamic Client Registration → PKCE → buka browser untuk consent →
   loopback `127.0.0.1` menangkap `code` → tukar jadi access/refresh token.
2. Token dipasang sebagai `Authorization: Bearer …` pada request MCP; refresh
   otomatis saat mendekati kedaluwarsa.
3. Agent Proxius kini bisa memanggil tool Atlassian (mis. `getVisibleJiraProjects`,
   `createJiraIssue`) — jadi "buat test case lalu buat Jira issue" tanpa config.

Login OAuth hanya berjalan di **app desktop** (butuh browser + loopback). Catatan:
endpoint & transport tiap penyedia bisa beda (mis. Atlassian memakai varian SSE);
mekanisme OAuth-nya sudah teruji, tetapi handshake sesi ke server sungguhan perlu
diverifikasi langsung dengan akunmu.
