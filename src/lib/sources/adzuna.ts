import { decodeEntities, htmlToText, toIsoDate, toNumber } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

const CURRENCY: Record<string, string> = {
  gb: "GBP",
  us: "USD",
  at: "EUR",
  au: "AUD",
  be: "EUR",
  br: "BRL",
  ca: "CAD",
  ch: "CHF",
  de: "EUR",
  es: "EUR",
  fr: "EUR",
  in: "INR",
  it: "EUR",
  mx: "MXN",
  nl: "EUR",
  nz: "NZD",
  pl: "PLN",
  sg: "SGD",
  za: "ZAR",
};

export const ADZUNA_COUNTRIES = Object.keys(CURRENCY);

interface AdzunaResponse {
  results?: Array<{
    id: string;
    title: string;
    description?: string;
    redirect_url: string;
    created?: string;
    company?: { display_name?: string };
    location?: { display_name?: string };
    salary_min?: number;
    salary_max?: number;
    salary_is_predicted?: string | number;
    contract_time?: string;
    contract_type?: string;
    category?: { label?: string };
  }>;
}

export const adzuna: JobSource = {
  id: "adzuna",
  name: "Adzuna",
  homepage: "https://www.adzuna.com",
  category: "keyed",
  description: "Large aggregator across 19 countries (UK, US, EU, AU, IN…). Free API key.",
  envKeys: ["ADZUNA_APP_ID", "ADZUNA_APP_KEY"],
  signupUrl: "https://developer.adzuna.com/signup",
  keywordSearch: true,
  locationSearch: true,
  available(ctx) {
    return ctx.country in CURRENCY
      ? { ok: true }
      : { ok: false, reason: `Adzuna doesn't cover country "${ctx.country.toUpperCase()}"` };
  },
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<AdzunaResponse>(
        withQuery(`https://api.adzuna.com/v1/api/jobs/${ctx.country}/search/1`, {
          app_id: ctx.env.ADZUNA_APP_ID,
          app_key: ctx.env.ADZUNA_APP_KEY,
          what: keyword,
          where: ctx.location,
          results_per_page: 50,
          max_days_old: ctx.postedWithinDays,
          "content-type": "application/json",
        }),
        { signal: ctx.signal },
      );
      return (data.results ?? []).map((job) => {
        const predicted = String(job.salary_is_predicted) === "1";
        const min = toNumber(job.salary_min);
        const max = toNumber(job.salary_max);
        const location = job.location?.display_name ?? "";
        const title = htmlToText(job.title);
        return {
          id: `adzuna:${job.id}`,
          source: "adzuna" as const,
          sourceName: "Adzuna",
          title,
          company: decodeEntities(job.company?.display_name ?? "Unknown company"),
          location,
          remote: /remote|work from home/i.test(`${title} ${location}`),
          url: job.redirect_url,
          applyOptions: applyOptions({ label: "Adzuna", url: job.redirect_url }),
          // Adzuna only returns a snippet of the description.
          description: htmlToText(job.description),
          postedAt: toIsoDate(job.created),
          salary:
            (min || max) && !predicted
              ? { min, max, currency: CURRENCY[ctx.country], period: "year" as const }
              : undefined,
          employmentType: [job.contract_time, job.contract_type]
            .filter(Boolean)
            .map((s) => s!.replace(/_/g, " "))
            .join(", ") || undefined,
          tags: job.category?.label ? [job.category.label] : [],
        };
      });
    });
  },
};
