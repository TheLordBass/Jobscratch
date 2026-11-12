"use client";

import { ArrowRight, Check, MailCheck, Sunrise } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { CompanyMark, MatchBadge } from "@/components/JobCard";
import { PostedDate } from "@/components/JobFlags";
import { useCurrentMatches } from "@/components/MatchAll";
import { daysSinceApplied, followUpsDue } from "@/lib/follow-ups";
import { fetchLatestRun } from "@/lib/jobspy-run-client";
import { TODAY_FROM, TODAY_MAX_DAYS } from "@/lib/morning-prep";
import { useSavedJobs, useTailored, type SavedJob } from "@/lib/store";

/** A shortlist from a run older than this isn't today's any more. */
const TODAY_MS = 30 * 3_600_000;

const jobLink = (id: string, tab?: string) => `/tailor?job=${encodeURIComponent(id)}${tab ? `&tab=${tab}` : ""}`;

/**
 * Today's shortlist from the morning run (lib/morning-prep-server.ts): the best few fresh jobs from
 * employers that name themselves, to apply to while they're new. Those you've applied to drop off.
 */
export function TodayShortlist() {
  const { saved } = useSavedJobs();
  const [tailored] = useTailored();
  const { scoreFor } = useCurrentMatches();
  const [ids, setIds] = useState<string[] | null>(null);

  useEffect(() => {
    let active = true;
    void fetchLatestRun().then(({ run, prep }) => {
      if (!active) return;
      const recent = run && Date.now() - Date.parse(run.startedAt) < TODAY_MS;
      setIds(recent ? (prep?.today ?? []) : []);
    });
    return () => {
      active = false;
    };
  }, []);

  const entries = (ids ?? []).map((id) => saved[id]).filter((entry): entry is SavedJob => Boolean(entry));
  if (entries.length === 0) return null;
  const left = entries.filter((entry) => entry.status === "saved").length;

  return (
    <section className="card space-y-3 p-4" aria-labelledby="today-title" id="today">
      <div>
        <h2 id="today-title" className="flex items-center gap-2 font-semibold">
          <Sunrise size={16} aria-hidden className="text-amber-500" /> Today’s shortlist
        </h2>
        <p className="muted text-sm">
          This morning’s best: {TODAY_FROM}%+ matches posted in the last {TODAY_MAX_DAYS} days, from employers that name
          themselves. {left > 0 ? `Apply to ${left === 1 ? "it" : "these"} today, while the ads are new.` : "All applied to. Well done."}
        </p>
      </div>
      <ul className="space-y-2">
        {entries.map(({ job, status }) => {
          const score = scoreFor(job);
          const docs = tailored[job.id];
          const done = status !== "saved";
          return (
            <li key={job.id} className={`flex items-center gap-3 ${done ? "opacity-60" : ""}`}>
              <CompanyMark job={job} />
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-2">
                  <Link href={jobLink(job.id)} className="font-semibold hover:underline">
                    {job.title}
                  </Link>
                  {score && <MatchBadge score={score.score} stale={score.stale} />}
                </p>
                <p className="muted text-xs">
                  {job.company} {job.postedAt && <>· <PostedDate job={job} /></>}
                </p>
              </div>
              {done ? (
                <span className="inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 dark:text-emerald-300">
                  <Check size={14} aria-hidden /> Applied
                </span>
              ) : (
                <Link href={jobLink(job.id, docs?.cv ? "cv" : undefined)} className="btn btn-primary btn-sm shrink-0">
                  {docs?.cv ? "Apply" : "Tailor CV"} <ArrowRight size={14} aria-hidden />
                </Link>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/** Applications a week or more old with no reply: write a follow-up, or say there's no need. */
export function FollowUps() {
  const { saved, updateJob } = useSavedJobs();
  const [tailored] = useTailored();
  const due = followUpsDue(saved);
  if (due.length === 0) return null;

  return (
    <section className="card space-y-3 p-4" aria-labelledby="follow-ups-title">
      <div>
        <h2 id="follow-ups-title" className="flex items-center gap-2 font-semibold">
          <MailCheck size={16} aria-hidden className="text-indigo-500" /> Follow up ({due.length})
        </h2>
        <p className="muted text-sm">
          Applied a week or more ago and not heard back. A short, polite follow-up to the recruiter or hiring manager keeps
          you in mind.
        </p>
      </div>
      <ul className="space-y-2">
        {due.map((entry) => {
          const { job } = entry;
          const written = Boolean(tailored[job.id]?.followUp);
          return (
            <li key={job.id} className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <div className="min-w-0 flex-1">
                <Link href={jobLink(job.id)} className="font-semibold hover:underline">
                  {job.title}
                </Link>
                <p className="muted text-xs">
                  {job.company} · applied {daysSinceApplied(entry)} days ago
                </p>
              </div>
              <Link href={jobLink(job.id, "followUp")} className="btn btn-primary btn-sm">
                {written ? "Open follow-up" : "Write follow-up"}
              </Link>
              <button
                type="button"
                className="btn btn-secondary btn-sm"
                onClick={() => updateJob(job.id, { followedUpAt: new Date().toISOString() })}
              >
                Done, or no need
              </button>
            </li>
          );
        })}
      </ul>
    </section>
  );
}
