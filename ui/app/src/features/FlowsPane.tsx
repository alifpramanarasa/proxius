import { useState } from "react";
import { useWorkspace } from "../store/workspace";
import { promptDialog } from "../store/ui";
import { useT } from "../store/i18n";
import { Button } from "./Modal";
import { FlowDialog } from "./FlowDialog";

/** Daftar flow e2e di sidebar. */
export function FlowsPane() {
  const { flows, addFlow, deleteFlow } = useWorkspace();
  const [openId, setOpenId] = useState<string | null>(null);
  const openFlow = flows.find((f) => f.id === openId);
  const t = useT();

  return (
    <div className="py-1">
      <div className="mb-1 px-2">
        <Button
          variant="ghost"
          onClick={async () => {
            const name = await promptDialog({ title: t("newFlowTitle"), defaultValue: "New Flow" });
            if (name) setOpenId(addFlow(name));
          }}
        >
          ＋ {t("flowWord")}
        </Button>
      </div>

      {flows.length === 0 && (
        <p className="px-3 py-2 text-xs text-neutral-600">{t("flowsEmpty")}</p>
      )}

      <ul>
        {flows.map((f) => (
          <li
            key={f.id}
            className="group flex items-center gap-2 px-2 py-1 text-sm hover:bg-neutral-800/50"
          >
            <span className="flex-1 cursor-pointer truncate" onClick={() => setOpenId(f.id)}>
              {f.name}
            </span>
            <span className="text-xs text-neutral-600">{f.steps.length}</span>
            <button
              onClick={() => deleteFlow(f.id)}
              className="text-neutral-600 opacity-0 hover:text-rose-400 group-hover:opacity-100"
            >
              ×
            </button>
          </li>
        ))}
      </ul>

      {openFlow && (
        <FlowDialog flow={openFlow} open={true} onClose={() => setOpenId(null)} />
      )}
    </div>
  );
}
