"use client";

import { DETAIL_FILTERS, filterCounts, filterJobs, isFiltering, type DetailFilter, type JobFilter } from "@/lib/job-filters";
import type { Job } from "@/lib/types";

interface Props<T> {
  items: T[];
  jobOf: (item: T) => Job;
  isMatched: (job: Job) => boolean;
  filter: JobFilter;
  onChange: (filter: JobFilter) => void;
  /** How many are left after filtering, for "Showing 4 of 30". */
  shown: number;
}

/** "From [site]" and "Show [matched / not matched yet / no full description]". */
export function JobFilters<T>({ items, jobOf, isMatched, filter, onChange, shown }: Props<T>) {
  if (items.length === 0) return null;
  const { sites } = filterCounts(items, jobOf, isMatched);
  // With a site picked, the Show counts are for that site.
  const { details } = filterCounts(filterJobs(items, jobOf, { site: filter.site, detail: "all" }, isMatched), jobOf, isMatched);
  return (
    <div className="flex flex-wrap items-center gap-2">
      {(sites.length > 1 || filter.site) && (
        <select
          className="input w-auto py-1.5 text-xs"
          value={filter.site}
          onChange={(e) => onChange({ ...filter, site: e.target.value })}
          aria-label="From site"
        >
          <option value="">From any site</option>
          {sites.map((site) => (
            <option key={site.name} value={site.name}>
              From {site.name} ({site.count})
            </option>
          ))}
        </select>
      )}
      <select
        className="input w-auto py-1.5 text-xs"
        value={filter.detail}
        onChange={(e) => onChange({ ...filter, detail: e.target.value as DetailFilter })}
        aria-label="Show"
      >
        {DETAIL_FILTERS.map((option) => (
          <option key={option.id} value={option.id} disabled={option.id !== "all" && details[option.id] === 0 && filter.detail !== option.id}>
            {option.label} ({details[option.id]})
          </option>
        ))}
      </select>
      {isFiltering(filter) && (
        <span className="muted text-xs">
          Showing {shown} of {items.length}.{" "}
          <button type="button" className="link cursor-pointer" onClick={() => onChange({ site: "", detail: "all" })}>
            Clear
          </button>
        </span>
      )}
    </div>
  );
}
