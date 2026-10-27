import { slugify } from "@/lib/format";
import { inlinesToText, parseMarkdown } from "@/lib/markdown";
import type { SavedJob, TailoredDocs } from "@/lib/store";

/*
 * The Apply page: saved jobs you haven't applied to, ready to apply (a tailored CV written) or not yet.
 */

export interface ApplyQueue {
  /** Best match first, then the most recently saved. */
  ready: SavedJob[];
  /** Saved jobs without a tailored CV yet. */
  notReady: SavedJob[];
}

export function applyQueue(
  saved: Record<string, SavedJob>,
  tailored: Record<string, TailoredDocs>,
  scoreOf: (entry: SavedJob) => number | undefined,
): ApplyQueue {
  const waiting = Object.values(saved).filter((entry) => entry.status === "saved");
  const order = (a: SavedJob, b: SavedJob) => (scoreOf(b) ?? -1) - (scoreOf(a) ?? -1) || b.savedAt.localeCompare(a.savedAt);
  return {
    ready: waiting.filter((entry) => tailored[entry.job.id]?.cv?.trim()).sort(order),
    notReady: waiting.filter((entry) => !tailored[entry.job.id]?.cv?.trim()).sort(order),
  };
}

/** "jane-doe-cv-acme": the name from the CV's first heading, what it is, and the company. */
export function documentFileName(markdown: string, kind: "cv" | "cover-letter", company: string): string {
  const first = parseMarkdown(markdown).find((block) => block.type === "heading");
  const name = first?.type === "heading" && kind === "cv" ? inlinesToText(first.inlines) : "";
  return [name, kind, company].filter(Boolean).map(slugify).join("-");
}
