import { create } from "zustand";

export type ToastKind = "info" | "success" | "error";

export interface Toast {
  id: string;
  kind: ToastKind;
  message: string;
}

export interface DialogRequest {
  id: string;
  kind: "confirm" | "prompt";
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
  danger?: boolean;
  resolve: (value: string | boolean | null) => void;
}

interface UIState {
  toasts: Toast[];
  dialogs: DialogRequest[];
  pushToast: (kind: ToastKind, message: string) => void;
  dismissToast: (id: string) => void;
  confirm: (opts: ConfirmOpts) => Promise<boolean>;
  prompt: (opts: PromptOpts) => Promise<string | null>;
  resolveDialog: (id: string, value: string | boolean | null) => void;
}

interface ConfirmOpts {
  title: string;
  message?: string;
  confirmLabel?: string;
  danger?: boolean;
}
interface PromptOpts {
  title: string;
  message?: string;
  defaultValue?: string;
  placeholder?: string;
  confirmLabel?: string;
}

let counter = 0;
const nid = () => `ui-${Date.now().toString(36)}-${(counter++).toString(36)}`;

export const useUI = create<UIState>((set, get) => ({
  toasts: [],
  dialogs: [],

  pushToast: (kind, message) => {
    const id = nid();
    set((s) => ({ toasts: [...s.toasts, { id, kind, message }] }));
    setTimeout(() => get().dismissToast(id), kind === "error" ? 6000 : 3500);
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),

  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      const id = nid();
      set((s) => ({
        dialogs: [
          ...s.dialogs,
          { id, kind: "confirm", ...opts, resolve: (v) => resolve(v === true) },
        ],
      }));
    }),

  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      const id = nid();
      set((s) => ({
        dialogs: [
          ...s.dialogs,
          {
            id,
            kind: "prompt",
            ...opts,
            resolve: (v) => resolve(typeof v === "string" ? v : null),
          },
        ],
      }));
    }),

  resolveDialog: (id, value) => {
    const d = get().dialogs.find((x) => x.id === id);
    d?.resolve(value);
    set((s) => ({ dialogs: s.dialogs.filter((x) => x.id !== id) }));
  },
}));

// Helper modul (dipakai di luar komponen React).
export const toast = {
  info: (m: string) => useUI.getState().pushToast("info", m),
  success: (m: string) => useUI.getState().pushToast("success", m),
  error: (m: string) => useUI.getState().pushToast("error", m),
};
export const confirmDialog = (opts: ConfirmOpts) => useUI.getState().confirm(opts);
export const promptDialog = (opts: PromptOpts) => useUI.getState().prompt(opts);
