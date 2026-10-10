"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { ApplyButton, OtherApplyLinks } from "@/components/JobCard";
import { downloadBlob, formatPosted, formatSalary } from "@/lib/format";
import { APPLICATION_STATUSES, useHydrated, useSavedJobs, useTailored, type ApplicationStatus } from "@/lib/store";

const STATUS_LABEL: Record<ApplicationStatus, string> = {
  saved: "Saved",
  applied: "Applied",
  interviewing: "Interviewing",
  offer: "Offer",
  rejected: "Closed",
};

const STATUS_STYLE: Record<ApplicationStatus, string> = {
  saved: "bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300",
  applied: "bg-sky-50 text-sky-700 dark:bg-sky-950 dark:text-sky-300",
  interviewing: "bg-amber-50 text-amber-700 dark:bg-amber-950 dark:text-amber-300",
  offer: "bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300",
  rejected: "bg-zinc-100 text-zinc-500 line-through dark:bg-zinc-800 dark:text-zinc-500",
};

function toCsv(rows: string[][]): string {
  return rows.map((row) => row.map((cell) => `"${cell.replace(/"/g, '""')}"`).join(",")).join("\n");
}

export function SavedView() {
  const hydrated = useHydrated();
  const { saved, updateJob, removeJob } = useSavedJobs();
  const [tailored] = useTailored();
  const [statusFilter, setStatusFilter] = useState<ApplicationStatus | "all">("all");
  const [openNotes, setOpenNotes] = useState<string | null>(null);

  const entries = useMemo(
    () => Object.values(saved).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
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

  if (!hydrated) return <div className="card muted p-8 text-center text-sm">Loading saved jobs…</div>;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Saved jobs</h1>
          <p className="muted text-sm">Track where you are with each application.</p>
        </div>
        {entries.length > 0 && (
          <button type="button" className="btn btn-secondary btn-sm" onClick={exportCsv}>
            Export CSV
          </button>
        )}
      </div>

      {entries.length === 0 ? (
        <div className="card muted p-8 text-center text-sm">
          Nothing saved yet. <Link href="/" className="link">Search for jobs</Link> or{" "}
          <Link href="/import" className="link">import one from LinkedIn</Link>.
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

          <div className="space-y-3">
            {shown.map(({ job, status, notes, savedAt }) => {
              const docs = tailored[job.id];
              const salary = formatSalary(job.salary);
              return (
                <article key={job.id} className="card p-4">
                  <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h2 className="font-semibold">{job.title}</h2>
                        <span className={`chip ${STATUS_STYLE[status]}`}>{STATUS_LABEL[status]}</span>
                      </div>
                      <p className="text-sm text-zinc-700 dark:text-zinc-300">
                        {job.company}
                        {job.location && <span className="muted"> · {job.location}</span>}
                      </p>
                      <p className="muted mt-1 text-xs">
                        {[salary, `via ${job.sourceName}`, `saved ${formatPosted(savedAt)}`].filter(Boolean).join(" · ")}
                        {docs?.cv && " · tailored CV ready"}
                        {docs?.analysis && ` · ${docs.analysis.matchScore}% match`}
                      </p>
                      <div className="mt-1">
                        <OtherApplyLinks job={job} />
                      </div>
                    </div>
                    <div className="flex flex-wrap items-center gap-1.5">
                      <ApplyButton job={job} />
                      <Link href={`/tailor?job=${encodeURIComponent(job.id)}`} className="btn btn-secondary btn-sm">
                        ✨ {docs?.cv ? "Open tailored CV" : "Tailor CV"}
                      </Link>
                      <select
                        className="input w-auto py-1 text-xs"
                        value={status}
                        onChange={(e) => updateJob(job.id, { status: e.target.value as ApplicationStatus })}
                        aria-label="Application status"
                      >
                        {APPLICATION_STATUSES.map((s) => (
                          <option key={s} value={s}>
                            {STATUS_LABEL[s]}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={() => setOpenNotes(openNotes === job.id ? null : job.id)}
                      >
                        Notes{notes ? " •" : ""}
                      </button>
                      <button
                        type="button"
                        className="btn btn-danger btn-sm"
                        onClick={() => {
                          if (window.confirm(`Remove “${job.title}” from saved jobs?`)) removeJob(job.id);
                        }}
                      >
                        Remove
                      </button>
                    </div>
                  </div>
                  {openNotes === job.id && (
                    <textarea
                      className="input mt-3 min-h-24"
                      placeholder="Contacts, interview dates, salary discussed…"
                      value={notes}
                      onChange={(e) => updateJob(job.id, { notes: e.target.value })}
                      aria-label={`Notes for ${job.title}`}
                    />
                  )}
                </article>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
