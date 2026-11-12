"use client";

import { Gauge, Square } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useMemo } from "react";
import { useSources } from "@/components/useSources";
import { canMatch, candidateFor, madeFromCurrent, matchFromAnalysis, matchKey, type Candidate } from "@/lib/candidate";
import type { MatchAnalysis } from "@/lib/ai/prompts";
import { hasCvText } from "@/lib/cvs";
import { beginBatch, markBatchSeen, pausedInBackground, stopBatch, useBatch } from "@/lib/batch-runs";
import { matchInBatches, matchesInBackground } from "@/lib/match-batches";
import { siteJobKey } from "@/lib/import";
import { isSavedJob, updateStoredMatch, updateTailoredDocs, useCv, useMatches, useProfile, useSavedJobs, useSettings, useTailored, type StoredMatch } from "@/lib/store";
import type { Job } from "@/lib/types";

/** How many jobs are matched at the same time. */
const PARALLEL = 3;
/** Ask before matching more than this many in one go: each is a full analysis. */
const CONFIRM_ABOVE = 10;

/**
 * The current match for each job: its own analysis (from its page) or the one from Match all,
 * leaving out ones made from an older CV or description, from a snippet, or quick-only scores from
 * before every match was a full analysis.
 * `candidate` is what's sent about the candidate for every job: all their CVs, website and GitHub.
 */
export function useCurrentMatches(): {
  matchFor: (job: Job) => StoredMatch | undefined;
  scoreFor: (job: Job) => ListScore | undefined;
  candidate: Candidate;
  hasCv: boolean;
} {
  const [cv] = useCv();
  const [profile] = useProfile();
  const [matches] = useMatches();
  const [tailored] = useTailored();
  // Worked out once rather than for every job in a list.
  const candidate = useMemo(() => candidateFor(cv, profile), [cv, profile]);
  const matchFor = (job: Job) => {
    // A saved job analysed on its own page (or by the morning run) has its analysis there, and Match
    // all leaves it out, so every list shows that one while it's from the current CV.
    const docs = tailored[job.id];
    if (docs?.analysis && madeFromCurrent(docs, "analysis", candidate)) {
      return matchFromAnalysis(docs.analysis, matchKey(job, candidate), docs.updatedAt);
    }
    const match = matches[job.id];
    // A score made from a snippet (before snippets stopped being matched) isn't shown.
    return match?.analysis && canMatch(job) && match.key === matchKey(job, candidate) ? match : undefined;
  };
  // For lists: the current score, else the last one, made from an earlier CV or description, so a
  // job's score shows at a glance until Match all brings it up to date (as its page shows it).
  const scoreFor = (job: Job): ListScore | undefined => {
    const current = matchFor(job);
    if (current) return { score: current.score, stale: false };
    const earlier = tailored[job.id]?.analysis?.matchScore ?? (canMatch(job) ? matches[job.id]?.score : undefined);
    return earlier === undefined ? undefined : { score: earlier, stale: true };
  };
  return { matchFor, scoreFor, candidate, hasCv: hasCvText(cv) };
}

/** A job's score for a list; `stale` when it was made from an earlier CV or description. */
export interface ListScore {
  score: number;
  stale: boolean;
}


/** Runs a full match analysis of every job in `jobs` against the CV, one Claude request each. */
interface MatchAllProps {
  jobs: Job[];
  /** Called after a run that scored at least one job, e.g. to sort by match. */
  onMatched?: () => void;
}

export function MatchAllButton({ jobs, onMatched }: MatchAllProps) {
  const sources = useSources();
  const { saved } = useSavedJobs();
  const [settings] = useSettings();
  const { matchFor, candidate, hasCv } = useCurrentMatches();
  // Runs in the background (lib/batch-runs.ts), so going to another page doesn't stop it.
  const page = usePathname();
  const progress = useBatch("match", page);
  const running = progress?.status === "running";
  const error = progress?.stopped;

  useEffect(() => {
    if (progress?.status === "done") markBatchSeen("match", page);
  }, [progress?.status, page]);

  const matchable = jobs.filter(canMatch);
  // A saved job analysed on its own page counts as matched (see useCurrentMatches), unless that was from an earlier CV.
  const todo = matchable.filter((job) => !matchFor(job));
  const withoutDescription = jobs.length - matchable.length;
  // The bookmarklet can add the full description for jobs it recognises (LinkedIn, Indeed, Glassdoor).
  const fillable = jobs.filter((job) => !canMatch(job) && siteJobKey(job.url)).length;
  const noCv = !hasCv;
  const noAi = sources !== null && !sources.aiConfigured;

  async function start() {
    if (todo.length === 0) return;
    // On a phone, as batches that carry on while it has the app in the background (lib/match-batches.ts).
    const background = matchesInBackground();
    if (
      todo.length > CONFIRM_ABOVE &&
      !window.confirm(
        background
          ? `Analyse ${todo.length} jobs against your CV? Claude does them all in the background at half price, usually within a few minutes, so you can leave the app meanwhile.`
          : `Analyse ${todo.length} jobs against your CV? Each is a full analysis, one Claude request per job, so it takes a few minutes.`,
      )
    ) {
      return;
    }
    const notesOf = (job: Job) => (settings.useJobNotes ? saved[job.id]?.notes.trim().slice(0, 4000) || undefined : undefined);
    if (background) {
      await matchInBatches(page, candidate, todo.map((job) => ({ job, notes: notesOf(job) })));
      return;
    }
    const queue = [...todo];
    const run = beginBatch("match", page, queue.length);
    let done = 0;
    let failed = 0;

    const worker = async () => {
      while (!run.signal.aborted) {
        const job = queue.shift();
        if (!job) return;
        try {
          const notes = notesOf(job);
          const response = await fetch("/api/tailor/analyze", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              cv: candidate.cv,
              cvs: candidate.cvs,
              profile: candidate.profile,
              skills: candidate.skills,
              job: {
                title: job.title.slice(0, 300),
                company: job.company.slice(0, 200),
                location: job.location.slice(0, 200),
                url: job.url.slice(0, 2000),
                description: job.description.slice(0, 40_000),
              },
              notes,
            }),
            signal: run.signal,
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok) {
            // A missing key or a rate limit will fail every job, so stop rather than spend the rest.
            if ([401, 403, 404, 429, 503].includes(response.status)) {
              run.report({ stopped: data.error ?? `Matching stopped (HTTP ${response.status}).` });
              run.abort();
              return;
            }
            failed++;
          } else {
            const analysis = data as MatchAnalysis;
            const match: StoredMatch = matchFromAnalysis(analysis, matchKey(job, candidate));
            updateStoredMatch(job.id, match);
            // A saved job's page shows it as its analysis straight away.
            if (isSavedJob(job.id)) updateTailoredDocs(job.id, { analysis, analysisFrom: candidate.key });
          }
        } catch {
          if (run.signal.aborted) return;
          // Dropped while the phone had the app in the background: tried again once you're back.
          if (await pausedInBackground(run.signal)) {
            queue.unshift(job);
            continue;
          }
          failed++;
        }
        done++;
        run.report({ done, failed });
      }
    };

    await Promise.all(Array.from({ length: Math.min(PARALLEL, queue.length) }, worker));
    run.finish();
    if (done > failed) onMatched?.();
  }

  const disabledReason = noCv
    ? "Add your CV first, under Profile."
    : noAi
      ? "AI isn’t set up. Add ANTHROPIC_API_KEY (see the README)."
      : matchable.length === 0
        ? "None of these jobs has a full description to match against, only snippets."
        : undefined;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        {running && progress ? (
          <>
            <div className="flex min-w-48 flex-1 items-center gap-2.5" role="status">
              <span className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
                <span
                  className="block h-full rounded-full bg-indigo-600 transition-all"
                  style={{ width: `${(progress.done / progress.total) * 100}%` }}
                />
              </span>
              <span className="text-xs font-semibold tabular-nums">
                {progress.background
                  ? `Claude is matching ${progress.total - progress.done} in the background: you can leave the app, and the scores appear when they’re ready (usually within a few minutes).`
                  : `Matching ${progress.done} of ${progress.total}`}
              </span>
            </div>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => stopBatch("match", page)}>
              <Square size={12} aria-hidden /> Stop
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => void start()}
              disabled={Boolean(disabledReason) || todo.length === 0}
              title={disabledReason ?? "Scores each job against your CV with Claude"}
            >
              <Gauge size={14} aria-hidden />
              {todo.length === 0 && matchable.length > 0
                ? "All matched"
                : `Match ${todo.length === matchable.length ? "all" : "the rest"} to my CV (${todo.length})`}
            </button>
            {progress && (
              <span className="muted text-xs" role="status">
                Matched {progress.done - progress.failed}
                {progress.failed > 0 && `, ${progress.failed} failed (try again to retry them)`}
                {progress.done < progress.total && ", stopped early"}.
              </span>
            )}
            {disabledReason && <span className="muted text-xs">{disabledReason}</span>}
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {withoutDescription > 0 && (
        <p className="muted text-xs">
          {withoutDescription} {withoutDescription === 1 ? "job has" : "jobs have"} no full description (only a snippet, or
          nothing), so {withoutDescription === 1 ? "it isn’t" : "they aren’t"} matched
          {fillable > 0 && (
            <>
              . For the LinkedIn, Indeed or Glassdoor {fillable === 1 ? "one" : "ones"}, open the job there and click your{" "}
              <strong>Send to JobScratch</strong> bookmark: the full description is added to the saved job here
            </>
          )}
          .
        </p>
      )}
    </div>
  );
}
