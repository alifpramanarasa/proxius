import { useT } from "../store/i18n";
import { LanguageSelect } from "./LanguageSelect";
import { AiSettings } from "./AiSettings";
import { IntegrationSettings } from "./IntegrationSettings";
import { McpServerInfo } from "./McpServerInfo";
import { Button, Modal } from "./Modal";

export function SettingsDialog({
  open,
  onClose,
  onOpenAgent,
}: {
  open: boolean;
  onClose: () => void;
  onOpenAgent: () => void;
}) {
  const t = useT();
  return (
    <Modal open={open} title={t("settings")} onClose={onClose} wide>
      <div className="space-y-5">
        <section className="flex items-center justify-between rounded-lg border border-neutral-800 p-3">
          <span className="text-sm">{t("language")}</span>
          <LanguageSelect />
        </section>

        <section className="rounded-lg border border-neutral-800 p-3">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-sm font-medium">{t("aiAssistant")}</span>
            <Button
              onClick={() => {
                onClose();
                onOpenAgent();
              }}
            >
              {t("openAssistant")}
            </Button>
          </div>
          <AiSettings />
        </section>

        <section className="rounded-lg border border-neutral-800 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium">{t("integration")}</span>
          </div>
          <IntegrationSettings />
        </section>

        <section className="rounded-lg border border-neutral-800 p-3">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium">{t("mcpServer")}</span>
          </div>
          <McpServerInfo />
        </section>
      </div>
    </Modal>
  );
}
