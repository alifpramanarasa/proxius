import { useWorkspace } from "../store/workspace";
import { useT } from "../store/i18n";

export function TabBar() {
  const { tabs, activeTabId, setActiveTab, closeTab, newTab } = useWorkspace();
  const t = useT();
  return (
    <div className="flex items-center gap-1 overflow-x-auto border-b border-neutral-800 bg-neutral-950 px-2">
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            className={`group flex cursor-pointer items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm ${
              active
                ? "border-brand text-neutral-100"
                : "border-transparent text-neutral-500 hover:text-neutral-300"
            }`}
          >
            <span className={`method-${tab.request.method} font-mono text-[10px] font-bold`}>
              {tab.request.method}
            </span>
            <span className="max-w-[160px] truncate">
              {tab.request.name || t("untitled")}
            </span>
            {tab.dirty && <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />}
            <button
              onClick={(e) => {
                e.stopPropagation();
                closeTab(tab.id);
              }}
              title={t("closeTabTitle")}
              aria-label={t("closeTabTitle")}
              className="text-neutral-600 opacity-0 hover:text-rose-400 group-hover:opacity-100"
            >
              ×
            </button>
          </div>
        );
      })}
      <button
        onClick={() => newTab()}
        title={t("newTabTitle")}
        aria-label={t("newTabTitle")}
        className="px-2 py-1 text-neutral-500 hover:text-brand-fg"
      >
        ＋
      </button>
    </div>
  );
}
