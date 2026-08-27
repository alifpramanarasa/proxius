import { useEffect, useState } from "react";
import { useTeam } from "../store/team";
import { useT } from "../store/i18n";

/** Panel komentar untuk sebuah request (mode tim). */
export function CommentsPanel({ requestId }: { requestId: string }) {
  const { status, comments, loadComments, postComment } = useTeam();
  const t = useT();
  const [body, setBody] = useState("");
  const list = comments[requestId] ?? [];

  useEffect(() => {
    if (status === "connected") loadComments(requestId);
  }, [requestId, status, loadComments]);

  if (status !== "connected") {
    return <p className="p-3 text-xs text-neutral-600">{t("commentsHint")}</p>;
  }

  function submit(e: React.FormEvent) {
    e.preventDefault();
    if (body.trim()) {
      postComment(requestId, body.trim());
      setBody("");
    }
  }

  return (
    <div className="flex h-full flex-col">
      <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
        {list.length === 0 && (
          <p className="text-xs text-neutral-600">{t("noComments")}</p>
        )}
        {list.map((c) => (
          <div key={c.id} className="text-sm">
            <div className="flex items-baseline gap-2">
              <span className="font-medium text-brand-fg">{c.authorName}</span>
              <span className="text-[10px] text-neutral-600">
                {new Date(c.createdAt).toLocaleString()}
              </span>
            </div>
            <p className="text-neutral-300">{c.body}</p>
          </div>
        ))}
      </div>
      <form onSubmit={submit} className="flex gap-2 border-t border-neutral-800 p-2">
        <input
          value={body}
          onChange={(e) => setBody(e.target.value)}
          placeholder={t("commentPlaceholder")}
          className="flex-1 rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1 text-sm outline-none focus:border-brand"
        />
        <button
          type="submit"
          className="rounded-md bg-brand px-3 text-sm font-semibold text-white hover:opacity-90"
        >
          {t("send")}
        </button>
      </form>
    </div>
  );
}
