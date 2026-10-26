import { z } from "zod";
import { payloadToJob } from "@/lib/import";
import { htmlToText, truncate } from "@/lib/text";
import type { Job, SalaryPeriod } from "@/lib/types";

/*
 * Reads the file written by scripts/jobspy/search.py, which runs JobSpy
 * (https://github.com/speedyapply/JobSpy) on the user's own computer. JobSpy
 * scrapes sites whose terms forbid it, so it's never run by the app itself.
 */

export const JOBSPY_FORMAT = "jobscratch-jobspy";

const SITE_NAMES: Record<string, string> = {
  indeed: "Indeed",
  linkedin: "LinkedIn",
  glassdoor: "Glassdoor",
  google: "Google Jobs",
  zip_recruiter: "ZipRecruiter",
  bayt: "Bayt",
  naukri: "Naukri",
  bdjobs: "BDJobs",
  hellowork: "HelloWork",
};

const PERIODS: Record<string, SalaryPeriod> = {
  yearly: "year",
  monthly: "month",
  weekly: "week",
  daily: "day",
  hourly: "hour",
};

const JOB_TYPES: Record<string, string> = {
  fulltime: "full-time",
  parttime: "part-time",
  contract: "contract",
  internship: "internship",
  temporary: "temporary",
};

/** pandas writes missing values as null; anything else odd becomes empty. */
const text = z.unknown().transform((value) => (typeof value === "string" ? value : value == null ? "" : String(value)));
const amount = z.unknown().transform((value) => (typeof value === "number" && Number.isFinite(value) && value > 0 ? value : undefined));

const RecordSchema = z.object({
  site: text,
  job_url: text,
  job_url_direct: text,
  title: text,
  company: text,
  location: text,
  date_posted: text,
  job_type: text,
  is_remote: z.unknown().transform((value) => value === true),
  min_amount: amount,
  max_amount: amount,
  currency: text,
  interval: text,
  description: text,
  company_logo: text,
});

/** One search term or location, or (from multi-searches) a list of them. */
const terms = z
  .union([z.string(), z.array(z.string())])
  .optional()
  .transform((value) => (Array.isArray(value) ? value : value ? [value] : []).map((v) => v.trim()).filter(Boolean));

const BLANK_ROW = Object.fromEntries(Object.keys(RecordSchema.shape).map((field) => [field, null]));

const FileSchema = z.object({
  format: z.literal(JOBSPY_FORMAT),
  version: z.literal(1),
  createdAt: z.string().optional(),
  query: z.object({ search: terms, location: terms }).optional(),
  // 100 searches on several sites can find thousands.
  jobs: z.array(z.unknown()).max(20_000),
});

export interface JobspyImport {
  jobs: Job[];
  /** What was searched for, e.g. "data analyst in London". */
  query?: string;
  createdAt?: string;
  /** Rows without a title or link, or that couldn't be read. */
  skipped: number;
  /** From the morning run: for each job id, the title lists whose searches found it. */
  lists?: Record<string, string[]>;
}

const isHttp = (value: string) => /^https?:\/\//i.test(value);

function toJob(row: z.infer<typeof RecordSchema>): Job | undefined {
  const url = isHttp(row.job_url) ? row.job_url : isHttp(row.job_url_direct) ? row.job_url_direct : "";
  if (!row.title.trim() || !url) return undefined;
  const sourceName = SITE_NAMES[row.site] ?? (row.site || "JobSpy");
  const job = payloadToJob({
    title: row.title.slice(0, 300),
    company: row.company.slice(0, 200),
    location: row.location.slice(0, 200),
    description: truncate(htmlToText(row.description), 20_000),
    url,
    sourceName: `${sourceName} (JobSpy)`,
    // pandas writes the posting day as a timestamp with no time zone, which would be read as local time.
    postedAt: /^\d{4}-\d{2}-\d{2}/.test(row.date_posted) ? row.date_posted.slice(0, 10) : row.date_posted || undefined,
    employmentType:
      row.job_type
        .split(/,\s*/)
        .map((type) => JOB_TYPES[type] ?? type)
        .filter(Boolean)
        .join(", ") || undefined,
    remote: row.is_remote,
  });
  // "Apply on Indeed", while "via Indeed (JobSpy)" still shows where the listing came from.
  job.applyOptions = [{ label: sourceName, url }];
  if (row.min_amount || row.max_amount) {
    job.salary = {
      min: row.min_amount,
      max: row.max_amount,
      currency: /^[A-Z]{3}$/.test(row.currency) ? row.currency : undefined,
      period: PERIODS[row.interval],
    };
  }
  if (isHttp(row.job_url_direct) && row.job_url_direct !== url) {
    job.applyOptions.push({ label: "Company site", url: row.job_url_direct });
  }
  if (isHttp(row.company_logo)) job.companyLogo = row.company_logo;
  return job;
}

/** Parse a JobSpy results file. Throws an Error worded for the user. */
export function parseJobspyFile(raw: string): JobspyImport {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error("That file isn't valid JSON.");
  }
  const file = FileSchema.safeParse(data);
  if (!file.success) {
    throw new Error("That isn't a JobSpy results file. Make one with scripts/jobspy/search.py (see the README).");
  }

  return { ...parseJobspyRows(file.data.jobs), query: describeQuery(file.data.query), createdAt: file.data.createdAt };
}

/**
 * JobSpy's rows as jobs, without repeats; rows without a title or link are counted as skipped. And
 * for each job, the title lists whose searches found it (a row's `lists`, from the morning run).
 */
export function parseJobspyRows(rows: unknown[]): { jobs: Job[]; skipped: number; lists: Record<string, string[]> } {
  const byId = new Map<string, Job>();
  const lists: Record<string, string[]> = {};
  let skipped = 0;
  for (const value of rows) {
    // A missing field is read as empty, like pandas' null.
    const row = RecordSchema.safeParse(value && typeof value === "object" ? { ...BLANK_ROW, ...value } : value);
    const job = row.success ? toJob(row.data) : undefined;
    if (!job) {
      skipped++;
      continue;
    }
    if (!byId.has(job.id)) byId.set(job.id, job);
    const names = (value as { lists?: unknown }).lists;
    for (const name of Array.isArray(names) ? names : []) {
      if (typeof name === "string" && name.trim() && !(lists[job.id] ??= []).includes(name.trim())) {
        lists[job.id].push(name.trim().slice(0, 60));
      }
    }
  }
  return { jobs: [...byId.values()], skipped, lists };
}

/** "data analyst, BI analyst in Manchester". */
export function describeQuery(query: { search?: string[]; location?: string[] } | undefined): string | undefined {
  const { search = [], location = [] } = query ?? {};
  return search.length ? `${search.join(", ")}${location.length ? ` in ${location.join(", ")}` : ""}` : undefined;
}
