import { useTeam } from "../store/team";

const COLORS = [
  "bg-emerald-600",
  "bg-sky-600",
  "bg-violet-600",
  "bg-amber-600",
  "bg-rose-600",
  "bg-teal-600",
];

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return (parts[0]?.[0] ?? "?").concat(parts[1]?.[0] ?? "").toUpperCase();
}

export function Presence() {
  const presence = useTeam((s) => s.presence);
  const status = useTeam((s) => s.status);
  if (status !== "connected" || presence.length === 0) return null;

  return (
    <div className="flex items-center -space-x-1.5">
      {presence.map((u, i) => (
        <div
          key={u.id}
          title={`${u.name} (${u.email})`}
          className={`flex h-6 w-6 items-center justify-center rounded-full border border-neutral-950 text-[10px] font-bold text-white ${
            COLORS[i % COLORS.length]
          }`}
        >
          {initials(u.name)}
        </div>
      ))}
    </div>
  );
}
