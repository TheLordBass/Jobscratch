import { describe, expect, it } from "vitest";
import { appliedAt, progressStats, siteName, startOfWeek } from "@/lib/progress";
import type { ApplicationStatus, SavedJob, StatusChange } from "@/lib/store";
import type { Job } from "@/lib/types";

// Local times, so the weeks line up whatever time zone the tests run in.
const at = (month: number, day: number, hour = 10) => new Date(2026, month - 1, day, hour).toISOString();
const NOW = new Date(2026, 9, 15, 12); // Thursday 15 October 2026

function entry(sourceName: string, status: ApplicationStatus, history?: StatusChange[], updatedAt = at(10, 1)): SavedJob {
  return {
    job: { id: sourceName + Math.random(), title: "Data Analyst", company: "CBRE", sourceName } as Job,
    status,
    notes: "",
    savedAt: at(9, 1),
    updatedAt,
    history,
  };
}

describe("progress", () => {
  it("starts weeks on Monday", () => {
    expect(startOfWeek(NOW)).toEqual(new Date(2026, 9, 12));
    expect(startOfWeek(new Date(2026, 9, 18, 23))).toEqual(new Date(2026, 9, 12));
    expect(startOfWeek(new Date(2026, 9, 12, 0, 30))).toEqual(new Date(2026, 9, 12));
  });

  it("names the site without (JobSpy)", () => {
    expect(siteName("Indeed (JobSpy)")).toBe("Indeed");
    expect(siteName("LinkedIn")).toBe("LinkedIn");
    expect(siteName("")).toBe("Other");
  });

  it("dates an application by when it was first set to Applied", () => {
    const moved = entry("Reed", "interviewing", [
      { status: "saved", at: at(9, 1) },
      { status: "applied", at: at(10, 13) },
      { status: "interviewing", at: at(10, 14) },
    ]);
    expect(appliedAt(moved)).toBe(at(10, 13));
    // Saved then closed without applying isn't an application.
    expect(appliedAt(entry("Reed", "rejected", [{ status: "saved", at: at(9, 1) }, { status: "rejected", at: at(9, 2) }]))).toBeNull();
    // Older jobs with no history are dated by their last change; a closed one counts as an application.
    expect(appliedAt(entry("Reed", "applied", undefined, at(10, 2)))).toBe(at(10, 2));
    expect(appliedAt(entry("Reed", "rejected", undefined, at(10, 3)))).toBe(at(10, 3));
    expect(appliedAt(entry("Reed", "saved"))).toBeNull();
  });

  it("counts applications per week, interviews and sites", () => {
    const saved = Object.fromEntries(
      [
        entry("Indeed (JobSpy)", "applied", [{ status: "saved", at: at(10, 1) }, { status: "applied", at: at(10, 12, 0) }]),
        entry("Indeed (JobSpy)", "interviewing", [
          { status: "applied", at: at(10, 6) },
          { status: "interviewing", at: at(10, 9) },
        ]),
        entry("LinkedIn", "rejected", [
          { status: "applied", at: at(10, 5) },
          { status: "interviewing", at: at(10, 7) },
          { status: "rejected", at: at(10, 10) },
        ]),
        entry("LinkedIn", "offer", [{ status: "applied", at: at(8, 1) }, { status: "offer", at: at(8, 20) }]),
        entry("Reed", "applied", undefined, at(10, 15, 9)),
        entry("Reed", "saved", [{ status: "saved", at: at(10, 14) }]),
      ].map((e, i) => [String(i), e]),
    );
    const stats = progressStats(saved, NOW, 4);

    expect(stats.applied).toBe(5);
    // Interviewing, then rejected, still counts as an interview.
    expect(stats.interviews).toBe(3);
    expect(stats.offers).toBe(1);
    expect(stats.interviewRate).toBeCloseTo(3 / 5);
    expect(stats.estimated).toBe(1);
    expect(stats.now).toEqual({ saved: 1, applied: 2, interviewing: 1, offer: 1, rejected: 1 });

    expect(stats.weeks.map((week) => week.start)).toEqual(
      [new Date(2026, 8, 21), new Date(2026, 8, 28), new Date(2026, 9, 5), new Date(2026, 9, 12)].map((d) => d.toISOString()),
    );
    // 12 Oct (just after midnight) and 15 Oct this week; 5 and 6 Oct last week; August is outside the range.
    expect(stats.weeks.map((week) => week.count)).toEqual([0, 0, 2, 2]);

    expect(stats.sites).toEqual([
      { name: "LinkedIn", applied: 2, interviews: 2 },
      { name: "Indeed", applied: 2, interviews: 1 },
      { name: "Reed", applied: 1, interviews: 0 },
    ]);
  });

  it("folds the smallest sites into one row", () => {
    const saved = Object.fromEntries(
      ["A", "B", "C", "D", "E", "F", "G", "H"].map((name, i) => [name, entry(name, "applied", [{ status: "applied", at: at(10, 1 + i) }])]),
    );
    const { sites } = progressStats(saved, NOW);
    expect(sites).toHaveLength(6);
    expect(sites[5]).toEqual({ name: "3 other sites", applied: 3, interviews: 0 });
  });

  it("has no rate before any applications", () => {
    expect(progressStats({}, NOW).interviewRate).toBeNull();
    expect(progressStats({}, NOW).weeks).toHaveLength(8);
  });
});
