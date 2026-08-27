// Client untuk server tim Proxius (mode tim): auth, sync workspace, comments,
// members. Building block untuk integrasi UI kolaborasi.

export interface TeamUser {
  id: string;
  email: string;
  name: string;
  role: string;
}

export interface WorkspaceMeta {
  id: string;
  name: string;
  ownerId: string;
  version: number;
  role: string;
  updatedAt: string;
}

export interface WorkspaceData {
  id: string;
  name: string;
  data: unknown;
  version: number;
}

export interface Comment {
  id: string;
  requestId: string;
  body: string;
  createdAt: string;
  authorId: string;
  authorName: string;
  authorEmail: string;
}

export class TeamClient {
  constructor(
    public baseUrl: string,
    public token: string | null = null,
  ) {}

  private async req<T>(path: string, opts: RequestInit = {}): Promise<T> {
    const res = await fetch(`${this.baseUrl}/api${path}`, {
      ...opts,
      headers: {
        "Content-Type": "application/json",
        ...(this.token ? { Authorization: `Bearer ${this.token}` } : {}),
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

  async register(email: string, password: string, name?: string) {
    const r = await this.req<{ token: string; user: TeamUser }>(
      "/auth/register",
      { method: "POST", body: JSON.stringify({ email, password, name }) },
    );
    this.token = r.token;
    return r;
  }

  async login(email: string, password: string) {
    const r = await this.req<{ token: string; user: TeamUser }>("/auth/login", {
      method: "POST",
      body: JSON.stringify({ email, password }),
    });
    this.token = r.token;
    return r;
  }

  me = () => this.req<TeamUser>("/auth/me");
  workspaces = () => this.req<WorkspaceMeta[]>("/workspaces");
  workspace = (id: string) => this.req<WorkspaceData>(`/workspaces/${id}`);

  /** Push snapshot; lempar Error dengan pesan "version conflict" bila basi. */
  pushWorkspace = (id: string, data: unknown, version: number) =>
    this.req<{ version: number }>(`/workspaces/${id}`, {
      method: "PUT",
      body: JSON.stringify({ data, version }),
    });

  addMember = (id: string, email: string, role: "owner" | "editor" | "viewer") =>
    this.req(`/workspaces/${id}/members`, {
      method: "POST",
      body: JSON.stringify({ email, role }),
    });

  listComments = (id: string, requestId: string) =>
    this.req<Comment[]>(
      `/workspaces/${id}/comments?requestId=${encodeURIComponent(requestId)}`,
    );

  createComment = (id: string, requestId: string, body: string) =>
    this.req<Comment>(`/workspaces/${id}/comments`, {
      method: "POST",
      body: JSON.stringify({ requestId, body }),
    });

  deleteComment = (commentId: string) =>
    this.req(`/comments/${commentId}`, { method: "DELETE" });
}
