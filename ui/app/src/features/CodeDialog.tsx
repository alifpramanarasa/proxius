import { useState } from "react";
import type { HttpRequest } from "../lib/types";
import { CODE_LANGS, generateCode, type CodeLang } from "../lib/codegen";
import { useT } from "../store/i18n";
import { toast } from "../store/ui";
import { Button, Modal } from "./Modal";

/** Dialog "Code": tampilkan request sebagai snippet (cURL/fetch/Python) + salin. */
export function CodeDialog({
  req,
  open,
  onClose,
}: {
  req: HttpRequest;
  open: boolean;
  onClose: () => void;
}) {
  const t = useT();
  const [lang, setLang] = useState<CodeLang>("curl");
  const code = generateCode(req, lang);

  function copy() {
    navigator.clipboard?.writeText(code).then(
      () => toast.success(t("copied")),
      () => toast.error(t("copyFailed")),
    );
  }

  return (
    <Modal
      open={open}
      title={t("codeTitle")}
      onClose={onClose}
      wide
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            {t("close")}
          </Button>
          <Button variant="primary" onClick={copy}>
            {t("copy")}
          </Button>
        </>
      }
    >
      <div className="mb-2 flex gap-1">
        {CODE_LANGS.map((l) => (
          <button
            key={l.id}
            onClick={() => setLang(l.id)}
            className={`rounded-md px-2.5 py-1 text-xs ${
              lang === l.id
                ? "bg-brand text-white"
                : "border border-neutral-700 text-neutral-300 hover:bg-neutral-800"
            }`}
          >
            {l.label}
          </button>
        ))}
      </div>
      <pre className="max-h-[55vh] overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-3 font-mono text-xs text-neutral-200">
        {code}
      </pre>
    </Modal>
  );
}
