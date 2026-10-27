"use client";

import { Power, Search, Square } from "lucide-react";
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { COUNTRIES } from "@/lib/format";
import {
  JOBSPY_SITES,
  MAX_SEARCHES,
  MIN_LINKEDIN_PACE,
  MAX_TITLES,
  cancelHelperSearch,
  getHelperPartial,
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
/** Minutes between LinkedIn searches: never less than MIN_LINKEDIN_PACE, as closer together LinkedIn blocks many more. */
const LINKEDIN_PACES = [
  { minutes: 10, label: "10 minutes apart" },
  { minutes: 15, label: "15 minutes apart" },
  { minutes: 20, label: "20 minutes apart" },
  { minutes: 30, label: "30 minutes apart" },
] as const;

const splitList = (text: string) => [...new Set(text.split(/[,;\n]/).map((item) => item.trim()).filter(Boolean))];
const timeOf = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });

/** "1 h 40 min", "25 minutes" or "1 minute". */
function duration(minutes: number): string {
  if (minutes < 60) return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} ${hours === 1 ? "hour" : "hours"}`;
}

/**
 * "about 6 minutes left": from the helper's own estimate (it knows about LinkedIn's gaps), or else
 * from how long the searches so far have taken. Undefined until there's something to go on.
 */
function timeLeft(state: HelperSearchState | null, checkedAt: number): string | undefined {
  if (!state || state.status !== "running" || !checkedAt) return undefined;
  let ms: number;
  if (state.endsAround) ms = Date.parse(state.endsAround) - checkedAt;
  else if (state.done > 0) ms = ((checkedAt - Date.parse(state.startedAt)) / state.done) * (state.total - state.done);
  else return undefined;
  const minutes = Math.round(ms / 60_000);
  return minutes < 1 ? "under a minute left" : `about ${duration(minutes)} left`;
}

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

/** Helper searches whose jobs have been shown, for the session: coming back to the page doesn't offer them again. */
const shownSearches = new Set<string>();

/** Runs a search with the helper and follows it until it's done. */
function useHelperSearch(onResult: (file: unknown) => void) {
  const [state, setState] = useState<HelperSearchState | null>(null);
  const [error, setError] = useState<string | null>(null);
  /** When the state was last fetched, for "about 5 minutes left". */
  const [checkedAt, setCheckedAt] = useState(0);
  /** A search that finished while this page wasn't open, to offer its results. */
  const [missed, setMissed] = useState<HelperSearchState | null>(null);
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
        setCheckedAt(Date.now());
        if (next.status === "running") {
          window.setTimeout(poll, 1500);
        } else {
          following.current = null;
          if (next.result) {
            shownSearches.add(next.id);
            deliver.current(next.result);
          }
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
      setMissed(null);
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

  /**
   * Picks up the helper's latest search after leaving the page and coming back: follows it if it's
   * still running, or offers its results if it finished in the meantime.
   */
  const resume = useCallback(async () => {
    if (following.current) return;
    try {
      const current = await getHelperSearch("");
      if (following.current) return;
      if (current.status === "running") {
        setState(current);
        follow(current.id);
      } else if (current.result && !shownSearches.has(current.id)) {
        setMissed(current);
      }
    } catch {
      // Nothing to pick up.
    }
  }, [follow]);

  /** Shows the results of the search that finished while the page was closed. */
  const showMissed = useCallback(() => {
    if (!missed?.result) return;
    shownSearches.add(missed.id);
    deliver.current(missed.result);
    setMissed(null);
  }, [missed]);

  /** Shows the jobs a running search has found so far; the full list replaces them when it's done. */
  const showSoFar = useCallback(async () => {
    if (!state || state.status !== "running") return;
    try {
      deliver.current(await getHelperPartial(state.id));
    } catch (err) {
      setError((err as Error).message);
    }
  }, [state]);

  useEffect(() => () => void (following.current = null), []);

  return { state, error, start, resume, missed, showMissed, showSoFar, checkedAt, running: state?.status === "running" };
}

export function JobspyHelperPanel({ onResult }: { onResult: (file: unknown) => void }) {
  const [status, setStatus] = useHelperStatus();
  const search = useHelperSearch(onResult);
  const { resume } = search;
  const online = Boolean(status);
  const busy = Boolean(status?.busy);
  useEffect(() => {
    if (online) void resume();
  }, [online, busy, resume]);

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

      {status && search.missed && !search.running && (
        <div className="flex flex-wrap items-center gap-2 rounded-lg bg-indigo-50 px-3 py-2 text-sm dark:bg-indigo-950/60">
          <p className="min-w-0 flex-1">
            Your last search{search.missed.finishedAt ? `, finished at ${timeOf(search.missed.finishedAt)},` : ""} found{" "}
            {search.missed.found} {search.missed.found === 1 ? "job" : "jobs"}.
          </p>
          <button type="button" className="btn btn-secondary btn-sm" onClick={search.showMissed}>
            Show them
          </button>
        </div>
      )}

      {status && <SearchForm search={search} />}
    </div>
  );
}

function SearchForm({ search }: { search: ReturnType<typeof useHelperSearch> }) {
  const [settings, setSettings] = useSettings();
  const saved = settings.jobspy;
  const [terms, setTerms] = useState(saved.search.join("\n"));
  const [places, setPlaces] = useState(saved.location.join(", "));
  const [sites, setSites] = useState<JobspySite[]>(saved.sites);
  const [hours, setHours] = useState(saved.hours);
  const [resultsText, setResultsText] = useState(String(saved.results));
  const [distance, setDistance] = useState(saved.distance);
  const [remote, setRemote] = useState(saved.remote);
  const [linkedinDescriptions, setLinkedinDescriptions] = useState(saved.linkedinDescriptions);
  // Searches saved with a shorter gap, from before it had a minimum, use the minimum.
  const [linkedinPace, setLinkedinPace] = useState(Math.max(MIN_LINKEDIN_PACE, saved.linkedinPace));

  const country = COUNTRIES.find((c) => c.code === settings.country)?.name ?? "United Kingdom";
  const keywords = splitList(terms);
  const locations = splitList(places);
  const count = keywords.length * Math.max(1, locations.length);
  const results = Math.min(100, Math.max(1, Math.round(Number(resultsText)) || DEFAULT_SETTINGS.jobspy.results));
  const { state, running, checkedAt } = search;
  const tooManyTitles = keywords.length > MAX_TITLES;
  const tooMany = tooManyTitles || count > MAX_SEARCHES;
  const withLinkedIn = sites.includes("linkedin");
  // LinkedIn is only spaced out when there's more than one search to space.
  const paced = withLinkedIn && linkedinPace > 0 && count > 1;
  // About 5 seconds a search plus the 3-second pause; full LinkedIn descriptions take much longer, and
  // spaced-out LinkedIn searches run after the others, the chosen gap apart.
  const linkedInEach = 10 + (linkedinDescriptions ? 25 : 0);
  const seconds = paced
    ? (sites.length > 1 ? count * 8 : 0) + count * (linkedInEach + linkedinPace * 60)
    : count * (8 + (withLinkedIn && linkedinDescriptions ? 25 : 0));
  const minutes = Math.max(1, Math.round(seconds / 60));
  const left = timeLeft(state, checkedAt);

  function submit(event: FormEvent) {
    event.preventDefault();
    if (!keywords.length || !sites.length || tooMany) return;
    const options = { search: keywords, location: locations, sites, results, hours, remote, linkedinDescriptions, distance, linkedinPace };
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
            <span className="muted">
              {" "}
              · {state.found} jobs so far{left && ` · ${left}`}
            </span>
          </p>
          {state.found > 0 && (
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => void search.showSoFar()}>
              Show the {state.found} so far
            </button>
          )}
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => void cancelHelperSearch().catch(() => undefined)}>
            <Square size={13} aria-hidden /> Stop search
          </button>
        </div>
        {state.waitingUntil && (
          <p className="text-sm">
            {state.waitingFor === "LinkedIn to stop blocking"
              ? `LinkedIn turned a search away, so the helper is giving it a rest and will try again at ${timeOf(state.waitingUntil)}.`
              : `Waiting until ${timeOf(state.waitingUntil)} for ${state.waitingFor ?? "the next search"}, so LinkedIn is less likely to block it.`}
          </p>
        )}
        <p className="muted text-xs">
          {state.total > state.done + 1 && state.current?.startsWith("LinkedIn")
            ? "The other sites are done; LinkedIn is being searched one at a time, spaced out. "
            : "Each search takes a few seconds, with a short pause between them so the sites are less likely to block it. "}
          You can leave this page: the search carries on in the helper (keep the computer on), and its results are offered
          when you come back.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="jobspy-terms" className="label">
            Job titles or keywords{" "}
            <span className="font-normal">
              (up to {MAX_TITLES}, one per line or separated by commas{keywords.length > 1 ? `: ${keywords.length} so far` : ""})
            </span>
          </label>
          <textarea
            id="jobspy-terms"
            className="input min-h-20 resize-y"
            rows={3}
            value={terms}
            onChange={(e) => setTerms(e.target.value)}
            placeholder={"data analyst\njunior data analyst\nBI analyst"}
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
        {withLinkedIn && (
          <label className="flex items-center gap-2 pb-2 text-sm">
            <input
              type="checkbox"
              checked={linkedinDescriptions}
              onChange={(e) => setLinkedinDescriptions(e.target.checked)}
            />
            Full LinkedIn descriptions (slower)
          </label>
        )}
        {withLinkedIn && count > 1 && (
          <div>
            <label htmlFor="jobspy-pace" className="label">
              LinkedIn searches
            </label>
            <select
              id="jobspy-pace"
              className="input w-auto"
              value={linkedinPace}
              onChange={(e) => setLinkedinPace(Number(e.target.value))}
            >
              {LINKEDIN_PACES.map((option) => (
                <option key={option.minutes} value={option.minutes}>
                  {option.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <button type="submit" className="btn btn-primary" disabled={!keywords.length || !sites.length || tooMany}>
          <Search size={15} aria-hidden /> Search with JobSpy
        </button>
        <p className={`text-xs ${tooMany ? "text-red-600 dark:text-red-400" : "muted"}`}>
          {!keywords.length
            ? "Add at least one job title."
            : !sites.length
              ? "Pick at least one site."
              : tooManyTitles
                ? `That’s ${keywords.length} job titles; ${MAX_TITLES} at most at once.`
                : count > MAX_SEARCHES
                  ? `That’s ${count} searches (job titles × places); ${MAX_SEARCHES} at most at once.`
                  : `${count} ${count === 1 ? "search" : "searches"} on ${sites.length} ${sites.length === 1 ? "site" : "sites"}, about ${duration(minutes)}. Indeed and Glassdoor search in ${country} (change it in Settings).`}
        </p>
      </div>
      {!tooMany && paced && (
        <p className="muted text-xs">
          {sites.length > 1 ? "The other sites are searched first, then " : ""}LinkedIn one search at a time,{" "}
          {linkedinPace} {linkedinPace === 1 ? "minute" : "minutes"} apart, so it’s less likely to block. If it blocks anyway,
          the helper waits 10 minutes and tries again. Keep the computer on until it’s done.
        </p>
      )}

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
