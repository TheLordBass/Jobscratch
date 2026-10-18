"use client";

import { BookmarkPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCurrentMatches } from "@/components/MatchAll";
import { canMatch } from "@/lib/candidate";
import { siteName } from "@/lib/progress";
import { useSavedJobs, useSettings } from "@/lib/store";
import type { Job } from "@/lib/types";

const THRESHOLDS = [50, 60, 70, 80, 90, 100] as const;
const thresholdLabel = (threshold: number) => (threshold >= 100 ? "100%" : `${threshold}% or more`);

const jobsLabel = (count: number) => `${count} ${count === 1 ? "job" : "jobs"}`;
const listSites = (jobs: Job[]) => [...new Set(jobs.map((job) => siteName(job.sourceName)))].join(", ");

/**
 * Saves only the jobs that match your CV well enough, instead of all of them, and optionally the
 * ones with no full description to match (often LinkedIn and Glassdoor), to fill in one by one.
 * Until the jobs are matched it says to run Match all first.
 */
export function SaveByMatch({ jobs }: { jobs: Job[] }) {
  const { saved, saveJobs } = useSavedJobs();
  const { matchFor } = useCurrentMatches();
  const [settings, setSettings] = useSettings();
  const [justSaved, setJustSaved] = useState<{ total: number; bare: number } | null>(null);

  const min = settings.saveMatchesFrom;
  const withBare = settings.saveUndescribed;
  const scored = jobs.filter((job) => matchFor(job));
  // Nothing here can be matched (no full descriptions), so there is nothing to save by score.
  if (!jobs.some(canMatch)) return null;
  const waiting = scored.length === 0;

  const good = scored.filter((job) => (matchFor(job)?.score ?? 0) >= min);
  // No description, so no score: saved to add the description by hand (see the bookmarklet).
  const bare = jobs.filter((job) => !canMatch(job));
  const wanted = withBare ? [...good, ...bare] : good;
  const toSave = wanted.filter((job) => !saved[job.id]);
  const bareToSave = withBare ? bare.filter((job) => !saved[job.id]).length : 0;
  const notScored = jobs.filter((job) => canMatch(job) && !matchFor(job)).length;

  const change = (patch: Partial<Pick<typeof settings, "saveMatchesFrom" | "saveUndescribed">>) => {
    setSettings((previous) => ({ ...previous, ...patch }));
    setJustSaved(null);
  };

  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <label htmlFor="save-matches-from">Save jobs matching</label>
        <select
          id="save-matches-from"
          className="input w-auto py-1 text-xs"
          value={min}
          onChange={(e) => change({ saveMatchesFrom: Number(e.target.value) })}
        >
          {THRESHOLDS.map((threshold) => (
            <option key={threshold} value={threshold}>
              {thresholdLabel(threshold)}
            </option>
          ))}
        </select>
        {bare.length > 0 && !waiting && (
          <label
            className="flex items-center gap-1.5"
            title="JobSpy often can't get the description of LinkedIn and Glassdoor jobs. Save them anyway to add it yourself: open each one on its site and click your Send to JobScratch bookmark."
          >
            <input type="checkbox" checked={withBare} onChange={(e) => change({ saveUndescribed: e.target.checked })} />
            plus the {bare.length} without a full description ({listSites(bare)})
          </label>
        )}
        <button
          type="button"
          className="btn btn-secondary btn-sm"
          disabled={waiting || toSave.length === 0}
          onClick={() => {
            saveJobs(toSave);
            setJustSaved({ total: toSave.length, bare: bareToSave });
          }}
        >
          <BookmarkPlus size={14} aria-hidden />
          {waiting ? "Save" : toSave.length ? `Save ${jobsLabel(toSave.length)}` : "Nothing new to save"}
        </button>
      </div>
      <p className="muted text-xs" role="status">
        {waiting ? (
          "Click Match all to my CV first to give each job a score. Then you can save just the ones at the percentage you pick."
        ) : justSaved ? (
          <>
            Saved {justSaved.total} to{" "}
            <Link href="/saved" className="link">
              My jobs
            </Link>
            {justSaved.bare > 0
              ? `, including ${jobsLabel(justSaved.bare)} without a full description. Open each one on its site and click your Send to JobScratch bookmark to add it, then match or tailor it there.`
              : "."}
          </>
        ) : (
          [
            wanted.length > toSave.length && `${wanted.length - toSave.length} already saved.`,
            good.length === 0 && `None match ${thresholdLabel(min)}.`,
            notScored > 0 && `${notScored} not matched yet, so left out.`,
          ]
            .filter(Boolean)
            .join(" ")
        )}
      </p>
    </div>
  );
}
