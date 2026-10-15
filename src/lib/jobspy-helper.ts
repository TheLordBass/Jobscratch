/*
 * Talks to the JobSpy helper (scripts/jobspy/helper.py), which runs on your own
 * computer. The browser calls it directly; nothing goes through the server.
 */

export const HELPER_URL = "http://127.0.0.1:8765";

export const JOBSPY_SITES = [
  { id: "indeed", label: "Indeed" },
  { id: "linkedin", label: "LinkedIn" },
  { id: "glassdoor", label: "Glassdoor" },
  { id: "google", label: "Google" },
  { id: "zip_recruiter", label: "ZipRecruiter" },
] as const;

export type JobspySite = (typeof JOBSPY_SITES)[number]["id"];

export interface HelperStatus {
  app: "jobscratch-jobspy-helper";
  version: number;
  busy: boolean;
  /** When it stops by itself if there's no search before then. */
  stopsAt: string | null;
}

export interface HelperSearch {
  search: string[];
  location: string[];
  sites: JobspySite[];
  results: number;
  hours: number | null;
  remote: boolean;
  linkedinDescriptions: boolean;
  distance: number;
  /** For Indeed and Glassdoor, e.g. "united kingdom". */
  country: string;
}

export interface HelperSearchState {
  id: string;
  status: "running" | "done" | "failed" | "cancelled";
  done: number;
  total: number;
  /** The search running now, e.g. “data analyst” in Manchester. */
  current: string | null;
  found: number;
  failed: string[];
  error: string | null;
  /** A JobSpy results file (see lib/jobspy.ts), once finished. */
  result: unknown;
}

async function call<T>(path: string, body?: unknown, timeoutMs = 5000): Promise<T> {
  const response = await fetch(HELPER_URL + path, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(timeoutMs),
  });
  const data = (await response.json().catch(() => ({}))) as T & { error?: string };
  if (!response.ok) throw new Error(data.error ?? `The helper answered ${response.status}`);
  return data;
}

/** The helper's status, or null when it isn't running (or the browser won't let the page reach it). */
export async function getHelperStatus(): Promise<HelperStatus | null> {
  try {
    const status = await call<HelperStatus>("/status", undefined, 2500);
    return status.app === "jobscratch-jobspy-helper" ? status : null;
  } catch {
    return null;
  }
}

export const startHelperSearch = (search: HelperSearch) => call<HelperSearchState>("/search", search);
export const getHelperSearch = (id: string) => call<HelperSearchState>(`/search?id=${encodeURIComponent(id)}`);
export const cancelHelperSearch = () => call<{ ok: true }>("/search/cancel", {});
export const stopHelper = () => call<{ ok: true }>("/stop", {});
