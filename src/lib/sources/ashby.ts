import { htmlToText, prettifySlug, toIsoDate } from "@/lib/text";
import { boardsAvailability, perBoard } from "./boards";
import { fetchJson } from "./http";
import { applyOptions, type JobSource } from "./types";

interface AshbyBoard {
  jobs?: Array<{
    id: string;
    title: string;
    department?: string;
    team?: string;
    employmentType?: string;
    location?: string;
    secondaryLocations?: Array<{ location?: string }>;
    isRemote?: boolean;
    workplaceType?: string;
    isListed?: boolean;
    descriptionPlain?: string;
    descriptionHtml?: string;
    publishedAt?: string;
    jobUrl: string;
    applyUrl?: string;
    compensation?: { compensationTierSummary?: string; scrapeableCompensationSalarySummary?: string };
  }>;
}

export const ashby: JobSource = {
  id: "ashby",
  name: "Ashby boards",
  homepage: "https://www.ashbyhq.com",
  category: "company",
  description: "Jobs straight from the careers pages of companies that use Ashby.",
  envKeys: [],
  keywordSearch: false,
  available: (ctx) => boardsAvailability(ctx, "ashby"),
  async search(ctx) {
    return perBoard(ctx, "ashby", async (token) => {
      const board = await fetchJson<AshbyBoard>(
        `https://api.ashbyhq.com/posting-api/job-board/${encodeURIComponent(token)}?includeCompensation=true`,
        { signal: ctx.signal, ttlMs: 30 * 60_000 },
      );
      return (board.jobs ?? [])
        .filter((job) => job.isListed !== false)
        .map((job) => {
          const locations = [job.location, ...(job.secondaryLocations ?? []).map((l) => l.location)].filter(
            (l): l is string => Boolean(l),
          );
          const location = locations.join(" / ");
          const pay =
            job.compensation?.scrapeableCompensationSalarySummary || job.compensation?.compensationTierSummary;
          return {
            id: `ashby:${token}:${job.id}`,
            source: "ashby" as const,
            sourceName: "Company site (Ashby)",
            title: job.title,
            company: prettifySlug(token),
            location,
            remote: Boolean(job.isRemote) || job.workplaceType === "Remote" || /remote/i.test(location),
            url: job.jobUrl,
            applyOptions: applyOptions(
              { label: "Company site", url: job.jobUrl },
              { label: "Apply form", url: job.applyUrl },
            ),
            description: job.descriptionPlain || htmlToText(job.descriptionHtml),
            postedAt: toIsoDate(job.publishedAt),
            salary: pay ? { text: pay } : undefined,
            employmentType: job.employmentType,
            tags: [job.department, job.team].filter((t): t is string => Boolean(t)),
          };
        });
    });
  },
};
