"use client";

import type { MatchAnalysis } from "@/lib/ai/prompts";
import { beginBatch, type BatchHandle } from "@/lib/batch-runs";
import { MATCH_BATCH_SIZE, matchFromAnalysis, matchKey, type Candidate } from "@/lib/candidate";
import { isSavedJob, updateStoredMatch, updateTailoredDocs } from "@/lib/store";
import type { Job } from "@/lib/types";

/*
 * Match all on a phone. A phone pauses a page as soon as you switch to another app, which would stop
 * matching one job at a time. So the jobs go to Claude as batches instead (half price, through the
 * server: /api/tailor/analyze/batch), which carry on whatever the phone does, and the answers are
 * collected whenever the app is open: every 20 seconds while you're on it, and as soon as you're back.
 * The batches are remembered in this browser, so a phone that reloaded the page still collects them.
 */

interface PendingBatch {
  id: string;
  /** The page Match all was started on, for its progress. */
  page: string;
  /** Each request's job (its custom id is `job-<index>`) and the key its match is saved with. */
  jobs: Array<{ id: string; key: string }>;
  /** The candidate's key, saved with a saved job's analysis (lib/candidate.ts). */
  from?: string;
}

const STORAGE_KEY = "jobscratch:match-batches";
const CHECK_MS = 20_000;
/** Errors that every batch would hit too: the key, the model, the rate limit, the API being down. */
const FATAL = [401, 403, 404, 429, 503];

let pending: PendingBatch[] = [];
let loaded = false;
let timer: ReturnType<typeof setTimeout> | undefined;
let checking = false;
/** Pages whose batches are still being sent: their progress isn't finished until they all are. */
const sending = new Set<string>();
/** The progress shown for each page, and how far it's got. */
const progress = new Map<string, { run: BatchHandle; done: number; failed: number; stopped?: string }>();

function save() {
  try {
    if (pending.length) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(pending));
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or full storage: they're still collected while the page stays open.
  }
}

function load() {
  if (loaded || typeof window === "undefined") return;
  loaded = true;
  try {
    const stored = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    if (Array.isArray(stored)) pending = stored;
  } catch {
    pending = [];
  }
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
}

/** Whether Match all here should go as batches: on a phone or tablet. */
export function matchesInBackground(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(pointer: coarse)").matches;
}

/** The progress for `page`, started when its batches are sent or found again after a reload. */
function progressFor(page: string, total: number) {
  let entry = progress.get(page);
  if (!entry) {
    const run = beginBatch("match", page, total, "", true);
    entry = { run, done: 0, failed: 0 };
    progress.set(page, entry);
    // Stop: the batches are cancelled, and what they'd finished still comes back.
    run.signal.addEventListener("abort", () => {
      entry!.stopped ??= "Stopped.";
      for (const batch of pending.filter((b) => b.page === page)) {
        void fetch(`/api/tailor/analyze/batch?id=${encodeURIComponent(batch.id)}`, { method: "DELETE" }).catch(() => undefined);
      }
    });
  }
  return entry;
}

function report(page: string) {
  const entry = progress.get(page);
  if (!entry) return;
  entry.run.report({ done: entry.done, failed: entry.failed, stopped: entry.stopped });
  if (!sending.has(page) && !pending.some((batch) => batch.page === page)) {
    entry.run.finish();
    progress.delete(page);
  }
}

function schedule() {
  clearTimeout(timer);
  if (pending.length) timer = setTimeout(() => void check(), CHECK_MS);
}

/** Asks after every batch still out, and saves the answers of those that are back. */
async function check() {
  if (checking || !pending.length || document.visibilityState === "hidden") return schedule();
  checking = true;
  try {
    for (const batch of [...pending]) {
      const entry = progressFor(batch.page, batch.jobs.length);
      const response = await fetch(`/api/tailor/analyze/batch?id=${encodeURIComponent(batch.id)}`, { cache: "no-store" }).catch(() => null);
      if (!response) continue;
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Gone (sent with another API key, say): those jobs can be matched again.
        if (response.status === 404) {
          pending = pending.filter((b) => b !== batch);
          entry.done += batch.jobs.length;
          entry.failed += batch.jobs.length;
          save();
          report(batch.page);
        }
        continue;
      }
      if (!data.done) continue;
      const outcomes = data.outcomes as Record<string, { analysis?: MatchAnalysis; error?: string; canceled?: true }>;
      batch.jobs.forEach(({ id, key }, i) => {
        const analysis = outcomes[`job-${i}`]?.analysis;
        entry.done++;
        if (!analysis) {
          entry.failed++;
          return;
        }
        updateStoredMatch(id, matchFromAnalysis(analysis, key));
        // A saved job's page shows it as its analysis straight away.
        if (isSavedJob(id)) updateTailoredDocs(id, { analysis, analysisFrom: batch.from });
      });
      pending = pending.filter((b) => b !== batch);
      save();
      report(batch.page);
    }
  } finally {
    checking = false;
    schedule();
  }
}

/** Picks up batches sent before the page was reloaded. Called once the app has loaded. */
export function resumeMatchBatches() {
  load();
  for (const page of new Set(pending.map((batch) => batch.page))) {
    progressFor(page, pending.filter((batch) => batch.page === page).reduce((sum, batch) => sum + batch.jobs.length, 0));
  }
  void check();
}

/**
 * Sends `jobs` to Claude as batches of up to MATCH_BATCH_SIZE, for the scores to be collected later
 * (see above). Resolves once they're sent.
 */
export async function matchInBatches(page: string, candidate: Candidate, jobs: Array<{ job: Job; notes?: string }>) {
  load();
  const entry = progressFor(page, jobs.length);
  sending.add(page);
  let handled = 0;
  for (let start = 0; start < jobs.length && !entry.run.signal.aborted; start += MATCH_BATCH_SIZE) {
    const chunk = jobs.slice(start, start + MATCH_BATCH_SIZE);
    handled = start + chunk.length;
    const response = await fetch("/api/tailor/analyze/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        cv: candidate.cv,
        cvs: candidate.cvs,
        profile: candidate.profile,
        skills: candidate.skills,
        jobs: chunk.map(({ job, notes }, i) => ({
          customId: `job-${i}`,
          job: {
            title: job.title.slice(0, 300),
            company: job.company.slice(0, 200),
            location: job.location.slice(0, 200),
            url: job.url.slice(0, 2000),
            description: job.description.slice(0, 40_000),
          },
          notes,
        })),
      }),
    }).catch(() => null);
    const data = await response?.json().catch(() => ({}));
    if (!response?.ok) {
      // When every batch would fail the same way, the rest aren't sent either.
      const fatal = !response || FATAL.includes(response.status);
      const lost = fatal ? jobs.length - start : chunk.length;
      if (fatal) handled = jobs.length;
      entry.done += lost;
      entry.failed += lost;
      if (fatal) {
        entry.stopped = data?.error ?? (response ? `Matching stopped (HTTP ${response.status}).` : "Couldn't reach JobScratch.");
        break;
      }
      continue;
    }
    pending.push({ id: data.id, page, jobs: chunk.map(({ job }) => ({ id: job.id, key: matchKey(job, candidate) })), from: candidate.key });
    save();
  }
  // Stopped before they were all sent: the rest count as not matched.
  entry.done += jobs.length - handled;
  entry.failed += jobs.length - handled;
  sending.delete(page);
  report(page);
  schedule();
}
