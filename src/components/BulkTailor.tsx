"use client";

import { Sparkles, Square } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { useCurrentMatches } from "@/components/MatchAll";
import { findSavedCopy } from "@/lib/import";
import { useSavedJobs, useSettings, useTailored } from "@/lib/store";
import { streamTailored } from "@/lib/tailor-client";
import type { Job } from "@/lib/types";

/** CVs written at the same time. Each takes about a minute. */
const PARALLEL = 2;
const THRESHOLDS = [90, 80, 70, 60];

interface Progress {
  done: number;
  total: number;
  failed: number;
  current: string[];
  stopped?: string;
}

/**
 * Writes tailored CVs (and, if asked, cover letters) for every job whose
 * quick match is at or above a threshold. Jobs are saved to My jobs first,
 * since that's where tailored documents live.
 */
export function BulkTailor({ jobs }: { jobs: Job[] }) {
  const { matchFor, candidate } = useCurrentMatches();
  const { saved, saveJob } = useSavedJobs();
  const [tailored, setTailored] = useTailored();
  const [settings] = useSettings();
  const [threshold, setThreshold] = useState(80);
  const [withLetters, setWithLetters] = useState(false);
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);
  const controller = useRef<AbortController | null>(null);

  useEffect(() => () => controller.current?.abort(), []);

  const scored = jobs.filter((job) => matchFor(job));
  if (scored.length === 0) return null;

  // Tailored documents are kept on the saved copy of a job, which may have another id.
  const target = (job: Job) => findSavedCopy(saved, job)?.job ?? job;
  const needs = (job: Job) => {
    const docs = tailored[target(job).id];
    return !docs?.cv || (withLetters && !docs.coverLetter);
  };
  const eligible = scored.filter((job) => (matchFor(job)?.score ?? 0) >= threshold);
  const todo = eligible.filter(needs);
  const what = withLetters ? "CVs and cover letters" : "CVs";

  async function start() {
    if (todo.length === 0) return;
    const minutes = Math.max(1, Math.ceil((todo.length * (withLetters ? 2 : 1)) / PARALLEL));
    if (
      !window.confirm(
        `Write tailored ${what} for ${todo.length} ${todo.length === 1 ? "job" : "jobs"} matching ${threshold}%+? ` +
          `That's ${todo.length * (withLetters ? 2 : 1)} Claude requests and takes about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      )
    ) {
      return;
    }
    const abort = new AbortController();
    controller.current = abort;
    setRunning(true);
    const queue = [...todo];
    const total = queue.length;
    let done = 0;
    let failed = 0;
    let failedInARow = 0;
    const current = new Set<string>();
    const report = (stopped?: string) => setProgress({ done, total, failed, current: [...current], stopped });
    report();

    const write = async (job: Job, kind: "cv" | "cover-letter") => {
      const into = target(job);
      const text = await streamTailored(
        {
          kind,
          cv: candidate.cv,
          job: {
            title: into.title.slice(0, 300),
            company: into.company.slice(0, 200),
            location: into.location.slice(0, 200),
            url: into.url.slice(0, 2000),
            description: (tailored[into.id]?.jobDescription ?? into.description).slice(0, 40_000),
          },
          profile: candidate.profile,
          options: settings.tailor,
        },
        { signal: abort.signal },
      );
      const field = kind === "cv" ? "cv" : "coverLetter";
      setTailored((previous) => ({
        ...previous,
        [into.id]: { ...previous[into.id], [field]: text, updatedAt: new Date().toISOString() },
      }));
    };

    const worker = async () => {
      while (!abort.signal.aborted) {
        const job = queue.shift();
        if (!job) return;
        const into = target(job);
        if (!saved[into.id]) saveJob(into);
        const label = `${into.title} at ${into.company}`;
        current.add(label);
        report();
        try {
          const docs = tailored[into.id];
          if (!docs?.cv) await write(job, "cv");
          if (withLetters && !docs?.coverLetter) await write(job, "cover-letter");
          failedInARow = 0;
        } catch (error) {
          if (abort.signal.aborted) return;
          failed++;
          failedInARow++;
          // Two failures in a row usually means a problem every job will hit (key, rate limit).
          if (failedInARow >= 2) {
            abort.abort();
            current.delete(label);
            report(`Stopped: ${(error as Error).message}`);
            return;
          }
        }
        current.delete(label);
        done++;
        report();
      }
    };

    await Promise.all(Array.from({ length: Math.min(PARALLEL, total) }, worker));
    if (controller.current === abort) controller.current = null;
    setRunning(false);
    setProgress((last) => (last ? { ...last, current: [] } : last));
  }

  return (
    <div className="space-y-2 rounded-xl border border-indigo-200/70 bg-indigo-50/50 p-3 dark:border-indigo-900/70 dark:bg-indigo-950/20">
      {running && progress ? (
        <div className="flex flex-wrap items-center gap-2.5" role="status">
          <span className="h-2 min-w-32 flex-1 overflow-hidden rounded-full bg-white dark:bg-zinc-800">
            <span
              className="block h-full rounded-full bg-indigo-600 transition-all"
              style={{ width: `${(progress.done / progress.total) * 100}%` }}
            />
          </span>
          <span className="text-xs font-semibold tabular-nums">
            {progress.done} of {progress.total} done
          </span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => controller.current?.abort()}>
            <Square size={12} aria-hidden /> Stop
          </button>
          {progress.current.length > 0 && (
            <p className="muted w-full truncate text-xs">Writing: {progress.current.join("; ")}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">Tailor CVs for top matches</span>
          <select
            className="input w-auto py-1 text-xs"
            value={threshold}
            onChange={(e) => setThreshold(Number(e.target.value))}
            aria-label="Minimum match"
          >
            {THRESHOLDS.map((value) => (
              <option key={value} value={value}>
                {value}%+ match
              </option>
            ))}
          </select>
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={withLetters} onChange={(e) => setWithLetters(e.target.checked)} />
            Cover letters too
          </label>
          <button
            type="button"
            className="btn btn-primary btn-sm ml-auto"
            onClick={() => void start()}
            disabled={todo.length === 0}
            title={`Writes tailored ${what} with Claude and saves the jobs to My jobs`}
          >
            <Sparkles size={14} aria-hidden />
            {todo.length > 0
              ? `Write for ${todo.length} ${todo.length === 1 ? "job" : "jobs"}`
              : eligible.length > 0
                ? "All written"
                : `No jobs at ${threshold}%+`}
          </button>
        </div>
      )}
      {!running && progress && (
        <p className="text-xs" role="status">
          {progress.stopped ?? (
            <>
              Wrote {what} for {progress.done - progress.failed} {progress.done - progress.failed === 1 ? "job" : "jobs"}
              {progress.failed > 0 && `; ${progress.failed} failed (try again to retry)`}
              {progress.done < progress.total && ", stopped early"}.
            </>
          )}{" "}
          <Link href="/saved" className="link">
            Open My jobs
          </Link>
        </p>
      )}
    </div>
  );
}
