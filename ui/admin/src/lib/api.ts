// Client API Admin CMS. Dev → server localhost:8080; prod → same-origin /api.

const API = import.meta.env.DEV ? "http://localhost:8080/api" : "/api";
const TOKEN_KEY = "proxius-admin-token";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}
export function setToken(t: string | null) {
  if (t) localStorage.setItem(TOKEN_KEY, t);
  else localStorage.removeItem(TOKEN_KEY);
}

export interface User {
  id: string;
  email: string;
  name: string;
  role: string;
  active: boolean;
}
export interface AdminUser extends User {
  createdAt: string;
  lastActive: string | null;
  workspaceCount: number;
}
export interface AdminWorkspace {
  id: string;
  name: string;
  ownerEmail: string;
  memberCount: number;
  version: number;
  updatedAt: string;
}
export interface Stats {
  users: number;
  workspaces: number;
  activeSessions: number;
}

async function req<T>(path: string, opts: RequestInit = {}): Promise<T> {
  const token = getToken();
  const res = await fetch(API + path, {
    ...opts,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...opts.headers,
    },
  });
  if (!res.ok) {
    let msg = `${res.status}`;
    try {
      msg = (await res.json()).error ?? msg;
    } catch {
      /* ignore */
    }
    throw new Error(msg);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

export const api = {
  login: (email: string, password: string) =>
    req<{ token: string; user: User }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    }),
  me: () => req<User>("/auth/me"),
  stats: () => req<Stats>("/admin/stats"),
  users: () => req<AdminUser[]>("/admin/users"),
  workspaces: () => req<AdminWorkspace[]>("/admin/workspaces"),
  setRole: (id: string, role: string) =>
    req(`/admin/users/${id}/role`, {
      method: "PATCH",
      body: JSON.stringify({ role }),
    }),
  deleteWorkspace: (id: string) =>
    req(`/admin/workspaces/${id}`, { method: "DELETE" }),
};
