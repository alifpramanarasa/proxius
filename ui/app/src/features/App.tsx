import { useEffect, useState } from "react";
import { useWorkspace } from "../store/workspace";
import { promptDialog, confirmDialog } from "../store/ui";
import { useTeam } from "../store/team";
import { useStorage, folderName } from "../store/storage";
import { useT } from "../store/i18n";
import { Sidebar } from "./Sidebar";
import { TabBar } from "./TabBar";
import { RequestEditor } from "./RequestEditor";
import { EnvironmentDialog } from "./EnvironmentDialog";
import { ImportDialog } from "./ImportDialog";
import { TeamDialog } from "./TeamDialog";
import { Presence } from "./Presence";
import { AgentPanel } from "./AgentPanel";
import { SettingsDialog } from "./SettingsDialog";
import { RealtimeDialog } from "./RealtimeDialog";
import { GrpcDialog } from "./GrpcDialog";
import { SyncDialog } from "./SyncDialog";
import { CommandPalette, type CommandAction } from "./CommandPalette";
import { IconSettings, IconSun, IconMoon } from "./icons";
import { Toaster, DialogHost } from "./Overlays";

export function App() {
  const [importOpen, setImportOpen] = useState(false);
  const [envOpen, setEnvOpen] = useState(false);
  const [teamOpen, setTeamOpen] = useState(false);
  const [agentOpen, setAgentOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [realtimeOpen, setRealtimeOpen] = useState(false);
  const [grpcOpen, setGrpcOpen] = useState(false);
  const [syncOpen, setSyncOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const { tabs, newTab } = useWorkspace();
  const t = useT();
  const restoreTeam = useTeam((s) => s.restore);
  const restoreStorage = useStorage((s) => s.restore);

  useEffect(() => {
    if (tabs.length === 0) newTab();
  }, [tabs.length, newTab]);

  // Pulihkan folder workspace lalu sesi tim dari yang tersimpan.
  useEffect(() => {
    restoreStorage();
    restoreTeam();
  }, [restoreStorage, restoreTeam]);

  // Ctrl/Cmd+K → toggle command palette.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && (e.key === "k" || e.key === "K")) {
        e.preventDefault();
        setPaletteOpen((o) => !o);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const paletteActions: CommandAction[] = [
    { label: t("newRequest"), run: () => newTab() },
    { label: t("openAssistant"), run: () => setAgentOpen(true) },
    { label: t("importTitle"), run: () => setImportOpen(true) },
    { label: t("teamSyncTitle"), run: () => setSyncOpen(true) },
    { label: t("environment"), run: () => setEnvOpen(true) },
    { label: t("grpcBtn"), run: () => setGrpcOpen(true) },
    { label: t("realtimeBtn"), run: () => setRealtimeOpen(true) },
    { label: t("toggleTheme"), run: () => useWorkspace.getState().toggleTheme() },
    { label: t("settings"), run: () => setSettingsOpen(true) },
  ];

  return (
    <div className="flex h-full flex-col">
      <TopBar
        onOpenTeam={() => setTeamOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        onOpenEnvs={() => setEnvOpen(true)}
        onOpenRealtime={() => setRealtimeOpen(true)}
        onOpenGrpc={() => setGrpcOpen(true)}
        onOpenSync={() => setSyncOpen(true)}
        onOpenAgent={() => setAgentOpen(true)}
      />
      <div className="flex min-h-0 flex-1">
        <Sidebar onImport={() => setImportOpen(true)} />
        <main className="flex min-w-0 flex-1 flex-col">
          <TabBar />
          <RequestEditor />
        </main>
      </div>
      <ImportDialog open={importOpen} onClose={() => setImportOpen(false)} />
      <EnvironmentDialog open={envOpen} onClose={() => setEnvOpen(false)} />
      <TeamDialog open={teamOpen} onClose={() => setTeamOpen(false)} />
      <AgentPanel open={agentOpen} onClose={() => setAgentOpen(false)} />
      <SettingsDialog
        open={settingsOpen}
        onClose={() => setSettingsOpen(false)}
        onOpenAgent={() => setAgentOpen(true)}
      />
      <RealtimeDialog open={realtimeOpen} onClose={() => setRealtimeOpen(false)} />
      <GrpcDialog open={grpcOpen} onClose={() => setGrpcOpen(false)} />
      <SyncDialog open={syncOpen} onClose={() => setSyncOpen(false)} />
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        actions={paletteActions}
      />
      <Toaster />
      <DialogHost />
    </div>
  );
}

function TopBar({
  onOpenTeam,
  onOpenSettings,
  onOpenEnvs,
  onOpenRealtime,
  onOpenGrpc,
  onOpenSync,
  onOpenAgent,
}: {
  onOpenTeam: () => void;
  onOpenSettings: () => void;
  onOpenEnvs: () => void;
  onOpenRealtime: () => void;
  onOpenGrpc: () => void;
  onOpenSync: () => void;
  onOpenAgent: () => void;
}) {
  const { environments, activeEnvId, setActiveEnv } = useWorkspace();
  const t = useT();

  return (
    <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-2">
      <div className="flex items-center gap-2">
        <span className="text-lg font-bold tracking-tight">
          Prox<span className="text-brand-fg">ius</span>
        </span>
        <ProjectSwitcher />
      </div>
      <div className="flex items-center gap-2">
        <Presence />
        {/* Konfigurasi workspace: environment */}
        <div className="flex items-center">
          <select
            value={activeEnvId ?? ""}
            onChange={(e) => setActiveEnv(e.target.value || null)}
            title={t("environment")}
            className="rounded-l-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none hover:bg-neutral-800"
          >
            <option value="">{t("noEnvironment")}</option>
            {environments.map((e) => (
              <option key={e.id} value={e.id}>
                {e.name}
              </option>
            ))}
          </select>
          <button
            onClick={onOpenEnvs}
            title={t("manageEnvironment")}
            className="rounded-r-md border border-l-0 border-neutral-800 px-1.5 py-1 font-mono text-xs hover:bg-neutral-800"
          >
            {"{x}"}
          </button>
        </div>

        <div className="mx-0.5 h-5 w-px bg-neutral-800" />

        {/* Sinkron: Team (server) + Folder/Git, satu pintu */}
        <SyncMenu onTeam={onOpenTeam} onGit={onOpenSync} />
        {/* Protokol lain: gRPC + WebSocket/SSE */}
        <ProtocolsMenu onGrpc={onOpenGrpc} onRealtime={onOpenRealtime} />
        {/* AI assistant — buka panel chat langsung */}
        <button
          onClick={onOpenAgent}
          title={t("openAssistant")}
          className="rounded-md border border-brand/50 bg-brand/10 px-2.5 py-1 text-xs font-medium text-brand-fg hover:bg-brand/20"
        >
          {t("agentBtn")}
        </button>
        {/* Tema terang/gelap */}
        <ThemeToggle />
        {/* Settings */}
        <button
          onClick={onOpenSettings}
          title={t("settings")}
          aria-label={t("settings")}
          className="rounded-md border border-neutral-800 px-2 py-1.5 text-neutral-300 hover:bg-neutral-800"
        >
          <IconSettings />
        </button>
      </div>
    </div>
  );
}

function ProjectSwitcher() {
  const t = useT();
  const [open, setOpen] = useState(false);
  const projects = useWorkspace((s) => s.projects);
  const activeProjectId = useWorkspace((s) => s.activeProjectId);
  const switchProject = useWorkspace((s) => s.switchProject);
  const addProject = useWorkspace((s) => s.addProject);
  const renameProject = useWorkspace((s) => s.renameProject);
  const deleteProject = useWorkspace((s) => s.deleteProject);
  const active = projects.find((p) => p.id === activeProjectId);

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex items-center gap-1 rounded-md border border-neutral-800 px-2 py-1 text-xs text-neutral-300 hover:bg-neutral-800"
        title={t("project")}
      >
        <span className="max-w-[140px] truncate">{active?.name ?? "—"}</span>
        <span className="text-neutral-500">▾</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-40" onClick={() => setOpen(false)} />
          <div className="absolute left-0 z-50 mt-1 w-56 rounded-md border border-neutral-800 bg-neutral-900 py-1 shadow-xl">
            <div className="px-2 py-1 text-[10px] uppercase tracking-wide text-neutral-500">
              {t("projects")}
            </div>
            {projects.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  switchProject(p.id);
                  setOpen(false);
                }}
                className={`flex w-full items-center gap-2 px-2 py-1 text-left text-sm hover:bg-neutral-800 ${
                  p.id === activeProjectId ? "text-neutral-100" : "text-neutral-400"
                }`}
              >
                <span className="w-3 text-brand-fg">{p.id === activeProjectId ? "•" : ""}</span>
                <span className="flex-1 truncate">{p.name}</span>
              </button>
            ))}
            <div className="my-1 border-t border-neutral-800" />
            <button
              onClick={async () => {
                setOpen(false);
                const name = await promptDialog({
                  title: t("newProject"),
                  defaultValue: "New Project",
                  placeholder: t("projectNamePh"),
                });
                if (name) addProject(name);
              }}
              className="w-full px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800"
            >
              ＋ {t("newProject")}
            </button>
            <button
              onClick={async () => {
                setOpen(false);
                const name = await promptDialog({
                  title: t("renameProject"),
                  defaultValue: active?.name ?? "",
                  placeholder: t("projectNamePh"),
                });
                if (name && active) renameProject(active.id, name);
              }}
              className="w-full px-2 py-1 text-left text-sm text-neutral-300 hover:bg-neutral-800"
            >
              {t("renameProject")}
            </button>
            {projects.length > 1 && (
              <button
                onClick={async () => {
                  setOpen(false);
                  if (!active) return;
                  const ok = await confirmDialog({
                    title: t("deleteProjectTitle"),
                    message: t("deleteProjectMsg", { name: active.name }),
                    confirmLabel: t("delete"),
                    danger: true,
                  });
                  if (ok) deleteProject(active.id);
                }}
                className="w-full px-2 py-1 text-left text-sm text-rose-300 hover:bg-rose-950/40"
              >
                {t("deleteProjectTitle")}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function ThemeToggle() {
  const t = useT();
  const theme = useWorkspace((s) => s.theme);
  const toggleTheme = useWorkspace((s) => s.toggleTheme);
  return (
    <button
      onClick={toggleTheme}
      title={t("toggleTheme")}
      aria-label={t("toggleTheme")}
      className="rounded-md border border-neutral-800 px-2 py-1.5 text-neutral-300 hover:bg-neutral-800"
    >
      {theme === "dark" ? <IconSun /> : <IconMoon />}
    </button>
  );
}

function MenuItem({
  label,
  hint,
  onClick,
}: {
  label: string;
  hint?: string;
  onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="flex w-full items-center justify-between gap-4 px-3 py-2 text-left hover:bg-neutral-800"
    >
      <span className="text-neutral-200">{label}</span>
      {hint && <span className="max-w-[140px] truncate text-neutral-500">{hint}</span>}
    </button>
  );
}

/** Satu pintu untuk sinkron: Team (server) + Folder/Git. */
function SyncMenu({ onTeam, onGit }: { onTeam: () => void; onGit: () => void }) {
  const [open, setOpen] = useState(false);
  const user = useTeam((s) => s.user);
  const teamSync = useTeam((s) => s.sync);
  const dir = useStorage((s) => s.dir);
  const gitStatus = useStorage((s) => s.gitStatus);
  const storStatus = useStorage((s) => s.status);
  const t = useT();

  const active = !!user || !!dir;
  const syncing = teamSync === "syncing" || gitStatus === "syncing" || storStatus === "syncing";
  const error = teamSync === "error" || gitStatus === "error";
  const dot = error
    ? "bg-rose-400"
    : syncing
      ? "bg-amber-400 animate-pulse"
      : active
        ? "bg-emerald-400"
        : "bg-neutral-600";

  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };

  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        title={t("syncTitle")}
        className="flex items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 py-1 text-xs hover:bg-neutral-800"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${dot}`} />
        <span className="text-neutral-200">{t("syncWord")}</span>
        <span className="text-neutral-600">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-56 rounded-md border border-neutral-800 bg-neutral-900 py-1 text-xs shadow-xl">
          <MenuItem
            label={t("syncTeamServer")}
            hint={user ? user.email : t("signInTeam")}
            onClick={() => pick(onTeam)}
          />
          <MenuItem
            label={t("syncFolderGit")}
            hint={dir ? folderName(dir) : t("saveSync")}
            onClick={() => pick(onGit)}
          />
        </div>
      )}
    </div>
  );
}

/** Protokol non-HTTP: gRPC + WebSocket/SSE. */
function ProtocolsMenu({
  onGrpc,
  onRealtime,
}: {
  onGrpc: () => void;
  onRealtime: () => void;
}) {
  const [open, setOpen] = useState(false);
  const t = useT();
  const pick = (fn: () => void) => {
    setOpen(false);
    fn();
  };
  return (
    <div className="relative">
      <button
        onClick={() => setOpen((o) => !o)}
        onBlur={() => setTimeout(() => setOpen(false), 160)}
        title={t("protocolsLabel")}
        className="flex items-center gap-1.5 rounded-md border border-neutral-800 px-2.5 py-1 text-xs text-neutral-200 hover:bg-neutral-800"
      >
        <span>{t("protocolsLabel")}</span>
        <span className="text-neutral-600">▾</span>
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 min-w-44 rounded-md border border-neutral-800 bg-neutral-900 py-1 text-xs shadow-xl">
          <MenuItem label="gRPC" onClick={() => pick(onGrpc)} />
          <MenuItem label={t("realtimeBtn")} onClick={() => pick(onRealtime)} />
        </div>
      )}
    </div>
  );
}
