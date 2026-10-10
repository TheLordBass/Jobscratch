import { decodeEntities, htmlToText, toIsoDate, toNumber } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

type Restriction = string | { name?: string; alpha2?: string };

interface HimalayasResponse {
  jobs?: Array<{
    guid?: string;
    title: string;
    excerpt?: string;
    companyName?: string;
    companySlug?: string;
    companyLogo?: string;
    employmentType?: string;
    minSalary?: number | string | null;
    maxSalary?: number | string | null;
    currency?: string;
    seniority?: string[] | string;
    locationRestrictions?: Restriction[];
    categories?: string[];
    description?: string;
    pubDate?: number | string;
    applicationLink?: string;
  }>;
}

const restrictionName = (r: Restriction) => (typeof r === "string" ? r : r.name || r.alpha2 || "");

export const himalayas: JobSource = {
  id: "himalayas",
  name: "Himalayas",
  homepage: "https://himalayas.app",
  category: "free",
  description: "Remote jobs with salary data. No key needed.",
  envKeys: [],
  keywordSearch: true,
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<HimalayasResponse>(
        withQuery("https://himalayas.app/jobs/api/search", { q: keyword, page: 1 }),
        { signal: ctx.signal, ttlMs: 60 * 60_000 },
      );
      return (data.jobs ?? [])
        .filter((job) => job.title && (job.applicationLink || job.guid))
        .map((job) => {
          const url = (job.applicationLink || job.guid)!;
          const regions = (job.locationRestrictions ?? []).map(restrictionName).filter(Boolean);
          const min = toNumber(job.minSalary);
          const max = toNumber(job.maxSalary);
          const seniority = Array.isArray(job.seniority) ? job.seniority : job.seniority ? [job.seniority] : [];
          return {
            id: `himalayas:${job.guid ?? url}`,
            source: "himalayas" as const,
            sourceName: "Himalayas",
            title: decodeEntities(job.title),
            company: decodeEntities(job.companyName ?? "Unknown company"),
            location: regions.length ? `Remote (${regions.join(", ")})` : "Remote (worldwide)",
            remote: true,
            url,
            applyOptions: applyOptions({ label: "Himalayas", url }),
            description: htmlToText(job.description || job.excerpt),
            postedAt: toIsoDate(job.pubDate),
            salary: min || max ? { min, max, currency: job.currency || "USD", period: "year" as const } : undefined,
            employmentType: job.employmentType,
            tags: [...(job.categories ?? []), ...seniority],
            companyLogo: job.companyLogo,
          };
        });
    });
  },
};
