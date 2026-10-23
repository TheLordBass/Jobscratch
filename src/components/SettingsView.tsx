"use client";

import { ArrowUpRight } from "lucide-react";
import { useEffect, useState, type ChangeEvent } from "react";
import { PROFILE_TABS, SectionTabs } from "@/components/Nav";
import { useSources } from "@/components/useSources";
import { COUNTRIES, downloadBlob } from "@/lib/format";
import { parseBoardToken } from "@/lib/sources/boards";
import { exportLocalData, isBackup, replaceLocalData, useDismissed, useHydrated, useSettings } from "@/lib/store";
import { clearServerData, replaceServerData, useSyncState } from "@/lib/sync";
import type { CompanyBoards, SourceCategory } from "@/lib/types";

const CATEGORY_LABEL: Record<SourceCategory, string> = {
  free: "Free job boards (no key needed)",
  company: "Company career pages",
  keyed: "Job board APIs (free key)",
  aggregator: "Google for Jobs: covers LinkedIn, Indeed, Glassdoor (API key)",
};

const BOARD_HELP: Record<keyof CompanyBoards, { name: string; example: string }> = {
  greenhouse: { name: "Greenhouse", example: "https://boards.greenhouse.io/stripe  or  stripe" },
  lever: { name: "Lever", example: "https://jobs.lever.co/plaid  or  plaid" },
  ashby: { name: "Ashby", example: "https://jobs.ashbyhq.com/ramp  or  ramp" },
};


function BoardEditor({ provider, values, onChange }: { provider: keyof CompanyBoards; values: string[]; onChange: (values: string[]) => void }) {
  const [text, setText] = useState(values.join("\n"));
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const help = BOARD_HELP[provider];
  return (
    <div>
      <label htmlFor={`board-${provider}`} className="label">
        {help.name} companies (one per line)
      </label>
      <textarea
        id={`board-${provider}`}
        className="input min-h-24 font-mono text-xs"
        placeholder={help.example}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => onChange(lines)}
      />
      {lines.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {lines.map((line) => {
            const token = parseBoardToken(provider, line);
            return (
              <span
                key={line}
                className={`chip ${token ? "" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}
                title={line}
              >
                {token ?? `not recognised: ${line.slice(0, 30)}`}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}

/** Jobs marked "Not interested", with a way to bring them back. */
function HiddenJobs() {
  const { dismissed, restoreEntry, restoreAll, count } = useDismissed();
  const entries = Object.entries(dismissed).sort(([, a], [, b]) => b.at.localeCompare(a.at));
  return (
    <section className="card space-y-3 p-4">
      <div>
        <h2 className="font-semibold">Hidden jobs</h2>
        <p className="muted text-sm">
          {count === 0
            ? "Jobs you mark Not interested are hidden from searches and JobSpy results. You haven't hidden any."
            : `${count} ${count === 1 ? "job is" : "jobs are"} hidden from searches and JobSpy results, along with any copies on other sites.`}
        </p>
      </div>
      {count > 0 && (
        <>
          <details>
            <summary className="link cursor-pointer text-sm">See the list</summary>
            <ul className="mt-2 max-h-72 divide-y divide-zinc-100 overflow-y-auto rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {entries.map(([id, entry]) => (
                <li key={id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">
                    {entry.title} <span className="muted">· {entry.company}</span>
                  </span>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => restoreEntry(id)}>
                    Show again
                  </button>
                </li>
              ))}
            </ul>
          </details>
          <button
            type="button"
            className="btn btn-secondary"
            onClick={() => {
              if (window.confirm(`Show all ${count} hidden ${count === 1 ? "job" : "jobs"} again?`)) restoreAll();
            }}
          >
            Show them all again
          </button>
        </>
      )}
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1e6) return `${Math.max(1, Math.round(bytes / 1e3))} KB`;
  if (bytes < 1e9) return `${(bytes / 1e6).toFixed(1)} MB`;
  return `${(bytes / 1e9).toFixed(1)} GB`;
}

interface Space {
  usage: number;
  quota: number;
  persisted: boolean;
}

async function readSpace(): Promise<Space | null> {
  try {
    const [{ usage = 0, quota = 0 }, persisted] = await Promise.all([navigator.storage.estimate(), navigator.storage.persisted()]);
    return { usage, quota, persisted };
  } catch {
    return null; // Not supported here: nothing to show.
  }
}

/** How much room this browser gives the app, and whether it may clear the data to free up disk space. */
function StorageSpace() {
  const [space, setSpace] = useState<Space | null>(null);
  const [refused, setRefused] = useState(false);

  useEffect(() => {
    let active = true;
    void readSpace().then((result) => active && setSpace(result));
    return () => {
      active = false;
    };
  }, []);

  if (!space || !space.quota) return null;
  return (
    <div className="space-y-1.5 rounded-lg bg-zinc-50 px-3 py-2.5 text-sm dark:bg-zinc-900">
      <p>
        Using <strong>{formatBytes(space.usage)}</strong> of the {formatBytes(space.quota)} this browser allows the app.
      </p>
      {space.persisted ? (
        <p className="muted text-xs">Kept safe: the browser won’t clear it to free up disk space.</p>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="muted min-w-0 flex-1 text-xs">
            {refused
              ? "The browser didn’t agree (some only do once you use the site often, or add it to your home screen). Keep a backup, or turn on server storage."
              : "If the disk gets very full, the browser may clear sites’ data to make room. Ask it to keep yours:"}
          </p>
          {!refused && (
            <button
              type="button"
              className="btn btn-secondary btn-sm"
              onClick={async () => {
                const granted = await navigator.storage.persist().catch(() => false);
                setRefused(!granted);
                setSpace(await readSpace());
              }}
            >
              Keep my data safe
            </button>
          )}
        </div>
      )}
    </div>
  );
}

export function SettingsView() {
  const [settings, setSettings] = useSettings();
  const sources = useSources();
  const hydrated = useHydrated();
  const sync = useSyncState();
  const onServer = sync.status === "saved" || sync.status === "saving" || sync.status === "error";

  function toggleSource(id: (typeof settings.disabledSources)[number], enabled: boolean) {
    const disabled = new Set(settings.disabledSources);
    if (enabled) disabled.delete(id);
    else disabled.add(id);
    setSettings({ ...settings, disabledSources: [...disabled] });
  }

  async function exportData() {
    const data = await exportLocalData();
    const stamp = new Date().toISOString().slice(0, 10);
    downloadBlob(new Blob([JSON.stringify(data, null, 2)], { type: "application/json" }), `jobscratch-backup-${stamp}.json`);
  }

  async function importData(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const data = JSON.parse(await file.text()) as Record<string, unknown>;
      if (!isBackup(data)) throw new Error("No JobScratch data in that file");
      if (!window.confirm("Replace your current CV, saved jobs, groups and settings with this backup?")) return;
      await replaceLocalData(data);
      // With server storage on, the server gets exactly the backup too, or it would merge the old data back.
      await replaceServerData();
      window.location.reload();
    } catch (error) {
      window.alert(`Couldn't restore: ${(error as Error).message}`);
    }
  }

  const categories = (["free", "company", "keyed", "aggregator"] as const).map((category) => ({
    category,
    items: sources?.sources.filter((s) => s.category === category) ?? [],
  }));

  return (
    <div className="space-y-6">
      <SectionTabs tabs={PROFILE_TABS} />
      <div>
        <h1 className="page-title">Settings</h1>
        <p className="page-subtitle">Choose where to search. API keys go in the server’s <code>.env.local</code> (see README).</p>
      </div>

      <section className="card space-y-3 p-4">
        <h2 className="font-semibold">Search defaults</h2>
        <div className="flex flex-wrap items-end gap-4">
          <div>
            <label htmlFor="country" className="label">
              Country
            </label>
            <select
              id="country"
              className="input"
              value={settings.country}
              onChange={(e) => setSettings({ ...settings, country: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </div>
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={settings.includeRemoteAnywhere}
              onChange={(e) => setSettings({ ...settings, includeRemoteAnywhere: e.target.checked })}
            />
            Include remote jobs open to my country even when they don’t mention my city
          </label>
        </div>
      </section>

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Job sources</h2>
          <p className="muted text-sm">
            JobScratch only uses official APIs and public job feeds. LinkedIn, Indeed and Glassdoor listings come
            through the Google for Jobs sources below, or you can import any job with the bookmarklet.
          </p>
        </div>
        {!sources && <p className="muted text-sm">Loading…</p>}
        {categories.map(({ category, items }) =>
          items.length === 0 ? null : (
            <div key={category}>
              <h3 className="muted mb-2 text-xs font-semibold tracking-wide uppercase">{CATEGORY_LABEL[category]}</h3>
              <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
                {items.map((source) => {
                  const enabled = !settings.disabledSources.includes(source.id);
                  const companies =
                    source.category === "company" ? settings.companyBoards[source.id as keyof CompanyBoards].length : 0;
                  return (
                    <li key={source.id} className="flex flex-col gap-2 p-3 sm:flex-row sm:items-center">
                      <label className="flex flex-1 items-start gap-3">
                        <input
                          type="checkbox"
                          className="mt-1"
                          checked={enabled}
                          onChange={(e) => toggleSource(source.id, e.target.checked)}
                        />
                        <span>
                          <span className="text-sm font-medium">
                            <a href={source.homepage} target="_blank" rel="noopener noreferrer" className="hover:underline">
                              {source.name}
                            </a>
                          </span>
                          <span className="muted block text-xs">{source.description}</span>
                        </span>
                      </label>
                      <div className="text-xs sm:text-right">
                        {source.category === "company" ? (
                          <span className="chip">
                            {companies ? `${companies} ${companies === 1 ? "company" : "companies"}` : "Add companies below"}
                          </span>
                        ) : source.configured ? (
                          <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                            {source.envKeys.length ? "Key set" : "Ready"}
                          </span>
                        ) : (
                          <span className="block space-y-0.5">
                            <span className="chip bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                              Needs {source.envKeys.join(" + ")}
                            </span>
                            {source.signupUrl && (
                              <a href={source.signupUrl} target="_blank" rel="noopener noreferrer" className="link block">
                                Get a key <ArrowUpRight size={12} className="inline" aria-hidden />
                              </a>
                            )}
                          </span>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </div>
          ),
        )}
      </section>

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">Company career pages</h2>
          <p className="muted text-sm">
            Follow companies you’d love to work for. Paste their careers page link; most tech companies use one of these
            three systems (look at the address of their jobs page). Their jobs are included in every search.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-3">
          {(Object.keys(BOARD_HELP) as Array<keyof CompanyBoards>).map((provider) => (
            <BoardEditor
              // Remount once saved settings are loaded so the text box starts with them.
              key={`${provider}-${hydrated}`}
              provider={provider}
              values={settings.companyBoards[provider]}
              onChange={(values) =>
                setSettings({ ...settings, companyBoards: { ...settings.companyBoards, [provider]: values } })
              }
            />
          ))}
        </div>
      </section>

      <section className="card space-y-2 p-4">
        <h2 className="font-semibold">AI CV tailoring</h2>
        {sources ? (
          sources.aiConfigured ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">Ready. Claude is connected.</p>
          ) : (
            <p className="text-sm text-amber-800 dark:text-amber-200">
              Not set up. Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code> and restart. Get a key at{" "}
              <a className="link" href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">
                console.anthropic.com
              </a>
              .
            </p>
          )
        ) : (
          <p className="muted text-sm">Checking…</p>
        )}
        <p className="muted text-xs">
          Your CV and the job description are sent to the Anthropic API only when you click a tailoring button.
        </p>
      </section>

      <HiddenJobs />

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">Your data</h2>
          <p className="muted text-sm">
            {onServer
              ? "Your CV, jobs and settings are saved on the server as well as in this browser, so they're the same on every device you sign in from."
              : sync.status === "off" && sync.reason === "needs-password"
                ? "Server storage is connected, but it stays off until you set APP_PASSWORD, so your CV isn't open to anyone with the link."
                : sync.status === "off" && sync.reason === "unreachable"
                  ? `Server storage is connected but isn't working right now${sync.detail ? ` (${sync.detail})` : ""}, so for now everything is only in this browser. If it says Upstash rejected the request, reconnect the database to this project in Vercel and redeploy.`
                  : "No database found in this deployment, so everything is stored in this browser only. To use your jobs on any device, add a Redis database to this project in Vercel (Storage tab: Upstash for Redis or Redis, see the README). If you've just added it, redeploy (Deployments → the latest one → Redeploy): the app only sees it in deployments made after that."}
          </p>
          {sync.status === "error" && (
            <p className="mt-1 text-sm text-amber-700 dark:text-amber-300">
              Some changes aren’t on the server yet ({sync.message}). They’re kept here and retried.
            </p>
          )}
        </div>
        <StorageSpace />
        <div className="flex flex-wrap gap-2">
          <button type="button" className="btn btn-secondary" onClick={exportData}>
            Download backup
          </button>
          <label className="btn btn-secondary">
            Restore backup
            <input type="file" accept="application/json,.json" className="sr-only" onChange={importData} />
          </label>
          <button
            type="button"
            className="btn btn-danger ml-auto"
            onClick={async () => {
              const where = onServer ? "from this browser and the server" : "from this browser";
              if (!window.confirm(`Delete your CV, saved jobs, groups and settings ${where}?`)) return;
              try {
                await clearServerData();
              } catch (error) {
                window.alert((error as Error).message);
                return;
              }
              await replaceLocalData();
              window.location.reload();
            }}
          >
            Delete all data
          </button>
        </div>
      </section>
    </div>
  );
}
