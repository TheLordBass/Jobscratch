import type { SalaryPeriod } from "@/lib/types";
import { toIsoDate, toNumber, tidyText } from "@/lib/text";
import { fetchJson, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

interface UsaJobsResponse {
  SearchResult?: {
    SearchResultItems?: Array<{
      MatchedObjectId: string;
      MatchedObjectDescriptor: {
        PositionTitle: string;
        PositionURI: string;
        ApplyURI?: string[];
        PositionLocationDisplay?: string;
        OrganizationName?: string;
        DepartmentName?: string;
        PublicationStartDate?: string;
        QualificationSummary?: string;
        PositionRemuneration?: Array<{ MinimumRange?: string; MaximumRange?: string; RateIntervalCode?: string }>;
        PositionSchedule?: Array<{ Name?: string }>;
        UserArea?: {
          Details?: {
            JobSummary?: string;
            MajorDuties?: string[];
            TeleworkEligible?: boolean;
            RemoteIndicator?: boolean;
          };
        };
      };
    }>;
  };
}

const RATE: Record<string, SalaryPeriod> = { PA: "year", PH: "hour", PM: "month", PW: "week", PD: "day" };

export const usajobs: JobSource = {
  id: "usajobs",
  name: "USAJOBS",
  homepage: "https://www.usajobs.gov",
  category: "keyed",
  description: "US federal government jobs. Free API key. US only.",
  envKeys: ["USAJOBS_API_KEY", "USAJOBS_EMAIL"],
  signupUrl: "https://developer.usajobs.gov/apirequest/",
  keywordSearch: true,
  locationSearch: true,
  available(ctx) {
    return ctx.country === "us" ? { ok: true } : { ok: false, reason: "USAJOBS only lists US jobs" };
  },
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const data = await fetchJson<UsaJobsResponse>(
        withQuery("https://data.usajobs.gov/api/search", {
          Keyword: keyword,
          LocationName: ctx.location,
          ResultsPerPage: 50,
          DatePosted: ctx.postedWithinDays,
          RemoteIndicator: ctx.remoteOnly ? "True" : undefined,
        }),
        {
          signal: ctx.signal,
          headers: {
            "User-Agent": ctx.env.USAJOBS_EMAIL ?? "",
            "Authorization-Key": ctx.env.USAJOBS_API_KEY ?? "",
          },
        },
      );
      return (data.SearchResult?.SearchResultItems ?? []).map(({ MatchedObjectId, MatchedObjectDescriptor: d }) => {
        const details = d.UserArea?.Details ?? {};
        const pay = d.PositionRemuneration?.[0];
        const min = toNumber(pay?.MinimumRange);
        const max = toNumber(pay?.MaximumRange);
        const description = tidyText(
          [details.JobSummary, ...(details.MajorDuties ?? []).map((duty) => `• ${duty}`), d.QualificationSummary]
            .filter(Boolean)
            .join("\n\n"),
        );
        return {
          id: `usajobs:${MatchedObjectId}`,
          source: "usajobs" as const,
          sourceName: "USAJOBS",
          title: d.PositionTitle,
          company: [d.OrganizationName, d.DepartmentName].filter(Boolean).join(" · ") || "US Government",
          location: d.PositionLocationDisplay ?? "",
          remote: Boolean(details.RemoteIndicator),
          url: d.PositionURI,
          applyOptions: applyOptions(
            { label: "USAJOBS", url: d.PositionURI },
            { label: "Apply on USAJOBS", url: d.ApplyURI?.[0] },
          ),
          description,
          postedAt: toIsoDate(d.PublicationStartDate),
          salary: min || max ? { min, max, currency: "USD", period: RATE[pay?.RateIntervalCode ?? ""] } : undefined,
          employmentType: d.PositionSchedule?.map((s) => s.Name).filter(Boolean).join(", ") || undefined,
          tags: details.TeleworkEligible ? ["Telework eligible"] : [],
        };
      });
    });
  },
};
