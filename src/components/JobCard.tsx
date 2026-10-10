"use client";

import { formatPosted, formatSalary } from "@/lib/format";
import type { ApplicationStatus } from "@/lib/store";
import type { Job } from "@/lib/types";

interface Props {
  job: Job;
  status?: ApplicationStatus;
  expanded: boolean;
  onToggle: () => void;
  onSave: () => void;
  onTailor: () => void;
}

const SNIPPET_LENGTH = 600;

export function ApplyButton({ job, className = "" }: { job: Job; className?: string }) {
  if (!job.url) return null;
  const label = job.applyOptions[0]?.label ?? job.sourceName;
  return (
    <a
      href={job.url}
      target="_blank"
      rel="noopener noreferrer"
      className={`btn btn-primary btn-sm ${className}`}
      title={`Open this job on ${label}`}
    >
      Apply on {label} <span aria-hidden>↗</span>
    </a>
  );
}

export function OtherApplyLinks({ job }: { job: Job }) {
  const others = job.applyOptions.slice(1);
  if (others.length === 0) return null;
  return (
    <p className="muted text-xs">
      Also on:{" "}
      {others.map((option, i) => (
        <span key={option.url}>
          {i > 0 && " · "}
          <a href={option.url} target="_blank" rel="noopener noreferrer" className="link">
            {option.label}
          </a>
        </span>
      ))}
    </p>
  );
}

export function JobCard({ job, status, expanded, onToggle, onSave, onTailor }: Props) {
  const salary = formatSalary(job.salary);
  const posted = formatPosted(job.postedAt);
  const isSnippet = job.description.length > 0 && job.description.length < SNIPPET_LENGTH;

  return (
    <article className="card p-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
        {job.companyLogo ? (
          // eslint-disable-next-line @next/next/no-img-element -- logos come from many third-party hosts
          <img
            src={job.companyLogo}
            alt=""
            className="hidden h-10 w-10 shrink-0 rounded-lg border border-zinc-200 bg-white object-contain sm:block dark:border-zinc-800"
            loading="lazy"
            referrerPolicy="no-referrer"
            onError={(event) => {
              event.currentTarget.style.visibility = "hidden";
            }}
          />
        ) : (
          <div className="hidden h-10 w-10 shrink-0 place-items-center rounded-lg bg-zinc-100 text-sm font-semibold text-zinc-500 sm:grid dark:bg-zinc-800">
            {job.company.slice(0, 1).toUpperCase()}
          </div>
        )}
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={onToggle}
            aria-expanded={expanded}
            className="cursor-pointer text-left text-base font-semibold hover:text-indigo-600 dark:hover:text-indigo-400"
          >
            {job.title}
          </button>
          <p className="text-sm text-zinc-700 dark:text-zinc-300">
            {job.company}
            {job.location && <span className="muted"> · {job.location}</span>}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {job.remote && <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">Remote</span>}
            {salary && <span className="chip">{salary}</span>}
            {job.employmentType && <span className="chip capitalize">{job.employmentType}</span>}
            {posted && <span className="chip">{posted}</span>}
            <span className="muted text-xs">via {job.sourceName}</span>
          </div>
        </div>
        <div className="flex shrink-0 flex-wrap gap-1.5 sm:flex-col sm:items-stretch">
          <ApplyButton job={job} />
          <div className="flex gap-1.5">
            <button
              type="button"
              onClick={onSave}
              className={`btn btn-sm flex-1 ${status ? "btn-secondary text-indigo-600 dark:text-indigo-400" : "btn-secondary"}`}
              aria-pressed={Boolean(status)}
            >
              {status ? "★ Saved" : "☆ Save"}
            </button>
            <button type="button" onClick={onTailor} className="btn btn-secondary btn-sm flex-1">
              ✨ Tailor CV
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <OtherApplyLinks job={job} />
          {isSnippet && (
            <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              {job.sourceName} only shares a snippet. Open the listing for the full description, and paste it in when
              you tailor your CV.
            </p>
          )}
          <div className="mt-3 max-h-96 overflow-y-auto text-sm leading-relaxed whitespace-pre-line text-zinc-700 dark:text-zinc-300">
            {job.description || <span className="muted">No description provided.</span>}
          </div>
          {job.tags.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1">
              {job.tags.slice(0, 12).map((tag) => (
                <span key={tag} className="chip">
                  {tag}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </article>
  );
}
