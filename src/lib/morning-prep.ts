/*
 * What the morning JobSpy run does after it's found the jobs, before you're up: score them against
 * your CV, get the best few ready to apply, and tell your phone. The run on your computer asks the
 * site to do it a few jobs at a time (/api/helper/prepare, lib/morning-prep-server.ts), so it uses
 * the CV, settings and API key the app already has. Shared by the browser and the server.
 */

export interface MorningPrepSettings {
  /** Score the run's jobs against your CV, as Match all does. */
  match: boolean;
  /** At most this many analyses a morning: each is one Claude request. */
  matchLimit: number;
  /** Send them as batches: half price, but back later (usually within the hour). */
  batch: boolean;
  /** Save the best matches to My jobs with a tailored CV, ready to apply. */
  ready: boolean;
  /** Only jobs matching this much or more. */
  readyFrom: number;
  /** At most this many a morning. */
  readyLimit: number;
  coverLetters: boolean;
  answers: boolean;
  /** Send a summary to the devices that asked for one (Web Push, lib/push.ts). */
  notify: boolean;
  /**
   * Today's shortlist: the best few fresh jobs from employers that name themselves (TODAY_FROM or more,
   * posted in the last TODAY_MAX_DAYS days), saved to My jobs and named in the summary. Optional, as
   * settings saved before it was added don't have it: on unless turned off.
   */
  shortlist?: boolean;
}

/** Today's shortlist: at most this many jobs, matching this much or more, posted this recently. */
export const TODAY_LIMIT = 5;
export const TODAY_FROM = 65;
export const TODAY_MAX_DAYS = 3;

export const DEFAULT_MORNING_PREP: MorningPrepSettings = {
  match: false,
  matchLimit: 40,
  batch: true,
  ready: false,
  readyFrom: 85,
  readyLimit: 5,
  coverLetters: true,
  answers: true,
  notify: true,
};

export const MATCH_LIMITS = [20, 40, 80, 150];
export const READY_LIMITS = [3, 5, 10];
export const READY_FROM = [90, 85, 80, 75, 70];

/** How far this morning's preparation has got, kept with the run. */
export interface PrepState {
  runId: string;
  matched: number;
  /** Jobs whose analysis failed, not tried again this run. */
  failed: string[];
  /** Jobs made ready to apply (their ids in My jobs), best first. */
  ready: string[];
  readyFailed: string[];
  /** How many of the run's jobs match readyFrom or more, once it's finished. */
  strong?: number;
  /** Why it stopped early, e.g. the API key was refused. */
  stopped?: string;
  /** How many jobs the run had when they were last all matched, so it waits for more before looking again. */
  checkedCount?: number;
  /** Today's shortlist (their ids in My jobs), best first, once it's been picked. */
  today?: string[];
  /** Analyses sent as a batch, not back yet (lib/ai/claude.ts, submitMatchBatch). */
  batch?: PrepBatch;
  /** A batch took too long: the rest are matched one at a time. */
  live?: boolean;
  /** Everything there was to do is done. */
  finished: boolean;
  notified: boolean;
  updatedAt: string;
}

export interface PrepBatch {
  id: string;
  sentAt: string;
  /** Each request's job (its custom id is `job-<index>`) and the key its match is saved with. */
  jobs: Array<{ id: string; key: string }>;
  /** The candidate (lib/candidate.ts) it was sent with: the CVs may have changed by the time it's back. */
  from?: string;
  /** Cancelled for taking too long: what it finished still comes back. */
  canceled?: boolean;
}

export function emptyPrepState(runId: string, now = new Date().toISOString()): PrepState {
  return { runId, matched: 0, failed: [], ready: [], readyFailed: [], finished: false, notified: false, updatedAt: now };
}

/** "Morning run: 214 jobs, 48 matched, 9 at 85%+, 5 ready to apply." */
export function prepSummary(found: number, prep: PrepState, settings: MorningPrepSettings): string {
  const parts = [`${found} ${found === 1 ? "job" : "jobs"} found`];
  if (prep.matched) parts.push(`${prep.matched} matched`);
  if (prep.strong !== undefined && prep.matched) parts.push(`${prep.strong} at ${settings.readyFrom}%+`);
  if (prep.ready.length) parts.push(`${prep.ready.length} ready to apply`);
  return parts.join(", ");
}
