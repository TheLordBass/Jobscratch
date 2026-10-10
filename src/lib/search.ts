import { SOURCES, SOURCE_BY_ID, missingEnvKeys } from "@/lib/sources";
import type { JobSource, SearchContext } from "@/lib/sources/types";
import {
  isExcluded,
  locationMatches,
  matchesAnyKeyword,
  normalizeForMatch,
  relevanceScore,
  truncate,
} from "@/lib/text";
import type { Job, SearchRequest, SearchResponse, SourceResult } from "@/lib/types";

export const SOURCE_TIMEOUT_MS = 15_000;
export const MAX_DESCRIPTION_CHARS = 12_000;
export const MAX_JOBS_PER_SOURCE = 200;
export const MAX_RESULTS = 600;

export interface RunSearchOptions {
  env: Record<string, string | undefined>;
  /** Override the registry (used by tests). */
  sources?: JobSource[];
  timeoutMs?: number;
  now?: Date;
}

function dedupeKey(job: Job): string {
  const title = normalizeForMatch(job.title)
    .replace(/\b(remote|hybrid|m f d|f m d|w m d|all genders)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  const company = normalizeForMatch(job.company)
    .replace(/\b(inc|ltd|llc|limited|plc|gmbh|corp|corporation|co)\b/g, "")
    .replace(/\s+/g, " ")
    .trim();
  return `${title}|${company}`;
}

/** Merge duplicates found on several portals into one listing with every apply link. */
export function mergeDuplicates(jobs: Job[]): Job[] {
  const byKey = new Map<string, Job>();
  for (const job of jobs) {
    const key = dedupeKey(job);
    const existing = byKey.get(key);
    if (!existing) {
      byKey.set(key, { ...job, applyOptions: [...job.applyOptions], tags: [...job.tags] });
      continue;
    }
    const seenUrls = new Set(existing.applyOptions.map((option) => option.url));
    for (const option of job.applyOptions) {
      if (!seenUrls.has(option.url)) {
        existing.applyOptions.push(option);
        seenUrls.add(option.url);
      }
    }
    for (const tag of job.tags) if (!existing.tags.includes(tag)) existing.tags.push(tag);
    if (job.description.length > existing.description.length) existing.description = job.description;
    existing.salary ??= job.salary;
    existing.employmentType ??= job.employmentType;
    existing.companyLogo ??= job.companyLogo;
    existing.remote ||= job.remote;
    if (job.postedAt && (!existing.postedAt || job.postedAt < existing.postedAt)) existing.postedAt = job.postedAt;
  }
  return [...byKey.values()];
}

function normalizeRequest(request: SearchRequest) {
  const unique = (values: string[] | undefined) => [
    ...new Map(
      (values ?? []).map((v) => v.trim()).filter(Boolean).map((v) => [v.toLowerCase(), v] as const),
    ).values(),
  ];
  return {
    keywords: unique(request.keywords),
    exclude: unique(request.exclude),
    location: request.location?.trim() || undefined,
    country: (request.country || "gb").toLowerCase(),
    remoteOnly: Boolean(request.remoteOnly),
    includeRemoteAnywhere: request.includeRemoteAnywhere ?? true,
    postedWithinDays: request.postedWithinDays && request.postedWithinDays > 0 ? request.postedWithinDays : undefined,
    companyBoards: request.companyBoards ?? { greenhouse: [], lever: [], ashby: [] },
  };
}

export async function runSearch(request: SearchRequest, options: RunSearchOptions): Promise<SearchResponse> {
  const query = normalizeRequest(request);
  const registry = options.sources ?? SOURCES;
  const byId = options.sources ? new Map(registry.map((s) => [s.id, s])) : SOURCE_BY_ID;
  const selected = request.sources?.length
    ? request.sources.map((id) => byId.get(id)).filter((s): s is JobSource => Boolean(s))
    : registry;
  const now = options.now ?? new Date();
  const cutoff = query.postedWithinDays ? now.getTime() - query.postedWithinDays * 86_400_000 : undefined;

  const runOne = async (source: JobSource): Promise<{ result: SourceResult; jobs: Job[] }> => {
    const base = { source: source.id, name: source.name };
    const missing = missingEnvKeys(source, options.env);
    if (missing.length) {
      return { result: { ...base, status: "skipped", count: 0, message: `Needs ${missing.join(", ")}` }, jobs: [] };
    }
    const ctx: SearchContext = {
      keywords: query.keywords,
      location: query.location,
      country: query.country,
      remoteOnly: query.remoteOnly,
      postedWithinDays: query.postedWithinDays,
      companyBoards: query.companyBoards,
      env: options.env,
      signal: AbortSignal.timeout(options.timeoutMs ?? SOURCE_TIMEOUT_MS),
    };
    const availability = source.available?.(ctx) ?? { ok: true };
    if (!availability.ok) {
      return { result: { ...base, status: "skipped", count: 0, message: availability.reason }, jobs: [] };
    }
    const started = Date.now();
    try {
      const raw = await source.search(ctx);
      const jobs = raw
        .filter((job) => job.title && job.url)
        .filter((job) => source.keywordSearch || matchesAnyKeyword(job, query.keywords))
        .filter((job) => !isExcluded(job.title, query.exclude))
        .filter((job) => !query.remoteOnly || job.remote)
        .filter(
          (job) =>
            source.locationSearch ||
            locationMatches(job.location, job.remote, query.location, query.includeRemoteAnywhere),
        )
        .filter((job) => !cutoff || !job.postedAt || Date.parse(job.postedAt) >= cutoff)
        .slice(0, MAX_JOBS_PER_SOURCE)
        .map((job) => ({
          ...job,
          description: truncate(job.description, MAX_DESCRIPTION_CHARS),
          score: relevanceScore(job, query.keywords),
        }));
      return { result: { ...base, status: "ok", count: jobs.length, ms: Date.now() - started }, jobs };
    } catch (error) {
      return {
        result: { ...base, status: "error", count: 0, message: (error as Error).message, ms: Date.now() - started },
        jobs: [],
      };
    }
  };

  if (query.keywords.length === 0) {
    return { jobs: [], sources: [], total: 0 };
  }

  const outcomes = await Promise.all(selected.map(runOne));
  // Within a source, the same posting can come back for several keywords.
  const unique = new Map<string, Job>();
  for (const { jobs } of outcomes) for (const job of jobs) if (!unique.has(job.id)) unique.set(job.id, job);

  const merged = mergeDuplicates([...unique.values()]).sort(
    (a, b) => (b.score ?? 0) - (a.score ?? 0) || (b.postedAt ?? "").localeCompare(a.postedAt ?? ""),
  );
  return {
    jobs: merged.slice(0, MAX_RESULTS),
    sources: outcomes.map((outcome) => outcome.result),
    total: merged.length,
  };
}
