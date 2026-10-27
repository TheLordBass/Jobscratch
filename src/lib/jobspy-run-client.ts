import type { JobspyRun, RunJob } from "@/lib/jobspy-runs";
import type { PrepState } from "@/lib/morning-prep";
import type { Job } from "@/lib/types";

/*
 * Reads the scheduled JobSpy run (scripts/jobspy/scheduled.py) back from the server: it searched on
 * the user's computer and uploaded what it found.
 */

export type { JobspyRun };

/** The address that opens Add a job with the morning run's jobs shown. */
export const MORNING_RUN_HASH = "#morning-run";

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { cache: "no-store" });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error ?? `HTTP ${response.status}`);
  return data as T;
}

/** The latest run, or null if there's none (or no server storage), and how far its preparation has got. */
export async function fetchLatestRun(): Promise<{ run: JobspyRun | null; prep: PrepState | null }> {
  try {
    const { run, prep } = await getJson<{ run: JobspyRun | null; prep?: PrepState | null }>("/api/jobspy-run");
    return { run, prep: prep ?? null };
  } catch {
    return { run: null, prep: null };
  }
}

/** The run's jobs, and for each one the title lists whose searches found it. */
export async function fetchRunJobs(): Promise<{ jobs: Job[]; lists: Record<string, string[]> }> {
  const jobs: Job[] = [];
  const lists: Record<string, string[]> = {};
  let cursor = "0";
  do {
    const page = await getJson<{ jobs: RunJob[]; cursor: string }>(`/api/jobspy-run?cursor=${cursor}`);
    for (const found of page.jobs) {
      jobs.push(found.job);
      if (found.lists.length) lists[found.job.id] = found.lists;
    }
    cursor = page.cursor;
  } while (cursor !== "0");
  return { jobs, lists };
}

/** "today at 07:02", "yesterday at 07:02" or "on Mon 26 Oct at 07:02". */
export function runTime(iso: string, now = new Date()): string {
  const date = new Date(iso);
  const time = date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  const day = (d: Date) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
  const days = Math.round((day(now) - day(date)) / 86_400_000);
  if (days === 0) return `today at ${time}`;
  if (days === 1) return `yesterday at ${time}`;
  return `on ${date.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" })} at ${time}`;
}
