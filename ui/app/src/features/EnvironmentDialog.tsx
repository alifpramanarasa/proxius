import { useState } from "react";
import { useWorkspace } from "../store/workspace";
import { confirmDialog, promptDialog } from "../store/ui";
import { useT } from "../store/i18n";
import { KeyValueEditor } from "./KeyValueEditor";
import { Button, Modal } from "./Modal";

export function EnvironmentDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const {
    environments,
    addEnvironment,
    updateEnvironment,
    deleteEnvironment,
  } = useWorkspace();
  const t = useT();
  const [selId, setSelId] = useState<string | null>(
    environments[0]?.id ?? null,
  );
  const sel = environments.find((e) => e.id === selId) ?? environments[0];

  return (
    <Modal
      open={open}
      title={t("environmentsTitle")}
      onClose={onClose}
      wide
      footer={<Button variant="primary" onClick={onClose}>{t("doneWord")}</Button>}
    >
      <div className="flex gap-4">
        {/* daftar env */}
        <div className="w-48 shrink-0 border-r border-neutral-800 pr-3">
          <ul className="mb-2 space-y-1">
            {environments.map((e) => (
              <li key={e.id}>
                <button
                  onClick={() => setSelId(e.id)}
                  className={`w-full truncate rounded px-2 py-1 text-left text-sm ${
                    sel?.id === e.id
                      ? "bg-neutral-800 text-neutral-100"
                      : "text-neutral-400 hover:bg-neutral-800/50"
                  }`}
                >
                  {e.name}
                </button>
              </li>
            ))}
            {environments.length === 0 && (
              <li className="px-2 py-1 text-xs text-neutral-600">
                {t("noEnvironments")}
              </li>
            )}
          </ul>
          <Button
            variant="ghost"
            onClick={async () => {
              const name = await promptDialog({
                title: t("newEnvironment"),
                defaultValue: "New Env",
                placeholder: t("envNamePh"),
              });
              if (name) addEnvironment(name);
            }}
          >
            ＋ {t("environmentWord")}
          </Button>
        </div>

        {/* editor variabel */}
        <div className="min-w-0 flex-1">
          {sel ? (
            <>
              <div className="mb-2 flex items-center gap-2">
                <input
                  value={sel.name}
                  onChange={(e) =>
                    updateEnvironment({ ...sel, name: e.target.value })
                  }
                  className="flex-1 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm outline-none"
                />
                <button
                  onClick={async () => {
                    const ok = await confirmDialog({
                      title: t("deleteEnvTitle"),
                      message: t("deleteRequestMsg", { name: sel.name }),
                      confirmLabel: t("delete"),
                      danger: true,
                    });
                    if (ok) deleteEnvironment(sel.id);
                  }}
                  className="rounded-md border border-rose-900 px-2 py-1 text-xs text-rose-300 hover:bg-rose-950"
                >
                  {t("delete")}
                </button>
              </div>
              <p className="mb-1 text-xs text-neutral-500">{t("envVarHint")}</p>
              <KeyValueEditor
                rows={sel.variables}
                onChange={(variables) => updateEnvironment({ ...sel, variables })}
                keyPlaceholder="VAR_NAME"
                valuePlaceholder="value"
                allowSecret
              />
            </>
          ) : (
            <div className="py-8 text-center text-sm text-neutral-600">
              {t("pickOrCreateEnv")}
            </div>
          )}
        </div>
      </div>
    </Modal>
  );
}
