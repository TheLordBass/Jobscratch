"use client";

import { Sparkles, Square } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useCurrentMatches } from "@/components/MatchAll";
import { findSavedCopy } from "@/lib/import";
import { DEFAULT_QUESTIONS } from "@/lib/ai/prompts";
import { beginBatch, markBatchSeen, pausedInBackground, stopBatch, useBatch } from "@/lib/batch-runs";
import { useProfile, useSavedJobs, useSettings, useTailored } from "@/lib/store";
import { requestAnswers, streamTailored } from "@/lib/tailor-client";
import type { Job } from "@/lib/types";

/** CVs written at the same time. Each takes about a minute. */
const PARALLEL = 2;
const THRESHOLDS = [90, 80, 70, 60];

/**
 * Writes tailored CVs (and, if asked, cover letters and application answers) for every job whose
 * match is at or above a threshold. Jobs are saved to My jobs first, since that's where tailored
 * documents live. `title` and `ready` (cover letters and answers ticked) are for the Apply page.
 */
export function BulkTailor({ jobs, title = "Tailor CVs for top matches", ready = false }: { jobs: Job[]; title?: string; ready?: boolean }) {
  const { matchFor, candidate } = useCurrentMatches();
  const { saved, saveJob } = useSavedJobs();
  const [tailored, setTailored] = useTailored();
  const [settings] = useSettings();
  const [profile] = useProfile();
  const [threshold, setThreshold] = useState(80);
  const [withLetters, setWithLetters] = useState(ready);
  const [withAnswers, setWithAnswers] = useState(ready);
  // Runs in the background (lib/batch-runs.ts), so going to another page, say to apply, doesn't stop it.
  const page = usePathname();
  const progress = useBatch("tailor", page);
  const running = progress?.status === "running";

  useEffect(() => {
    if (progress?.status === "done") markBatchSeen("tailor", page);
  }, [progress?.status, page]);

  const scored = jobs.filter((job) => matchFor(job));
  if (scored.length === 0) return null;

  // Tailored documents are kept on the saved copy of a job, which may have another id.
  const target = (job: Job) => findSavedCopy(saved, job)?.job ?? job;
  const needs = (job: Job) => {
    const docs = tailored[target(job).id];
    return !docs?.cv || (withLetters && !docs.coverLetter) || (withAnswers && !docs.answers?.length);
  };
  const eligible = scored.filter((job) => (matchFor(job)?.score ?? 0) >= threshold);
  const todo = eligible.filter(needs);
  const what = withLetters && withAnswers ? "CVs, cover letters and answers" : withLetters ? "CVs and cover letters" : withAnswers ? "CVs and answers" : "CVs";
  const perJob = 1 + (withLetters ? 1 : 0) + (withAnswers ? 1 : 0);

  async function start() {
    if (todo.length === 0) return;
    const minutes = Math.max(1, Math.ceil((todo.length * perJob) / PARALLEL));
    if (
      !window.confirm(
        `Write tailored ${what} for ${todo.length} ${todo.length === 1 ? "job" : "jobs"} matching ${threshold}%+? ` +
          `That's up to ${todo.length * perJob} Claude requests and takes about ${minutes} ${minutes === 1 ? "minute" : "minutes"}.`,
      )
    ) {
      return;
    }
    const queue = [...todo];
    const total = queue.length;
    const run = beginBatch("tailor", page, total, what);
    let done = 0;
    let failed = 0;
    let failedInARow = 0;
    const current = new Set<string>();
    const report = (stopped?: string) => run.report({ done, failed, current: [...current], stopped });

    const materials = (into: Job) => ({
      cv: candidate.cv,
      job: {
        title: into.title.slice(0, 300),
        company: into.company.slice(0, 200),
        location: into.location.slice(0, 200),
        url: into.url.slice(0, 2000),
        description: (tailored[into.id]?.jobDescription ?? into.description).slice(0, 40_000),
      },
      profile: candidate.profile,
      skills: candidate.skills,
      notes: settings.useJobNotes ? saved[into.id]?.notes.slice(0, 4000) || undefined : undefined,
    });

    const draft = async (into: Job) => {
      const answers = await requestAnswers(
        { ...materials(into), questions: DEFAULT_QUESTIONS, details: profile.application },
        run.signal,
      );
      setTailored((previous) => ({
        ...previous,
        [into.id]: { ...previous[into.id], answers, updatedAt: new Date().toISOString() },
      }));
    };

    const write = async (into: Job, kind: "cv" | "cover-letter") => {
      const text = await streamTailored({ kind, ...materials(into), options: settings.tailor }, { signal: run.signal });
      const field = kind === "cv" ? "cv" : "coverLetter";
      setTailored((previous) => ({
        ...previous,
        [into.id]: { ...previous[into.id], [field]: text, updatedAt: new Date().toISOString() },
      }));
    };

    const worker = async () => {
      while (!run.signal.aborted) {
        const job = queue.shift();
        if (!job) return;
        const found = target(job);
        // Saving may fold it into a job saved a moment ago (another copy in this run); the documents go there.
        const into = saved[found.id] ? found : { ...found, id: saveJob(found) };
        const label = `${into.title} at ${into.company}`;
        current.add(label);
        report();
        try {
          const docs = tailored[into.id];
          if (!docs?.cv) await write(into, "cv");
          if (withLetters && !docs?.coverLetter) await write(into, "cover-letter");
          if (withAnswers && !docs?.answers?.length) await draft(into);
          failedInARow = 0;
        } catch (error) {
          if (run.signal.aborted) return;
          // Dropped while the phone had the app in the background: tried again once you're back.
          if (await pausedInBackground(run.signal)) {
            current.delete(label);
            queue.unshift(job);
            report();
            continue;
          }
          failed++;
          failedInARow++;
          // Two failures in a row usually means a problem every job will hit (key, rate limit).
          if (failedInARow >= 2) {
            run.abort();
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
    run.finish();
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
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => stopBatch("tailor", page)}>
            <Square size={12} aria-hidden /> Stop
          </button>
          {progress.current.length > 0 && (
            <p className="muted w-full truncate text-xs">Writing: {progress.current.join("; ")}</p>
          )}
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="font-semibold">{title}</span>
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
          <label className="flex items-center gap-1.5 text-xs">
            <input type="checkbox" checked={withAnswers} onChange={(e) => setWithAnswers(e.target.checked)} />
            Application answers too
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
              Wrote {progress.what} for {progress.done - progress.failed} {progress.done - progress.failed === 1 ? "job" : "jobs"}
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
