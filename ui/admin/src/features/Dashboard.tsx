import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { api, type User } from "../lib/api";

export function Dashboard({
  me,
  onLogout,
}: {
  me: User;
  onLogout: () => void;
}) {
  const stats = useQuery({ queryKey: ["stats"], queryFn: api.stats });
  const users = useQuery({ queryKey: ["users"], queryFn: api.users });
  const workspaces = useQuery({ queryKey: ["workspaces"], queryFn: api.workspaces });
  const qc = useQueryClient();

  const setRole = useMutation({
    mutationFn: ({ id, role }: { id: string; role: string }) =>
      api.setRole(id, role),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["users"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });
  const delWs = useMutation({
    mutationFn: (id: string) => api.deleteWorkspace(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["workspaces"] });
      qc.invalidateQueries({ queryKey: ["stats"] });
    },
  });

  return (
    <div className="mx-auto max-w-5xl p-6">
      <header className="mb-6 flex items-center justify-between">
        <h1 className="text-lg font-bold">
          Prox<span className="text-brand-fg">ius</span> Admin
          <span className="ml-2 text-xs font-normal text-neutral-600">
            M3 · CMS
          </span>
        </h1>
        <div className="flex items-center gap-3 text-sm">
          <span className="text-neutral-400">{me.email}</span>
          <button onClick={onLogout} className="text-neutral-500 hover:text-rose-400">
            Keluar
          </button>
        </div>
      </header>

      {/* Stat cards */}
      <div className="mb-6 grid grid-cols-3 gap-3">
        <Stat label="Users" value={stats.data?.users} />
        <Stat label="Workspaces" value={stats.data?.workspaces} />
        <Stat label="Sesi aktif" value={stats.data?.activeSessions} />
      </div>

      {/* Users */}
      <Section title="Users">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr>
              <Th>Email</Th>
              <Th>Nama</Th>
              <Th>Role</Th>
              <Th>Workspaces</Th>
              <Th>Terakhir aktif</Th>
            </tr>
          </thead>
          <tbody>
            {users.data?.map((u) => (
              <tr key={u.id} className="border-t border-neutral-800">
                <Td>{u.email}</Td>
                <Td>{u.name}</Td>
                <Td>
                  <select
                    value={u.role}
                    disabled={u.id === me.id}
                    onChange={(e) => setRole.mutate({ id: u.id, role: e.target.value })}
                    className="rounded border border-neutral-800 bg-neutral-900 px-1 py-0.5 text-xs outline-none disabled:opacity-50"
                  >
                    <option value="member">member</option>
                    <option value="admin">admin</option>
                  </select>
                </Td>
                <Td>{u.workspaceCount}</Td>
                <Td className="text-neutral-500">{fmt(u.lastActive)}</Td>
              </tr>
            ))}
          </tbody>
        </table>
        {users.isLoading && <Loading />}
      </Section>

      {/* Workspaces */}
      <Section title="Workspaces">
        <table className="w-full text-sm">
          <thead className="text-left text-xs uppercase text-neutral-500">
            <tr>
              <Th>Nama</Th>
              <Th>Pemilik</Th>
              <Th>Anggota</Th>
              <Th>Versi</Th>
              <Th>Diperbarui</Th>
              <Th></Th>
            </tr>
          </thead>
          <tbody>
            {workspaces.data?.map((w) => (
              <tr key={w.id} className="border-t border-neutral-800">
                <Td>{w.name}</Td>
                <Td>{w.ownerEmail}</Td>
                <Td>{w.memberCount}</Td>
                <Td>{w.version}</Td>
                <Td className="text-neutral-500">{fmt(w.updatedAt)}</Td>
                <Td>
                  <button
                    onClick={() =>
                      confirm(`Hapus workspace "${w.name}"?`) && delWs.mutate(w.id)
                    }
                    className="text-xs text-neutral-600 hover:text-rose-400"
                  >
                    hapus
                  </button>
                </Td>
              </tr>
            ))}
          </tbody>
        </table>
        {workspaces.isLoading && <Loading />}
      </Section>
    </div>
  );
}

function Stat({ label, value }: { label: string; value?: number }) {
  return (
    <div className="rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <div className="text-2xl font-bold">{value ?? "—"}</div>
      <div className="text-xs text-neutral-500">{label}</div>
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-6 overflow-x-auto rounded-lg border border-neutral-800 bg-neutral-900 p-4">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  );
}

function Th({ children }: { children?: React.ReactNode }) {
  return <th className="px-2 py-1 font-medium">{children}</th>;
}
function Td({
  children,
  className = "",
}: {
  children?: React.ReactNode;
  className?: string;
}) {
  return <td className={`px-2 py-1.5 ${className}`}>{children}</td>;
}
function Loading() {
  return <p className="py-2 text-xs text-neutral-600">Memuat…</p>;
}
function fmt(s: string | null): string {
  if (!s) return "—";
  return new Date(s).toLocaleString();
}
