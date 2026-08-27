// Integrasi siap-pakai: server MCP resmi tiap penyedia (login OAuth, tanpa
// API token/project key manual). Dipakai section "Integration" di Settings.

export interface IntegrationPreset {
  key: string;
  name: string;
  /** Deskripsi singkat layanan. */
  desc: string;
  /** Endpoint remote MCP (OAuth). */
  url: string;
}

export const INTEGRATIONS: IntegrationPreset[] = [
  {
    key: "atlassian",
    name: "Atlassian",
    desc: "Jira · Confluence",
    // Endpoint Streamable-HTTP (bukan /v1/sse yang transport SSE lama).
    url: "https://mcp.atlassian.com/v1/mcp",
  },
  // Linear ditunda — tambahkan lagi bila diperlukan.
];

/** URL semua preset — untuk memisahkan integrasi resmi dari server MCP custom. */
export const PRESET_URLS = new Set(INTEGRATIONS.map((i) => i.url));
