"use client";

import { ArrowUpRight, CheckCircle2, ChevronDown, Download, FileText } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { EMPTY_DETAILS } from "@/components/ApplicationDetailsForm";
import { BulkTailor } from "@/components/BulkTailor";
import { CopyButton } from "@/components/CopyButton";
import { CompanyMark, MatchBadge } from "@/components/JobCard";
import { useCurrentMatches } from "@/components/MatchAll";
import { MY_JOBS_TABS, SectionTabs } from "@/components/Nav";
import { APPLICATION_DETAIL_LABELS, type ApplicationDetails } from "@/lib/ai/prompts";
import { applyQueue, documentFileName } from "@/lib/apply";
import { markdownToDocx } from "@/lib/export-docx";
import { downloadBlob } from "@/lib/format";
import { markdownToPlainText } from "@/lib/markdown";
import { useHydrated, useProfile, useSavedJobs, useTailored, type SavedJob, type TailoredDocs } from "@/lib/store";

/**
 * My jobs → Apply: the saved jobs you haven't applied to yet that have a tailored CV, best match
 * first, with everything to hand: the application link, the CV to upload, the cover letter and
 * answers to paste, and your standard details. You apply on the job's own site, then mark it applied.
 */
export function ApplyView() {
  const hydrated = useHydrated();
  const { saved, updateJob } = useSavedJobs();
  const [tailored] = useTailored();
  const [profile] = useProfile();
  const { matchFor } = useCurrentMatches();
  const details = { ...EMPTY_DETAILS, ...profile.application };
  const hasDetails = Object.values(details).some((value) => value.trim());
  const { ready, notReady } = applyQueue(saved, tailored, (entry) => matchFor(entry.job)?.score);
  const [applied, setApplied] = useState<string[]>([]);

  return (
    <div className="space-y-4">
      <SectionTabs tabs={MY_JOBS_TABS} />
      <div>
        <h1 className="page-title">Ready to apply</h1>
        <p className="page-subtitle">
          Saved jobs with a tailored CV, best match first. Open the application, upload the CV and paste the rest, then mark
          it applied.
        </p>
      </div>

      {!hydrated ? (
        <div className="card muted p-8 text-center text-sm">Loading…</div>
      ) : (
        <>
          {applied.length > 0 && (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" role="status">
              Marked applied: {applied.join("; ")}. They’re counted in{" "}
              <Link href="/progress" className="link">
                Progress
              </Link>
              .
            </p>
          )}
          {!hasDetails && (
            <p className="muted text-sm">
              Tip: add your right to work, notice period and salary under{" "}
              <Link href="/cv" className="link">
                Profile → Application details
              </Link>
              , and they’ll be here to copy, and used in drafted answers.
            </p>
          )}

          {ready.length === 0 ? (
            <div className="card muted p-8 text-center text-sm">
              {notReady.length > 0
                ? "No job is ready yet: get some ready below, or tailor a CV on a job’s page."
                : "Nothing to apply to: save some jobs first, from Find jobs."}
            </div>
          ) : (
            <ul className="space-y-3">
              {ready.map((entry) => (
                <ApplyCard
                  key={entry.job.id}
                  entry={entry}
                  docs={tailored[entry.job.id]}
                  score={matchFor(entry.job)?.score}
                  details={details}
                  onApplied={() => {
                    updateJob(entry.job.id, { status: "applied" });
                    setApplied((previous) => [...previous, `${entry.job.title} at ${entry.job.company}`]);
                  }}
                />
              ))}
            </ul>
          )}

          {notReady.length > 0 && (
            <section className="space-y-2" aria-labelledby="not-ready-title">
              <h2 id="not-ready-title" className="text-sm font-semibold">
                Not ready yet ({notReady.length})
              </h2>
              <BulkTailor jobs={notReady.map((entry) => entry.job)} title="Get top matches ready" ready />
              <p className="muted text-xs">
                Writes a tailored CV, cover letter and application answers for each matched job at or above the chosen match.
                Jobs that aren’t matched yet need{" "}
                <Link href="/saved" className="link">
                  Match all
                </Link>{" "}
                first, or open one to tailor it by hand.
              </p>
            </section>
          )}
        </>
      )}
    </div>
  );
}

function ApplyCard({
  entry,
  docs,
  score,
  details,
  onApplied,
}: {
  entry: SavedJob;
  docs: TailoredDocs | undefined;
  score: number | undefined;
  details: ApplicationDetails;
  onApplied: () => void;
}) {
  const { job } = entry;
  const [open, setOpen] = useState(false);
  const cv = docs?.cv ?? "";
  const letter = docs?.coverLetter;
  const answers = docs?.answers ?? [];
  const apply = job.applyOptions[0] ?? (job.url ? { label: job.sourceName, url: job.url } : undefined);
  const filled = (Object.keys(APPLICATION_DETAIL_LABELS) as Array<keyof ApplicationDetails>).filter((key) => details[key].trim());
  const jobLink = `/tailor?job=${encodeURIComponent(job.id)}`;

  return (
    <li className="card space-y-3 p-4">
      <div className="flex items-start gap-3">
        <CompanyMark job={job} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-2">
            <Link href={jobLink} className="font-semibold hover:underline">
              {job.title}
            </Link>
            {score !== undefined && <MatchBadge score={score} />}
          </p>
          <p className="text-sm">
            {job.company}
            {job.location && <span className="muted"> · {job.location}</span>}
          </p>
          <p className="muted mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-xs">
            <span>✓ Tailored CV</span>
            <span>{letter ? "✓ Cover letter" : "No cover letter"}</span>
            <span>{answers.length ? `✓ ${answers.length} ${answers.length === 1 ? "answer" : "answers"}` : "No answers"}</span>
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5">
        {apply && (
          <a href={apply.url} target="_blank" rel="noopener noreferrer" className="btn btn-primary btn-sm">
            Apply on {apply.label} <ArrowUpRight size={14} aria-hidden />
          </a>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          onClick={async () => downloadBlob(await markdownToDocx(cv, `${job.title} at ${job.company}`), `${documentFileName(cv, "cv", job.company)}.docx`)}
        >
          <Download size={13} aria-hidden /> CV (.docx)
        </button>
        {letter && <CopyButton text={markdownToPlainText(letter)} label="Copy cover letter" />}
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(!open)} aria-expanded={open}>
          <ChevronDown size={14} aria-hidden className={open ? "rotate-180" : ""} /> Answers and details
        </button>
        <button type="button" className="btn btn-secondary btn-sm ml-auto" onClick={onApplied}>
          <CheckCircle2 size={14} aria-hidden /> Mark as applied
        </button>
      </div>

      {open && (
        <div className="space-y-3 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          {answers.length > 0 ? (
            answers.map((a) => (
              <div key={a.question} className="space-y-1">
                <div className="flex items-start gap-2">
                  <p className="min-w-0 flex-1 text-sm font-semibold">{a.question}</p>
                  <CopyButton text={a.answer} className="shrink-0" />
                </div>
                <p className="muted line-clamp-3 text-sm">{a.answer}</p>
              </div>
            ))
          ) : (
            <p className="muted text-sm">
              No drafted answers yet.{" "}
              <Link href={`${jobLink}&tab=answers`} className="link">
                Draft them on the job’s page
              </Link>
              .
            </p>
          )}
          {filled.length > 0 && (
            <dl className="grid gap-2 sm:grid-cols-2">
              {filled.map((key) => (
                <div key={key} className="flex items-start gap-2 rounded-lg bg-zinc-50 px-3 py-2 dark:bg-zinc-900">
                  <div className="min-w-0 flex-1">
                    <dt className="muted text-xs">{APPLICATION_DETAIL_LABELS[key]}</dt>
                    <dd className="text-sm">{details[key]}</dd>
                  </div>
                  <CopyButton text={details[key]} label="" className="shrink-0 px-2" />
                </div>
              ))}
            </dl>
          )}
          <p className="text-xs">
            <Link href={`${jobLink}&tab=answers`} className="link inline-flex items-center gap-1">
              <FileText size={12} aria-hidden /> Edit the answers, or add a question from the form
            </Link>
          </p>
        </div>
      )}
    </li>
  );
}
