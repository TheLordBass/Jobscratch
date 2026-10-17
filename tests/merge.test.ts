import { describe, expect, it } from "vitest";
import { canMatch, candidateFor, matchKey } from "@/lib/candidate";
import { findSavedCopy, jobKeys, mergeJobs, payloadToJob, siteJobKey } from "@/lib/import";
import { parseJobspyFile } from "@/lib/jobspy";
import { EMPTY_PROFILE } from "@/lib/store";
import type { Job } from "@/lib/types";

const jobspyLinkedIn = parseJobspyFile(
  JSON.stringify({
    format: "jobscratch-jobspy",
    version: 1,
    jobs: [
      {
        site: "linkedin",
        job_url: "https://www.linkedin.com/jobs/view/4012345678",
        title: "Data Analyst",
        company: "CBRE",
        location: "Manchester, England, United Kingdom",
        description: null,
        min_amount: 35000,
        max_amount: 42000,
        currency: "GBP",
        interval: "yearly",
      },
    ],
  }),
).jobs[0];

const bookmarklet = payloadToJob({
  title: "Data Analyst",
  company: "CBRE",
  location: "Manchester",
  description: "About the job\nWe're looking for a data analyst to build Power BI dashboards and own our SQL models.",
  url: "https://www.linkedin.com/jobs/view/4012345678/",
  sourceName: "LinkedIn",
});

describe("recognising the same job", () => {
  it("reads the job's own id from LinkedIn, Indeed and Glassdoor links", () => {
    expect(siteJobKey("https://www.linkedin.com/jobs/view/4012345678/")).toBe("linkedin:4012345678");
    expect(siteJobKey("https://uk.linkedin.com/jobs/view/data-analyst-at-cbre-4012345678?trk=x")).toBe("linkedin:4012345678");
    expect(siteJobKey("https://www.linkedin.com/jobs/search/?currentJobId=4012345678&keywords=data")).toBe("linkedin:4012345678");
    expect(siteJobKey("https://uk.indeed.com/viewjob?jk=A6E6924067E185D7")).toBe("indeed:a6e6924067e185d7");
    expect(siteJobKey("https://www.glassdoor.co.uk/job-listing/x.htm?jl=1009876543210")).toBe("glassdoor:1009876543210");
    expect(siteJobKey("https://careers.example.com/jobs/1")).toBeUndefined();
    expect(siteJobKey("not a link")).toBeUndefined();
  });

  it("gives JobSpy's and the bookmarklet's copy of a LinkedIn job the same id", () => {
    expect(bookmarklet.id).toBe(jobspyLinkedIn.id);
  });

  it("finds a saved copy saved under an older id, or through another apply link", () => {
    const older: Job = { ...jobspyLinkedIn, id: "import:oldhash" };
    const fromSearch: Job = {
      ...jobspyLinkedIn,
      id: "google-jobs:abc",
      url: "https://www.google.com/search?q=x",
      applyOptions: [{ label: "LinkedIn", url: "https://www.linkedin.com/jobs/view/4012345678" }],
    };
    expect(findSavedCopy({ a: { job: older } }, bookmarklet)?.job.id).toBe("import:oldhash");
    expect(findSavedCopy({ b: { job: fromSearch } }, bookmarklet)?.job.id).toBe("google-jobs:abc");
    const elsewhere = (location: string) =>
      payloadToJob({ title: "Data Analyst", company: "CBRE", location, description: "", url: "https://careers.example.com/jobs/9", sourceName: "" });
    // The same role at the same company is the same job, unless it's somewhere else.
    expect(findSavedCopy({ a: { job: older } }, elsewhere(""))?.job.id).toBe("import:oldhash");
    expect(findSavedCopy({ a: { job: older } }, elsewhere("London"))).toBeUndefined();
    expect(jobKeys(fromSearch)).toEqual(["linkedin:4012345678"]);
  });
});

describe("mergeJobs", () => {
  it("fills in the description without losing what the saved copy already had", () => {
    const merged = mergeJobs(jobspyLinkedIn, bookmarklet);
    expect(merged.id).toBe(jobspyLinkedIn.id);
    expect(merged.description).toBe(bookmarklet.description);
    expect(merged.salary).toEqual({ min: 35000, max: 42000, currency: "GBP", period: "year" });
    expect(merged.location).toBe("Manchester, England, United Kingdom");
    // The bookmarklet's link is the same posting as JobSpy's, so it isn't listed twice.
    expect(merged.applyOptions.map((option) => option.url)).toEqual(["https://www.linkedin.com/jobs/view/4012345678"]);
    const withCompanySite = { ...bookmarklet, applyOptions: [...bookmarklet.applyOptions, { label: "Company site", url: "https://cbre.example/jobs/1" }] };
    expect(mergeJobs(jobspyLinkedIn, withCompanySite).applyOptions.map((option) => option.label)).toEqual(["LinkedIn", "Company site"]);
  });

  it("keeps the longer description and replaces placeholder titles", () => {
    const placeholder: Job = { ...bookmarklet, title: "Untitled job", description: "A much longer description than the other one." };
    const merged = mergeJobs(placeholder, { ...jobspyLinkedIn, description: "Short" });
    expect(merged.title).toBe("Data Analyst");
    expect(merged.description).toBe("A much longer description than the other one.");
  });
});

describe("quick match freshness", () => {
  const cv = { text: "Alex Test\nData analyst with four years of SQL, Power BI and Python experience in retail.", updatedAt: "" };

  it("changes the key when the CV or the description changes", () => {
    const candidate = candidateFor(cv, EMPTY_PROFILE);
    const key = matchKey(bookmarklet, candidate);
    expect(matchKey(bookmarklet, candidate)).toBe(key);
    expect(matchKey({ ...bookmarklet, description: `${bookmarklet.description} More.` }, candidate)).not.toBe(key);
    expect(matchKey(bookmarklet, candidateFor({ ...cv, text: `${cv.text} Also dbt.` }, EMPTY_PROFILE))).not.toBe(key);
  });

  it("leaves out website and GitHub details fetched for links that have changed", () => {
    const profile = {
      ...EMPTY_PROFILE,
      github: "someone-else",
      evidence: "## GitHub (https://github.com/janedoe)\n- etl-pipeline",
      fetchedFor: { website: "", github: "janedoe" },
    };
    const candidate = candidateFor(cv, profile);
    expect(candidate.staleDetails).toBe(true);
    expect(candidate.profile).toEqual({ website: "", github: "someone-else", evidence: "" });
  });

  it("only matches jobs with a full description, not a snippet", () => {
    expect(canMatch(jobspyLinkedIn)).toBe(false);
    // A few lines, as Adzuna, Reed or a LinkedIn teaser give, would make a misleading score.
    expect(canMatch(bookmarklet)).toBe(false);
    expect(canMatch({ ...bookmarklet, description: bookmarklet.description.repeat(8) })).toBe(true);
  });
});
