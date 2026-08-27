import { useEffect, useMemo, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { useT } from "../store/i18n";
import { toast } from "../store/ui";
import { isTauri, mockStart, mockStatus, mockStop } from "../lib/api";
import { mockRoutes, type MockRoute } from "../lib/mock";
import { Button } from "./Modal";

const PORT = 9090;

export function MockPane() {
  const t = useT();
  const { collections } = useWorkspace();
  const [port, setPort] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const routes = useMemo<MockRoute[]>(
    () => collections.flatMap((c) => mockRoutes(c)),
    [collections],
  );

  useEffect(() => {
    if (!isTauri()) return;
    mockStatus()
      .then(setPort)
      .catch(() => {});
  }, []);

  async function toggle() {
    setBusy(true);
    try {
      if (port != null) {
        await mockStop();
        setPort(null);
      } else {
        if (routes.length === 0) {
          toast.error(t("mockNoExamples"));
          return;
        }
        const p = await mockStart(routes, PORT);
        setPort(p);
        toast.success(t("mockRunningAt").replace("{url}", `http://127.0.0.1:${p}`));
      }
    } catch (e) {
      toast.error(String(e));
    } finally {
      setBusy(false);
    }
  }

  if (!isTauri()) {
    return (
      <div className="px-3 py-4 text-xs text-neutral-500">
        {t("mockDesktopOnly")}{" "}
        <code className="rounded bg-neutral-800 px-1 text-neutral-300">
          proxius mock routes.mock.json --port {PORT}
        </code>
      </div>
    );
  }

  const base = `http://127.0.0.1:${port ?? PORT}`;

  return (
    <div className="px-2">
      <div className="mb-2 flex items-center gap-2">
        <Button variant={port != null ? "ghost" : "primary"} onClick={toggle} disabled={busy}>
          {port != null ? t("mockStopBtn") : t("mockStartBtn")}
        </Button>
        {port != null && (
          <button
            onClick={() => {
              navigator.clipboard?.writeText(base);
              toast.success(t("copied"));
            }}
            className="flex items-center gap-1.5 text-[11px] text-neutral-400 hover:text-neutral-200"
            title={base}
          >
            <span className="h-2 w-2 rounded-full bg-emerald-500" />
            {t("mockRunningAt").replace("{url}", base)}
          </button>
        )}
      </div>

      {routes.length === 0 ? (
        <p className="px-1 py-2 text-xs text-neutral-600">{t("mockNoExamples")}</p>
      ) : (
        <ul className="space-y-0.5">
          {routes.map((r, i) => (
            <li key={i} className="flex items-center gap-2 rounded px-1 py-1 text-xs hover:bg-neutral-800/50">
              <span className={`method-${r.method} w-12 shrink-0 font-mono text-[10px] font-bold`}>
                {r.method}
              </span>
              <span className="truncate text-neutral-300">{r.path}</span>
              <span className="ml-auto shrink-0 font-mono text-[10px] text-neutral-500">{r.status}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
