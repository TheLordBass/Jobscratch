export const SOURCE_IDS = [
  "remotive",
  "remoteok",
  "arbeitnow",
  "jobicy",
  "himalayas",
  "greenhouse",
  "lever",
  "ashby",
  "adzuna",
  "reed",
  "jooble",
  "usajobs",
  "google-jobs",
  "jsearch",
] as const;

export type SearchSourceId = (typeof SOURCE_IDS)[number];

/** "import" marks jobs brought in by the bookmarklet, extension, URL importer or manual paste. */
export type SourceId = SearchSourceId | "import";

export type SalaryPeriod = "year" | "month" | "week" | "day" | "hour";

export interface Salary {
  min?: number;
  max?: number;
  currency?: string;
  period?: SalaryPeriod;
  /** Free-text salary when the source doesn't give numbers, e.g. "£40k–£50k". */
  text?: string;
}

export interface ApplyOption {
  label: string;
  url: string;
}

export interface Job {
  /** Stable id: `${source}:${externalId}`. */
  id: string;
  source: SourceId;
  /** Display name for where the listing came from, e.g. "Remotive" or "Google Jobs · LinkedIn". */
  sourceName: string;
  title: string;
  company: string;
  location: string;
  remote: boolean;
  /** Primary link to view / apply for the job on the original portal. */
  url: string;
  /** Every known place to apply (always includes `url`). */
  applyOptions: ApplyOption[];
  /** Plain-text description (may be a snippet for some sources). */
  description: string;
  /** ISO timestamp. */
  postedAt?: string;
  salary?: Salary;
  employmentType?: string;
  tags: string[];
  companyLogo?: string;
  /** Keyword relevance computed by the aggregator. */
  score?: number;
}

export interface CompanyBoards {
  greenhouse: string[];
  lever: string[];
  ashby: string[];
}

export interface SearchRequest {
  keywords: string[];
  exclude?: string[];
  location?: string;
  /** ISO 3166-1 alpha-2, lower case (e.g. "gb", "us"). */
  country?: string;
  remoteOnly?: boolean;
  /** Keep remote jobs whose location doesn't match the location filter. */
  includeRemoteAnywhere?: boolean;
  postedWithinDays?: number;
  sources?: SearchSourceId[];
  companyBoards?: CompanyBoards;
}

export type SourceStatus = "ok" | "error" | "skipped";

export interface SourceResult {
  source: SearchSourceId;
  name: string;
  status: SourceStatus;
  count: number;
  message?: string;
  ms?: number;
}

export interface SearchResponse {
  jobs: Job[];
  sources: SourceResult[];
  /** Matching jobs before the response cap was applied. */
  total: number;
}

export interface SourceInfo {
  id: SearchSourceId;
  name: string;
  homepage: string;
  category: SourceCategory;
  description: string;
  envKeys: string[];
  signupUrl?: string;
  configured: boolean;
}

export type SourceCategory = "free" | "company" | "keyed" | "aggregator";

export interface SourcesResponse {
  sources: SourceInfo[];
  aiConfigured: boolean;
}
