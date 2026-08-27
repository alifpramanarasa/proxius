import { useState } from "react";
import { useTeam } from "../store/team";
import { toast } from "../store/ui";
import { useT } from "../store/i18n";
import { Button, Modal } from "./Modal";

// URL server resmi Proxius (hosted). GANTI ke domain resmimu saat sudah siap.
// Di mode "Official" URL ini terkunci — user tak bisa mengubahnya.
export const OFFICIAL_SERVER_URL = "https://sync.proxius.app";

export function TeamDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const user = useTeam((s) => s.user);
  const t = useT();
  return (
    <Modal open={open} title={t("teamSyncTitle")} onClose={onClose} wide>
      {!user ? <ConnectForm /> : <Connected onClose={onClose} />}
    </Modal>
  );
}

function ConnectForm() {
  const { baseUrl, setBaseUrl, login, register } = useTeam();
  const t = useT();
  const [serverMode, setServerMode] = useState<"official" | "selfhost">(
    baseUrl === OFFICIAL_SERVER_URL ? "official" : "selfhost",
  );
  const [customUrl, setCustomUrl] = useState(
    baseUrl === OFFICIAL_SERVER_URL ? "" : baseUrl,
  );
  const [mode, setMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem("proxius-last-email") ?? "";
    } catch {
      return "";
    }
  });
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const emailValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
  const pwValid = password.length >= (mode === "register" ? 8 : 1);
  const canSubmit = emailValid && pwValid && !busy;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setErr(null);
    try {
      if (mode === "login") await login(email.trim(), password);
      else await register(email.trim(), password);
      try {
        localStorage.setItem("proxius-last-email", email.trim());
      } catch {
        /* localStorage tak tersedia — abaikan */
      }
      toast.success(t("signedIn"));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  function pickServerMode(m: "official" | "selfhost") {
    setServerMode(m);
    setErr(null);
    if (m === "official") setBaseUrl(OFFICIAL_SERVER_URL);
    else setBaseUrl(customUrl || "http://localhost:8080");
  }

  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-brand";

  return (
    <form onSubmit={submit} className="space-y-4">
      {/* Pilih server: resmi (terkunci) atau self-hosted (bebas) */}
      <div>
        <div className="flex rounded-md border border-neutral-800 p-0.5 text-sm">
          {(["official", "selfhost"] as const).map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => pickServerMode(m)}
              className={`flex-1 rounded py-1.5 ${
                serverMode === m ? "bg-brand text-white" : "text-neutral-400 hover:text-neutral-200"
              }`}
            >
              {m === "official" ? t("serverOfficial") : t("serverSelfHost")}
            </button>
          ))}
        </div>

        {serverMode === "official" ? (
          <div className="mt-2">
            <input
              value={OFFICIAL_SERVER_URL}
              readOnly
              disabled
              className={`${field} cursor-not-allowed font-mono text-neutral-400`}
            />
          </div>
        ) : (
          <div className="mt-2">
            <input
              value={customUrl}
              onChange={(e) => {
                setCustomUrl(e.target.value);
                setBaseUrl(e.target.value);
              }}
              placeholder="http://localhost:8080"
              className={`${field} font-mono`}
            />
            <details className="mt-1.5">
              <summary className="cursor-pointer text-xs text-brand-fg hover:underline">
                {t("selfHostGuide")}
              </summary>
              <div className="mt-2 space-y-1.5 rounded-md border border-neutral-800 bg-neutral-950/60 p-2.5 text-xs text-neutral-400">
                <p>{t("selfHostIntro")}</p>
                <pre className="overflow-x-auto rounded bg-neutral-900 px-2 py-1.5 font-mono text-[11px] text-neutral-200">
                  git clone https://github.com/your-org/proxius{"\n"}cd proxius{"\n"}docker compose up -d
                </pre>
                <p>{t("selfHostThen")}</p>
              </div>
            </details>
          </div>
        )}
      </div>

      <div className="flex rounded-md border border-neutral-800 p-0.5 text-sm">
        {(["login", "register"] as const).map((m) => (
          <button
            key={m}
            type="button"
            onClick={() => setMode(m)}
            className={`flex-1 rounded py-1.5 ${
              mode === m ? "bg-brand text-white" : "text-neutral-400 hover:text-neutral-200"
            }`}
          >
            {m === "login" ? t("loginTab") : t("registerTab")}
          </button>
        ))}
      </div>

      <label className="block">
        <span className="mb-1 block text-xs text-neutral-500">Email</span>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          autoFocus
          autoComplete="email"
          required
          placeholder="you@company.com"
          className={`${field} ${email && !emailValid ? "border-rose-800" : ""}`}
        />
        {email && !emailValid && (
          <span className="mt-1 block text-[11px] text-rose-400">{t("emailInvalid")}</span>
        )}
      </label>
      <label className="block">
        <span className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          Password
          <button
            type="button"
            onClick={() => setShowPw((v) => !v)}
            className="text-neutral-500 hover:text-neutral-300"
          >
            {showPw ? t("hideWord") : t("showWord")}
          </button>
        </span>
        <input
          type={showPw ? "text" : "password"}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          autoComplete={mode === "register" ? "new-password" : "current-password"}
          required
          minLength={mode === "register" ? 8 : undefined}
          placeholder={mode === "register" ? t("min8Chars") : ""}
          className={field}
        />
        {mode === "register" && password.length > 0 && password.length < 8 && (
          <span className="mt-1 block text-[11px] text-neutral-500">
            {t("passwordTooShort", { n: 8 - password.length })}
          </span>
        )}
      </label>

      {err && (
        <p className="rounded bg-rose-500/10 px-2 py-1.5 text-xs text-rose-400">{err}</p>
      )}

      <div className="flex items-center justify-between">
        <span className="text-xs text-neutral-600">
          {mode === "register" ? t("firstUserAdmin") : " "}
        </span>
        <Button type="submit" variant="primary" disabled={!canSubmit}>
          {busy ? "…" : mode === "login" ? t("loginTab") : t("registerTab")}
        </Button>
      </div>
    </form>
  );
}

const SYNC_COLOR: Record<string, string> = {
  offline: "text-neutral-400",
  syncing: "text-amber-400",
  synced: "text-emerald-400",
  error: "text-rose-400",
};

function Connected({ onClose }: { onClose: () => void }) {
  const team = useTeam();
  const t = useT();
  const [memberEmail, setMemberEmail] = useState("");
  const [addingMember, setAddingMember] = useState(false);
  const active = team.workspaces.find((w) => w.id === team.workspaceId);
  const SYNC_LABEL: Record<string, string> = {
    offline: t("syncOffline"),
    syncing: t("syncingShort"),
    synced: t("syncSynced"),
    error: t("syncErrorLabel"),
  };

  async function doAddMember() {
    if (!memberEmail.trim()) return;
    setAddingMember(true);
    try {
      await team.addMember(memberEmail.trim(), "editor");
      toast.success(t("memberAdded", { email: memberEmail.trim() }));
      setMemberEmail("");
    } catch (e) {
      toast.error(t("genericFailed", { msg: e instanceof Error ? e.message : String(e) }));
    } finally {
      setAddingMember(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between text-sm">
        <div>
          <div className="text-neutral-300">{team.user!.email}</div>
          <div className="text-xs text-neutral-600">{team.baseUrl}</div>
        </div>
        <Button variant="ghost" onClick={team.logout}>
          {t("logoutBtn")}
        </Button>
      </div>

      <div>
        <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500">
          {t("workspacesLabel")}
        </div>
        <ul className="space-y-1">
          {team.workspaces.map((w) => (
            <li key={w.id}>
              <button
                onClick={() => team.openWorkspace(w.id)}
                className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-sm ${
                  w.id === team.workspaceId
                    ? "bg-neutral-800"
                    : "hover:bg-neutral-800/50"
                }`}
              >
                <span>{w.name}</span>
                <span className="text-xs text-neutral-500">
                  {w.role} · v{w.version}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </div>

      {active && (
        <>
          <div className="rounded-lg border border-neutral-800 p-3">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-sm">
                <b>{active.name}</b>
              </span>
              <span className={`flex items-center gap-1.5 text-xs ${SYNC_COLOR[team.sync]}`}>
                <span
                  className={`h-1.5 w-1.5 rounded-full ${
                    team.sync === "synced"
                      ? "bg-emerald-400"
                      : team.sync === "syncing"
                        ? "bg-amber-400 animate-pulse"
                        : team.sync === "error"
                          ? "bg-rose-400"
                          : "bg-neutral-500"
                  }`}
                />
                {SYNC_LABEL[team.sync]}
              </span>
            </div>
            <p className="mb-2.5 text-xs text-neutral-500">{t("autoSaveDesc")}</p>
            <div className="flex gap-2">
              <Button onClick={() => team.push(true)} disabled={team.sync === "syncing"}>
                {t("pushNow")}
              </Button>
              <Button onClick={() => team.pull(true)} disabled={team.sync === "syncing"}>
                {t("pullNow")}
              </Button>
            </div>
          </div>

          <div className="rounded-lg border border-neutral-800 p-3">
            <div className="mb-1.5 text-xs uppercase tracking-wide text-neutral-500">
              {t("inviteMember")}
            </div>
            <div className="flex gap-2">
              <input
                value={memberEmail}
                onChange={(e) => setMemberEmail(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && doAddMember()}
                placeholder={t("memberEmailPh")}
                className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm outline-none focus:border-brand"
              />
              <Button onClick={doAddMember} disabled={addingMember || !memberEmail.trim()}>
                {addingMember ? "…" : t("addEditor")}
              </Button>
            </div>
          </div>
        </>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );
}
