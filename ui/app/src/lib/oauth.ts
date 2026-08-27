// Wrapper OAuth (desktop-only) untuk login ke server MCP ber-OAuth seperti
// Atlassian. Flow sesungguhnya (PKCE, DCR, loopback) berjalan di Rust/Tauri.

import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "./api";
import { tr } from "../store/i18n";

export interface TokenSet {
  accessToken: string;
  refreshToken?: string | null;
  expiresIn?: number | null;
  scope?: string | null;
  tokenEndpoint: string;
  clientId: string;
}

/** Token tersimpan (dengan waktu kedaluwarsa absolut). */
export interface StoredToken extends TokenSet {
  expiresAt?: number; // epoch ms
}

export function oauthSupported(): boolean {
  return isTauri();
}

/** Login: buka browser, tangkap callback, kembalikan token. Desktop-only. */
export async function oauthLogin(mcpUrl: string): Promise<TokenSet> {
  if (!isTauri()) {
    throw new Error(tr("oauthDesktopOnly"));
  }
  return invoke<TokenSet>("oauth_login", { mcpUrl });
}

/** Segarkan access token dengan refresh token. */
export async function oauthRefresh(
  tokenEndpoint: string,
  clientId: string,
  refreshToken: string,
): Promise<TokenSet> {
  return invoke<TokenSet>("oauth_refresh", { tokenEndpoint, clientId, refreshToken });
}

/** Ubah TokenSet → StoredToken dengan expiresAt absolut. */
export function toStored(t: TokenSet): StoredToken {
  return {
    ...t,
    expiresAt: t.expiresIn ? Date.now() + t.expiresIn * 1000 : undefined,
  };
}
