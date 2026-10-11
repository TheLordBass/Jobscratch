"use client";

import { ArrowUpRight, Banknote, Bookmark, BookmarkCheck, Clock, MapPin, Sparkles, Wifi } from "lucide-react";
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
      Apply on {label} <ArrowUpRight size={14} aria-hidden />
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

/** The company's logo, or its first letter. */
export function CompanyMark({ job, size = "md" }: { job: Job; size?: "md" | "lg" }) {
  const box = size === "lg" ? "h-12 w-12 text-lg" : "h-11 w-11 text-base";
  if (job.companyLogo) {
    return (
      // eslint-disable-next-line @next/next/no-img-element -- logos come from many third-party hosts
      <img
        src={job.companyLogo}
        alt=""
        className={`${box} shrink-0 rounded-xl border border-zinc-200 bg-white object-contain p-1 dark:border-zinc-700`}
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={(event) => {
          event.currentTarget.style.visibility = "hidden";
        }}
      />
    );
  }
  return (
    <div className={`avatar ${box}`} aria-hidden>
      {(job.company.trim()[0] ?? "?").toUpperCase()}
    </div>
  );
}

export function JobCard({ job, status, expanded, onToggle, onSave, onTailor }: Props) {
  const salary = formatSalary(job.salary);
  const posted = formatPosted(job.postedAt);
  const isSnippet = job.description.length > 0 && job.description.length < SNIPPET_LENGTH;

  return (
    <article className="card group p-4 transition hover:border-zinc-300 hover:shadow-md dark:hover:border-zinc-700 sm:p-5">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start">
        <div className="flex min-w-0 flex-1 gap-3.5">
          <CompanyMark job={job} />
          <div className="min-w-0 flex-1">
            <button
              type="button"
              onClick={onToggle}
              aria-expanded={expanded}
              className="cursor-pointer text-left text-base leading-snug font-bold hover:text-indigo-600 dark:hover:text-indigo-400"
            >
              {job.title}
            </button>
            <p className="mt-0.5 text-sm font-medium text-zinc-700 dark:text-zinc-300">{job.company}</p>
            <div className="muted mt-2 flex flex-wrap items-center gap-x-3.5 gap-y-1 text-xs">
              {job.location && (
                <span className="inline-flex items-center gap-1">
                  <MapPin size={13} aria-hidden /> {job.location}
                </span>
              )}
              {job.remote && (
                <span className="inline-flex items-center gap-1 font-semibold text-emerald-700 dark:text-emerald-400">
                  <Wifi size={13} aria-hidden /> Remote
                </span>
              )}
              {salary && (
                <span className="inline-flex items-center gap-1 font-medium text-zinc-700 dark:text-zinc-300">
                  <Banknote size={13} aria-hidden /> {salary}
                </span>
              )}
              {posted && (
                <span className="inline-flex items-center gap-1">
                  <Clock size={13} aria-hidden /> {posted}
                </span>
              )}
              {job.employmentType && <span className="capitalize">{job.employmentType}</span>}
              <span>via {job.sourceName}</span>
            </div>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1.5 sm:flex-col sm:items-end">
          <ApplyButton job={job} />
          <div className="flex gap-1.5">
            <button type="button" onClick={onTailor} className="btn btn-secondary btn-sm">
              <Sparkles size={14} aria-hidden /> Tailor CV
            </button>
            <button
              type="button"
              onClick={onSave}
              className={`btn btn-secondary btn-sm btn-icon ${status ? "border-indigo-200 bg-indigo-50 text-indigo-600 dark:border-indigo-900 dark:bg-indigo-950 dark:text-indigo-300" : ""}`}
              aria-pressed={Boolean(status)}
              aria-label={status ? "Saved. Click to remove" : "Save job"}
              title={status ? "Saved" : "Save"}
            >
              {status ? <BookmarkCheck size={15} aria-hidden /> : <Bookmark size={15} aria-hidden />}
            </button>
          </div>
        </div>
      </div>

      {expanded && (
        <div className="mt-4 border-t border-zinc-100 pt-4 dark:border-zinc-800">
          <OtherApplyLinks job={job} />
          {isSnippet && (
            <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
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
