// Client WebSocket kolaborasi realtime: presence, live-sync, comments.

import type { Comment } from "./team";

export interface PresenceUser {
  id: string;
  name: string;
  email: string;
}

export type CollabEvent =
  | { type: "welcome"; userId: string; role: string }
  | { type: "presence"; users: PresenceUser[] }
  | { type: "comment"; comment: Comment }
  | { type: "changed"; version: number; by: string }
  | { type: "cursor"; userId: string; requestId: string | null };

/** Koneksi realtime ke satu workspace room. */
export class CollabClient {
  private ws: WebSocket | null = null;
  private closedByUser = false;

  constructor(
    private baseUrl: string,
    private workspaceId: string,
    private token: string,
    private onEvent: (e: CollabEvent) => void,
  ) {}

  connect() {
    const url =
      this.baseUrl.replace(/^http/, "ws") +
      `/api/ws/workspace/${this.workspaceId}?token=${encodeURIComponent(this.token)}`;
    const ws = new WebSocket(url);
    this.ws = ws;
    ws.onmessage = (e) => {
      try {
        this.onEvent(JSON.parse(e.data) as CollabEvent);
      } catch {
        /* abaikan pesan non-JSON */
      }
    };
    ws.onclose = () => {
      // Auto-reconnect ringan bila bukan penutupan sengaja.
      if (!this.closedByUser) setTimeout(() => this.connect(), 2000);
    };
  }

  private send(obj: unknown) {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(obj));
    }
  }

  /** Beri tahu peserta lain bahwa versi workspace berubah (setelah push). */
  notifySync = (version: number) => this.send({ type: "sync", version });
  /** Umumkan request yang sedang dilihat (presence detail). */
  setCursor = (requestId: string | null) =>
    this.send({ type: "cursor", requestId });
  /** Tambah komentar (butuh role editor/owner). */
  comment = (requestId: string, body: string) =>
    this.send({ type: "comment", requestId, body });

  close() {
    this.closedByUser = true;
    this.ws?.close();
  }
}
