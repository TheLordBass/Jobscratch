"use client";

import { Plus, Search, X } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, type FormEvent } from "react";
import { GettingStarted } from "@/components/GettingStarted";
import { MorningRunNotice } from "@/components/MorningRun";
import { BulkTailor } from "@/components/BulkTailor";
import { JobCard } from "@/components/JobCard";
import { JobFilters } from "@/components/JobFilters";
import { KeywordInput, addTerms } from "@/components/KeywordInput";
import { MatchAllButton, useCurrentMatches } from "@/components/MatchAll";
import { SaveByMatch } from "@/components/SaveByMatch";
import { FIND_TABS, SectionTabs } from "@/components/Nav";
import { COUNTRIES } from "@/lib/format";
import { collapseCopies, savedCopyFinder } from "@/lib/import";
import { ANY_JOB, filterJobs, type JobFilter } from "@/lib/job-filters";
import { pausedInBackground } from "@/lib/batch-runs";
import { nextSearch, useSearchState, useSearchUnseen } from "@/lib/search-session";
import { useSessionState } from "@/lib/session-state";
import { newId, useDismissed, useGroups, useHydrated, useSavedJobs, useSettings, type SearchGroup } from "@/lib/store";
import { SOURCE_IDS, type Job, type SearchRequest, type SearchResponse, type SourceResult } from "@/lib/types";

const PAGE_SIZE = 30;

/** One-click searches for an empty page. */
const SUGGESTIONS = ["Data analyst", "Software engineer", "Product manager", "Marketing manager", "Project manager"];

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

const NO_TERMS: string[] = [];
/** A search isn't stopped part-way, so waiting for the page to come back needs no way to give up. */
const KEEP_GOING = new AbortController().signal;

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

  // The search, its results and how they're shown are kept for the session (lib/session-state.ts), so
  // going to a job and back finds them as you left them, and a search still running when you leave carries on.
  const [keywords, setKeywords] = useSessionState("search:keywords", NO_TERMS);
  const [keywordDraft, setKeywordDraft] = useSessionState("search:keywordDraft", "");
  const [exclude, setExclude] = useSessionState("search:exclude", NO_TERMS);
  const [excludeDraft, setExcludeDraft] = useSessionState("search:excludeDraft", "");
  const [location, setLocation] = useSessionState("search:location", "");
  const [remoteOnly, setRemoteOnly] = useSessionState("search:remoteOnly", false);
  const [postedWithinDays, setPostedWithinDays] = useSessionState("search:postedWithinDays", 0);
  const [showMore, setShowMore] = useSessionState("search:showMore", false);
  const [activeGroupId, setActiveGroupId] = useSessionState<string | null>("search:group", null);
  const [groupName, setGroupName] = useState("");
  const [naming, setNaming] = useState(false);

  const [search, setSearch] = useSearchState();
  // A search that finished while you were on another page is noted in the navigation until you're back.
  const [unseen, setUnseen] = useSearchUnseen();
  useEffect(() => {
    if (unseen) setUnseen(false);
  }, [unseen, setUnseen]);
  const [sort, setSort] = useSessionState<"relevance" | "newest" | "match">("search:sort", "relevance");
  const [showHidden, setShowHidden] = useSessionState("search:showHidden", false);
  // Jobs already saved when the search ran are left out; ones saved from its results stay, marked saved.
  const [savedBeforeIds, setSavedBefore] = useSessionState("search:savedBefore", NO_TERMS);
  const savedBefore = useMemo(() => new Set(savedBeforeIds), [savedBeforeIds]);
  const [showSaved, setShowSaved] = useSessionState("search:showSaved", false);
  const { isDismissed, dismiss, restore } = useDismissed();
  const { matchFor } = useCurrentMatches();
  const [filter, setFilter] = useSessionState("search:filter", "");
  const [visible, setVisible] = useSessionState("search:visible", PAGE_SIZE);
  const [jobFilter, setJobFilter] = useSessionState<JobFilter>("search:jobFilter", ANY_JOB);
  const [expanded, setExpanded] = useSessionState<string | null>("search:expanded", null);

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
    const stillLatest = nextSearch();
    setSearch({ status: "loading", label });
    setVisible(PAGE_SIZE);
    setExpanded(null);
    setFilter("");
    setJobFilter(ANY_JOB);
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
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Search failed (HTTP ${response.status})`);
      if (!stillLatest()) return;
      setSavedBefore(Object.keys(saved));
      setShowSaved(false);
      setSearch({ status: "done", label, response: data as SearchResponse });
      setUnseen(window.location.pathname !== "/");
    } catch (error) {
      if (!stillLatest()) return;
      // Dropped while the phone had the app in the background: searched again once you're back.
      if (error instanceof TypeError && (await pausedInBackground(KEEP_GOING)) && stillLatest()) {
        void run(query, label);
        return;
      }
      setSearch({ status: "error", message: (error as Error).message });
      setUnseen(window.location.pathname !== "/");
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
    setNaming(false);
  }

  function deleteGroup(group: SearchGroup) {
    if (!window.confirm(`Delete the saved search “${group.name}”?`)) return;
    setGroups(groups.filter((g) => g.id !== group.id));
    if (activeGroupId === group.id) setActiveGroupId(null);
  }

  function tailor(job: Job) {
    const id = saveJob(job);
    router.push(`/tailor?job=${encodeURIComponent(id)}`);
  }

  const findCopy = useMemo(() => savedCopyFinder(saved), [saved]);
  const allResults = useMemo(() => {
    if (search.status !== "done") return [];
    // A job you've saved already, even from another site or an earlier search, shows as the saved one, once.
    const found = collapseCopies(search.response.jobs, findCopy);
    const needle = filter.trim().toLowerCase();
    const jobs = needle
      ? found.filter((job) =>
          `${job.title} ${job.company} ${job.location} ${job.sourceName}`.toLowerCase().includes(needle),
        )
      : found;
    if (sort === "newest") return [...jobs].sort((a, b) => (b.postedAt ?? "").localeCompare(a.postedAt ?? ""));
    // Unscored jobs keep their order after the scored ones.
    if (sort === "match") return [...jobs].sort((a, b) => (matchFor(b)?.score ?? -1) - (matchFor(a)?.score ?? -1));
    return jobs;
  }, [search, filter, sort, matchFor, findCopy]);

  // Jobs marked "Not interested" are left out, unless you ask to see them.
  const wasSaved = (job: Job) => savedBefore.has(job.id) && Boolean(saved[job.id]);
  const savedCount = allResults.filter(wasSaved).length;
  const fresh = showSaved ? allResults : allResults.filter((job) => !wasSaved(job));
  const hiddenCount = fresh.filter(isDismissed).length;
  const unfiltered = showHidden ? fresh : fresh.filter((job) => !isDismissed(job));
  // The From and Show filters narrow the list, and Match all and the rest act on what's left.
  const isMatched = (job: Job) => Boolean(matchFor(job));
  const results = filterJobs(unfiltered, (job) => job, jobFilter, isMatched);
  const onScreen = results.slice(0, visible).filter((job) => !isDismissed(job));

  const hasQuery = keywords.length > 0 || Boolean(keywordDraft.trim());

  return (
    <div className="space-y-4">
      <SectionTabs tabs={FIND_TABS} />
      <GettingStarted />
      <MorningRunNotice />

      <form onSubmit={onSubmit} className="card space-y-3 p-4">
        <div className="grid gap-3 md:grid-cols-[1fr_220px_auto] md:items-end">
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
              placeholder="City or region (optional)"
              value={location}
              onChange={(e) => setLocation(e.target.value)}
            />
          </div>
          <button type="submit" className="btn btn-primary px-5 py-2.5" disabled={search.status === "loading"}>
            <Search size={16} aria-hidden /> {search.status === "loading" ? "Searching…" : "Search"}
          </button>
        </div>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
          <label className="flex items-center gap-2">
            <span className="muted text-xs">Country</span>
            <select
              className="input w-auto py-1 text-sm"
              value={settings.country}
              onChange={(e) => setSettings({ ...settings, country: e.target.value })}
            >
              {COUNTRIES.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex items-center gap-2">
            <span className="muted text-xs">Posted</span>
            <select
              className="input w-auto py-1 text-sm"
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
          </label>
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={remoteOnly} onChange={(e) => setRemoteOnly(e.target.checked)} />
            Remote only
          </label>
          <button type="button" className="link cursor-pointer text-sm" onClick={() => setShowMore(!showMore)}>
            {showMore ? "Hide excluded words" : "Exclude words"}
          </button>
        </div>
        {showMore && (
          <KeywordInput
            label="Leave out jobs whose title contains"
            values={exclude}
            onChange={setExclude}
            draft={excludeDraft}
            onDraftChange={setExcludeDraft}
            placeholder="e.g. senior, unpaid, internship"
            tone="exclude"
          />
        )}

        <div className="flex flex-wrap items-center gap-1.5 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <span className="muted mr-1 text-xs">Saved searches</span>
          {groups.map((group) => {
            const active = group.id === activeGroupId;
            return (
              <span
                key={group.id}
                className={`inline-flex items-center rounded-full border text-xs ${active ? "border-indigo-300 bg-indigo-50 text-indigo-800 dark:border-indigo-700 dark:bg-indigo-950 dark:text-indigo-200" : "border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900"}`}
              >
                <button
                  type="button"
                  className="cursor-pointer py-1 pr-1 pl-2.5 font-medium"
                  onClick={() => loadGroup(group, true)}
                  title={`Search for ${group.keywords.join(", ")}`}
                >
                  {group.name}
                </button>
                <button
                  type="button"
                  className="cursor-pointer rounded-full px-1.5 py-1 text-zinc-400 hover:text-red-600"
                  onClick={() => deleteGroup(group)}
                  aria-label={`Delete the saved search ${group.name}`}
                >
                  <X size={12} aria-hidden />
                </button>
              </span>
            );
          })}
          {hydrated && groups.length === 0 && !naming && (
            <button
              type="button"
              className="link cursor-pointer text-xs"
              onClick={() => setGroups(EXAMPLE_GROUPS.map((g) => ({ ...g, id: newId() })))}
            >
              Add examples
            </button>
          )}
          <span className="ml-auto flex items-center gap-1.5">
            {activeGroup ? (
              <>
                <button type="button" className="btn btn-secondary btn-sm" onClick={saveGroup} disabled={!hasQuery}>
                  Update “{activeGroup.name}”
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setActiveGroupId(null)}>
                  Deselect
                </button>
              </>
            ) : naming ? (
              <>
                <input
                  className="input w-40 py-1 text-xs"
                  placeholder="Name, e.g. Data roles"
                  value={groupName}
                  onChange={(e) => setGroupName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      saveGroup();
                    }
                  }}
                  aria-label="Name for this search"
                  autoFocus
                />
                <button type="button" className="btn btn-secondary btn-sm" onClick={saveGroup}>
                  Save
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setNaming(false)}>
                  Cancel
                </button>
              </>
            ) : (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setNaming(true)}
                disabled={!hasQuery}
                title="Save these keywords and filters to run again with one click"
              >
                <Plus size={14} aria-hidden /> Save this search
              </button>
            )}
          </span>
        </div>
      </form>

      {search.status === "idle" && (
        <div className="card flex flex-col items-center gap-3 px-6 py-12 text-center">
          <span className="avatar h-14 w-14">
            <Search size={24} aria-hidden />
          </span>
          <div>
            <p className="text-base font-bold">Search many job sites at once</p>
            <p className="muted mt-1 text-sm">
              Type a few job titles above, or try one of these. Found a job on LinkedIn?{" "}
              <Link href="/import" className="link">
                Add it here
              </Link>
              .
            </p>
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            {SUGGESTIONS.map((suggestion) => (
              <button
                key={suggestion}
                type="button"
                className="btn btn-secondary btn-sm rounded-full"
                onClick={() => {
                  const query = { ...currentQuery(), keywords: [suggestion] };
                  setKeywords([suggestion]);
                  setKeywordDraft("");
                  void run(query, suggestion);
                }}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      )}
      {search.status === "loading" && (
        <div className="card muted animate-pulse p-8 text-center text-sm">
          Searching for “{search.label}” across job sites…
        </div>
      )}
      {search.status === "error" && (
        <div className="card border-red-200 p-4 text-sm text-red-700 dark:border-red-900 dark:text-red-300">
          {search.message}
        </div>
      )}
      {search.status === "done" && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-sm">
              <strong>{search.response.total}</strong> jobs for “{search.label}”
              {search.response.total > search.response.jobs.length && (
                <span className="muted"> (showing the top {search.response.jobs.length})</span>
              )}
            </p>
            {search.response.jobs.length > 0 && (
              <div className="ml-auto flex flex-wrap items-center gap-2">
                <input
                  className="input w-48 py-1.5"
                  placeholder="Filter these results"
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
                  onChange={(e) => setSort(e.target.value as "relevance" | "newest" | "match")}
                  aria-label="Sort results"
                >
                  <option value="relevance">Most relevant</option>
                  <option value="newest">Newest</option>
                  <option value="match">Best match to my CV</option>
                </select>
              </div>
            )}
          </div>
          <JobFilters
            items={unfiltered}
            jobOf={(job) => job}
            isMatched={isMatched}
            filter={jobFilter}
            onChange={(next) => {
              setJobFilter(next);
              setVisible(PAGE_SIZE);
            }}
            shown={results.length}
          />
          {unfiltered.length > 0 && <MatchAllButton jobs={onScreen} onMatched={() => setSort("match")} />}
          {unfiltered.length > 0 && <SaveByMatch jobs={onScreen} />}
          {unfiltered.length > 0 && <BulkTailor jobs={onScreen} />}
          {savedCount > 0 && (
            <p className="muted text-xs">
              {savedCount} {savedCount === 1 ? "job you’ve" : "jobs you’ve"} already saved
              {showSaved ? " shown. " : " left out (they’re in My jobs). "}
              <button type="button" className="link cursor-pointer" onClick={() => setShowSaved(!showSaved)}>
                {showSaved ? "Hide them" : "Show them"}
              </button>
            </p>
          )}
          {hiddenCount > 0 && (
            <p className="muted text-xs">
              {hiddenCount} {hiddenCount === 1 ? "job" : "jobs"} marked Not interested
              {showHidden ? ", shown faded. " : " hidden. "}
              <button type="button" className="link cursor-pointer" onClick={() => setShowHidden(!showHidden)}>
                {showHidden ? "Hide them" : "Show them"}
              </button>
            </p>
          )}
          <details className="text-xs">
            <summary className="muted cursor-pointer">Where these came from</summary>
            <div className="mt-2 space-y-2">
              <SourceSummary sources={search.response.sources} />
              {search.response.sources.some((s) => s.status === "skipped" && s.message?.startsWith("Needs")) && (
                <p className="muted">
                  Want more jobs in your country? Add free API keys, such as Adzuna, in your hosting settings.{" "}
                  <Link href="/settings" className="link">
                    Settings
                  </Link>{" "}
                  shows which ones are missing.
                </p>
              )}
            </div>
          </details>
          {results.length === 0 && (
            <div className="card muted p-6 text-center text-sm">
              {unfiltered.length > 0
                ? "No jobs match these filters."
                : "No jobs matched. Try broader keywords, a different location, or turn off “Remote only”."}
            </div>
          )}
          <div className="space-y-3">
            {results.slice(0, visible).map((job) => (
              <JobCard
                key={job.id}
                job={job}
                status={saved[job.id]?.status}
                match={matchFor(job)}
                dismissed={isDismissed(job)}
                onDismiss={() => (isDismissed(job) ? restore(job) : dismiss(job))}
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
    </div>
  );
}
