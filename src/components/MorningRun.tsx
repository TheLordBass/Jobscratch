"use client";

import { Sunrise } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { MORNING_RUN_HASH, fetchLatestRun, fetchRunJobs, runTime, type JobspyRun } from "@/lib/jobspy-run-client";
import type { Job } from "@/lib/types";

/** Older runs aren't news on Find jobs any more; they're still in Add a job. */
const RECENT_MS = 36 * 3_600_000;

/**
 * The latest morning JobSpy run, once fetched: undefined while loading, null when there's none. And
 * whether it's recent, judged when it was fetched.
 */
function useLatestRun() {
  const [state, setState] = useState<{ run: JobspyRun | null | undefined; recent: boolean }>({ run: undefined, recent: false });
  useEffect(() => {
    let active = true;
    void fetchLatestRun().then((run) => {
      if (active) setState({ run, recent: Boolean(run && Date.now() - Date.parse(run.startedAt) < RECENT_MS) });
    });
    return () => {
      active = false;
    };
  }, []);
  return state;
}

function summary(run: JobspyRun): string {
  const found = `${run.count} ${run.count === 1 ? "job" : "jobs"}`;
  return run.finishedAt
    ? `The morning JobSpy run ${runTime(run.startedAt)} found ${found}`
    : `The morning JobSpy run ${runTime(run.startedAt)} is still sending its jobs (${found} so far)`;
}

/**
 * In Add a job > From JobSpy: the latest morning run, and a button to look through its jobs (with
 * the usual Match all, filters and saving). Opens them straight away when the address ends in
 * #morning-run, e.g. from the notice on Find jobs.
 */
export function MorningRunBanner({ onShow }: { onShow: (jobs: Job[], run: JobspyRun) => void }) {
  const { run } = useLatestRun();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const opened = useRef(false);
  const deliver = useRef(onShow);
  useEffect(() => {
    deliver.current = onShow;
  }, [onShow]);

  async function show(latest: JobspyRun) {
    setLoading(true);
    setError(null);
    try {
      deliver.current(await fetchRunJobs(), latest);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!run || opened.current || window.location.hash !== MORNING_RUN_HASH) return;
    opened.current = true;
    history.replaceState(null, "", window.location.pathname);
    void show(run);
    document.getElementById("jobspy-title")?.scrollIntoView({ block: "start" });
  }, [run]);

  if (!run) return null;
  return (
    <div className="space-y-1.5 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm dark:bg-indigo-950/60" role="status">
      <div className="flex flex-wrap items-center gap-2">
        <Sunrise size={16} className="shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
        <p className="min-w-0 flex-1">
          {summary(run)}
          {run.query && <span className="muted"> for “{run.query}”</span>}.
        </p>
        {run.count > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" disabled={loading} onClick={() => void show(run)}>
            {loading ? "Loading…" : "Show them"}
          </button>
        )}
      </div>
      {run.failed.length > 0 && (
        <p className="muted text-xs">
          {run.failed.length} {run.failed.length === 1 ? "search" : "searches"} failed (the site may have blocked them):{" "}
          {run.failed.slice(0, 5).join("; ")}
          {run.failed.length > 5 && "…"}
        </p>
      )}
      {error && <p className="text-xs text-red-700 dark:text-red-300">{error}</p>}
    </div>
  );
}

/** On Find jobs: a one-line pointer to the morning run's jobs, if there's a recent one. */
export function MorningRunNotice() {
  const { run, recent } = useLatestRun();
  if (!run?.count || !recent) return null;
  return (
    <Link
      href={`/import${MORNING_RUN_HASH}`}
      className="flex items-center gap-2 rounded-xl bg-indigo-50 px-3 py-2.5 text-sm hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-950"
    >
      <Sunrise size={16} className="shrink-0 text-indigo-600 dark:text-indigo-300" aria-hidden />
      <span className="min-w-0 flex-1">{summary(run)}.</span>
      <span className="link shrink-0">Show them</span>
    </Link>
  );
}
