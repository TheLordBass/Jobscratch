"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { downloadBlob, formatPosted, formatSalary } from "@/lib/format";
import { APPLICATION_STATUSES, useHydrated, useSavedJobs, useTailored, type ApplicationStatus } from "@/lib/store";

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

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${csvSafe(cell).replace(/"/g, '""')}"`).join(",")).join("\n");
}

/** Job titles and notes come from other sites, so stop Excel/Sheets running one that starts like a formula. */
function csvSafe(cell: string): string {
  return /^[=+\-@\t\r]/.test(cell) ? `'${cell}` : cell;
}

export function SavedView() {
  const hydrated = useHydrated();
  const { saved, updateJob, removeJob } = useSavedJobs();
  const [tailored] = useTailored();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");

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
  const shown = statusFilter === "all" ? entries : entries.filter((e) => e.status === statusFilter);

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

  if (!hydrated) return <div className="card muted p-8 text-center text-sm">Loading your jobs…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">My jobs</h1>
          <p className="muted text-sm">Open a job to check your match, tailor your CV and track your application.</p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn btn-ghost btn-sm" onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="card space-y-3 p-8 text-center text-sm">
          <p className="text-base font-medium">No jobs yet</p>
          <p className="muted">Save jobs from a search, or add one from LinkedIn or any link.</p>
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
          <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filter by status">
            {(["all", ...APPLICATION_STATUSES] as const).map((status) => (
              <button
                key={status}
                type="button"
                role="tab"
                aria-selected={statusFilter === status}
                onClick={() => setStatusFilter(status)}
                className={`btn btn-sm ${statusFilter === status ? "btn-primary" : "btn-secondary"}`}
              >
                {status === "all" ? "All" : STATUS_LABEL[status]} <span className="opacity-70">{counts[status] ?? 0}</span>
              </button>
            ))}
          </div>

          {shown.length === 0 && (
            <p className="card muted p-6 text-center text-sm">No jobs are marked “{STATUS_LABEL[statusFilter as ApplicationStatus]}”.</p>
          )}
          <ul className="space-y-2">
            {shown.map(({ job, status, notes, savedAt }) => {
              const docs = tailored[job.id];
              const salary = formatSalary(job.salary);
              const href = `/tailor?job=${encodeURIComponent(job.id)}`;
              return (
                <li key={job.id} className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
                  <div className="min-w-0 flex-1">
                    <Link href={href} className="font-semibold hover:text-indigo-600 dark:hover:text-indigo-400">
                      {job.title}
                    </Link>
                    <p className="text-sm text-zinc-700 dark:text-zinc-300">
                      {job.company}
                      {job.location && <span className="muted"> · {job.location}</span>}
                    </p>
                    <p className="muted mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
                      {docs?.analysis && <span className="chip">{docs.analysis.matchScore}% match</span>}
                      {docs?.cv && <span className="chip">CV tailored</span>}
                      {docs?.coverLetter && <span className="chip">Cover letter</span>}
                      <span>{[salary, `saved ${formatPosted(savedAt)}`, notes.trim() && "has notes"].filter(Boolean).join(" · ")}</span>
                    </p>
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <select
                      className={`input w-auto py-1 text-xs font-medium ${STATUS_STYLE[status]}`}
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
                      {docs?.cv ? "Open" : "Tailor CV"}
                    </Link>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm"
                      onClick={() => {
                        if (window.confirm(`Remove “${job.title}” from your jobs?`)) removeJob(job.id);
                      }}
                      aria-label={`Remove ${job.title}`}
                      title="Remove"
                    >
                      ✕
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
