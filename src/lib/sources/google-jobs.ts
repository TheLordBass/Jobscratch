import { decodeEntities, parseRelativeDate, tidyText } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface SerpApiResponse {
  error?: string;
  jobs_results?: Array<{
    job_id?: string;
    title: string;
    company_name?: string;
    location?: string;
    via?: string;
    description?: string;
    thumbnail?: string;
    share_link?: string;
    extensions?: string[];
    detected_extensions?: {
      posted_at?: string;
      schedule_type?: string;
      salary?: string;
      work_from_home?: boolean;
    };
    job_highlights?: Array<{ title?: string; items?: string[] }>;
    apply_options?: Array<{ title?: string; link?: string }>;
  }>;
}

function describe(job: NonNullable<SerpApiResponse["jobs_results"]>[number]): string {
  const highlights = (job.job_highlights ?? [])
    .map((h) => [h.title, ...(h.items ?? []).map((item) => `• ${item}`)].filter(Boolean).join("\n"))
    .join("\n\n");
  return tidyText([job.description, highlights].filter(Boolean).join("\n\n"));
}

export const googleJobs: JobSource = {
  id: "google-jobs",
  name: "Google Jobs (SerpApi)",
  homepage: "https://serpapi.com/google-jobs-api",
  category: "aggregator",
  description:
    "Google for Jobs results — includes listings from LinkedIn, Indeed, Glassdoor, ZipRecruiter and company sites, with their apply links. Paid API with a free monthly allowance.",
  envKeys: ["SERPAPI_API_KEY"],
  signupUrl: "https://serpapi.com/users/sign_up",
  keywordSearch: true,
  locationSearch: true,
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<SerpApiResponse>(
        withQuery("https://serpapi.com/search.json", {
          engine: "google_jobs",
          q: ctx.location ? `${keyword} ${ctx.location}` : keyword,
          gl: ctx.country,
          hl: "en",
          ltype: ctx.remoteOnly ? 1 : undefined,
          api_key: ctx.env.SERPAPI_API_KEY,
        }),
        // Each SerpApi search uses a credit, so cache results for longer.
        { signal: ctx.signal, ttlMs: 6 * 60 * 60_000 },
      );
      if (data.error && !/hasn't returned any results/i.test(data.error)) throw new Error(data.error);
      return (data.jobs_results ?? []).map((job, index) => {
        const via = job.via?.replace(/^via\s+/i, "").trim();
        const options = applyOptions(
          ...(job.apply_options ?? []).map((option) => ({ label: option.title ?? "Apply", url: option.link })),
          { label: "Google Jobs", url: job.share_link },
        );
        const location = job.location ?? "";
        return {
          id: `google-jobs:${job.job_id ?? `${keyword}:${index}`}`,
          source: "google-jobs" as const,
          sourceName: via ? `Google Jobs · ${via}` : "Google Jobs",
          title: decodeEntities(job.title),
          company: decodeEntities(job.company_name ?? "Unknown company"),
          location,
          remote: Boolean(job.detected_extensions?.work_from_home) || /remote|anywhere/i.test(location),
          url: options[0]?.url ?? "",
          applyOptions: options,
          description: describe(job),
          postedAt: parseRelativeDate(job.detected_extensions?.posted_at),
          salary: job.detected_extensions?.salary ? { text: job.detected_extensions.salary } : undefined,
          employmentType: job.detected_extensions?.schedule_type,
          tags: [],
          companyLogo: job.thumbnail,
        };
      });
    });
  },
};
