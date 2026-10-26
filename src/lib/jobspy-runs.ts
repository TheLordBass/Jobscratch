import { safeEqual } from "@/lib/auth";
import type { DataBackend } from "@/lib/server-data";
import type { Job } from "@/lib/types";

/*
 * The scheduled JobSpy run (scripts/jobspy/scheduled.py): the helper on the user's computer searches
 * every morning and uploads what it found, so the jobs are waiting in the app on any device. Only the
 * latest run is kept: a run replaces the one before.
 */

export const RUN_KEY = "jobscratch:jobspy-run";
export const RUN_JOBS_KEY = "jobscratch:jobspy-run:jobs";
const PAGE_SIZE = 200;

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
  part: { id: string; startedAt: string; query?: string; failed: string[]; jobs: Job[]; done: boolean },
  now = new Date().toISOString(),
): Promise<JobspyRun> {
  const previous = await readRun(backend);
  const sameRun = previous?.id === part.id;
  const run: JobspyRun = {
    id: part.id,
    startedAt: part.startedAt,
    finishedAt: part.done ? now : null,
    query: part.query,
    failed: part.failed,
    count: (sameRun ? previous.count : 0) + part.jobs.length,
  };
  const fields = part.jobs.flatMap((job) => [job.id, JSON.stringify(job)]);
  await backend.run([
    ...(sameRun ? [] : [["DEL", RUN_JOBS_KEY]]),
    ...(fields.length ? [["HSET", RUN_JOBS_KEY, ...fields]] : []),
    ["SET", RUN_KEY, JSON.stringify(run)],
  ]);
  return run;
}

/** One page of the run's jobs; keep asking with the returned cursor until it's "0". */
export async function readRunJobs(backend: DataBackend, cursor = "0"): Promise<{ jobs: Job[]; cursor: string }> {
  const [result] = await backend.run([["HSCAN", RUN_JOBS_KEY, cursor, "COUNT", String(PAGE_SIZE)]]);
  const [next, flat] = result as [string, string[]];
  const jobs: Job[] = [];
  for (let i = 1; i < flat.length; i += 2) jobs.push(JSON.parse(flat[i]) as Job);
  return { jobs, cursor: String(next) };
}
