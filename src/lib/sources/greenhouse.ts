import { decodeEntities, htmlToText, prettifySlug, toIsoDate } from "@/lib/text";
import { boardsAvailability, perBoard } from "./boards";
import { fetchJson } from "./http";
import { applyOptions, type JobSource } from "./types";

interface GreenhouseJobs {
  jobs?: Array<{
    id: number;
    title: string;
    absolute_url: string;
    location?: { name?: string };
    updated_at?: string;
    first_published?: string;
    content?: string;
    company_name?: string;
    departments?: Array<{ name?: string }>;
  }>;
}

interface GreenhouseBoard {
  name?: string;
}

export const greenhouse: JobSource = {
  id: "greenhouse",
  name: "Greenhouse boards",
  homepage: "https://www.greenhouse.com",
  category: "company",
  description: "Jobs straight from the careers pages of companies that use Greenhouse.",
  envKeys: [],
  keywordSearch: false,
  available: (ctx) => boardsAvailability(ctx, "greenhouse"),
  async search(ctx) {
    return perBoard(ctx, "greenhouse", async (token) => {
      const base = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(token)}`;
      const [jobsResult, boardResult] = await Promise.allSettled([
        fetchJson<GreenhouseJobs>(`${base}/jobs?content=true`, { signal: ctx.signal, ttlMs: 30 * 60_000 }),
        fetchJson<GreenhouseBoard>(base, { signal: ctx.signal, ttlMs: 24 * 60 * 60_000 }),
      ]);
      if (jobsResult.status === "rejected") throw jobsResult.reason;
      const boardName = boardResult.status === "fulfilled" ? boardResult.value.name : undefined;
      return (jobsResult.value.jobs ?? []).map((job) => {
        const location = job.location?.name ?? "";
        return {
          id: `greenhouse:${token}:${job.id}`,
          source: "greenhouse" as const,
          sourceName: "Company site (Greenhouse)",
          title: decodeEntities(job.title),
          company: job.company_name || boardName || prettifySlug(token),
          location,
          remote: /remote/i.test(location),
          url: job.absolute_url,
          applyOptions: applyOptions({ label: "Company site", url: job.absolute_url }),
          description: htmlToText(job.content),
          postedAt: toIsoDate(job.first_published ?? job.updated_at),
          tags: (job.departments ?? []).map((d) => d.name ?? "").filter(Boolean),
        };
      });
    });
  },
};
