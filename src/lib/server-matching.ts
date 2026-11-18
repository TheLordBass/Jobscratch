"use client";

import { beginBatch, type BatchHandle } from "@/lib/batch-runs";
import { MATCH_BATCH_SIZE, matchKey, type Candidate } from "@/lib/candidate";
import type { MatchQueueStatus } from "@/lib/match-queue-server";
import { flush, refreshFromServer } from "@/lib/sync";
import type { Job } from "@/lib/types";

/*
 * Match all, done by the server (lib/match-queue-server.ts) whenever server storage is on. The jobs are
 * sent to it and it matches them whether or not the app stays open. The scores come with the rest of
 * the synced data, a few times a minute, rather than one at a time: saving each one as it came back
 * is what made a phone freeze on a big run.
 */

/** Where the run was started, kept in this browser so a reloaded page still shows its progress. */
const STORAGE_KEY = "jobscratch:server-match";
/** How often to ask how far it's got while the app is open. */
const CHECK_MS = 15_000;
/** How often to fetch the scores made since, while it's going (and once at the end). */
const REFRESH_MS = 45_000;

let current: { page: string; run: BatchHandle } | undefined;
let timer: ReturnType<typeof setTimeout> | undefined;
let lastRefresh = 0;
let listening = false;

function remember(page: string | null) {
  try {
    if (page) window.localStorage.setItem(STORAGE_KEY, page);
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing: the progress shows while the page stays open.
  }
}

function listen() {
  if (listening) return;
  listening = true;
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void check();
  });
}

function track(page: string, total: number): BatchHandle {
  if (current?.page === page) return current.run;
  const run = beginBatch("match", page, total, "", true);
  current = { page, run };
  // Stop: the jobs still waiting are dropped; the scores made so far are kept.
  run.signal.addEventListener("abort", () => {
    void fetch("/api/match", { method: "DELETE" })
      .catch(() => undefined)
      .then(() => end(true));
  });
  remember(page);
  listen();
  return run;
}

async function end(refresh: boolean) {
  clearTimeout(timer);
  const run = current?.run;
  current = undefined;
  remember(null);
  if (refresh) await refreshFromServer();
  run?.finish();
}

/** Asks how far it's got; fetches the new scores now and then, and all of them once it's done. */
async function check() {
  clearTimeout(timer);
  if (!current) return;
  if (document.visibilityState === "hidden") return;
  const response = await fetch("/api/match", { cache: "no-store" }).catch(
    () => null,
  );
  const data = response?.ok
    ? ((await response.json().catch(() => null)) as {
        status: MatchQueueStatus | null;
      } | null)
    : null;
  const status = data?.status;
  if (current && status) {
    current.run.report({
      total: status.total,
      done: status.done,
      failed: status.failed,
      stopped: status.stopped,
    });
    if (status.waiting === 0 || status.stopped) {
      await end(true);
      return;
    }
    if (Date.now() - lastRefresh > REFRESH_MS) {
      lastRefresh = Date.now();
      await refreshFromServer();
    }
  }
  if (current) timer = setTimeout(() => void check(), CHECK_MS);
}

/**
 * Sends `jobs` to the server to match, MATCH_BATCH_SIZE at a time. Resolves once they're sent; the
 * progress then shows on `page` until the server has done them.
 */
export async function matchOnServer(
  page: string,
  candidate: Candidate,
  jobs: Array<{ job: Job; notes?: string }>,
) {
  // The server matches with the CVs it has, so this browser's latest changes go first.
  await flush();
  const run = track(page, jobs.length);
  lastRefresh = Date.now();
  for (
    let start = 0;
    start < jobs.length && !run.signal.aborted;
    start += MATCH_BATCH_SIZE
  ) {
    const chunk = jobs.slice(start, start + MATCH_BATCH_SIZE);
    const response = await fetch("/api/match", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        jobs: chunk.map(({ job, notes }) => ({
          id: job.id,
          job: {
            title: job.title.slice(0, 300),
            company: job.company.slice(0, 200),
            location: job.location.slice(0, 200),
            url: job.url.slice(0, 2000),
            description: job.description.slice(0, 40_000),
          },
          notes,
          // Worked out here from the whole description, so the score matches the job as this app has it.
          hash: matchKey(job, candidate).slice(candidate.key.length + 1),
        })),
      }),
    }).catch(() => null);
    if (!response?.ok) {
      const data = await response?.json().catch(() => ({}));
      run.report({
        stopped:
          data?.error ??
          (response
            ? `Matching stopped (HTTP ${response.status}).`
            : "Couldn't reach JobScratch."),
      });
      // Those already sent are still matched.
      if (start === 0) {
        await end(false);
        return;
      }
      break;
    }
  }
  void check();
}

/** Picks up a run started before the page was reloaded. Called once the app has loaded. */
export function resumeServerMatching() {
  let page: string | null = null;
  try {
    page = window.localStorage.getItem(STORAGE_KEY);
  } catch {
    return;
  }
  if (!page) return;
  track(page, 0);
  void check();
}
