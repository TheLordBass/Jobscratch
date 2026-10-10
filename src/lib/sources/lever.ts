import type { SalaryPeriod } from "@/lib/types";
import { htmlToText, prettifySlug, toIsoDate, toNumber } from "@/lib/text";
import { boardsAvailability, perBoard } from "./boards";
import { fetchJson } from "./http";
import { applyOptions, type JobSource } from "./types";

type LeverPosting = {
  id: string;
  text: string;
  hostedUrl: string;
  applyUrl?: string;
  createdAt?: number;
  categories?: {
    location?: string;
    team?: string;
    department?: string;
    commitment?: string;
    allLocations?: string[];
  };
  descriptionPlain?: string;
  description?: string;
  lists?: Array<{ text?: string; content?: string }>;
  additionalPlain?: string;
  workplaceType?: string;
  salaryRange?: { min?: number; max?: number; currency?: string; interval?: string };
};

const INTERVALS: Record<string, SalaryPeriod> = {
  "per-year-salary": "year",
  "per-month-salary": "month",
  "per-week-salary": "week",
  "per-day-wage": "day",
  "per-hour-wage": "hour",
};

function leverDescription(posting: LeverPosting): string {
  const parts = [posting.descriptionPlain || htmlToText(posting.description)];
  for (const list of posting.lists ?? []) {
    parts.push([list.text, htmlToText(list.content)].filter(Boolean).join("\n"));
  }
  if (posting.additionalPlain) parts.push(posting.additionalPlain);
  return parts.filter(Boolean).join("\n\n").trim();
}

export const lever: JobSource = {
  id: "lever",
  name: "Lever boards",
  homepage: "https://www.lever.co",
  category: "company",
  description: "Jobs straight from the careers pages of companies that use Lever.",
  envKeys: [],
  keywordSearch: false,
  available: (ctx) => boardsAvailability(ctx, "lever"),
  async search(ctx) {
    return perBoard(ctx, "lever", async (token) => {
      const postings = await fetchJson<LeverPosting[]>(
        `https://api.lever.co/v0/postings/${encodeURIComponent(token)}?mode=json`,
        { signal: ctx.signal, ttlMs: 30 * 60_000 },
      );
      return postings.map((posting) => {
        const categories = posting.categories ?? {};
        const location = categories.allLocations?.join(" / ") || categories.location || "";
        const salary = posting.salaryRange;
        const min = toNumber(salary?.min);
        const max = toNumber(salary?.max);
        return {
          id: `lever:${token}:${posting.id}`,
          source: "lever" as const,
          sourceName: "Company site (Lever)",
          title: posting.text,
          company: prettifySlug(token),
          location,
          remote: posting.workplaceType === "remote" || /remote/i.test(location),
          url: posting.hostedUrl,
          applyOptions: applyOptions(
            { label: "Company site", url: posting.hostedUrl },
            { label: "Apply form", url: posting.applyUrl },
          ),
          description: leverDescription(posting),
          postedAt: toIsoDate(posting.createdAt),
          salary:
            min || max
              ? { min, max, currency: salary?.currency, period: INTERVALS[salary?.interval ?? ""] }
              : undefined,
          employmentType: categories.commitment,
          tags: [categories.team, categories.department].filter((t): t is string => Boolean(t)),
        };
      });
    });
  },
};
