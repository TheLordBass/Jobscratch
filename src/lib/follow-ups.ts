import { NO_REPLY_AFTER_DAYS, appliedAt } from "@/lib/progress";
import type { SavedJob } from "@/lib/store";

/*
 * After you apply: a follow-up a week on with no reply, and "no reply" once three weeks have passed,
 * worked out from the date you set a job to Applied (it stays Applied until you hear back).
 */

/** A follow-up is due this many days after applying. */
export const FOLLOW_UP_AFTER_DAYS = 7;
export { NO_REPLY_AFTER_DAYS };

const DAY = 86_400_000;

/** Whole days since you applied, or null if you haven't. */
export function daysSinceApplied(entry: SavedJob, now = Date.now()): number | null {
  if (entry.status !== "applied") return null;
  const at = appliedAt(entry);
  if (!at) return null;
  return Math.floor((now - Date.parse(at)) / DAY);
}

/** Applied a week or more ago, not heard back, not followed up yet, and not given up on. */
export function followUpDue(entry: SavedJob, now = Date.now()): boolean {
  const days = daysSinceApplied(entry, now);
  return days !== null && days >= FOLLOW_UP_AFTER_DAYS && days < NO_REPLY_AFTER_DAYS && !entry.followedUpAt;
}

/** Applied three weeks or more ago and still nothing back. */
export function noReply(entry: SavedJob, now = Date.now()): boolean {
  const days = daysSinceApplied(entry, now);
  return days !== null && days >= NO_REPLY_AFTER_DAYS;
}

/** The jobs to follow up on now, the longest waiting first. */
export function followUpsDue(saved: Record<string, SavedJob>, now = Date.now()): SavedJob[] {
  return Object.values(saved)
    .filter((entry) => followUpDue(entry, now))
    .sort((a, b) => (appliedAt(a) ?? "").localeCompare(appliedAt(b) ?? ""));
}
