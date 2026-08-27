import { useQuery, useQueryClient } from "@tanstack/react-query";
import { api, getToken, setToken } from "./lib/api";
import { Login } from "./features/Login";
import { Dashboard } from "./features/Dashboard";

export function App() {
  const qc = useQueryClient();
  const {
    data: me,
    isLoading,
    isError,
  } = useQuery({
    queryKey: ["me"],
    queryFn: api.me,
    enabled: !!getToken(),
  });

  function logout() {
    setToken(null);
    qc.clear();
  }

  if (!getToken() || isError) {
    return <Login onLoggedIn={() => qc.invalidateQueries({ queryKey: ["me"] })} />;
  }
  if (isLoading || !me) {
    return <Centered>Memuat…</Centered>;
  }
  if (me.role !== "admin") {
    return (
      <Centered>
        <div className="text-center">
          <p className="mb-2 text-rose-400">
            Akun <b>{me.email}</b> bukan admin.
          </p>
          <button onClick={logout} className="text-sm text-brand-fg underline">
            Keluar
          </button>
        </div>
      </Centered>
    );
  }
  return <Dashboard me={me} onLogout={logout} />;
}

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex h-full items-center justify-center text-sm text-neutral-400">
      {children}
    </div>
  );
}
