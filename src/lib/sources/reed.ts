import { decodeEntities, htmlToText, toIsoDate, toNumber } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface ReedResponse {
  results?: Array<{
    jobId: number;
    employerName?: string;
    jobTitle: string;
    locationName?: string;
    minimumSalary?: number | null;
    maximumSalary?: number | null;
    currency?: string | null;
    date?: string;
    jobDescription?: string;
    jobUrl: string;
  }>;
}

export const reed: JobSource = {
  id: "reed",
  name: "Reed",
  homepage: "https://www.reed.co.uk",
  category: "keyed",
  description: "One of the UK's largest job boards. Free API key. UK only.",
  envKeys: ["REED_API_KEY"],
  signupUrl: "https://www.reed.co.uk/developers/jobseeker",
  keywordSearch: true,
  locationSearch: true,
  available(ctx) {
    return ctx.country === "gb" ? { ok: true } : { ok: false, reason: "Reed only lists UK jobs" };
  },
  async search(ctx) {
    const auth = `Basic ${Buffer.from(`${ctx.env.REED_API_KEY}:`).toString("base64")}`;
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<ReedResponse>(
        withQuery("https://www.reed.co.uk/api/1.0/search", {
          keywords: keyword,
          locationName: ctx.location,
          resultsToTake: 100,
        }),
        { signal: ctx.signal, headers: { Authorization: auth } },
      );
      return (data.results ?? []).map((job) => {
        const min = toNumber(job.minimumSalary);
        const max = toNumber(job.maximumSalary);
        const location = job.locationName ?? "";
        return {
          id: `reed:${job.jobId}`,
          source: "reed" as const,
          sourceName: "Reed",
          title: decodeEntities(job.jobTitle),
          company: decodeEntities(job.employerName ?? "Unknown company"),
          location,
          remote: /remote|work from home/i.test(`${job.jobTitle} ${location}`),
          url: job.jobUrl,
          applyOptions: applyOptions({ label: "Reed", url: job.jobUrl }),
          // The search endpoint returns a snippet; the full text is on the listing.
          description: htmlToText(job.jobDescription),
          postedAt: toIsoDate(job.date),
          salary: min || max ? { min, max, currency: job.currency || "GBP", period: "year" as const } : undefined,
          tags: [],
        };
      });
    });
  },
};
