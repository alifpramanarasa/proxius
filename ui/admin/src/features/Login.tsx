import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { api, setToken } from "../lib/api";

export function Login({ onLoggedIn }: { onLoggedIn: () => void }) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const mut = useMutation({
    mutationFn: () => api.login(email, password),
    onSuccess: (res) => {
      setToken(res.token);
      onLoggedIn();
    },
  });

  return (
    <div className="flex h-full items-center justify-center">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          mut.mutate();
        }}
        className="w-80 rounded-lg border border-neutral-800 bg-neutral-900 p-6"
      >
        <h1 className="mb-1 text-xl font-bold">
          Prox<span className="text-brand-fg">ius</span> Admin
        </h1>
        <p className="mb-4 text-xs text-neutral-500">Masuk sebagai operator.</p>

        <label className="mb-1 block text-xs text-neutral-400">Email</label>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          className="mb-3 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        <label className="mb-1 block text-xs text-neutral-400">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          className="mb-4 w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-brand"
        />
        {mut.isError && (
          <p className="mb-3 text-xs text-rose-400">
            Gagal masuk: {(mut.error as Error).message}
          </p>
        )}
        <button
          type="submit"
          disabled={mut.isPending}
          className="w-full rounded-md bg-brand py-2 text-sm font-semibold text-white hover:opacity-90 disabled:opacity-50"
        >
          {mut.isPending ? "Masuk…" : "Masuk"}
        </button>
      </form>
    </div>
  );
}
