import type { StoredCv } from "@/lib/store";
import type { Job } from "@/lib/types";

/*
 * More than one CV, for different kinds of job (Profile → CV). The main CV is the one saved as
 * before; the others are kept alongside it, each with any job-title words it's always used for.
 * A job uses the CV picked for it on its page, else the one whose words are in its title, else the
 * one its match analysis chose as fitting it best (a match is sent every CV when neither of the
 * others decides), else the main CV. Runs in the browser and on the server (the morning run), so
 * it's kept free of React.
 */

export const MAIN_CV = "main";
export const MAX_CVS = 6;

/** A CV as the pages and requests use it: the main one, or one of the others. */
export interface CvVersion {
  id: string;
  name: string;
  text: string;
  fileName?: string;
  updatedAt: string;
  /** Words in a job's title that pick this CV, e.g. "data analyst" or "operations". None for the main CV. */
  titles: string[];
}

export function hasCvText(cv: { text: string } | null | undefined): boolean {
  return (cv?.text.trim().length ?? 0) >= 50;
}

/** Every CV, the main one first. */
export function cvVersions(cv: StoredCv | null): CvVersion[] {
  if (!cv) return [];
  const main: CvVersion = {
    id: MAIN_CV,
    name: cv.name?.trim() || "Main CV",
    text: cv.text,
    fileName: cv.fileName,
    updatedAt: cv.updatedAt,
    titles: [],
  };
  return [main, ...(cv.others ?? [])];
}

function inTitle(title: string, term: string): boolean {
  const words = term.trim().toLowerCase();
  if (!words) return false;
  const escaped = words.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(title.toLowerCase());
}

/** The CV whose title words fit the job best (the longest that's in its title), if any does. */
export function cvForTitle(versions: CvVersion[], title: string): CvVersion | undefined {
  let best: { version: CvVersion; length: number } | undefined;
  for (const version of versions) {
    if (!hasCvText(version)) continue;
    for (const term of version.titles) {
      if (inTitle(title, term) && term.length > (best?.length ?? 0)) best = { version, length: term.length };
    }
  }
  return best?.version;
}

function usable(versions: CvVersion[], id: string | undefined): CvVersion | undefined {
  return id ? versions.find((version) => version.id === id && hasCvText(version)) : undefined;
}

/**
 * The CV a job is tailored with: the one picked on its page (`chosen`), else the one its title fits,
 * else the one its match chose (`matched`), else the main CV. Null when there's no CV at all.
 */
export function pickCv(cv: StoredCv | null, job: Pick<Job, "title">, chosen?: string, matched?: string): CvVersion | null {
  const versions = cvVersions(cv);
  if (!versions.length) return null;
  return usable(versions, chosen) ?? cvForTitle(versions, job.title) ?? usable(versions, matched) ?? versions[0];
}

/**
 * The CVs a job is matched against: the one picked on its page or that its title fits, else every
 * CV, for the analysis to choose the best of.
 */
export function cvsToMatch(cv: StoredCv | null, job: Pick<Job, "title">, chosen?: string): CvVersion[] {
  const versions = cvVersions(cv).filter(hasCvText);
  const decided = usable(versions, chosen) ?? cvForTitle(versions, job.title);
  return decided ? [decided] : versions;
}

/** Why a job uses its CV, for its page: "picked for this job", "the job title has “data”" and so on. */
export function whyCv(cv: StoredCv | null, job: Pick<Job, "title">, chosen?: string, matched?: string): string {
  const versions = cvVersions(cv);
  const picked = pickCv(cv, job, chosen, matched);
  if (!picked || versions.length < 2) return "";
  if (chosen && picked.id === chosen) return "picked for this job";
  const term = picked.titles.find((t) => inTitle(job.title, t));
  if (term) return `the job title has “${term}”`;
  if (matched && picked.id === matched) return "the match found it fits this job best";
  return "the main CV, until a match picks the best one";
}
