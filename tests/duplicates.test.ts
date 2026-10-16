import { describe, expect, it } from "vitest";
import { collapseCopies, linkKey, roleKey, sameArea, savedCopyFinder } from "@/lib/import";
import type { Job } from "@/lib/types";

const job = (id: string, fields: Partial<Job> = {}): Job =>
  ({
    id,
    title: "Data Analyst",
    company: "CBRE",
    location: "Manchester",
    url: `https://jobs.example.com/${id}`,
    applyOptions: [],
    description: "",
    sourceName: "Test",
    tags: [],
    ...fields,
  }) as Job;

const saved = (...jobs: Job[]) => Object.fromEntries(jobs.map((j) => [j.id, { job: j, status: "saved" }]));

describe("recognising a job you've already saved", () => {
  it("treats links that differ only by tracking, www. or a trailing slash as one posting", () => {
    expect(linkKey("https://www.reed.co.uk/jobs/data-analyst/123?utm_source=x&source=feed")).toBe(
      linkKey("https://reed.co.uk/jobs/data-analyst/123/"),
    );
    expect(linkKey("https://careers.example.com/job?id=1")).not.toBe(linkKey("https://careers.example.com/job?id=2"));
    // A bare careers page can be shared by many jobs.
    expect(linkKey("https://careers.example.com/")).toBeUndefined();
  });

  it("matches a title and company despite Ltd/Group endings, but not an unknown company", () => {
    expect(roleKey({ title: "Data Analyst", company: "CBRE Group Ltd" })).toBe(roleKey({ title: "data analyst", company: "CBRE" }));
    expect(roleKey({ title: "Senior Data Analyst", company: "CBRE" })).not.toBe(roleKey({ title: "Data Analyst", company: "CBRE" }));
    expect(roleKey({ title: "Data Analyst", company: "Unknown company" })).toBeUndefined();
  });

  it("knows when two locations could be the same place", () => {
    expect(sameArea("Manchester", "Manchester, England, United Kingdom")).toBe(true);
    expect(sameArea("Greater Manchester", "Manchester")).toBe(true);
    expect(sameArea("Remote (United Kingdom)", "Remote")).toBe(true);
    expect(sameArea("", "London")).toBe(true);
    expect(sameArea("Manchester", "London")).toBe(false);
  });

  it("finds the saved copy by id, site job number, link, or title + company + area", () => {
    const linkedIn = job("a", { url: "https://www.linkedin.com/jobs/view/4012345678" });
    const reed = job("b", { title: "BI Developer", company: "Matalan", url: "https://www.reed.co.uk/jobs/bi-developer/555" });
    const find = savedCopyFinder(saved(linkedIn, reed));

    expect(find(job("a"))?.job.id).toBe("a");
    expect(find(job("x", { url: "https://uk.linkedin.com/jobs/view/4012345678/?refId=abc" }))?.job.id).toBe("a");
    expect(find(job("y", { title: "Other", url: "https://reed.co.uk/jobs/bi-developer/555/?utm_medium=email" }))?.job.id).toBe("b");
    // The same role at the same company on another site, in the same area.
    expect(find(job("z", { company: "CBRE Ltd", location: "Manchester, England", url: "https://uk.indeed.com/viewjob?jk=zz" }))?.job.id).toBe("a");
    // The same role in another city is a different job.
    expect(find(job("w", { location: "London", url: "https://uk.indeed.com/viewjob?jk=ww" }))).toBeUndefined();
  });

  it("shows each job in a results list once", () => {
    const savedOne = job("s", { url: "https://www.linkedin.com/jobs/view/4012345678", applyOptions: [] });
    const find = savedCopyFinder(saved(savedOne));
    const results = [
      job("r1", { url: "https://uk.linkedin.com/jobs/view/4012345678?trk=x" }),
      job("r2", { company: "CBRE Group", url: "https://uk.indeed.com/viewjob?jk=a" }),
      job("r3", { title: "BI Developer", company: "Matalan", location: "Liverpool", url: "https://uk.indeed.com/viewjob?jk=b", applyOptions: [{ label: "Indeed", url: "https://uk.indeed.com/viewjob?jk=b" }] }),
      job("r4", { title: "BI Developer", company: "Matalan Ltd", location: "Liverpool, England", url: "https://www.glassdoor.co.uk/job-listing/x?jl=1", applyOptions: [{ label: "Glassdoor", url: "https://www.glassdoor.co.uk/job-listing/x?jl=1" }] }),
      job("r5", { location: "London", url: "https://uk.indeed.com/viewjob?jk=c" }),
    ];
    const shown = collapseCopies(results, find);
    // Both copies of the saved job show as the saved job, once; the two Matalan copies become one.
    expect(shown.map((j) => j.id)).toEqual(["s", "r3", "r5"]);
    expect(shown[0]).toBe(savedOne);
    expect(shown[1].applyOptions.map((option) => option.label)).toEqual(["Indeed", "Glassdoor"]);
  });
});
