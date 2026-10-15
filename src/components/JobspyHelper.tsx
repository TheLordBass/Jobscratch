"use client";

import { Power, Search, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { COUNTRIES } from "@/lib/format";
import {
  JOBSPY_SITES,
  cancelHelperSearch,
  getHelperSearch,
  getHelperStatus,
  startHelperSearch,
  stopHelper,
  type HelperSearchState,
  type HelperStatus,
  type JobspySite,
} from "@/lib/jobspy-helper";
import { DEFAULT_SETTINGS, useSettings } from "@/lib/store";

const POSTED = [
  { hours: null, label: "Any time" },
  { hours: 24, label: "Last 24 hours" },
  { hours: 72, label: "Last 3 days" },
  { hours: 168, label: "Last week" },
  { hours: 336, label: "Last 2 weeks" },
  { hours: 720, label: "Last month" },
] as const;

const DISTANCES = [10, 25, 50, 100] as const;
/** The helper refuses more than this many searches (keywords × locations) at once. */
const MAX_SEARCHES = 30;

const splitList = (text: string) => [...new Set(text.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** Whether the helper is running, checked every few seconds while the page is open. undefined = still checking. */
function useHelperStatus() {
  const [status, setStatus] = useState<HelperStatus | null | undefined>(undefined);
  useEffect(() => {
    let timer: number | undefined;
    let stopped = false;
    const check = async () => {
      if (document.visibilityState === "visible") {
        const next = await getHelperStatus();
        if (!stopped) setStatus(next);
      }
      if (!stopped) timer = window.setTimeout(check, 4000);
    };
    void check();
    return () => {
      stopped = true;
      window.clearTimeout(timer);
    };
  }, []);
  return [status, setStatus] as const;
}

/** Runs a search with the helper and follows it until it's done. */
function useHelperSearch(onResult: (file: unknown) => void) {
  const [state, setState] = useState<HelperSearchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const following = useRef<string | null>(null);
  const deliver = useRef(onResult);
  useEffect(() => {
    deliver.current = onResult;
  }, [onResult]);

  const follow = useCallback((id: string) => {
    following.current = id;
    const poll = async () => {
      if (following.current !== id) return;
      try {
        const next = await getHelperSearch(id);
        if (following.current !== id) return;
        setState(next);
        if (next.status === "running") {
          window.setTimeout(poll, 1500);
        } else {
          following.current = null;
          if (next.result) deliver.current(next.result);
          if (next.status === "failed") setError(next.error ?? "The search failed");
        }
      } catch {
        following.current = null;
        setError("Lost touch with the helper. Is its window still open?");
      }
    };
    void poll();
  }, []);

  const start = useCallback(
    async (search: Parameters<typeof startHelperSearch>[0]) => {
      setError(null);
      try {
        const started = await startHelperSearch(search);
        setState(started);
        follow(started.id);
      } catch (err) {
        setError((err as Error).message);
      }
    },
    [follow],
  );

  /** Picks up a search that was already running, e.g. after leaving the page and coming back. */
  const resume = useCallback(async () => {
    if (following.current) return;
    try {
      const current = await getHelperSearch("");
      if (current.status === "running" && !following.current) {
        setState(current);
        follow(current.id);
      }
    } catch {
      // Nothing to pick up.
    }
  }, [follow]);

  useEffect(() => () => void (following.current = null), []);

  return { state, error, start, resume, running: state?.status === "running" };
}

export function JobspyHelperPanel({ onResult }: { onResult: (file: unknown) => void }) {
  const [status, setStatus] = useHelperStatus();
  const search = useHelperSearch(onResult);
  const { resume } = search;
  const busy = Boolean(status?.busy);
  useEffect(() => {
    if (busy) void resume();
  }, [busy, resume]);

  return (
    <div className="space-y-3 rounded-xl border border-zinc-200 p-3 dark:border-zinc-800">
      <div className="flex flex-wrap items-center gap-2">
        <span
          className={`h-2.5 w-2.5 rounded-full ${status ? "bg-emerald-500" : "bg-zinc-300 dark:bg-zinc-600"}`}
          aria-hidden
        />
        <p className="text-sm font-semibold" role="status">
          {status === undefined ? "Looking for the JobSpy helper…" : status ? "Helper running on this computer" : "Helper not running"}
        </p>
        {status?.stopsAt && !search.running && (
          <span className="muted text-xs">Stops by itself at {timeOf(status.stopsAt)} if you don’t search</span>
        )}
        {status && (
          <button
            type="button"
            className="btn btn-secondary btn-sm ml-auto"
            onClick={async () => {
              await stopHelper().catch(() => undefined);
              setStatus(null);
            }}
          >
            <Power size={14} aria-hidden /> Turn off
          </button>
        )}
      </div>

      {status === null && (
        <div className="muted space-y-1.5 text-sm">
          <p>
            To turn it on, double-click <strong>JobScratch JobSpy helper</strong> on your desktop (or{" "}
            <code>scripts/jobspy/start-helper.bat</code>). A small window opens; keep it open while you search. It shows as
            running here within a few seconds.
          </p>
          <p className="text-xs">
            If your browser asks whether this site may connect to devices on your network, choose Allow: that’s how it
            reaches the helper on your computer.
          </p>
        </div>
      )}

      {status && <SearchForm search={search} />}
    </div>
  );
}

function SearchForm({ search }: { search: ReturnType<typeof useHelperSearch> }) {
  const [settings, setSettings] = useSettings();
  const saved = settings.jobspy;
  const [terms, setTerms] = useState(saved.search.join(", "));
  const [places, setPlaces] = useState(saved.location.join(", "));
  const [sites, setSites] = useState<JobspySite[]>(saved.sites);
  const [hours, setHours] = useState(saved.hours);
  const [resultsText, setResultsText] = useState(String(saved.results));
  const [distance, setDistance] = useState(saved.distance);
  const [remote, setRemote] = useState(saved.remote);
  const [linkedinDescriptions, setLinkedinDescriptions] = useState(saved.linkedinDescriptions);

  const country = COUNTRIES.find((c) => c.code === settings.country)?.name ?? "United Kingdom";
  const keywords = splitList(terms);
  const locations = splitList(places);
  const count = keywords.length * Math.max(1, locations.length);
  const results = Math.min(100, Math.max(1, Math.round(Number(resultsText)) || DEFAULT_SETTINGS.jobspy.results));
  const { state, running } = search;

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!keywords.length || !sites.length || count > MAX_SEARCHES) return;
    const options = { search: keywords, location: locations, sites, results, hours, remote, linkedinDescriptions, distance };
    setSettings((previous) => ({ ...previous, jobspy: options }));
    void search.start({ ...options, country: country.toLowerCase() });
  }

  if (running && state) {
    return (
      <div className="space-y-2" role="status">
        <div className="h-1.5 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
          <div
            className="h-full rounded-full bg-indigo-500 transition-all"
            style={{ width: `${Math.max(4, (state.done / Math.max(1, state.total)) * 100)}%` }}
          />
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <p className="min-w-0 flex-1">
            {state.current ? (
              <>
                Searching {state.current} ({state.done + 1} of {state.total})
              </>
            ) : (
              "Finishing…"
            )}
            <span className="muted"> · {state.found} jobs so far</span>
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cancelHelperSearch().catch(() => undefined)}>
            <Square size={13} aria-hidden /> Stop search
          </button>
        </div>
        <p className="muted text-xs">Each search takes a few seconds, with a short pause between them so the sites are less likely to block it.</p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="jobspy-terms" className="label">
            Job titles or keywords
          </label>
          <input
            id="jobspy-terms"
            className="input"
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder="data analyst, junior data analyst"
          />
        </div>
        <div>
          <label htmlFor="jobspy-places" className="label">
            Locations
          </label>
          <input
            id="jobspy-places"
            className="input"
            value={places}
            onChange={(e) => setPlaces(e.target.value)}
            placeholder="Manchester, London (blank for anywhere)"
          />
        </div>
      </div>

      <fieldset>
        <legend className="label">Sites</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-1.5">
          {JOBSPY_SITES.map((site) => (
            <label key={site.id} className="flex items-center gap-1.5 text-sm">
              <input
                type="checkbox"
                checked={sites.includes(site.id)}
                onChange={(e) =>
                  setSites(e.target.checked ? [...sites, site.id] : sites.filter((id) => id !== site.id))
                }
              />
              {site.label}
            </label>
          ))}
        </div>
      </fieldset>

      <div className="flex flex-wrap items-end gap-3">
        <div>
          <label htmlFor="jobspy-posted" className="label">
            Posted
          </label>
          <select
            id="jobspy-posted"
            className="input w-auto"
            value={hours ?? ""}
            onChange={(e) => setHours(e.target.value ? Number(e.target.value) : null)}
          >
            {POSTED.map((option) => (
              <option key={option.label} value={option.hours ?? ""}>
                {option.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jobspy-distance" className="label">
            Distance
          </label>
          <select
            id="jobspy-distance"
            className="input w-auto"
            value={distance}
            onChange={(e) => setDistance(Number(e.target.value))}
          >
            {DISTANCES.map((miles) => (
              <option key={miles} value={miles}>
                Within {miles} miles
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="jobspy-results" className="label">
            Results per site
          </label>
          <input
            id="jobspy-results"
            type="number"
            min={1}
            max={100}
            className="input w-24"
            value={resultsText}
            onChange={(e) => setResultsText(e.target.value)}
            onBlur={() => setResultsText(String(results))}
          />
        </div>
        <label className="flex items-center gap-2 pb-2 text-sm">
          <input type="checkbox" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          Remote only
        </label>
        {sites.includes("linkedin") && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={linkedinDescriptions}
              onChange={(e) => setLinkedinDescriptions(e.target.checked)}
            />
            Full LinkedIn descriptions (slower)
          </label>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!keywords.length || !sites.length || count > MAX_SEARCHES}>
          <Search size={15} aria-hidden /> Search with JobSpy
        </button>
        <p className={`text-xs ${count > MAX_SEARCHES ? "text-red-600 dark:text-red-400" : "muted"}`}>
          {!keywords.length
            ? "Add at least one job title."
            : !sites.length
              ? "Pick at least one site."
              : count > MAX_SEARCHES
                ? `That’s ${count} searches; ${MAX_SEARCHES} at most at once.`
                : `${count} ${count === 1 ? "search" : "searches"} on ${sites.length} ${sites.length === 1 ? "site" : "sites"}. Indeed and Glassdoor search in ${country} (change it in Settings).`}
        </p>
      </div>

      {search.error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {search.error}
        </p>
      )}
      {state && state.status !== "running" && !search.error && (
        <p className="muted text-sm">
          {state.status === "cancelled" ? "Stopped early: " : "Done: "}
          {state.found} {state.found === 1 ? "job" : "jobs"} found
          {state.failed.length > 0 && `. These searches failed (the site may have blocked them): ${state.failed.join("; ")}`}.
        </p>
      )}
    </form>
  );
}
