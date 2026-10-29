import type { StoredCv } from "@/lib/store";

/*
 * More than one CV (Profile → CV), for the different kinds of job the candidate goes for. The main
 * CV is the one saved as before; the others are kept alongside it. Claude is given them all, with
 * the website and GitHub, as one record of the candidate: a match weighs everything in them, and a
 * tailored CV, cover letter or answers draw on whichever parts fit the job. Runs in the browser and
 * on the server (the morning run), so it's kept free of React.
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
  };
  return [main, ...(cv.others ?? [])];
}
