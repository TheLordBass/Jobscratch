import { decodeEntities, htmlToText, toIsoDate } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, type JobSource } from "./types";

interface ArbeitnowResponse {
  data?: Array<{
    slug: string;
    company_name: string;
    title: string;
    description?: string;
    remote?: boolean;
    url: string;
    tags?: string[];
    job_types?: string[];
    location?: string;
    created_at?: number;
  }>;
}

const PAGES = 3;

export const arbeitnow: JobSource = {
  id: "arbeitnow",
  name: "Arbeitnow",
  homepage: "https://www.arbeitnow.com",
  category: "free",
  description: "Jobs in Europe (mostly Germany), many English-speaking and remote. No key needed.",
  envKeys: [],
  keywordSearch: false,
  async search(ctx) {
    const pages = await Promise.allSettled(
      Array.from({ length: PAGES }, (_, i) =>
        fetchJson<ArbeitnowResponse>(
          withQuery("https://www.arbeitnow.com/api/job-board-api", { page: i + 1 }),
          { signal: ctx.signal, ttlMs: 60 * 60_000 },
        ),
      ),
    );
    if (pages[0].status === "rejected") throw pages[0].reason;
    return pages
      .flatMap((page) => (page.status === "fulfilled" ? (page.value.data ?? []) : []))
      .map((job) => ({
        id: `arbeitnow:${job.slug}`,
        source: "arbeitnow" as const,
        sourceName: "Arbeitnow",
        title: decodeEntities(job.title),
        company: decodeEntities(job.company_name),
        location: job.location || (job.remote ? "Remote" : ""),
        remote: Boolean(job.remote),
        url: job.url,
        applyOptions: applyOptions({ label: "Arbeitnow", url: job.url }),
        description: htmlToText(job.description),
        postedAt: toIsoDate(job.created_at),
        employmentType: job.job_types?.join(", ") || undefined,
        tags: job.tags ?? [],
      }));
  },
};
