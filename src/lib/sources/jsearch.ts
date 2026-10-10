import type { SalaryPeriod } from "@/lib/types";
import { decodeEntities, tidyText, toIsoDate, toNumber } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface JSearchResponse {
  status?: string;
  error?: { message?: string };
  data?: Array<{
    job_id: string;
    employer_name?: string;
    employer_logo?: string | null;
    job_publisher?: string;
    job_employment_type?: string;
    job_title: string;
    job_apply_link?: string;
    job_description?: string;
    job_is_remote?: boolean;
    job_posted_at_datetime_utc?: string;
    job_posted_at_timestamp?: number;
    job_location?: string;
    job_city?: string | null;
    job_state?: string | null;
    job_country?: string | null;
    job_min_salary?: number | null;
    job_max_salary?: number | null;
    job_salary_currency?: string | null;
    job_salary_period?: string | null;
    job_google_link?: string;
    apply_options?: Array<{ publisher?: string; apply_link?: string; is_direct?: boolean }>;
  }>;
}

const PERIODS: Record<string, SalaryPeriod> = {
  YEAR: "year",
  MONTH: "month",
  WEEK: "week",
  DAY: "day",
  HOUR: "hour",
};

function datePosted(days: number | undefined): string {
  if (!days) return "all";
  if (days <= 1) return "today";
  if (days <= 3) return "3days";
  if (days <= 7) return "week";
  if (days <= 31) return "month";
  return "all";
}

export const jsearch: JobSource = {
  id: "jsearch",
  name: "JSearch (RapidAPI)",
  homepage: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch",
  category: "aggregator",
  description:
    "Google for Jobs data via RapidAPI — covers LinkedIn, Indeed, Glassdoor, ZipRecruiter and more, with direct apply links. Free tier available.",
  envKeys: ["RAPIDAPI_KEY"],
  signupUrl: "https://rapidapi.com/letscrape-6bRBa3QguO5/api/jsearch/pricing",
  keywordSearch: true,
  locationSearch: true,
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<JSearchResponse>(
        withQuery("https://jsearch.p.rapidapi.com/search", {
          query: ctx.location ? `${keyword} in ${ctx.location}` : keyword,
          page: 1,
          num_pages: 1,
          country: ctx.country,
          date_posted: datePosted(ctx.postedWithinDays),
          work_from_home: ctx.remoteOnly ? "true" : undefined,
        }),
        {
          signal: ctx.signal,
          ttlMs: 6 * 60 * 60_000,
          headers: {
            "X-RapidAPI-Key": ctx.env.RAPIDAPI_KEY ?? "",
            "X-RapidAPI-Host": "jsearch.p.rapidapi.com",
          },
        },
      );
      if (data.status === "ERROR") throw new Error(data.error?.message ?? "JSearch returned an error");
      return (data.data ?? []).map((job) => {
        const options = applyOptions(
          { label: job.job_publisher ?? "Apply", url: job.job_apply_link },
          ...(job.apply_options ?? []).map((option) => ({
            label: option.publisher ?? "Apply",
            url: option.apply_link,
          })),
          { label: "Google Jobs", url: job.job_google_link },
        );
        const location =
          job.job_location ||
          [job.job_city, job.job_state, job.job_country].filter(Boolean).join(", ") ||
          (job.job_is_remote ? "Remote" : "");
        const min = toNumber(job.job_min_salary);
        const max = toNumber(job.job_max_salary);
        return {
          id: `jsearch:${job.job_id}`,
          source: "jsearch" as const,
          sourceName: job.job_publisher ? `JSearch · ${job.job_publisher}` : "JSearch",
          title: decodeEntities(job.job_title),
          company: decodeEntities(job.employer_name ?? "Unknown company"),
          location,
          remote: Boolean(job.job_is_remote),
          url: options[0]?.url ?? "",
          applyOptions: options,
          description: tidyText(job.job_description ?? ""),
          postedAt: toIsoDate(job.job_posted_at_datetime_utc ?? job.job_posted_at_timestamp),
          salary:
            min || max
              ? {
                  min,
                  max,
                  currency: job.job_salary_currency ?? undefined,
                  period: PERIODS[job.job_salary_period?.toUpperCase() ?? ""],
                }
              : undefined,
          employmentType: job.job_employment_type?.replace(/_/g, " ").toLowerCase(),
          tags: [],
          companyLogo: job.employer_logo ?? undefined,
        };
      });
    });
  },
};
