import type { SearchSourceId, SourceInfo } from "@/lib/types";
import { adzuna } from "./adzuna";
import { arbeitnow } from "./arbeitnow";
import { ashby } from "./ashby";
import { googleJobs } from "./google-jobs";
import { greenhouse } from "./greenhouse";
import { himalayas } from "./himalayas";
import { jobicy } from "./jobicy";
import { jooble } from "./jooble";
import { jsearch } from "./jsearch";
import { lever } from "./lever";
import { nhsJobs } from "./nhs-jobs";
import { reed } from "./reed";
import { remoteok } from "./remoteok";
import { remotive } from "./remotive";
import type { JobSource } from "./types";
import { usajobs } from "./usajobs";

/** Ordered by how trustworthy the listing is as the "primary" copy of a duplicate. */
export const SOURCES: JobSource[] = [
  greenhouse,
  lever,
  ashby,
  reed,
  nhsJobs,
  usajobs,
  adzuna,
  remotive,
  remoteok,
  himalayas,
  jobicy,
  arbeitnow,
  jooble,
  googleJobs,
  jsearch,
];

export const SOURCE_BY_ID = new Map<SearchSourceId, JobSource>(SOURCES.map((source) => [source.id, source]));

export function missingEnvKeys(source: JobSource, env: Record<string, string | undefined>): string[] {
  return source.envKeys.filter((key) => !env[key]?.trim());
}

export function describeSources(env: Record<string, string | undefined>): SourceInfo[] {
  return SOURCES.map((source) => ({
    id: source.id,
    name: source.name,
    homepage: source.homepage,
    category: source.category,
    description: source.description,
    envKeys: source.envKeys,
    signupUrl: source.signupUrl,
    configured: missingEnvKeys(source, env).length === 0,
  }));
}
