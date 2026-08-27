import { useI18n } from "../store/i18n";
import { LANGS, type Lang } from "../lib/i18n/locales";

export function LanguageSelect() {
  const { lang, setLang } = useI18n();
  return (
    <select
      value={lang}
      onChange={(e) => setLang(e.target.value as Lang)}
      title="Language"
      className="rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-xs outline-none hover:bg-neutral-800"
    >
      {LANGS.map((l) => (
        <option key={l.code} value={l.code}>
          {l.label}
        </option>
      ))}
    </select>
  );
}
