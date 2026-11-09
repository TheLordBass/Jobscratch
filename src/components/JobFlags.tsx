import { AlertTriangle, Building2 } from "lucide-react";
import { formatPosted } from "@/lib/format";
import { LONG_SHOT_BELOW, OLD_POSTING_DAYS, isLongShot, isOldPosting, postingFlag } from "@/lib/job-flags";
import type { Job } from "@/lib/types";

const CHIP = "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium";
const AMBER = "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200";

/**
 * Small warnings for a list: a long shot (scored under 60) and a posting that isn't from the
 * employer. Nothing when there's nothing to warn about. (Lists show an old posting by its date.)
 */
export function JobFlagChips({ job, score }: { job: Job; score?: number }) {
  const flag = postingFlag(job);
  if (!isLongShot(score) && !flag) return null;
  return (
    <span className="flex flex-wrap gap-1">
      {isLongShot(score) && (
        <span className={`${CHIP} ${AMBER}`} title={`Scored under ${LONG_SHOT_BELOW}%: most of what the job asks for isn’t on your CV`}>
          <AlertTriangle size={11} aria-hidden /> Long shot
        </span>
      )}
      {flag && (
        <span className={`${CHIP} ${AMBER}`} title={flag.detail}>
          <Building2 size={11} aria-hidden /> {flag.label}
        </span>
      )}
    </span>
  );
}

/** The same warnings, explained, with an old posting too, for a job you're about to apply to. */
export function JobFlagNotes({ job, score }: { job: Job; score?: number }) {
  const flag = postingFlag(job);
  const notes = [
    isLongShot(score) &&
      `Long shot: this job scored ${score}%, so most of what it asks for isn’t on your CV. Apply only if you can show you do have it, and put your time into jobs scoring ${LONG_SHOT_BELOW}% or more first.`,
    flag && `${flag.label}: ${flag.detail}`,
    isOldPosting(job) && `Posted ${formatPosted(job.postedAt)}: over ${OLD_POSTING_DAYS} days old, so it may already be filled.`,
  ].filter((note): note is string => Boolean(note));
  if (notes.length === 0) return null;
  return (
    <div className={`space-y-1 rounded-lg px-3 py-2 text-sm ${AMBER}`} role="note">
      {notes.map((note) => (
        <p key={note} className="flex gap-2">
          <AlertTriangle size={14} aria-hidden className="mt-0.5 shrink-0" />
          <span>{note}</span>
        </p>
      ))}
    </div>
  );
}

/** When a job was posted ("posted 3w ago"), in amber once it's old enough to have been filled. */
export function PostedDate({ job, prefix = "posted " }: { job: Job; prefix?: string }) {
  const posted = formatPosted(job.postedAt);
  if (!posted) return null;
  return isOldPosting(job) ? (
    <span className="font-medium text-amber-700 dark:text-amber-300" title={`Posted over ${OLD_POSTING_DAYS} days ago: it may have been filled`}>
      {prefix}
      {posted}
    </span>
  ) : (
    <span>
      {prefix}
      {posted}
    </span>
  );
}
