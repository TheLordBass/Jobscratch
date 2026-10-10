"use client";

import { useCallback, useSyncExternalStore } from "react";
import type { MatchAnalysis, TailorOptions } from "@/lib/ai/prompts";
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

export interface SavedJob {
  job: Job;
  status: ApplicationStatus;
  notes: string;
  savedAt: string;
  updatedAt: string;
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
  tailor: TailorOptions;
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
  tailor: { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "" },
};

export const EMPTY_PROFILE: StoredProfile = { website: "", github: "", evidence: "", enabled: true };

const EMPTY_GROUPS: SearchGroup[] = [];
const EMPTY_SAVED: Record<string, SavedJob> = {};
const EMPTY_TAILORED: Record<string, TailoredDocs> = {};

const PREFIX = "jobscratch:";
type Key = "groups" | "saved" | "cv" | "profile" | "settings" | "tailored";

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
  const raw = JSON.stringify(value);
  try {
    window.localStorage.setItem(storageKey, raw);
  } catch {
    window.alert("Your browser's storage is full. Remove some saved jobs and try again.");
    return;
  }
  parsed.set(storageKey, { raw, value });
  notify();
}

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
            : { job, status, notes: "", savedAt: now, updatedAt: now },
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
        return {
          ...previous,
          [id]: {
            ...existing,
            ...patch,
            job: { ...existing.job, ...patch.job },
            updatedAt: new Date().toISOString(),
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

  return { saved, saveJob, updateJob, removeJob };
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
