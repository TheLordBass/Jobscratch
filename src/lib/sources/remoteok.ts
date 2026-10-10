import { decodeEntities, htmlToText, toIsoDate, toNumber } from "@/lib/text";
import { fetchJson } from "./http";
import { applyOptions, type JobSource } from "./types";

type RemoteOkItem = {
  legal?: string;
  id?: string | number;
  slug?: string;
  epoch?: number;
  date?: string;
  company?: string;
  company_logo?: string;
  logo?: string;
  position?: string;
  tags?: string[];
  description?: string;
  location?: string;
  salary_min?: number;
  salary_max?: number;
  url?: string;
};

export const remoteok: JobSource = {
  id: "remoteok",
  name: "Remote OK",
  homepage: "https://remoteok.com",
  category: "free",
  description: "Remote tech and non-tech jobs. No key needed.",
  envKeys: [],
  keywordSearch: false,
  async search(ctx) {
    const items = await fetchJson<RemoteOkItem[]>("https://remoteok.com/api", {
      signal: ctx.signal,
      ttlMs: 60 * 60_000,
    });
    return items
      .filter((item) => !item.legal && item.id && item.position && item.url)
      .map((item) => {
        const min = toNumber(item.salary_min);
        const max = toNumber(item.salary_max);
        return {
          id: `remoteok:${item.id}`,
          source: "remoteok" as const,
          sourceName: "Remote OK",
          title: decodeEntities(item.position!),
          company: decodeEntities(item.company ?? "Unknown company"),
          location: item.location || "Remote",
          remote: true,
          // Remote OK's terms require linking back to the Remote OK listing.
          url: item.url!,
          applyOptions: applyOptions({ label: "Remote OK", url: item.url }),
          description: htmlToText(item.description),
          postedAt: toIsoDate(item.date ?? item.epoch),
          salary: min || max ? { min, max, currency: "USD", period: "year" as const } : undefined,
          tags: item.tags ?? [],
          companyLogo: item.company_logo || item.logo || undefined,
        };
      });
  },
};
