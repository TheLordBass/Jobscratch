import { slugify } from "@/lib/format";
import { inlinesToText, parseMarkdown } from "@/lib/markdown";
import type { SavedJob, TailoredDocs } from "@/lib/store";

/*
 * The Apply page: saved jobs you haven't applied to, ready to apply (a tailored CV written) or not yet.
 */

export interface ApplyQueue {
  /** Best match first (or newest posted first), then the most recently saved. */
  ready: SavedJob[];
  /** Saved jobs without a tailored CV yet. */
  notReady: SavedJob[];
}

/** Best match first, or newest posted first (jobs without a posting date last). */
export type ApplyOrder = "match" | "posted";

export function applyQueue(
  saved: Record<string, SavedJob>,
  tailored: Record<string, TailoredDocs>,
  scoreOf: (entry: SavedJob) => number | undefined,
  by: ApplyOrder = "match",
): ApplyQueue {
  const waiting = Object.values(saved).filter((entry) => entry.status === "saved");
  const byMatch = (a: SavedJob, b: SavedJob) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1);
  const byPosted = (a: SavedJob, b: SavedJob) => (b.job.postedAt ?? "").localeCompare(a.job.postedAt ?? "");
  const [first, then] = by === "posted" ? [byPosted, byMatch] : [byMatch, byPosted];
  const order = (a: SavedJob, b: SavedJob) => first(a, b) || then(a, b) || b.savedAt.localeCompare(a.savedAt);
  return {
    ready: waiting.filter((entry) => tailored[entry.job.id]?.cv?.trim()).sort(order),
    notReady: waiting.filter((entry) => !tailored[entry.job.id]?.cv?.trim()).sort(order),
  };
}

/** "jane-doe-cv-acme": the name from the CV's first heading, what it is, and the company. */
export function documentFileName(markdown: string, kind: "cv" | "cover-letter" | "interview-prep" | "test-prep" | "message" | "follow-up", company: string): string {
  const first = parseMarkdown(markdown).find((block) => block.type === "heading");
  const name = first?.type === "heading" && kind === "cv" ? inlinesToText(first.inlines) : "";
  return [name, kind, company].filter(Boolean).map(slugify).join("-");
}
