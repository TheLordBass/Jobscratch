import { describe, expect, it } from "vitest";
import { followUpDue, followUpsDue, noReply } from "@/lib/follow-ups";
import { progressStats } from "@/lib/progress";
import type { ApplicationStatus, SavedJob } from "@/lib/store";
import type { Job } from "@/lib/types";

const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();

function entry(id: string, status: ApplicationStatus, appliedDaysAgo: number, extra: Partial<SavedJob> = {}): SavedJob {
  const job = { id, title: `Job ${id}`, company: "Acme", sourceName: "LinkedIn (JobSpy)" } as Job;
  const at = daysAgo(appliedDaysAgo);
  const history: SavedJob["history"] = [{ status: "saved", at: daysAgo(appliedDaysAgo + 1) }];
  if (status !== "saved") history.push({ status: "applied", at });
  if (status === "interviewing" || status === "rejected") history.push({ status, at: daysAgo(appliedDaysAgo - 1) });
  return { job, status, notes: "", savedAt: history[0].at, updatedAt: at, history, ...extra };
}

describe("follow-ups", () => {
  it("are due a week after applying, until three weeks, unless already done", () => {
    expect(followUpDue(entry("a", "applied", 8), NOW)).toBe(true);
    expect(followUpDue(entry("b", "applied", 3), NOW)).toBe(false);
    expect(followUpDue(entry("c", "applied", 9, { followedUpAt: daysAgo(1) }), NOW)).toBe(false);
    expect(followUpDue(entry("d", "interviewing", 9), NOW)).toBe(false);
    expect(followUpDue(entry("e", "applied", 25), NOW)).toBe(false);
  });

  it("count as no reply after three weeks", () => {
    expect(noReply(entry("a", "applied", 21), NOW)).toBe(true);
    expect(noReply(entry("b", "applied", 20), NOW)).toBe(false);
    expect(noReply(entry("c", "rejected", 30), NOW)).toBe(false);
  });

  it("are listed longest waiting first", () => {
    const saved = { a: entry("a", "applied", 8), b: entry("b", "applied", 12), c: entry("c", "applied", 2) };
    expect(followUpsDue(saved, NOW).map((e) => e.job.id)).toEqual(["b", "a"]);
  });
});

describe("progress by score and cover letter", () => {
  it("groups applications by match score and by cover letter, and counts no replies", () => {
    const saved = {
      a: entry("a", "interviewing", 10),
      b: entry("b", "applied", 25),
      c: entry("c", "applied", 5),
      d: entry("d", "applied", 30),
      e: entry("e", "saved", 0),
    };
    const scores: Record<string, number> = { a: 80, b: 45, c: 70 };
    const letters = new Set(["a", "c"]);
    const stats = progressStats(saved, new Date(NOW), 8, {
      scoreOf: (e) => scores[e.job.id],
      hasLetter: (e) => letters.has(e.job.id),
    });
    expect(stats.applied).toBe(4);
    expect(stats.noReply).toBe(2);
    expect(stats.bands).toEqual([
      { name: "75% or more", applied: 1, interviews: 1 },
      { name: "65–74%", applied: 1, interviews: 0 },
      { name: "Under 50%", applied: 1, interviews: 0 },
      { name: "Not scored", applied: 1, interviews: 0 },
    ]);
    expect(stats.letters).toEqual([
      { name: "With a cover letter", applied: 2, interviews: 1 },
      { name: "Without", applied: 2, interviews: 0 },
    ]);
  });
});
