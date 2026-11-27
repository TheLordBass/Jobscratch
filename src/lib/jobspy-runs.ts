import { safeEqual } from "@/lib/auth";
import { dismissKeys } from "@/lib/import";
import type { DataBackend } from "@/lib/server-data";
import type { Job } from "@/lib/types";

/*
 * The scheduled JobSpy run (scripts/jobspy/scheduled.py): the helper on the user's computer searches
 * every morning and uploads what it found, so the jobs are waiting in the app on any device. Only the
 * latest run is kept: a run replaces the one before.
 */

export const RUN_KEY = "jobscratch:jobspy-run";
export const RUN_JOBS_KEY = "jobscratch:jobspy-run:jobs";
/** How far the run's matching and getting jobs ready has got (lib/morning-prep-server.ts). */
export const RUN_PREP_KEY = "jobscratch:jobspy-run:prep";
/**
 * Every job earlier runs found, by each of its keys (its id, its links, its title and company: see
 * dismissKeys), with when it was first found. So a job a run finds again, on the same site or
 * another, is marked as found before and the app can hide it.
 */
export const SEEN_KEY = "jobscratch:jobspy-seen";
/** How long a job is remembered: runs look back two days, so a job older than this won't come back. */
const SEEN_DAYS = 14;
const PAGE_SIZE = 200;
const DAY_MS = 86_400_000;

type Env = Record<string, string | undefined>;

export interface JobspyRun {
  id: string;
  /** When the helper started the run. */
  startedAt: string;
  /** When the last part arrived; null while it's still uploading. */
  finishedAt: string | null;
  /** What was searched for, e.g. "data analyst, BI analyst in Manchester". */
  query?: string;
  /** Searches that failed or that LinkedIn turned away. */
  failed: string[];
  count: number;
  /** The title lists searched (lib/jobspy-lists.ts), when it searched lists. */
  lists?: string[];
  /** Which part of the title lists this was, when they take several mornings to get through. */
  batch?: { index: number; count: number };
}

/** A job the run found, and the title lists whose searches found it. */
export interface RunJob {
  job: Job;
  lists: string[];
  /** When an earlier run first found this job, if one did. */
  seenBefore?: string;
}

/** The token the helper sends (JOBSCRATCH_HELPER_TOKEN), long enough not to be guessed. */
export function helperTokenConfigured(env: Env): boolean {
  return (env.JOBSCRATCH_HELPER_TOKEN?.trim().length ?? 0) >= 24;
}

export function checkHelperToken(env: Env, header: string | null): boolean {
  if (!helperTokenConfigured(env) || !header?.startsWith("Bearer ")) return false;
  return safeEqual(header.slice("Bearer ".length).trim(), env.JOBSCRATCH_HELPER_TOKEN!.trim());
}

export async function readRun(backend: DataBackend): Promise<JobspyRun | null> {
  const [raw] = await backend.run([["GET", RUN_KEY]]);
  return typeof raw === "string" ? (JSON.parse(raw) as JobspyRun) : null;
}

/**
 * Adds one part of a run. The first part of a new run (a new id) replaces the previous run; `done`
 * marks the last part.
 */
export async function saveRunPart(
  backend: DataBackend,
  part: {
    id: string;
    startedAt: string;
    query?: string;
    failed: string[];
    jobs: RunJob[];
    done: boolean;
    lists?: string[];
    batch?: { index: number; count: number };
  },
  now = new Date().toISOString(),
): Promise<JobspyRun> {
  const previous = await readRun(backend);
  const sameRun = previous?.id === part.id;
  // A new run: the one it replaces is remembered first, so its jobs count as found before.
  if (previous && !sameRun) await rememberRun(backend, previous, Date.parse(now));
  const jobs = await markSeen(backend, part.jobs);
  const fields = jobs.flatMap((found) => [found.job.id, JSON.stringify(found)]);
  // Counted from what's stored, so a part sent twice (a retry after a timeout) or a job sent again
  // (found by another title list) isn't counted twice.
  const results = await backend.run([
    ...(sameRun ? [] : [["DEL", RUN_JOBS_KEY]]),
    ...(fields.length ? [["HSET", RUN_JOBS_KEY, ...fields]] : []),
    ["HLEN", RUN_JOBS_KEY],
  ]);
  const run: JobspyRun = {
    id: part.id,
    startedAt: part.startedAt,
    finishedAt: part.done ? now : null,
    query: part.query,
    // Failed searches are only known at the end; parts sent during the run have none yet.
    failed: part.failed.length || !sameRun ? part.failed : previous.failed,
    count: Number(results.at(-1)) || 0,
    ...(part.lists?.length && { lists: part.lists }),
    ...(part.batch && { batch: part.batch }),
  };
  await backend.run([["SET", RUN_KEY, JSON.stringify(run)]]);
  return run;
}

async function scan(backend: DataBackend, key: string, each: (field: string, value: string) => void) {
  let cursor = "0";
  do {
    const [result] = await backend.run([["HSCAN", key, cursor, "COUNT", String(PAGE_SIZE)]]);
    const [next, flat] = result as [string, string[]];
    for (let i = 0; i + 1 < flat.length; i += 2) each(flat[i], flat[i + 1]);
    cursor = String(next);
  } while (cursor !== "0");
}

/** Adds a finished run's jobs to the ones found before (keeping the earliest date), and forgets old ones. */
async function rememberRun(backend: DataBackend, run: JobspyRun, now: number) {
  const seen = new Map<string, string>();
  await scan(backend, SEEN_KEY, (key, at) => seen.set(key, at));
  const stale = [...seen].filter(([, at]) => now - Date.parse(at) > SEEN_DAYS * DAY_MS).map(([key]) => key);
  const added: string[] = [];
  await scan(backend, RUN_JOBS_KEY, (_, raw) => {
    const value = JSON.parse(raw) as RunJob | Job;
    const job = "job" in value ? value.job : value;
    const at = ("job" in value && value.seenBefore) || run.startedAt;
    for (const key of dismissKeys(job)) {
      const known = seen.get(key);
      if (known && known <= at) continue;
      seen.set(key, at);
      added.push(key, at);
    }
  });
  for (let i = 0; i < stale.length; i += 500) await backend.run([["HDEL", SEEN_KEY, ...stale.slice(i, i + 500)]]);
  for (let i = 0; i < added.length; i += 1000) await backend.run([["HSET", SEEN_KEY, ...added.slice(i, i + 1000)]]);
}

/** Each job with when an earlier run first found it, by any of its keys. */
async function markSeen(backend: DataBackend, jobs: RunJob[]): Promise<RunJob[]> {
  const keys = jobs.map(({ job }) => dismissKeys(job));
  const all = [...new Set(keys.flat())];
  if (!all.length) return jobs;
  const [values] = await backend.run([["HMGET", SEEN_KEY, ...all]]);
  const at = new Map(all.map((key, i) => [key, (values as Array<string | null>)[i]]));
  return jobs.map((found, i) => {
    const dates = keys[i].map((key) => at.get(key)).filter((date): date is string => typeof date === "string");
    if (!dates.length) return found;
    return { ...found, seenBefore: dates.sort()[0] };
  });
}

/** One page of the run's jobs; keep asking with the returned cursor until it's "0". */
export async function readRunJobs(backend: DataBackend, cursor = "0"): Promise<{ jobs: RunJob[]; cursor: string }> {
  const [result] = await backend.run([["HSCAN", RUN_JOBS_KEY, cursor, "COUNT", String(PAGE_SIZE)]]);
  const [next, flat] = result as [string, string[]];
  const jobs: RunJob[] = [];
  for (let i = 1; i < flat.length; i += 2) {
    const value = JSON.parse(flat[i]) as RunJob | Job;
    // Runs from before title lists stored the job on its own.
    jobs.push("job" in value ? value : { job: value, lists: [] });
  }
  return { jobs, cursor: String(next) };
}
