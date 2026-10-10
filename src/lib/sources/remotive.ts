import { decodeEntities, htmlToText, toIsoDate } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface RemotiveResponse {
  jobs?: Array<{
    id: number;
    url: string;
    title: string;
    company_name: string;
    company_logo?: string | null;
    category?: string;
    tags?: string[];
    job_type?: string;
    publication_date?: string;
    candidate_required_location?: string;
    salary?: string;
    description?: string;
  }>;
}

export const remotive: JobSource = {
  id: "remotive",
  name: "Remotive",
  homepage: "https://remotive.com",
  category: "free",
  description: "Remote jobs worldwide. No key needed.",
  envKeys: [],
  keywordSearch: true,
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<RemotiveResponse>(
        withQuery("https://remotive.com/api/remote-jobs", { search: keyword, limit: 50 }),
        // Remotive asks API users to keep request volume very low.
        { signal: ctx.signal, ttlMs: 2 * 60 * 60_000 },
      );
      return (data.jobs ?? []).map((job) => ({
        id: `remotive:${job.id}`,
        source: "remotive" as const,
        sourceName: "Remotive",
        title: decodeEntities(job.title),
        company: decodeEntities(job.company_name),
        location: job.candidate_required_location || "Remote",
        remote: true,
        // Remotive's terms require linking back to the Remotive listing.
        url: job.url,
        applyOptions: applyOptions({ label: "Remotive", url: job.url }),
        description: htmlToText(job.description),
        postedAt: toIsoDate(job.publication_date),
        salary: job.salary ? { text: job.salary } : undefined,
        employmentType: job.job_type?.replace(/_/g, " "),
        tags: [...(job.category ? [job.category] : []), ...(job.tags ?? [])],
        companyLogo: job.company_logo ?? undefined,
      }));
    });
  },
};
