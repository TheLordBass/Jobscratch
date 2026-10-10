"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState, type FormEvent } from "react";
import { JobCard } from "@/components/JobCard";
import { KeywordInput, addTerms } from "@/components/KeywordInput";
import { COUNTRIES } from "@/lib/format";
import { newId, useGroups, useHydrated, useSavedJobs, useSettings, type SearchGroup } from "@/lib/store";
import { SOURCE_IDS, type Job, type SearchRequest, type SearchResponse, type SourceResult } from "@/lib/types";

const PAGE_SIZE = 30;

const EXAMPLE_GROUPS: Array<Omit<SearchGroup, "id">> = [
  {
    name: "Data roles",
    keywords: ["data analyst", "BI analyst", "analytics engineer", "data scientist"],
    exclude: ["principal", "director"],
    location: "",
    remoteOnly: false,
  },
  {
    name: "Product roles",
    keywords: ["product manager", "product owner", "associate product manager"],
    exclude: [],
    location: "",
    remoteOnly: false,
  },
];

type SearchState =
  | { status: "idle" }
  | { status: "loading"; label: string }
  | { status: "done"; label: string; response: SearchResponse }
  | { status: "error"; message: string };

interface Query {
  keywords: string[];
  exclude: string[];
  location: string;
  remoteOnly: boolean;
  postedWithinDays: number;
}

function SourceSummary({ sources }: { sources: SourceResult[] }) {
  const [open, setOpen] = useState(false);
  const ok = sources.filter((s) => s.status === "ok");
  const failed = sources.filter((s) => s.status === "error");
  const skipped = sources.filter((s) => s.status === "skipped");
  return (
    <div className="text-xs">
      <div className="flex flex-wrap items-center gap-1.5">
        {ok.map((s) => (
          <span key={s.source} className="chip" title={s.ms ? `${s.ms} ms` : undefined}>
            {s.name} <strong className="font-semibold">{s.count}</strong>
          </span>
        ))}
        {failed.map((s) => (
          <span key={s.source} className="chip bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300" title={s.message}>
            {s.name} failed
          </span>
        ))}
        {skipped.length > 0 && (
          <button type="button" className="link cursor-pointer" onClick={() => setOpen(!open)}>
            {skipped.length} skipped {open ? "▴" : "▾"}
          </button>
        )}
      </div>
      {(open || failed.length > 0) && (
        <ul className="muted mt-2 space-y-0.5">
          {failed.map((s) => (
            <li key={s.source}>
              <strong>{s.name}</strong>: {s.message}
            </li>
          ))}
          {open &&
            skipped.map((s) => (
              <li key={s.source}>
                <strong>{s.name}</strong>: {s.message}
              </li>
            ))}
          {open && (
            <li>
              <Link href="/settings" className="link">
                Set up more sources in Settings
              </Link>
            </li>
          )}
        </ul>
      )}
    </div>
  );
}

export function SearchView() {
  const router = useRouter();
  const hydrated = useHydrated();
  const [settings, setSettings] = useSettings();
  const [groups, setGroups] = useGroups();
  const { saved, saveJob, removeJob } = useSavedJobs();

  const [keywords, setKeywords] = useState<string[]>([]);
  const [keywordDraft, setKeywordDraft] = useState("");
  const [exclude, setExclude] = useState<string[]>([]);
  const [excludeDraft, setExcludeDraft] = useState("");
  const [location, setLocation] = useState("");
  const [remoteOnly, setRemoteOnly] = useState(false);
  const [postedWithinDays, setPostedWithinDays] = useState(0);
  const [showMore, setShowMore] = useState(false);
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const [groupName, setGroupName] = useState("");

  const [search, setSearch] = useState<SearchState>({ status: "idle" });
  const [sort, setSort] = useState<"relevance" | "newest">("relevance");
  const [filter, setFilter] = useState("");
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [expanded, setExpanded] = useState<string | null>(null);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  const currentQuery = (): Query => ({
    keywords: addTerms(keywords, keywordDraft),
    exclude: addTerms(exclude, excludeDraft),
    location: location.trim(),
    remoteOnly,
    postedWithinDays,
  });

  async function run(query: Query, label: string) {
    if (query.keywords.length === 0) {
      setSearch({ status: "error", message: "Add at least one keyword or job title." });
      return;
    }
    setSearch({ status: "loading", label });
    setVisible(PAGE_SIZE);
    setExpanded(null);
    setFilter("");
    const body: SearchRequest = {
      keywords: query.keywords,
      exclude: query.exclude,
      location: query.location || undefined,
      remoteOnly: query.remoteOnly,
      postedWithinDays: query.postedWithinDays || undefined,
      country: settings.country,
      includeRemoteAnywhere: settings.includeRemoteAnywhere,
      companyBoards: settings.companyBoards,
      sources: SOURCE_IDS.filter((id) => !settings.disabledSources.includes(id)),
    };
    try {
      const response = await fetch("/api/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? `Search failed (HTTP ${response.status})`);
      setSearch({ status: "done", label, response: data as SearchResponse });
    } catch (error) {
      setSearch({ status: "error", message: (error as Error).message });
    }
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    const query = currentQuery();
    setKeywords(query.keywords);
    setKeywordDraft("");
    setExclude(query.exclude);
    setExcludeDraft("");
    void run(query, activeGroup ? activeGroup.name : query.keywords.join(", "));
  }

  function loadGroup(group: SearchGroup, andRun: boolean) {
    setActiveGroupId(group.id);
    setKeywords(group.keywords);
    setExclude(group.exclude);
    setLocation(group.location);
    setRemoteOnly(group.remoteOnly);
    setKeywordDraft("");
    setExcludeDraft("");
    if (group.exclude.length) setShowMore(true);
    if (andRun) void run({ ...group, postedWithinDays }, group.name);
  }

  function saveGroup() {
    const query = currentQuery();
    if (query.keywords.length === 0) return;
    if (activeGroup) {
      setGroups(groups.map((g) => (g.id === activeGroup.id ? { ...g, ...query, id: g.id, name: g.name } : g)));
      return;
    }
    const name = groupName.trim() || query.keywords.slice(0, 2).join(" / ");
    const group: SearchGroup = { id: newId(), name, ...query };
    setGroups([...groups, group]);
    setActiveGroupId(group.id);
    setGroupName("");
  }

  function tailor(job: Job) {
    saveJob(job);
    router.push(`/tailor?job=${encodeURIComponent(job.id)}`);
  }

  const results = useMemo(() => {
    if (search.status !== "done") return [];
    const needle = filter.trim().toLowerCase();
    const jobs = needle
      ? search.response.jobs.filter((job) =>
          `${job.title} ${job.company} ${job.location} ${job.sourceName}`.toLowerCase().includes(needle),
        )
      : search.response.jobs;
    return sort === "newest"
      ? [...jobs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""))
      : jobs;
  }, [search, filter, sort]);

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      <aside className="order-2 space-y-3 lg:order-1">
        <div className="card p-4">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="text-sm font-semibold">Keyword groups</h2>
            {activeGroup && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveGroupId(null)}>
                Clear
              </button>
            )}
          </div>
          {hydrated && groups.length === 0 && (
            <div className="muted space-y-2 text-xs">
              <p>
                Group related job titles, e.g. <em>Data roles</em> = data analyst, BI analyst, analytics engineer. Then
                search them all with one click.
              </p>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => setGroups(EXAMPLE_GROUPS.map((g) => ({ ...g, id: newId() })))}
              >
                Add example groups
              </button>
            </div>
          )}
          <ul className="space-y-1">
            {groups.map((group) => (
              <li
                key={group.id}
                className={`group rounded-lg border px-2.5 py-2 ${group.id === activeGroupId ? "border-indigo-300 bg-indigo-50/60 dark:border-indigo-800 dark:bg-indigo-950/40" : "border-transparent hover:bg-zinc-50 dark:hover:bg-zinc-800/50"}`}
              >
                <button type="button" className="w-full cursor-pointer text-left" onClick={() => loadGroup(group, true)}>
                  <span className="block text-sm font-medium">{group.name}</span>
                  <span className="muted line-clamp-2 block text-xs">{group.keywords.join(", ")}</span>
                </button>
                <div className="mt-1 flex gap-1">
                  <button type="button" className="btn btn-ghost btn-sm px-1.5 py-0.5" onClick={() => loadGroup(group, false)}>
                    Edit
                  </button>
                  <button
                    type="button"
                    className="btn btn-danger btn-sm px-1.5 py-0.5"
                    onClick={() => {
                      if (window.confirm(`Delete the group “${group.name}”?`)) {
                        setGroups(groups.filter((g) => g.id !== group.id));
                        if (activeGroupId === group.id) setActiveGroupId(null);
                      }
                    }}
                  >
                    Delete
                  </button>
                </div>
              </li>
            ))}
          </ul>
          <div className="mt-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
            {activeGroup ? (
              <button type="button" className="btn btn-secondary btn-sm w-full" onClick={saveGroup}>
                Update “{activeGroup.name}”
              </button>
            ) : (
              <div className="flex gap-1.5">
                <input
                  className="input py-1.5 text-xs"
                  placeholder="Group name"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  aria-label="New group name"
                />
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={saveGroup}
                  disabled={keywords.length === 0 && !keywordDraft.trim()}
                  title="Save the current keywords and filters as a group"
                >
                  Save
                </button>
              </div>
            )}
          </div>
        </div>
      </aside>

      <section className="order-1 min-w-0 space-y-4 lg:order-2">
        <form onSubmit={onSubmit} className="card space-y-3 p-4">
          <div className="grid gap-3 md:grid-cols-[1fr_200px]">
            <KeywordInput
              label="Job titles or keywords (any of)"
              values={keywords}
              onChange={setKeywords}
              draft={keywordDraft}
              onDraftChange={setKeywordDraft}
              placeholder="e.g. data analyst, power bi — press Enter to add"
            />
            <div>
              <label htmlFor="location" className="label">
                Location
              </label>
              <input
                id="location"
                className="input"
                placeholder="City, region or blank"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-wrap items-end gap-3">
            <div>
              <label htmlFor="country" className="label">
                Country
              </label>
              <select
                id="country"
                className="input py-1.5"
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
            <div>
              <label htmlFor="posted" className="label">
                Posted
              </label>
              <select
                id="posted"
                className="input py-1.5"
                value={postedWithinDays}
                onChange={(e) => setPostedWithinDays(Number(e.target.value))}
              >
                <option value={0}>Any time</option>
                <option value={1}>Last 24 hours</option>
                <option value={3}>Last 3 days</option>
                <option value={7}>Last week</option>
                <option value={14}>Last 2 weeks</option>
                <option value={30}>Last month</option>
              </select>
            </div>
            <label className="flex items-center gap-2 pb-2 text-sm">
              <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
              Remote only
            </label>
            <button type="button" className="btn btn-ghost btn-sm mb-1" onClick={() => setShowMore(!showMore)}>
              {showMore ? "Fewer options" : "Exclude words…"}
            </button>
            <button type="submit" className="btn btn-primary ml-auto" disabled={search.status === "loading"}>
              {search.status === "loading" ? "Searching…" : "Search jobs"}
            </button>
          </div>
          {showMore && (
            <KeywordInput
              label="Exclude jobs whose title contains"
              values={exclude}
              onChange={setExclude}
              draft={excludeDraft}
              onDraftChange={setExcludeDraft}
              placeholder="e.g. senior, unpaid, internship"
              tone="exclude"
            />
          )}
        </form>

        {search.status === "idle" && (
          <div className="card muted p-8 text-center text-sm">
            <p className="text-base font-medium text-zinc-700 dark:text-zinc-300">Search jobs from many portals at once</p>
            <p className="mt-1">
              Add a few job titles above, or pick a keyword group. Found a job on LinkedIn?{" "}
              <Link href="/import" className="link">
                Import it
              </Link>
              .
            </p>
          </div>
        )}
        {search.status === "loading" && (
          <div className="card muted animate-pulse p-8 text-center text-sm">
            Searching for “{search.label}” across job portals…
          </div>
        )}
        {search.status === "error" && (
          <div className="card border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
            {search.message}
          </div>
        )}
        {search.status === "done" && (
          <>
            <div className="card space-y-3 p-4">
              <p className="text-sm">
                <strong>{search.response.total}</strong> jobs for “{search.label}”
                {search.response.total > search.response.jobs.length && (
                  <span className="muted"> (showing the top {search.response.jobs.length})</span>
                )}
              </p>
              <SourceSummary sources={search.response.sources} />
            </div>
            {search.response.jobs.length > 0 && (
              <div className="flex flex-wrap items-center gap-2">
                <input
                  className="input max-w-xs py-1.5"
                  placeholder="Filter these results…"
                  value={filter}
                  onChange={(e) => {
                    setFilter(e.target.value);
                    setVisible(PAGE_SIZE);
                  }}
                  aria-label="Filter results"
                />
                <select
                  className="input w-auto py-1.5"
                  value={sort}
                  onChange={(e) => setSort(e.target.value as "relevance" | "newest")}
                  aria-label="Sort results"
                >
                  <option value="relevance">Best match</option>
                  <option value="newest">Newest</option>
                </select>
                <span className="muted text-xs">{results.length} shown</span>
              </div>
            )}
            {results.length === 0 && (
              <div className="card muted p-6 text-center text-sm">
                No jobs matched. Try broader keywords, a different location, or turn off “Remote only”.
              </div>
            )}
            <div className="space-y-3">
              {results.slice(0, visible).map((job) => (
                <JobCard
                  key={job.id}
                  job={job}
                  status={saved[job.id]?.status}
                  expanded={expanded === job.id}
                  onToggle={() => setExpanded(expanded === job.id ? null : job.id)}
                  onSave={() => {
                    const entry = saved[job.id];
                    if (!entry) saveJob(job);
                    else if (entry.status === "saved" || window.confirm(`Remove this job? It's marked “${entry.status}”.`)) {
                      removeJob(job.id);
                    }
                  }}
                  onTailor={() => tailor(job)}
                />
              ))}
            </div>
            {results.length > visible && (
              <div className="text-center">
                <button type="button" className="btn btn-secondary" onClick={() => setVisible(visible + PAGE_SIZE)}>
                  Show more ({results.length - visible} left)
                </button>
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
