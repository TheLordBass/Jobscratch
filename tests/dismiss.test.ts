import { describe, expect, it } from "vitest";
import { ImportPayloadSchema, dismissKeys, payloadToJob } from "@/lib/import";
import { parseJobspyFile } from "@/lib/jobspy";
import { mergeCollection } from "@/lib/sync";
import { SyncOpSchema } from "@/lib/sync-types";

const [indeed, linkedIn] = parseJobspyFile(
  JSON.stringify({
    format: "jobscratch-jobspy",
    version: 1,
    jobs: [
      {
        site: "indeed",
        job_url: "https://uk.indeed.com/viewjob?jk=abc123def456",
        title: "Data Analyst",
        company: "CBRE",
        location: "Manchester",
      },
      {
        site: "linkedin",
        job_url: "https://www.linkedin.com/jobs/view/4012345678",
        title: "Data Analyst",
        company: "CBRE",
        location: "Manchester, England, United Kingdom",
      },
    ],
  }),
).jobs;

const fromPage = (fields: Record<string, string>) => payloadToJob(ImportPayloadSchema.parse(fields));
const shares = (a: string[], b: string[]) => a.some((key) => b.includes(key));

describe("dismissKeys", () => {
  it("recognises a hidden job when it comes back from another search or site", () => {
    const fromBookmarklet = fromPage({
      title: "Data Analyst",
      company: "CBRE",
      url: "https://www.linkedin.com/jobs/view/4012345678/?refId=xyz",
    });
    // The same LinkedIn posting, read from its link.
    expect(dismissKeys(fromBookmarklet)).toContain("linkedin:4012345678");
    expect(shares(dismissKeys(fromBookmarklet), dismissKeys(linkedIn))).toBe(true);
    // The same role at the same company on Indeed, by title and company.
    expect(shares(dismissKeys(indeed), dismissKeys(linkedIn))).toBe(true);
    expect(dismissKeys(indeed)).toContain(indeed.id);
  });

  it("doesn't hide other roles, or jobs with no company name", () => {
    const senior = { ...indeed, id: "other", url: "https://example.com/1", applyOptions: [], title: "Senior Data Analyst" };
    expect(shares(dismissKeys(senior), dismissKeys(indeed))).toBe(false);
    const unknown = fromPage({ title: "Data Analyst", url: "https://example.com/a" });
    const otherUnknown = fromPage({ title: "Data Analyst", url: "https://example.com/b" });
    expect(shares(dismissKeys(unknown), dismissKeys(otherUnknown))).toBe(false);
  });
});

describe("syncing hidden jobs", () => {
  const entry = (at: string) => ({ title: "Data Analyst", company: "CBRE", keys: ["linkedin:1"], at });

  it("is stored item by item on the server", () => {
    expect(SyncOpSchema.safeParse({ key: "dismissed", items: { a: entry("1") } }).success).toBe(true);
  });

  it("keeps a job shown again on another device shown", () => {
    const { merged, upload } = mergeCollection({ a: { $deleted: "2026-10-15T12:00:00Z" } }, { a: entry("2026-10-15T10:00:00Z") });
    expect(merged).toEqual({});
    expect(upload).toEqual({ a: { $deleted: "2026-10-15T12:00:00Z" } });
  });
});
