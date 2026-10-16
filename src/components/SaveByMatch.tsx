"use client";

import { BookmarkPlus } from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useCurrentMatches } from "@/components/MatchAll";
import { useSavedJobs, useSettings } from "@/lib/store";
import type { Job } from "@/lib/types";

const THRESHOLDS = [50, 60, 70, 80, 90] as const;

/** Saves only the jobs that match your CV well enough, instead of all of them. Shown once some are matched. */
export function SaveByMatch({ jobs }: { jobs: Job[] }) {
  const { saved, saveJob } = useSavedJobs();
  const { matchFor } = useCurrentMatches();
  const [settings, setSettings] = useSettings();
  const [justSaved, setJustSaved] = useState<number | null>(null);

  const min = settings.saveMatchesFrom;
  const scored = jobs.filter((job) => matchFor(job));
  if (scored.length === 0) return null;
  const good = scored.filter((job) => (matchFor(job)?.score ?? 0) >= min);
  const toSave = good.filter((job) => !saved[job.id]);
  const notScored = jobs.length - scored.length;

  return (
    <div className="flex flex-wrap items-center gap-2 text-sm">
      <label htmlFor="save-matches-from">Save jobs matching</label>
      <select
        id="save-matches-from"
        className="input w-auto py-1 text-xs"
        value={min}
        onChange={(e) => {
          setSettings((previous) => ({ ...previous, saveMatchesFrom: Number(e.target.value) }));
          setJustSaved(null);
        }}
      >
        {THRESHOLDS.map((threshold) => (
          <option key={threshold} value={threshold}>
            {threshold}% or more
          </option>
        ))}
      </select>
      <button
        type="button"
        className="btn btn-secondary btn-sm"
        disabled={toSave.length === 0}
        onClick={() => {
          toSave.forEach((job) => saveJob(job));
          setJustSaved(toSave.length);
        }}
      >
        <BookmarkPlus size={14} aria-hidden />
        {toSave.length ? `Save ${toSave.length} ${toSave.length === 1 ? "job" : "jobs"}` : "Nothing new to save"}
      </button>
      <span className="muted text-xs" role="status">
        {justSaved ? (
          <>
            Saved {justSaved} to{" "}
            <Link href="/saved" className="link">
              My jobs
            </Link>
            .{" "}
          </>
        ) : good.length > toSave.length ? (
          `${good.length - toSave.length} already saved. `
        ) : good.length === 0 ? (
          `None match ${min}% or more. `
        ) : null}
        {notScored > 0 && `${notScored} not matched yet, so left out.`}
      </span>
    </div>
  );
}
