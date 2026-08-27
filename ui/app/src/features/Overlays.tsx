import { useState } from "react";
import { useUI } from "../store/ui";
import { Button, Modal } from "./Modal";

/** Notifikasi toast (kanan-bawah). */
export function Toaster() {
  const { toasts, dismissToast } = useUI();
  const color = {
    info: "border-neutral-700 bg-neutral-800 text-neutral-100",
    success: "border-emerald-800 bg-emerald-950 text-emerald-200",
    error: "border-rose-900 bg-rose-950 text-rose-200",
  };
  const icon = { info: "ℹ", success: "✓", error: "✕" };
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-80 flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          onClick={() => dismissToast(t.id)}
          className={`pointer-events-auto flex cursor-pointer items-start gap-2 rounded-md border px-3 py-2 text-sm shadow-lg ${color[t.kind]}`}
        >
          <span className="mt-0.5 shrink-0 font-bold">{icon[t.kind]}</span>
          <span className="flex-1">{t.message}</span>
        </div>
      ))}
    </div>
  );
}

/** Dialog confirm/prompt in-app (pengganti window.confirm/prompt). */
export function DialogHost() {
  const dialogs = useUI((s) => s.dialogs);
  const dialog = dialogs[0];
  if (!dialog) return null;
  return <DialogView key={dialog.id} />;
}

function DialogView() {
  const dialog = useUI((s) => s.dialogs[0]);
  const resolveDialog = useUI((s) => s.resolveDialog);
  const [value, setValue] = useState(dialog?.defaultValue ?? "");
  if (!dialog) return null;

  const isPrompt = dialog.kind === "prompt";
  const cancel = () => resolveDialog(dialog.id, isPrompt ? null : false);
  const ok = () => resolveDialog(dialog.id, isPrompt ? value : true);

  return (
    <Modal
      open
      title={dialog.title}
      onClose={cancel}
      footer={
        <>
          <Button variant="ghost" onClick={cancel}>
            Batal
          </Button>
          <Button
            variant={dialog.danger ? "danger" : "primary"}
            onClick={ok}
            disabled={isPrompt && !value.trim()}
          >
            {dialog.confirmLabel ?? (isPrompt ? "OK" : "Ya")}
          </Button>
        </>
      }
    >
      {dialog.message && (
        <p className="mb-3 text-sm text-neutral-300">{dialog.message}</p>
      )}
      {isPrompt && (
        <input
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && value.trim()) ok();
          }}
          placeholder={dialog.placeholder}
          className="w-full rounded-md border border-neutral-800 bg-neutral-950 px-3 py-2 text-sm outline-none focus:border-brand"
        />
      )}
    </Modal>
  );
}
