import { useEffect, type ReactNode } from "react";
import { useT } from "../store/i18n";

interface Props {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
}

export function Modal({ open, title, onClose, children, footer, wide }: Props) {
  const t = useT();
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className={`flex max-h-[85vh] w-full ${
          wide ? "max-w-2xl" : "max-w-md"
        } flex-col rounded-xl border border-neutral-800 bg-neutral-900 shadow-2xl`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-neutral-800 px-4 py-3">
          <h2 className="text-sm font-semibold">{title}</h2>
          <button
            onClick={onClose}
            className="text-neutral-500 hover:text-neutral-200"
            aria-label={t("close")}
            title={t("close")}
          >
            ×
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-auto p-4">{children}</div>
        {footer && (
          <div className="flex justify-end gap-2 border-t border-neutral-800 px-4 py-3">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

export function Button({
  children,
  onClick,
  variant = "default",
  type = "button",
  disabled,
}: {
  children: ReactNode;
  onClick?: () => void;
  variant?: "default" | "primary" | "ghost" | "danger";
  type?: "button" | "submit";
  disabled?: boolean;
}) {
  const styles = {
    default: "border border-neutral-700 bg-neutral-800 hover:bg-neutral-700",
    primary: "bg-brand text-white hover:opacity-90",
    ghost: "text-neutral-400 hover:text-neutral-100",
    danger: "border border-rose-900 bg-rose-950 text-rose-300 hover:bg-rose-900",
  }[variant];
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      className={`rounded-md px-3 py-1.5 text-sm transition disabled:opacity-50 ${styles}`}
    >
      {children}
    </button>
  );
}
