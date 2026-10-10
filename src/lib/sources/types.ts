import type { CompanyBoards, Job, SearchSourceId, SourceCategory } from "@/lib/types";

export interface SearchContext {
  /** Trimmed, de-duplicated, non-empty. */
  keywords: string[];
  location?: string;
  /** ISO 3166-1 alpha-2, lower case. */
  country: string;
  remoteOnly: boolean;
  postedWithinDays?: number;
  companyBoards: CompanyBoards;
  env: Record<string, string | undefined>;
  signal: AbortSignal;
}

export type Availability = { ok: true } | { ok: false; reason: string };

export interface JobSource {
  id: SearchSourceId;
  name: string;
  homepage: string;
  category: SourceCategory;
  description: string;
  /** Environment variables that must all be set for this source to run. */
  envKeys: string[];
  signupUrl?: string;
  /**
   * true: the API searches by keyword itself.
   * false: the source returns a feed and the aggregator filters it by keyword.
   */
  keywordSearch: boolean;
  /** true when the API takes the location itself, so the aggregator doesn't re-filter by it. */
  locationSearch?: boolean;
  /** Extra per-request checks beyond `envKeys` (e.g. country, configured boards). */
  available?(ctx: SearchContext): Availability;
  search(ctx: SearchContext): Promise<Job[]>;
}

/** Most APIs search one phrase at a time; cap the fan-out per source. */
export const MAX_KEYWORDS_PER_SOURCE = 5;

/** Run `fn` once per keyword in parallel and flatten the results. */
export async function perKeyword(
  ctx: SearchContext,
  fn: (keyword: string) => Promise<Job[]>,
): Promise<Job[]> {
  const keywords = ctx.keywords.slice(0, MAX_KEYWORDS_PER_SOURCE);
  const settled = await Promise.allSettled(keywords.map(fn));
  const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const firstError = settled.find((result) => result.status === "rejected");
  if (jobs.length === 0 && firstError?.status === "rejected") throw firstError.reason;
  return jobs;
}

export function applyOptions(...options: Array<{ label: string; url?: string | null } | undefined>) {
  const seen = new Set<string>();
  const out: { label: string; url: string }[] = [];
  for (const option of options) {
    if (!option?.url || !/^https?:\/\//i.test(option.url) || seen.has(option.url)) continue;
    seen.add(option.url);
    out.push({ label: option.label, url: option.url });
  }
  return out;
}
