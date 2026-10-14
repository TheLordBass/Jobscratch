import { z } from "zod";
import { tidyText, toIsoDate } from "@/lib/text";
import type { Job } from "@/lib/types";

/** What public/extractor.js returns (and what the manual import form produces). */
export const ImportPayloadSchema = z.object({
  v: z.number().optional(),
  title: z.string().max(300).default(""),
  company: z.string().max(200).default(""),
  location: z.string().max(200).default(""),
  description: z.string().max(40_000).default(""),
  url: z.string().max(2000).default(""),
  sourceName: z.string().max(100).default(""),
  postedAt: z.string().max(60).optional(),
  employmentType: z.string().max(100).optional(),
  salaryText: z.string().max(200).optional(),
  remote: z.boolean().optional(),
  extractedFrom: z.string().max(40).optional(),
});

export type ImportPayload = z.infer<typeof ImportPayloadSchema>;

export const IMPORT_HASH_KEY = "job";

/** Small stable hash for ids (djb2). */
export function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

/**
 * The same job on LinkedIn, Indeed or Glassdoor can arrive with different
 * links (the bookmarklet's /jobs/view/123/ and JobSpy's /jobs/view/123, a
 * search page's ?currentJobId=123…). This is the job's own id on that site,
 * so they're recognised as one job. Other sites: undefined.
 */
export function siteJobKey(raw: string): string | undefined {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return undefined;
  }
  const host = url.hostname.toLowerCase();
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = url.searchParams.get("currentJobId") ?? /\/jobs\/view\/(?:[^/]*?-)?(\d+)/.exec(url.pathname)?.[1];
    return id && /^\d+$/.test(id) ? `linkedin:${id}` : undefined;
  }
  if (/(^|\.)indeed\.[a-z.]+$/.test(host)) {
    const id = url.searchParams.get("jk") ?? url.searchParams.get("vjk");
    return id ? `indeed:${id.toLowerCase()}` : undefined;
  }
  if (/(^|\.)glassdoor\.[a-z.]+$/.test(host)) {
    const id = url.searchParams.get("jl") ?? url.searchParams.get("jobListingId");
    return id ? `glassdoor:${id}` : undefined;
  }
  return undefined;
}

/** Every site key a job can be recognised by (its main link and other apply links). */
export function jobKeys(job: Pick<Job, "url" | "applyOptions">): string[] {
  const keys = [job.url, ...job.applyOptions.map((option) => option.url)].map(siteJobKey).filter(Boolean);
  return [...new Set(keys as string[])];
}

export function payloadToJob(payload: ImportPayload): Job {
  const url = isHttpUrl(payload.url) ? payload.url : "";
  const title = tidyText(payload.title) || "Untitled job";
  const company = tidyText(payload.company) || "Unknown company";
  const sourceName = payload.sourceName || (url ? new URL(url).hostname.replace(/^www\./, "") : "Manual entry");
  return {
    id: `import:${hashString(siteJobKey(url) ?? (url || `${title}|${company}`))}`,
    source: "import",
    sourceName,
    title,
    company,
    location: tidyText(payload.location),
    remote: Boolean(payload.remote) || /\bremote\b/i.test(payload.location),
    url,
    applyOptions: url ? [{ label: sourceName, url }] : [],
    description: tidyText(payload.description),
    postedAt: toIsoDate(payload.postedAt),
    salary: payload.salaryText ? { text: payload.salaryText } : undefined,
    employmentType: payload.employmentType || undefined,
    tags: [],
  };
}

/** Parse `#job=<encoded JSON>` written by the bookmarklet / extension. */
export function readImportHash(hash: string): ImportPayload | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const raw = params.get(IMPORT_HASH_KEY);
  if (!raw) return null;
  try {
    const parsed = ImportPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Builds the javascript: URL for the "Send to JobScratch" bookmarklet. */
export function buildBookmarklet(extractorSource: string, appOrigin: string): string {
  const code = [
    "(function(){",
    extractorSource,
    ";var p=window.jobscratchExtract(document,location.href);",
    "if(!p||(!p.title&&!p.description)){alert('JobScratch could not find a job on this page. Select the job description text and try again.');return;}",
    `window.open(${JSON.stringify(`${appOrigin}/import#${IMPORT_HASH_KEY}=`)}+encodeURIComponent(JSON.stringify(p)),'_blank');`,
    "})();",
  ].join("\n");
  return `javascript:${encodeURIComponent(code)}`;
}

/** The saved job that `job` is another copy of: the same id, or the same job on LinkedIn/Indeed/Glassdoor. */
export function findSavedCopy<T extends { job: Job }>(saved: Record<string, T>, job: Job): T | undefined {
  if (saved[job.id]) return saved[job.id];
  const keys = jobKeys(job);
  if (keys.length === 0) return undefined;
  return Object.values(saved).find((entry) => jobKeys(entry.job).some((key) => keys.includes(key)));
}

/**
 * Combine two copies of one job, e.g. a JobSpy LinkedIn listing with no
 * description and the same job sent by the bookmarklet. Keeps the saved
 * copy's id and anything it already has, and fills in what it lacks; the
 * longer description wins.
 */
export function mergeJobs(existing: Job, incoming: Job): Job {
  const placeholder = (value: string) => !value.trim() || value === "Untitled job" || value === "Unknown company";
  // Links to the same posting (e.g. with and without a trailing slash) are listed once.
  const sameLink = (a: string, b: string) => a === b || (siteJobKey(a) !== undefined && siteJobKey(a) === siteJobKey(b));
  const applyOptions = [...existing.applyOptions];
  for (const option of incoming.applyOptions) {
    if (!applyOptions.some((known) => sameLink(known.url, option.url))) applyOptions.push(option);
  }
  return {
    ...existing,
    title: placeholder(existing.title) ? incoming.title : existing.title,
    company: placeholder(existing.company) ? incoming.company : existing.company,
    location: existing.location || incoming.location,
    remote: existing.remote || incoming.remote,
    url: existing.url || incoming.url,
    applyOptions,
    description: incoming.description.length > existing.description.length ? incoming.description : existing.description,
    postedAt: existing.postedAt ?? incoming.postedAt,
    salary: existing.salary ?? incoming.salary,
    employmentType: existing.employmentType ?? incoming.employmentType,
    companyLogo: existing.companyLogo ?? incoming.companyLogo,
    tags: [...new Set([...existing.tags, ...incoming.tags])],
  };
}
