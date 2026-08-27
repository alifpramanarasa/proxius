import { create } from "zustand";
import { persist } from "zustand/middleware";
import { locales, type Lang } from "../lib/i18n/locales";

interface I18nState {
  lang: Lang;
  setLang: (l: Lang) => void;
}

export const useI18n = create<I18nState>()(
  persist(
    (set) => ({
      lang: "en",
      setLang: (lang) => set({ lang }),
    }),
    { name: "proxius-lang" },
  ),
);

/** Terjemahkan key; params menggantikan {name}. Fallback ke English lalu key. */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  let s = locales[lang]?.[key] ?? locales.en[key] ?? key;
  if (params)
    for (const [k, v] of Object.entries(params)) s = s.replace(`{${k}}`, String(v));
  return s;
}

/** Hook: kembalikan fungsi t() yang re-render saat bahasa berganti. */
export function useT() {
  const lang = useI18n((s) => s.lang);
  return (key: string, params?: Record<string, string | number>) =>
    translate(lang, key, params);
}

/** Terjemahan untuk dipakai di luar komponen React (store/helper). */
export const tr = (key: string, params?: Record<string, string | number>) =>
  translate(useI18n.getState().lang, key, params);
