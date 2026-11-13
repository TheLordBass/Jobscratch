import { isTombstone } from "@/lib/sync-types";

/*
 * Clearing out what's no longer needed, so every device has less to load: match scores for jobs you
 * didn't save (each holds a full analysis, and a morning run can add hundreds), and tailored
 * documents left behind by jobs you've removed. Shared by the browser (lib/sync.ts) and the server
 * (lib/server-data.ts), which go by the same rule so neither brings back what the other cleared.
 */

/** A score or document for a job that isn't saved is kept this long, in case you save the job. */
export const KEEP_UNSAVED_DAYS = 14;
/** A marker left by something removed is kept this long, for devices that haven't heard yet. */
export const KEEP_REMOVED_DAYS = 30;

const DAY = 86_400_000;

type Items = Record<string, unknown>;

/** When an item last changed: documents have updatedAt, match scores have at, removal markers $deleted. */
function changedAt(item: unknown): number {
  if (isTombstone(item)) return Date.parse(item.$deleted);
  const record = item as { updatedAt?: string; at?: string } | null;
  return Date.parse(record?.updatedAt ?? record?.at ?? "");
}

/**
 * The ids in `items` (match scores or tailored documents) to clear: those for jobs that aren't in
 * `saved` and haven't changed for KEEP_UNSAVED_DAYS, and removal markers older than KEEP_REMOVED_DAYS.
 * One with no date counts as old.
 */
export function staleIds(items: Items, saved: Items, now = Date.now()): string[] {
  const isSaved = (id: string) => saved[id] !== undefined && !isTombstone(saved[id]);
  return Object.keys(items).filter((id) => {
    if (isSaved(id)) return false;
    const item = items[id];
    const age = now - changedAt(item);
    const limit = (isTombstone(item) ? KEEP_REMOVED_DAYS : KEEP_UNSAVED_DAYS) * DAY;
    return Number.isNaN(age) || age > limit;
  });
}

/** The collections cleared this way. */
export const CLEANED_KEYS = ["matches", "tailored"] as const;
