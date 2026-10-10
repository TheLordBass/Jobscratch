import { decodeEntities, htmlToText, toIsoDate } from "@/lib/text";
import { fetchJson } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface JoobleResponse {
  jobs?: Array<{
    id: number | string;
    title: string;
    location?: string;
    snippet?: string;
    salary?: string;
    source?: string;
    type?: string;
    link: string;
    company?: string;
    updated?: string;
  }>;
}

export const jooble: JobSource = {
  id: "jooble",
  name: "Jooble",
  homepage: "https://jooble.org",
  category: "keyed",
  description: "Aggregator of thousands of job sites in 60+ countries. Free API key.",
  envKeys: ["JOOBLE_API_KEY"],
  signupUrl: "https://jooble.org/api/about",
  keywordSearch: true,
  locationSearch: true,
  async search(ctx) {
    const host = ctx.env.JOOBLE_HOST || "jooble.org";
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<JoobleResponse>(`https://${host}/api/${ctx.env.JOOBLE_API_KEY}`, {
        signal: ctx.signal,
        method: "POST",
        body: { keywords: keyword, location: ctx.location ?? "", page: "1" },
      });
      return (data.jobs ?? []).map((job) => {
        const title = htmlToText(job.title);
        const location = decodeEntities(job.location ?? "");
        const origin = job.source?.replace(/^www\./, "");
        return {
          id: `jooble:${job.id}`,
          source: "jooble" as const,
          sourceName: origin ? `Jooble · ${origin}` : "Jooble",
          title,
          company: decodeEntities(job.company || "Unknown company"),
          location,
          remote: /remote|work from home/i.test(`${title} ${location} ${job.type ?? ""}`),
          url: job.link,
          applyOptions: applyOptions({ label: origin ? `${origin} (via Jooble)` : "Jooble", url: job.link }),
          description: htmlToText(job.snippet),
          postedAt: toIsoDate(job.updated),
          salary: job.salary ? { text: job.salary } : undefined,
          employmentType: job.type || undefined,
          tags: [],
        };
      });
    });
  },
};
