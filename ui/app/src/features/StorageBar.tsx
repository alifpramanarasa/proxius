import { useState } from "react";
import { isTauri } from "../lib/api";
import { useStorage, folderName } from "../store/storage";
import { useT } from "../store/i18n";
import { IconFolder } from "./icons";
import { SyncDialog } from "./SyncDialog";

export function StorageBar() {
  const { dir, status, gitRemote, gitStatus } = useStorage();
  const [open, setOpen] = useState(false);
  const t = useT();
  if (!isTauri()) return null; // browser: storage lokal saja

  const folderDot =
    status === "syncing" ? "bg-amber-400 animate-pulse" : status === "error" ? "bg-rose-400" : "bg-emerald-400";
  const gitDot =
    gitStatus === "syncing"
      ? "bg-amber-400 animate-pulse"
      : gitStatus === "error"
        ? "bg-rose-400"
        : "bg-emerald-400";

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title={dir ? dir : t("saveSyncHint")}
        className="flex w-full items-center gap-2 border-b border-neutral-800 px-2.5 py-2 text-left text-xs hover:bg-neutral-900"
      >
        <IconFolder className="shrink-0 text-neutral-500" />
        {dir ? (
          <>
            <span className="flex-1 truncate text-neutral-300">{folderName(dir)}</span>
            {gitRemote ? (
              <span className="flex items-center gap-1 text-neutral-500" title={t("gitSyncTitle")}>
                <span className={`h-1.5 w-1.5 rounded-full ${gitDot}`} />
                git
              </span>
            ) : (
              <span className={`h-1.5 w-1.5 rounded-full ${folderDot}`} title={status} />
            )}
          </>
        ) : (
          <>
            <span className="flex-1 text-neutral-400">{t("saveSync")}</span>
            <span className="shrink-0 text-neutral-600">›</span>
          </>
        )}
      </button>
      <SyncDialog open={open} onClose={() => setOpen(false)} />
    </>
  );
}
