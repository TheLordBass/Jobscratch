import { decodeEntities, htmlToText, toIsoDate, toNumber } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface JobicyResponse {
  jobs?: Array<{
    id: number;
    url: string;
    jobTitle: string;
    companyName: string;
    companyLogo?: string;
    jobIndustry?: string[] | string;
    jobType?: string[] | string;
    jobGeo?: string;
    jobLevel?: string;
    jobExcerpt?: string;
    jobDescription?: string;
    pubDate?: string;
    annualSalaryMin?: number | string;
    annualSalaryMax?: number | string;
    salaryCurrency?: string;
  }>;
}

const asList = (value: string[] | string | undefined) =>
  (Array.isArray(value) ? value : value ? [value] : []).map(decodeEntities);

export const jobicy: JobSource = {
  id: "jobicy",
  name: "Jobicy",
  homepage: "https://jobicy.com",
  category: "free",
  description: "Remote jobs. No key needed.",
  envKeys: [],
  keywordSearch: true,
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<JobicyResponse>(
        withQuery("https://jobicy.com/api/v2/remote-jobs", { count: 50, tag: keyword }),
        { signal: ctx.signal, ttlMs: 60 * 60_000 },
      );
      return (data.jobs ?? []).map((job) => {
        const min = toNumber(job.annualSalaryMin);
        const max = toNumber(job.annualSalaryMax);
        return {
          id: `jobicy:${job.id}`,
          source: "jobicy" as const,
          sourceName: "Jobicy",
          title: decodeEntities(job.jobTitle),
          company: decodeEntities(job.companyName),
          location: job.jobGeo ? `Remote (${decodeEntities(job.jobGeo)})` : "Remote",
          remote: true,
          url: job.url,
          applyOptions: applyOptions({ label: "Jobicy", url: job.url }),
          description: htmlToText(job.jobDescription || job.jobExcerpt),
          postedAt: toIsoDate(job.pubDate),
          salary:
            min || max ? { min, max, currency: job.salaryCurrency || "USD", period: "year" as const } : undefined,
          employmentType: asList(job.jobType).join(", ") || undefined,
          tags: [...asList(job.jobIndustry), ...(job.jobLevel ? [job.jobLevel] : [])],
          companyLogo: job.companyLogo,
        };
      });
    });
  },
};
