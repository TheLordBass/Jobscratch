"use client";

import { ArrowRight, BriefcaseBusiness, Download, FileText, Mail, StickyNote, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";
import { BulkTailor } from "@/components/BulkTailor";
import { CompanyMark, MatchBadge } from "@/components/JobCard";
import { JobFilters } from "@/components/JobFilters";
import { MatchAllButton, useCurrentMatches } from "@/components/MatchAll";
import { MY_JOBS_TABS, SectionTabs } from "@/components/Nav";
import { downloadBlob, formatPosted, formatSalary } from "@/lib/format";
import { ANY_JOB, filterJobs, type JobFilter } from "@/lib/job-filters";
import {
  APPLICATION_STATUSES,
  useHydrated,
  useSavedJobs,
  useTailored,
  type ApplicationStatus,
  type SavedJob,
} from "@/lib/store";
import type { Job } from "@/lib/types";

export const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Closed",
};

export const STATUS_STYLE: Record<ApplicationStatus, string> = {
  saved: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  applied: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  interviewing: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  offer: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-500",
};

/** The coloured strip down the side of each job. */
const STATUS_ACCENT: Record<ApplicationStatus, string> = {
  saved: "bg-zinc-300 dark:bg-zinc-600",
  applied: "bg-sky-500",
  interviewing: "bg-amber-500",
  offer: "bg-emerald-500",
  rejected: "bg-zinc-200 dark:bg-zinc-700",
};

/**
 * Which jobs the Clear button may remove in each view. Jobs you've applied to
 * (Applied, Interviewing, Offer) are never cleared in bulk; Closed ones only
 * from their own tab.
 */
const CLEARABLE: Record<ApplicationStatus | "all", readonly ApplicationStatus[]> = {
  all: ["saved"],
  saved: ["saved"],
  rejected: ["rejected"],
  applied: [],
  interviewing: [],
  offer: [],
};

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${csvSafe(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Job titles and notes come from other sites, so stop Excel/Sheets running one that starts like a formula. */
function csvSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

export function SavedView() {
  const hydrated = useHydrated();
  const { saved, updateJob, removeJob, removeJobs } = useSavedJobs();
  const [tailored, setTailored] = useTailored();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const { matchFor } = useCurrentMatches();
  const [order, setOrder] = useState<"saved" | "match" | "unmatched">("saved");
  const [jobFilter, setJobFilter] = useState<JobFilter>(ANY_JOB);

  // Newest saved first. Not by last update, or a job would jump to the top as soon as you change its status or notes.
  const entries = useMemo(
    () => Object.values(saved).sort((a, b) => b.savedAt.localeCompare(a.savedAt)),
    [saved],
  );
  const counts = useMemo(() => {
    const result: Record<string, number> = { all: entries.length };
    for (const entry of entries) result[entry.status] = (result[entry.status] ?? 0) + 1;
    return result;
  }, [entries]);
  const byStatus = statusFilter === "all" ? entries : entries.filter((e) => e.status === statusFilter);
  // The full analysis from the job page counts over a quick score; unscored jobs go last.
  const scoreOf = (job: Job) => tailored[job.id]?.analysis?.matchScore ?? matchFor(job)?.score;
  // The From and Show filters narrow the list further, and Match all and the rest act on what's left.
  const isMatched = (job: Job) => scoreOf(job) !== undefined;
  const shown = filterJobs(byStatus, (entry) => entry.job, jobFilter, isMatched);
  const anyScored = entries.some((entry) => scoreOf(entry.job) !== undefined);
  const byScore = (a: SavedJob, b: SavedJob) => (scoreOf(b.job) ?? -1) - (scoreOf(a.job) ?? -1);
  const ordered =
    order === "match" && anyScored
      ? [...shown].sort(byScore)
      : order === "unmatched" && anyScored
        ? // Jobs without a score first (newest saved first, as the sort keeps their order), then best match.
          [...shown].sort((a, b) => Number(isMatched(a.job)) - Number(isMatched(b.job)) || byScore(a, b))
        : shown;
  const clearable = shown.filter((entry) => CLEARABLE[statusFilter].includes(entry.status));

  function exportCsv() {
    const rows = [
      ["Title", "Company", "Location", "Status", "Link", "Source", "Saved", "Notes"],
      ...entries.map((e) => [
        e.job.title,
        e.job.company,
        e.job.location,
        STATUS_LABEL[e.status],
        e.job.url,
        e.job.sourceName,
        e.savedAt.slice(0, 10),
        e.notes,
      ]),
    ];
    downloadBlob(new Blob([toCsv(rows)], { type: "text/csv" }), "jobscratch-applications.csv");
  }

  /** Remove the jobs this view may clear, with their tailored documents. */
  function clearJobs() {
    const ids = clearable.map((entry) => entry.job.id);
    if (ids.length === 0) return;
    const one = ids.length === 1;
    const which =
      statusFilter === "all"
        ? one
          ? "the 1 job you haven’t applied to yet"
          : `the ${ids.length} jobs you haven’t applied to yet`
        : one
          ? `this “${STATUS_LABEL[statusFilter]}” job`
          : `the ${ids.length} “${STATUS_LABEL[statusFilter]}” jobs`;
    const kept = statusFilter === "all" && entries.length > ids.length ? " Jobs you’ve applied to are kept." : "";
    const documents = ids.some((id) => tailored[id])
      ? one
        ? " Its tailored CV and cover letter will be deleted too."
        : " Their tailored CVs and cover letters will be deleted too."
      : "";
    if (!window.confirm(`Remove ${which}?${kept}${documents} This can’t be undone, so use Export CSV first if you want a record.`)) {
      return;
    }
    removeJobs(ids);
    setTailored((previous) => {
      const next = { ...previous };
      for (const id of ids) delete next[id];
      return next;
    });
    setStatusFilter("all");
  }

  if (!hydrated) {
    return (
      <div className="space-y-5">
        <SectionTabs tabs={MY_JOBS_TABS} />
        <div className="card muted p-8 text-center text-sm">Loading your jobs…</div>
      </div>
    );
  }

  const clearLabel = statusFilter === "all" ? "Clear not applied" : `Clear “${STATUS_LABEL[statusFilter]}”`;

  return (
    <div className="space-y-5">
      <SectionTabs tabs={MY_JOBS_TABS} />
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="page-title">My jobs</h1>
          <p className="page-subtitle">Open a job to check your match, tailor your CV and track your application.</p>
        </div>
        {entries.length > 0 && (
          <div className="flex gap-1">
            <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}>
              <Download size={14} aria-hidden /> Export CSV
            </button>
            {CLEARABLE[statusFilter].length > 0 && (
              <button
                type="button"
                className="btn btn-danger btn-sm"
                onClick={clearJobs}
                disabled={clearable.length === 0}
                title={
                  statusFilter === "all"
                    ? "Removes jobs still marked Saved. Jobs you’ve applied to are kept."
                    : `Removes the jobs marked ${STATUS_LABEL[statusFilter]}`
                }
              >
                <Trash2 size={14} aria-hidden /> {clearLabel}
              </button>
            )}
          </div>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="card flex flex-col items-center gap-3 px-6 py-14 text-center">
          <span className="avatar h-14 w-14">
            <BriefcaseBusiness size={24} aria-hidden />
          </span>
          <div>
            <p className="text-base font-bold">No jobs yet</p>
            <p className="muted mt-1 text-sm">Save jobs from a search, or add one from LinkedIn or any link.</p>
          </div>
          <div className="flex justify-center gap-2">
            <Link href="/" className="btn btn-primary">
              Search jobs
            </Link>
            <Link href="/import" className="btn btn-secondary">
              Add a job
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
              {(["all", ...APPLICATION_STATUSES] as const).map((status) => {
                const active = statusFilter === status;
                return (
                  <button
                    key={status}
                    type="button"
                    role="tab"
                    aria-selected={active}
                    onClick={() => setStatusFilter(status)}
                    className={`btn btn-sm rounded-full ${active ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "btn-secondary"}`}
                  >
                    {status === "all" ? "All" : STATUS_LABEL[status]}
                    <span className={active ? "opacity-70" : "muted"}>{counts[status] ?? 0}</span>
                  </button>
                );
              })}
            </div>
            <JobFilters
              items={byStatus}
              jobOf={(entry) => entry.job}
              isMatched={isMatched}
              filter={jobFilter}
              onChange={setJobFilter}
              shown={shown.length}
            />
            {anyScored && (
              <select
                className="input ml-auto w-auto py-1.5 text-xs"
                value={order}
                onChange={(e) => setOrder(e.target.value as "saved" | "match" | "unmatched")}
                aria-label="Order"
              >
                <option value="saved">Newest saved first</option>
                <option value="match">Best match to my CV</option>
                <option value="unmatched">Not matched first</option>
              </select>
            )}
          </div>

          {byStatus.length > 0 && (
            <>
              <MatchAllButton jobs={shown.map((entry) => entry.job)} onMatched={() => setOrder("match")} />
              <BulkTailor jobs={shown.map((entry) => entry.job)} />
            </>
          )}
          {shown.length === 0 && (
            <p className="card muted p-6 text-center text-sm">
              {byStatus.length > 0
                ? "No jobs match these filters."
                : `No jobs are marked “${STATUS_LABEL[statusFilter as ApplicationStatus]}”.`}
            </p>
          )}
          <ul className="space-y-2.5">
            {ordered.map(({ job, status, notes, savedAt }) => {
              const docs = tailored[job.id];
              // The full analysis from the job page wins over a quick score.
              const quick = docs?.analysis ? undefined : matchFor(job);
              const salary = formatSalary(job.salary);
              const href = `/tailor?job=${encodeURIComponent(job.id)}`;
              return (
                <li
                  key={job.id}
                  className="card relative flex flex-col gap-3 overflow-hidden p-4 pl-5 transition hover:border-zinc-300 hover:shadow-md sm:flex-row sm:items-center dark:hover:border-zinc-700"
                >
                  <span className={`absolute inset-y-0 left-0 w-1 ${STATUS_ACCENT[status]}`} aria-hidden />
                  <div className="flex min-w-0 flex-1 gap-3.5">
                    <CompanyMark job={job} />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start gap-2">
                        <Link href={href} className="font-bold hover:text-indigo-600 dark:hover:text-indigo-400">
                          {job.title}
                        </Link>
                        {quick && <MatchBadge score={quick.score} />}
                      </div>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {job.company}
                        {job.location && <span className="muted"> · {job.location}</span>}
                      </p>
                      <p className="muted mt-1.5 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-xs">
                        {docs?.analysis && (
                          <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                            {docs.analysis.matchScore}% match
                          </span>
                        )}
                        {docs?.cv && (
                          <span className="inline-flex items-center gap-1">
                            <FileText size={12} aria-hidden /> CV tailored
                          </span>
                        )}
                        {docs?.coverLetter && (
                          <span className="inline-flex items-center gap-1">
                            <Mail size={12} aria-hidden /> Cover letter
                          </span>
                        )}
                        {notes.trim() && (
                          <span className="inline-flex items-center gap-1">
                            <StickyNote size={12} aria-hidden /> Notes
                          </span>
                        )}
                        <span>{[salary, `saved ${formatPosted(savedAt)}`].filter(Boolean).join(" · ")}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      className={`input w-auto rounded-full border-transparent py-1 pr-7 text-xs font-semibold shadow-none ${STATUS_STYLE[status]}`}
                      value={status}
                      onChange={(e) => updateJob(job.id, { status: e.target.value as ApplicationStatus })}
                      aria-label={`Status of ${job.title}`}
                    >
                      {APPLICATION_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {STATUS_LABEL[s]}
                        </option>
                      ))}
                    </select>
                    <Link href={href} className="btn btn-primary btn-sm">
                      {docs?.cv ? "Open" : "Tailor CV"} <ArrowRight size={14} aria-hidden />
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      onClick={() => {
                        if (window.confirm(`Remove “${job.title}” from your jobs?`)) removeJob(job.id);
                      }}
                      aria-label={`Remove ${job.title}`}
                      title="Remove"
                    >
                      <X size={15} aria-hidden />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
    </div>
  );
}
