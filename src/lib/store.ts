"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { MatchAnalysis, TailorOptions } from "@/lib/ai/prompts";
import { dismissKeys, mergeJobs } from "@/lib/import";
import type { HelperSearch } from "@/lib/jobspy-helper";
import { connectStore, queueChange } from "@/lib/sync";
import type { CompanyBoards, Job, SearchSourceId } from "@/lib/types";

/*
 * Everything personal (CV, saved jobs, groups, settings) lives in this
 * browser's localStorage. Nothing is stored on the server.
 */

export interface SearchGroup {
  id: string;
  name: string;
  keywords: string[];
  exclude: string[];
  location: string;
  remoteOnly: boolean;
}

export const APPLICATION_STATUSES = ["saved", "applied", "interviewing", "offer", "rejected"] as const;
export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];

/** When a saved job moved to a status (for the Progress page). */
export interface StatusChange {
  status: ApplicationStatus;
  at: string;
}

export interface SavedJob {
  job: Job;
  status: ApplicationStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
  /** Every status the job has had, oldest first. Missing on jobs saved before it was added. */
  history?: StatusChange[];
}

export interface StoredCv {
  text: string;
  fileName?: string;
  updatedAt: string;
}

/** The candidate's website / GitHub and the text read from them (shown to the user before use). */
export interface StoredProfile {
  website: string;
  github: string;
  evidence: string;
  /** Whether to send these to Claude when tailoring and matching. */
  enabled: boolean;
  fetchedAt?: string;
  /** The links `evidence` was read from, to spot when they've been changed since. */
  fetchedFor?: { website: string; github: string };
}

export interface Settings {
  country: string;
  includeRemoteAnywhere: boolean;
  companyBoards: CompanyBoards;
  disabledSources: SearchSourceId[];
  /** "Save jobs matching N% or more" on search results and the JobSpy list. */
  saveMatchesFrom: number;
  tailor: TailorOptions;
  /** The last JobSpy search, so the form starts with it. */
  jobspy: Omit<HelperSearch, "country">;
}

export interface TailoredDocs {
  analysis?: MatchAnalysis;
  cv?: string;
  coverLetter?: string;
  /** Edited job description used for tailoring (e.g. full text pasted over a snippet). */
  jobDescription?: string;
  updatedAt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  country: "gb",
  includeRemoteAnywhere: true,
  companyBoards: { greenhouse: [], lever: [], ashby: [] },
  disabledSources: [],
  saveMatchesFrom: 70,
  tailor: { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "" },
  jobspy: { search: [], location: [], sites: ["indeed", "linkedin"], results: 25, hours: null, remote: false, linkedinDescriptions: false, distance: 50 },
};

export const EMPTY_PROFILE: StoredProfile = { website: "", github: "", evidence: "", enabled: true };

/** A quick match score for one job (from "Match all"). */
export interface StoredMatch {
  score: number;
  verdict: string;
  missing: string[];
  /** Which CV and description it was scored against (see matchKey), to spot when it's out of date. */
  key: string;
  at: string;
}

const EMPTY_MATCHES: Record<string, StoredMatch> = {};

/** A job marked "Not interested", hidden from searches and JobSpy results. */
export interface DismissedJob {
  title: string;
  company: string;
  /** Every key the job can be recognised by (see dismissKeys). */
  keys: string[];
  at: string;
}

const EMPTY_DISMISSED: Record<string, DismissedJob> = {};

const EMPTY_GROUPS: SearchGroup[] = [];
const EMPTY_SAVED: Record<string, SavedJob> = {};
const EMPTY_TAILORED: Record<string, TailoredDocs> = {};

const PREFIX = "jobscratch:";
type Key = "groups" | "saved" | "cv" | "profile" | "settings" | "tailored" | "matches" | "dismissed";

const listeners = new Set<() => void>();
const parsed = new Map<string, { raw: string | null; value: unknown }>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (!event.key || event.key.startsWith(PREFIX)) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function read<T>(key: Key, fallback: T): T {
  const storageKey = PREFIX + key;
  let raw: string | null;
  try {
    raw = window.localStorage.getItem(storageKey);
  } catch {
    return fallback;
  }
  const cached = parsed.get(storageKey);
  if (cached && cached.raw === raw) return cached.value as T;
  let value: T = fallback;
  if (raw !== null) {
    try {
      value = JSON.parse(raw) as T;
    } catch {
      value = fallback;
    }
  }
  parsed.set(storageKey, { raw, value });
  return value;
}

function write<T>(key: Key, value: T) {
  const storageKey = PREFIX + key;
  const previous = read<unknown>(key, null);
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(storageKey, raw);
  } catch {
    window.alert("Your browser's storage is full. Remove some saved jobs and try again.");
    return;
  }
  parsed.set(storageKey, { raw, value });
  notify();
  queueChange(key, previous, value);
}

/** A value from server storage: saved here without being sent back. */
function applyRemote(key: Key, value: unknown) {
  const storageKey = PREFIX + key;
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    return;
  }
  parsed.delete(storageKey);
  notify();
}

connectStore({
  // What's actually stored: null when nothing is, rather than a page's default.
  read: (key) => {
    try {
      return window.localStorage.getItem(PREFIX + key) === null ? null : read<unknown>(key, null);
    } catch {
      return null;
    }
  },
  apply: applyRemote,
});

function useStored<T>(key: Key, fallback: T): [T, (update: T | ((previous: T) => T)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (update: T | ((previous: T) => T)) => {
      const previous = read(key, fallback);
      write(key, typeof update === "function" ? (update as (p: T) => T)(previous) : update);
    },
    [key, fallback],
  );
  return [value, set];
}

/** True after hydration, so pages can avoid flashing "empty" states. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    () => () => {},
    () => true,
    () => false,
  );
}

export function useGroups() {
  return useStored("groups", EMPTY_GROUPS);
}

export function useCv() {
  return useStored<StoredCv | null>("cv", null);
}

export function useProfile() {
  return useStored("profile", EMPTY_PROFILE);
}

/** Jobs marked "Not interested": hide them, bring them back, or ask whether a job is one. */
export function useDismissed() {
  const [dismissed, setDismissed] = useStored("dismissed", EMPTY_DISMISSED);
  const known = useMemo(() => new Set(Object.values(dismissed).flatMap((entry) => entry.keys)), [dismissed]);

  const isDismissed = useCallback((job: Job) => dismissKeys(job).some((key) => known.has(key)), [known]);

  const dismiss = useCallback(
    (job: Job) =>
      setDismissed((previous) => ({
        ...previous,
        [job.id]: { title: job.title, company: job.company, keys: dismissKeys(job), at: new Date().toISOString() },
      })),
    [setDismissed],
  );

  /** Removes every entry that hides this job (it may have been hidden as a copy from another site). */
  const restore = useCallback(
    (job: Job) =>
      setDismissed((previous) => {
        const keys = dismissKeys(job);
        return Object.fromEntries(Object.entries(previous).filter(([, entry]) => !entry.keys.some((key) => keys.includes(key))));
      }),
    [setDismissed],
  );

  /** Removes one entry by the id it was stored under (for the list in Settings). */
  const restoreEntry = useCallback(
    (id: string) =>
      setDismissed((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      }),
    [setDismissed],
  );

  const restoreAll = useCallback(() => setDismissed({}), [setDismissed]);

  return { dismissed, isDismissed, dismiss, restore, restoreEntry, restoreAll, count: Object.keys(dismissed).length };
}

export function useMatches() {
  return useStored("matches", EMPTY_MATCHES);
}

export function useTailored() {
  return useStored("tailored", EMPTY_TAILORED);
}

export function useSettings(): [Settings, (update: Settings | ((previous: Settings) => Settings)) => void] {
  const [stored, set] = useStored<Settings>("settings", DEFAULT_SETTINGS);
  // Fill in fields added after the settings were first saved.
  const settings =
    stored === DEFAULT_SETTINGS ? stored : mergeSettings(stored);
  return [settings, set];
}

const mergedSettings = new WeakMap<Settings, Settings>();
function mergeSettings(stored: Settings): Settings {
  let merged = mergedSettings.get(stored);
  if (!merged) {
    merged = {
      ...DEFAULT_SETTINGS,
      ...stored,
      companyBoards: { ...DEFAULT_SETTINGS.companyBoards, ...stored.companyBoards },
      tailor: { ...DEFAULT_SETTINGS.tailor, ...stored.tailor },
      jobspy: { ...DEFAULT_SETTINGS.jobspy, ...stored.jobspy },
    };
    mergedSettings.set(stored, merged);
  }
  return merged;
}

export function useSavedJobs() {
  const [saved, setSaved] = useStored("saved", EMPTY_SAVED);

  const saveJob = useCallback(
    (job: Job, status: ApplicationStatus = "saved") => {
      setSaved((previous) => {
        const now = new Date().toISOString();
        const existing = previous[job.id];
        return {
          ...previous,
          [job.id]: existing
            ? { ...existing, job: { ...existing.job, ...job }, updatedAt: now }
            : { job, status, notes: "", savedAt: now, updatedAt: now, history: [{ status, at: now }] },
        };
      });
    },
    [setSaved],
  );

  const updateJob = useCallback(
    (id: string, patch: Partial<Omit<SavedJob, "job">> & { job?: Partial<Job> }) => {
      setSaved((previous) => {
        const existing = previous[id];
        if (!existing) return previous;
        const now = new Date().toISOString();
        const status = patch.status;
        const moved = status !== undefined && status !== existing.status;
        // Jobs saved before history was kept start it with their current status, dated as best we can.
        const before = existing.history ?? [
          { status: existing.status, at: existing.status === "saved" ? existing.savedAt : existing.updatedAt },
        ];
        return {
          ...previous,
          [id]: {
            ...existing,
            ...patch,
            job: { ...existing.job, ...patch.job },
            updatedAt: now,
            ...(moved && { history: [...before, { status, at: now }] }),
          },
        };
      });
    },
    [setSaved],
  );

  const removeJob = useCallback(
    (id: string) => {
      setSaved((previous) => {
        const next = { ...previous };
        delete next[id];
        return next;
      });
    },
    [setSaved],
  );

  const removeJobs = useCallback(
    (ids: string[]) => {
      setSaved((previous) => {
        const next = { ...previous };
        for (const id of ids) delete next[id];
        return next;
      });
    },
    [setSaved],
  );

  /** Fill in a saved job from another copy of it (see mergeJobs), keeping its status and notes. */
  const mergeJob = useCallback(
    (id: string, incoming: Job) => {
      setSaved((previous) => {
        const existing = previous[id];
        if (!existing) return previous;
        return {
          ...previous,
          [id]: { ...existing, job: mergeJobs(existing.job, incoming), updatedAt: new Date().toISOString() },
        };
      });
    },
    [setSaved],
  );

  return { saved, saveJob, updateJob, removeJob, removeJobs, mergeJob };
}

/** Removes everything JobScratch keeps in this browser (not on the server). */
export function clearLocalData() {
  try {
    for (const key of Object.keys(window.localStorage)) if (key.startsWith(PREFIX)) window.localStorage.removeItem(key);
  } catch {
    return;
  }
  parsed.clear();
  notify();
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
