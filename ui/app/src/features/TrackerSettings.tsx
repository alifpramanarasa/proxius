import { useTracker } from "../store/tracker";

/** Pengaturan pelacak isu (Jira / Linear) untuk sync test case.
 * Konfigurasi tiap provider disimpan terpisah. */
export function TrackerSettings() {
  const { config, setProvider, setJira, setLinear } = useTracker();
  const field =
    "w-full rounded-md border border-neutral-800 bg-neutral-950 px-2 py-1.5 text-sm outline-none focus:border-brand";

  return (
    <div className="space-y-2">
      <label className="block text-xs text-neutral-500">
        Provider
        <select
          value={config.provider}
          onChange={(e) => setProvider(e.target.value as typeof config.provider)}
          className={field}
        >
          <option value="jira">Jira</option>
          <option value="linear">Linear</option>
        </select>
      </label>

      {config.provider === "jira" ? (
        <div className="space-y-2">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-500">
              Site URL
              <input
                value={config.jira.site}
                onChange={(e) => setJira({ site: e.target.value })}
                placeholder="https://acme.atlassian.net"
                className={`${field} font-mono`}
              />
            </label>
            <label className="text-xs text-neutral-500">
              Project key
              <input
                value={config.jira.projectKey}
                onChange={(e) => setJira({ projectKey: e.target.value })}
                placeholder="QA"
                className={`${field} font-mono`}
              />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="text-xs text-neutral-500">
              Email
              <input
                value={config.jira.email}
                onChange={(e) => setJira({ email: e.target.value })}
                placeholder="you@acme.com"
                className={`${field} font-mono`}
              />
            </label>
            <label className="text-xs text-neutral-500">
              Issue type
              <input
                value={config.jira.issueType}
                onChange={(e) => setJira({ issueType: e.target.value })}
                placeholder="Task"
                className={field}
              />
            </label>
          </div>
          <label className="block text-xs text-neutral-500">
            API token
            <input
              type="password"
              value={config.jira.apiToken}
              onChange={(e) => setJira({ apiToken: e.target.value })}
              placeholder="dari id.atlassian.com › API tokens"
              className={`${field} font-mono`}
            />
          </label>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="block text-xs text-neutral-500">
            Team ID
            <input
              value={config.linear.teamId}
              onChange={(e) => setLinear({ teamId: e.target.value })}
              placeholder="UUID team (Settings › API)"
              className={`${field} font-mono`}
            />
          </label>
          <label className="block text-xs text-neutral-500">
            API key
            <input
              type="password"
              value={config.linear.apiKey}
              onChange={(e) => setLinear({ apiKey: e.target.value })}
              placeholder="lin_api_…"
              className={`${field} font-mono`}
            />
          </label>
        </div>
      )}

      <p className="text-[11px] text-neutral-600">
        Test case bisa dikirim jadi issue dari tab Tests. Token disimpan lokal.
        Sync jalan tanpa CORS di app desktop (lewat native engine).
      </p>
    </div>
  );
}
