import { canMatch } from "@/lib/candidate";
import { siteName } from "@/lib/progress";
import type { Job } from "@/lib/types";

/*
 * The "From" and "Show" filters on job lists (search results, JobSpy results
 * and My jobs).
 */

export const DETAIL_FILTERS = [
  { id: "all", label: "All jobs" },
  { id: "matched", label: "Matched" },
  { id: "unmatched", label: "Not matched yet" },
  { id: "no-description", label: "No full description" },
] as const;

export type DetailFilter = (typeof DETAIL_FILTERS)[number]["id"];

export interface JobFilter {
  /** A site name as jobSite gives it, or "" for every site. */
  site: string;
  detail: DetailFilter;
}

export const ANY_JOB: JobFilter = { site: "", detail: "all" };

export const isFiltering = (filter: JobFilter) => filter.site !== "" || filter.detail !== "all";

/** Where the job was found, e.g. "LinkedIn" for "LinkedIn (JobSpy)". */
export const jobSite = (job: Pick<Job, "sourceName">) => siteName(job.sourceName);

/** Matched, not matched yet, or nothing to match against (JobSpy often can't get LinkedIn and Glassdoor descriptions). */
export function detailOf(job: Job, isMatched: (job: Job) => boolean): Exclude<DetailFilter, "all"> {
  if (isMatched(job)) return "matched";
  return canMatch(job) ? "unmatched" : "no-description";
}

export function filterJobs<T>(items: T[], jobOf: (item: T) => Job, filter: JobFilter, isMatched: (job: Job) => boolean): T[] {
  if (!isFiltering(filter)) return items;
  return items.filter((item) => {
    const job = jobOf(item);
    return (!filter.site || jobSite(job) === filter.site) && (filter.detail === "all" || detailOf(job, isMatched) === filter.detail);
  });
}

/** The sites in a list (most jobs first) and how many jobs there are of each kind, for the filter menus. */
export function filterCounts<T>(items: T[], jobOf: (item: T) => Job, isMatched: (job: Job) => boolean) {
  const sites = new Map<string, number>();
  const details: Record<DetailFilter, number> = { all: items.length, matched: 0, unmatched: 0, "no-description": 0 };
  for (const item of items) {
    const job = jobOf(item);
    const site = jobSite(job);
    sites.set(site, (sites.get(site) ?? 0) + 1);
    details[detailOf(job, isMatched)] += 1;
  }
  return {
    sites: [...sites].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
    details,
  };
}
