import type { RequestSettings } from "../lib/types";
import { useT } from "../store/i18n";

/** Pengaturan per-request: timeout, redirect, verifikasi SSL. */
export function SettingsPanel({
  settings,
  onChange,
}: {
  settings?: RequestSettings;
  onChange: (s: RequestSettings) => void;
}) {
  const s = settings ?? {};
  const set = (patch: Partial<RequestSettings>) => onChange({ ...s, ...patch });
  const followRedirects = s.followRedirects ?? true;
  const verifySsl = s.verifySsl ?? true;
  const t = useT();

  return (
    <div className="max-w-xl space-y-4">
      <Row title={t("timeoutTitle")} desc={t("timeoutDesc")}>
        <input
          type="number"
          min={0}
          value={s.timeoutMs ?? ""}
          onChange={(e) =>
            set({ timeoutMs: e.target.value ? Number(e.target.value) : undefined })
          }
          placeholder="60000"
          className="w-28 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 text-sm outline-none focus:border-brand"
        />
      </Row>

      <Row title={t("followRedirectsTitle")} desc={t("followRedirectsDesc")}>
        <Toggle on={followRedirects} onChange={(v) => set({ followRedirects: v })} />
      </Row>

      <Row title={t("verifySslTitle")} desc={t("verifySslDesc")}>
        <Toggle on={verifySsl} onChange={(v) => set({ verifySsl: v })} />
      </Row>

      <Row title={t("proxyTitle")} desc={t("proxyDesc")}>
        <input
          value={s.proxyUrl ?? ""}
          onChange={(e) => set({ proxyUrl: e.target.value || undefined })}
          placeholder="http://127.0.0.1:8080"
          className="w-56 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-sm outline-none focus:border-brand"
        />
      </Row>

      <Row title={t("mtlsTitle")} desc={t("mtlsDesc")}>
        <div className="flex flex-col gap-1">
          <input
            value={s.clientCertPath ?? ""}
            onChange={(e) => set({ clientCertPath: e.target.value || undefined })}
            placeholder="cert.pem"
            className="w-56 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs outline-none focus:border-brand"
          />
          <input
            value={s.clientKeyPath ?? ""}
            onChange={(e) => set({ clientKeyPath: e.target.value || undefined })}
            placeholder="key.pem"
            className="w-56 rounded-md border border-neutral-800 bg-neutral-900 px-2 py-1 font-mono text-xs outline-none focus:border-brand"
          />
        </div>
      </Row>
    </div>
  );
}

function Row({
  title,
  desc,
  children,
}: {
  title: string;
  desc: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex items-start justify-between gap-4">
      <div>
        <div className="text-sm text-neutral-200">{title}</div>
        <div className="text-xs text-neutral-600">{desc}</div>
      </div>
      <div className="shrink-0 pt-0.5">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-5 w-9 rounded-full transition ${on ? "bg-brand" : "bg-neutral-700"}`}
    >
      <span
        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition ${
          on ? "left-[18px]" : "left-0.5"
        }`}
      />
    </button>
  );
}
