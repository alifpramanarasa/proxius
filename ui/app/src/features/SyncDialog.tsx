import { useState } from "react";
import { isTauri } from "../lib/api";
import { useStorage, folderName } from "../store/storage";
import { toast } from "../store/ui";
import { useT } from "../store/i18n";
import { Button, Modal } from "./Modal";

export function SyncDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const s = useStorage();
  const t = useT();

  return (
    <Modal open={open} title={t("syncTitle")} onClose={onClose} wide>
      {!isTauri() ? (
        <p className="text-sm text-neutral-400">{t("syncDesktopOnly")}</p>
      ) : (
        <div className="space-y-5">
          <IdentitySection />
          {!s.dir ? <NotConnected onDone={onClose} /> : <Connected onClose={onClose} />}
        </div>
      )}
    </Modal>
  );
}

function IdentitySection() {
  const { identity, setIdentity } = useStorage();
  const t = useT();
  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 text-sm outline-none focus:border-brand";
  return (
    <section className="rounded-lg border border-neutral-800 p-3">
      <h3 className="mb-1 text-sm font-medium">{t("gitIdentity")}</h3>
      <p className="mb-2 text-xs text-neutral-500">{t("gitIdentityDesc")}</p>
      <div className="grid grid-cols-2 gap-2">
        <input
          value={identity.name}
          onChange={(e) => setIdentity({ ...identity, name: e.target.value })}
          placeholder={t("namePh")}
          className={field}
        />
        <input
          value={identity.email}
          onChange={(e) => setIdentity({ ...identity, email: e.target.value })}
          placeholder={t("emailExamplePh")}
          className={`${field} font-mono`}
        />
      </div>
    </section>
  );
}

function NotConnected({ onDone }: { onDone: () => void }) {
  const { chooseFolder, cloneGit, busy } = useStorage();
  const t = useT();
  const [joinUrl, setJoinUrl] = useState("");

  return (
    <div className="space-y-5">
      {/* Simpan ke folder */}
      <section>
        <h3 className="mb-1 text-sm font-medium">{t("saveToFolder")}</h3>
        <p className="mb-2 text-xs text-neutral-500">{t("saveToFolderDesc")}</p>
        <Button
          variant="primary"
          onClick={async () => {
            await chooseFolder();
            onDone();
          }}
        >
          {t("chooseFolder")}
        </Button>
      </section>

      <div className="flex items-center gap-3 text-xs text-neutral-600">
        <div className="h-px flex-1 bg-neutral-800" /> {t("orWord")}{" "}
        <div className="h-px flex-1 bg-neutral-800" />
      </div>

      {/* Gabung tim via link */}
      <section>
        <h3 className="mb-1 text-sm font-medium">{t("joinTeamWorkspace")}</h3>
        <p className="mb-2 text-xs text-neutral-500">{t("joinTeamDesc")}</p>
        <div className="flex gap-2">
          <input
            value={joinUrl}
            onChange={(e) => setJoinUrl(e.target.value)}
            placeholder="https://github.com/team/workspace.git"
            className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand"
          />
          <Button
            onClick={async () => {
              await cloneGit(joinUrl);
              if (useStorage.getState().dir) onDone();
            }}
            disabled={busy || !joinUrl.trim()}
          >
            {busy ? "…" : t("joinBtn")}
          </Button>
        </div>
      </section>
    </div>
  );
}

function Connected({ onClose }: { onClose: () => void }) {
  const s = useStorage();
  const t = useT();
  const [url, setUrl] = useState("");

  return (
    <div className="space-y-5">
      <section className="flex items-center justify-between rounded-lg border border-neutral-800 p-3">
        <div>
          <div className="text-sm">
            <b>{folderName(s.dir!)}</b>
          </div>
          <div className="max-w-[22rem] truncate text-xs text-neutral-600">{s.dir}</div>
        </div>
        <Button variant="ghost" onClick={s.detach}>
          {t("detachBtn")}
        </Button>
      </section>

      {!s.gitRemote ? (
        <section>
          <h3 className="mb-1 text-sm font-medium">{t("shareToTeamGit")}</h3>
          <p className="mb-2 text-xs text-neutral-500">{t("shareGitDesc")}</p>
          <div className="flex gap-2">
            <input
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://github.com/team/workspace.git"
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-xs outline-none focus:border-brand"
            />
            <Button
              variant="primary"
              onClick={() => s.connectGit(url)}
              disabled={s.busy || !url.trim()}
            >
              {s.busy ? "…" : t("connectUpload")}
            </Button>
          </div>
        </section>
      ) : (
        <section className="rounded-lg border border-emerald-900/60 bg-emerald-950/30 p-3">
          <div className="mb-2 flex items-center gap-2 text-sm text-emerald-400">
            <span
              className={`h-2 w-2 rounded-full ${
                s.gitStatus === "syncing"
                  ? "bg-amber-400 animate-pulse"
                  : s.gitStatus === "error"
                    ? "bg-rose-400"
                    : "bg-emerald-400"
              }`}
            />
            {s.gitStatus === "syncing"
              ? t("syncingShort")
              : s.gitStatus === "error"
                ? t("syncErrorLabel")
                : t("autoSyncedGit")}
          </div>
          <p className="mb-1 text-xs text-neutral-500">{t("shareLinkToJoin")}</p>
          <div className="flex gap-2">
            <input
              readOnly
              value={s.gitRemote}
              className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2.5 py-1.5 font-mono text-xs text-neutral-300 outline-none"
            />
            <Button
              onClick={() => {
                navigator.clipboard?.writeText(s.gitRemote!);
                toast.success(t("linkCopied"));
              }}
            >
              {t("copy")}
            </Button>
            <Button onClick={() => s.syncNow()} disabled={s.gitStatus === "syncing"}>
              {t("syncWord")}
            </Button>
          </div>
        </section>
      )}

      <div className="flex justify-end">
        <Button variant="ghost" onClick={onClose}>
          {t("close")}
        </Button>
      </div>
    </div>
  );
}
