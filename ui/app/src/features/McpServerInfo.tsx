import { useState } from "react";
import { useT } from "../store/i18n";
import { toast } from "../store/ui";

/** Panduan menyambungkan MCP client (mis. Claude Code) ke server MCP Proxius.
 * Menampilkan perintah siap-salin; path binary bisa disesuaikan user. */
export function McpServerInfo() {
  const t = useT();
  const [bin, setBin] = useState("proxius");
  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-brand";

  const cmd = `claude mcp add proxius -- ${bin} mcp`;
  const json = `{
  "mcpServers": {
    "proxius": {
      "command": "${bin}",
      "args": ["mcp"]
    }
  }
}`;

  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success(t("copied"));
    } catch {
      toast.error(t("clipboardUnavailable"));
    }
  }

  return (
    <div className="space-y-2">
      <p className="text-[11px] text-neutral-500">{t("mcpRunIntro")}</p>

      <label className="block text-xs text-neutral-500">
        {t("binaryPathLabel")}
        <input
          value={bin}
          onChange={(e) => setBin(e.target.value)}
          placeholder="target/release/proxius"
          className={`${field} font-mono`}
        />
      </label>

      <CopyRow label="claude mcp add" value={cmd} onCopy={() => copy(cmd)} />

      <div>
        <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
          <span>.mcp.json</span>
          <button onClick={() => copy(json)} className="hover:text-neutral-200">
            {t("copy")}
          </button>
        </div>
        <pre className="overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px] text-neutral-300">
          {json}
        </pre>
      </div>

      <p className="text-[11px] text-neutral-600">
        {t("toolsLabel")}{" "}
        <span className="text-neutral-400">http_send · assert_request · run_document · list_documents</span>.
      </p>
    </div>
  );
}

function CopyRow({
  label,
  value,
  onCopy,
}: {
  label: string;
  value: string;
  onCopy: () => void;
}) {
  const t = useT();
  return (
    <div>
      <div className="mb-1 flex items-center justify-between text-xs text-neutral-500">
        <span>{label}</span>
        <button onClick={onCopy} className="hover:text-neutral-200">
          {t("copy")}
        </button>
      </div>
      <pre className="overflow-auto rounded-md border border-neutral-800 bg-neutral-950 p-2 font-mono text-[11px] text-neutral-300">
        {value}
      </pre>
    </div>
  );
}
