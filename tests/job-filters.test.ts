import { describe, expect, it } from "vitest";
import { ANY_JOB, detailOf, filterCounts, filterJobs, isFiltering } from "@/lib/job-filters";
import type { Job } from "@/lib/types";

const FULL = "We are looking for an analyst to build dashboards in Power BI and write SQL against our data warehouse.";

const job = (id: string, sourceName: string, description = FULL) => ({ id, sourceName, description }) as Job;

const jobs = [
  job("a", "LinkedIn (JobSpy)", ""),
  job("b", "LinkedIn (JobSpy)"),
  job("c", "Indeed (JobSpy)"),
  job("d", "Indeed (JobSpy)"),
  job("e", "Indeed (JobSpy)"),
  job("f", "Glassdoor (JobSpy)", "Short"),
];
const matched = new Set(["b", "c"]);
const isMatched = (j: Job) => matched.has(j.id);
const ids = (list: Job[]) => list.map((j) => j.id);

describe("job filters", () => {
  it("sorts jobs into matched, not matched yet and no full description", () => {
    expect(jobs.map((j) => detailOf(j, isMatched))).toEqual([
      "no-description",
      "matched",
      "matched",
      "unmatched",
      "unmatched",
      "no-description",
    ]);
  });

  it("filters by site, by detail, or both", () => {
    const by = (site: string, detail: Parameters<typeof filterJobs>[2]["detail"]) =>
      ids(filterJobs(jobs, (j) => j, { site, detail }, isMatched));
    expect(by("", "all")).toEqual(["a", "b", "c", "d", "e", "f"]);
    expect(by("LinkedIn", "all")).toEqual(["a", "b"]);
    expect(by("", "no-description")).toEqual(["a", "f"]);
    expect(by("", "unmatched")).toEqual(["d", "e"]);
    expect(by("Indeed", "matched")).toEqual(["c"]);
    expect(by("Glassdoor", "matched")).toEqual([]);
  });

  it("works on saved entries through jobOf", () => {
    const entries = jobs.map((j) => ({ job: j, status: "saved" }));
    expect(filterJobs(entries, (e) => e.job, { site: "Indeed", detail: "unmatched" }, isMatched).map((e) => e.job.id)).toEqual(["d", "e"]);
  });

  it("counts sites (most first) and kinds of job for the menus", () => {
    expect(filterCounts(jobs, (j) => j, isMatched)).toEqual({
      sites: [
        { name: "Indeed", count: 3 },
        { name: "LinkedIn", count: 2 },
        { name: "Glassdoor", count: 1 },
      ],
      details: { all: 6, matched: 2, unmatched: 2, "no-description": 2 },
    });
  });

  it("knows when nothing is filtered", () => {
    expect(isFiltering(ANY_JOB)).toBe(false);
    expect(isFiltering({ site: "LinkedIn", detail: "all" })).toBe(true);
    expect(filterJobs(jobs, (j) => j, ANY_JOB, isMatched)).toBe(jobs);
  });
});
