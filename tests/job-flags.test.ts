import { describe, expect, it } from "vitest";
import { applyQueue } from "@/lib/apply";
import { payloadToJob, repairSiteTitle } from "@/lib/import";
import { isLongShot, isOldPosting, postingFlag } from "@/lib/job-flags";
import type { SavedJob } from "@/lib/store";
import type { Job } from "@/lib/types";

const job = (company: string, description = "We are hiring a data analyst."): Pick<Job, "company" | "description"> => ({
  company,
  description,
});

describe("job flags", () => {
  it("calls a job scoring under 60 a long shot", () => {
    expect(isLongShot(59)).toBe(true);
    expect(isLongShot(60)).toBe(false);
    expect(isLongShot(undefined)).toBe(false);
  });

  it("marks postings with no company named", () => {
    for (const company of ["Unknown company", "", "Confidential", "Company Confidential", "Anonymous"]) {
      expect(postingFlag(job(company))?.kind, company).toBe("unnamed");
    }
  });

  it("marks job aggregators and CV services", () => {
    for (const company of ["Jobright.ai", "CV-BRIDGE LTD", "Jobgether", "Lensa", "CV-Library"]) {
      expect(postingFlag(job(company))?.kind, company).toBe("aggregator");
    }
  });

  it("marks recruitment agencies, by name or by how they write", () => {
    for (const company of [
      "Halecroft Recruitment",
      "Humankind Global Recruitment",
      "Dexter Talent",
      "Resourcery Group",
      "Harnham",
      "Robert Walters Outsourcing",
      "Michael Page",
      "Reed",
      "Hays",
    ]) {
      expect(postingFlag(job(company))?.kind, company).toBe("agency");
    }
    expect(postingFlag(job("Northwind Ltd", "Our client, a growing retailer, is looking for an analyst."))?.kind).toBe("agency");
    expect(postingFlag(job("Northwind Ltd", "On behalf of a client in Salford…"))?.kind).toBe("agency");
  });

  it("leaves employers alone, including ones that share a name with an agency", () => {
    for (const company of [
      "The Guinness Partnership",
      "BNY",
      "REED CONSTRUCTION LIMITED",
      "Hays Travel",
      "Natural Resources Wales",
      "Manchester City Council",
      "IRIS Software Group",
    ]) {
      expect(postingFlag(job(company)), company).toBeUndefined();
    }
    // A consultancy that talks about its clients is still the employer.
    expect(postingFlag(job("Slalom", "You'll work with our clients across the North West."))).toBeUndefined();
  });

  it("calls a posting over 30 days old old", () => {
    const now = Date.parse("2026-11-09T12:00:00Z");
    expect(isOldPosting({ postedAt: "2026-10-01T00:00:00Z" }, now)).toBe(true);
    expect(isOldPosting({ postedAt: "2026-10-20T00:00:00Z" }, now)).toBe(false);
    expect(isOldPosting({}, now)).toBe(false);
  });
});

describe("page titles as job titles", () => {
  it("splits LinkedIn's \"Role | Company | LinkedIn\"", () => {
    expect(
      repairSiteTitle({ title: "Junior Data Analyst and BI Developer | VVB Engineering | LinkedIn", company: "Unknown company", location: "" }),
    ).toEqual({ title: "Junior Data Analyst and BI Developer", company: "VVB Engineering", location: "" });
    // A title with its own bar keeps it.
    expect(repairSiteTitle({ title: "BI Engineer | Analyst | Awaze | LinkedIn", company: "", location: "" })).toMatchObject({
      title: "BI Engineer | Analyst",
      company: "Awaze",
    });
    // A company already known is kept.
    expect(repairSiteTitle({ title: "Data Analyst | Acme | LinkedIn", company: "Acme Ltd", location: "" }).company).toBe("Acme Ltd");
  });

  it("splits Indeed's \"Role - Place - Indeed.com\"", () => {
    expect(
      repairSiteTitle({
        title: "Customer Service & Operations Analyst, Fraud Prevention - Manchester - Indeed.com",
        company: "Unknown company",
        location: "",
      }),
    ).toEqual({ title: "Customer Service & Operations Analyst, Fraud Prevention", company: "Unknown company", location: "Manchester" });
  });

  it("returns other jobs as they are", () => {
    const plain = { title: "Data Analyst", company: "Acme", location: "Leeds" };
    expect(repairSiteTitle(plain)).toBe(plain);
  });

  it("is used for imported jobs", () => {
    const imported = payloadToJob({
      title: "Junior Data Analyst | Dexter Talent | LinkedIn",
      company: "",
      location: "",
      description: "",
      url: "https://www.linkedin.com/jobs/view/4483119067/",
      sourceName: "LinkedIn",
    });
    expect(imported).toMatchObject({ title: "Junior Data Analyst", company: "Dexter Talent" });
  });
});

describe("apply queue order", () => {
  const entry = (id: string, postedAt?: string): SavedJob => ({
    job: { id, title: id, company: "Acme", location: "", remote: false, url: "", applyOptions: [], description: "", tags: [], source: "import", sourceName: "x", postedAt },
    status: "saved",
    notes: "",
    savedAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
  });
  const saved = { a: entry("a", "2026-10-01"), b: entry("b", "2026-11-05"), c: entry("c") };
  const tailored = { a: { cv: "x", updatedAt: "" }, b: { cv: "x", updatedAt: "" }, c: { cv: "x", updatedAt: "" } };
  const scores: Record<string, number> = { a: 80, b: 60, c: 70 };

  it("puts the best match first, or the newest posted (undated last)", () => {
    const ids = (by?: "match" | "posted") => applyQueue(saved, tailored, (e) => scores[e.job.id], by).ready.map((e) => e.job.id);
    expect(ids()).toEqual(["a", "c", "b"]);
    expect(ids("posted")).toEqual(["b", "a", "c"]);
  });
});
