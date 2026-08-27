import { useEffect } from "react";

export interface MenuItem {
  label?: string;
  shortcut?: string;
  onClick?: () => void;
  danger?: boolean;
  sep?: boolean;
  disabled?: boolean;
}

/** Menu klik-kanan sederhana pada posisi kursor. */
export function ContextMenu({
  x,
  y,
  items,
  onClose,
}: {
  x: number;
  y: number;
  items: MenuItem[];
  onClose: () => void;
}) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", esc);
    return () => window.removeEventListener("keydown", esc);
  }, [onClose]);

  // Jaga agar tak keluar dari layar (perkiraan kasar).
  const left = Math.min(x, window.innerWidth - 200);
  const top = Math.min(y, window.innerHeight - items.length * 34 - 12);

  return (
    <div
      className="fixed inset-0 z-50"
      onClick={onClose}
      onContextMenu={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div
        className="absolute min-w-44 rounded-md border border-neutral-700 bg-neutral-900 py-1 text-sm shadow-xl"
        style={{ left, top }}
        onClick={(e) => e.stopPropagation()}
      >
        {items.map((it, i) =>
          it.sep ? (
            <div key={i} className="my-1 border-t border-neutral-800" />
          ) : (
            <button
              key={i}
              disabled={it.disabled}
              onClick={() => {
                it.onClick?.();
                onClose();
              }}
              className={`flex w-full items-center justify-between gap-6 px-3 py-1.5 text-left hover:bg-neutral-800 disabled:opacity-40 ${
                it.danger ? "text-rose-400" : "text-neutral-200"
              }`}
            >
              <span>{it.label}</span>
              {it.shortcut && <span className="text-xs text-neutral-600">{it.shortcut}</span>}
            </button>
          ),
        )}
      </div>
    </div>
  );
}
