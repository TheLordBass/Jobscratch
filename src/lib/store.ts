"use client";

import { useCallback, useMemo, useSyncExternalStore } from "react";
import type { ApplicationAnswer, ApplicationDetails, ExtraSkill, MatchAnalysis, TailorOptions } from "@/lib/ai/prompts";
import { dismissKeys, findSavedCopy, mergeJobs } from "@/lib/import";
import { DEFAULT_JOBSPY_SEARCH, type HelperSearch } from "@/lib/jobspy-helper";
import type { JobspyList } from "@/lib/jobspy-lists";
import { DEFAULT_MORNING_PREP, type MorningPrepSettings } from "@/lib/morning-prep";
import { connectStore, queueChange } from "@/lib/sync";
import type { CompanyBoards, Job, SearchSourceId } from "@/lib/types";

/*
 * Everything personal (CV, saved jobs, groups, settings) lives in this browser (in IndexedDB, see
 * below), and on the server too when server storage is set up (lib/sync.ts).
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
  /** Skills and experience the CV doesn't show, added on the Profile page. Sent with every analysis and document. */
  skills?: ExtraSkill[];
  /** Standard answers for application forms (Profile → Application details), used in drafted answers. */
  application?: ApplicationDetails;
}

export interface Settings {
  country: string;
  includeRemoteAnywhere: boolean;
  companyBoards: CompanyBoards;
  disabledSources: SearchSourceId[];
  /** "Save jobs matching N% or more" on search results and the JobSpy list. */
  saveMatchesFrom: number;
  /** With it, also save the jobs that have no description to match (often LinkedIn and Glassdoor ones). */
  saveUndescribed: boolean;
  /** Send each job's notes with tailoring and analysis, as extra experience and guidance. */
  useJobNotes: boolean;
  tailor: TailorOptions;
  /** The last JobSpy search, so the form starts with it. The morning run uses its sites and other options too. */
  jobspy: Omit<HelperSearch, "country">;
  /** Job titles for the morning JobSpy run, in named lists with their own places (lib/jobspy-lists.ts). */
  jobspyLists: JobspyList[];
  /** What the morning run does with its jobs before you're up (lib/morning-prep.ts). */
  morningPrep: MorningPrepSettings;
}

export interface TailoredDocs {
  analysis?: MatchAnalysis;
  cv?: string;
  coverLetter?: string;
  /** Edited job description used for tailoring (e.g. full text pasted over a snippet). */
  jobDescription?: string;
  /** Drafted answers to the questions on the job's application form. */
  answers?: ApplicationAnswer[];
  updatedAt: string;
}

export const DEFAULT_SETTINGS: Settings = {
  country: "gb",
  includeRemoteAnywhere: true,
  companyBoards: { greenhouse: [], lever: [], ashby: [] },
  disabledSources: [],
  saveMatchesFrom: 70,
  saveUndescribed: true,
  useJobNotes: true,
  tailor: { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "", projects: true },
  jobspy: DEFAULT_JOBSPY_SEARCH,
  jobspyLists: [],
  morningPrep: DEFAULT_MORNING_PREP,
};

export const EMPTY_PROFILE: StoredProfile = { website: "", github: "", evidence: "", enabled: true };

/** A job's match (from "Match all" or its page), kept with its full analysis for lists and the job's page. */
export interface StoredMatch {
  score: number;
  verdict: string;
  missing: string[];
  /** The full analysis. Older, quick-only scores have none and aren't shown any more. */
  analysis?: MatchAnalysis;
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
const KEYS = ["groups", "saved", "cv", "profile", "settings", "tailored", "matches", "dismissed"] as const;
type Key = (typeof KEYS)[number];

/*
 * Where the data lives. IndexedDB can hold far more than localStorage's ~5 MB (browsers let a site
 * use a good share of the free disk), but it can't be read synchronously, so its contents are kept in
 * memory once loaded and each change is written back. Data saved by earlier versions in localStorage is
 * moved across on the first load. Where IndexedDB isn't available, localStorage is used as before.
 */
let mode: "loading" | "indexeddb" | "local" =
  typeof window === "undefined" || typeof indexedDB === "undefined" ? "local" : "loading";
const memory = new Map<Key, unknown>();
let db: IDBDatabase | null = null;
/** Changes asked for before the data had loaded, made once it has (so they start from the real data). */
const afterLoad: Array<() => void> = [];
let markReady: () => void = () => {};
const ready = mode === "loading" ? new Promise<void>((resolve) => (markReady = resolve)) : Promise.resolve();
const DB_NAME = "jobscratch";
const DB_STORE = "data";
/** Tells this site's other tabs which keys changed, as the "storage" event does for localStorage. */
const channel = mode === "loading" && typeof BroadcastChannel !== "undefined" ? new BroadcastChannel("jobscratch-store") : null;

const listeners = new Set<() => void>();
const parsed = new Map<string, { raw: string | null; value: unknown }>();

function notify() {
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  const onStorage = (event: StorageEvent) => {
    if (mode === "local" && (!event.key || event.key.startsWith(PREFIX))) listener();
  };
  window.addEventListener("storage", onStorage);
  return () => {
    listeners.delete(listener);
    window.removeEventListener("storage", onStorage);
  };
}

function request<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function openDb(): Promise<IDBDatabase> {
  const req = indexedDB.open(DB_NAME, 1);
  req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
  return request(req);
}

/** Reads keys from IndexedDB into memory (all of them when none are given). */
async function loadFromDb(keys: readonly Key[] = KEYS) {
  if (!db) return;
  const objects = db.transaction(DB_STORE, "readonly").objectStore(DB_STORE);
  const values = await Promise.all(keys.map((key) => request(objects.get(key))));
  keys.forEach((key, i) => {
    if (values[i] === undefined) memory.delete(key);
    else memory.set(key, values[i]);
  });
}

function storageFull() {
  window.alert("Your browser's storage is full. Remove some saved jobs and try again.");
}

/** Writes keys to IndexedDB (removing those without a value); resolves once they're saved. */
function persist(keys: readonly Key[]): Promise<void> {
  if (!db) return Promise.resolve();
  const tx = db.transaction(DB_STORE, "readwrite");
  const objects = tx.objectStore(DB_STORE);
  for (const key of keys) {
    const value = memory.get(key);
    if (value === undefined || value === null) objects.delete(key);
    else objects.put(value, key);
  }
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => {
      channel?.postMessage(keys);
      resolve();
    };
    tx.onabort = () => {
      if (tx.error?.name === "QuotaExceededError") storageFull();
      reject(tx.error);
    };
  });
}

async function init() {
  try {
    db = await openDb();
    await loadFromDb();
    // Move across anything earlier versions kept in localStorage (newer than what's here, if both are).
    const moved: Key[] = [];
    for (const key of KEYS) {
      const raw = window.localStorage.getItem(PREFIX + key);
      if (raw === null) continue;
      try {
        memory.set(key, JSON.parse(raw));
        moved.push(key);
      } catch {
        // Unreadable: left where it is.
      }
    }
    if (moved.length) {
      await persist(moved);
      for (const key of moved) window.localStorage.removeItem(PREFIX + key);
    }
    mode = "indexeddb";
    if (channel) {
      channel.onmessage = (event: MessageEvent<Key[]>) => {
        void loadFromDb(event.data.filter((key) => KEYS.includes(key))).then(notify);
      };
    }
  } catch {
    // No IndexedDB here (blocked, or a private window in some browsers): localStorage it is.
    db = null;
    memory.clear();
    mode = "local";
  }
  markReady();
  notify();
  for (const run of afterLoad.splice(0)) run();
}
if (mode === "loading") void init();

function read<T>(key: Key, fallback: T): T {
  if (mode !== "local") return memory.has(key) ? (memory.get(key) as T) : fallback;
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

/** What's actually stored: null when nothing is, rather than a page's default. */
function stored(key: Key): unknown {
  if (mode !== "local") return memory.get(key) ?? null;
  try {
    return window.localStorage.getItem(PREFIX + key) === null ? null : read<unknown>(key, null);
  } catch {
    return null;
  }
}

/** Saves a value. False if the browser's storage is full (known straight away only for localStorage; see persist). */
function save(key: Key, value: unknown): boolean {
  if (mode !== "local") {
    if (value === null || value === undefined) memory.delete(key);
    else memory.set(key, value);
    void persist([key]).catch(() => {});
    return true;
  }
  const storageKey = PREFIX + key;
  try {
    if (value === null || value === undefined) window.localStorage.removeItem(storageKey);
    else window.localStorage.setItem(storageKey, JSON.stringify(value));
  } catch {
    return false;
  }
  parsed.delete(storageKey);
  return true;
}

/** Changes a stored value; waits for the data to load first if it hasn't yet. */
function update<T>(key: Key, fallback: T, change: (previous: T) => T) {
  if (mode === "loading") {
    afterLoad.push(() => update(key, fallback, change));
    return;
  }
  const previous = stored(key);
  const next = change(read(key, fallback));
  if (!save(key, next)) {
    storageFull();
    return;
  }
  notify();
  queueChange(key, previous, next);
}

/** A value from server storage: saved here without being sent back. */
function applyRemote(key: Key, value: unknown) {
  if (save(key, value)) notify();
}

connectStore({ read: stored, apply: applyRemote, ready: () => ready });

function useStored<T>(key: Key, fallback: T): [T, (update: T | ((previous: T) => T)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, fallback),
    () => fallback,
  );
  const set = useCallback(
    (next: T | ((previous: T) => T)) =>
      update(key, fallback, typeof next === "function" ? (next as (p: T) => T) : () => next),
    [key, fallback],
  );
  return [value, set];
}

/** True once this browser's data has loaded, so pages can avoid flashing "empty" states. */
export function useHydrated(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => mode !== "loading",
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
      morningPrep: { ...DEFAULT_SETTINGS.morningPrep, ...stored.morningPrep },
    };
    mergedSettings.set(stored, merged);
  }
  return merged;
}

/**
 * Saved jobs with `job` saved, or updated if it's saved already. Another copy of a saved job
 * (e.g. the same job from another site or a later search) is merged into it rather than saved twice.
 */
function withJobSaved(
  previous: Record<string, SavedJob>,
  job: Job,
  status: ApplicationStatus,
  now: string,
): { saved: Record<string, SavedJob>; id: string } {
  const existing = previous[job.id];
  if (existing) {
    return { saved: { ...previous, [job.id]: { ...existing, job: { ...existing.job, ...job }, updatedAt: now } }, id: job.id };
  }
  const copy = findSavedCopy(previous, job);
  if (copy) {
    const id = copy.job.id;
    return { saved: { ...previous, [id]: { ...copy, job: mergeJobs(copy.job, job), updatedAt: now } }, id };
  }
  return {
    saved: { ...previous, [job.id]: { job, status, notes: "", savedAt: now, updatedAt: now, history: [{ status, at: now }] } },
    id: job.id,
  };
}

export function useSavedJobs() {
  const [saved, setSaved] = useStored("saved", EMPTY_SAVED);

  /**
   * Saves a job (see withJobSaved). Returns the id it's saved under, which is the saved copy's when it
   * was another copy of one.
   */
  const saveJob = useCallback(
    (job: Job, status: ApplicationStatus = "saved"): string => {
      let id = job.id;
      setSaved((previous) => {
        const result = withJobSaved(previous, job, status, new Date().toISOString());
        id = result.id;
        return result.saved;
      });
      return id;
    },
    [setSaved],
  );

  /** Saves several jobs at once (Save all), with one write instead of one per job. */
  const saveJobs = useCallback(
    (jobs: Job[], status: ApplicationStatus = "saved") => {
      if (jobs.length === 0) return;
      setSaved((previous) => {
        const now = new Date().toISOString();
        return jobs.reduce((saved, job) => withJobSaved(saved, job, status, now).saved, previous);
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

  return { saved, saveJob, saveJobs, updateJob, removeJob, removeJobs, mergeJob };
}

/** Whether a job is in My jobs, read outside React (see lib/job-tasks.ts). */
export function isSavedJob(id: string): boolean {
  return Boolean(read("saved", EMPTY_SAVED)[id]);
}

/** Saves a job's tailored documents or analysis outside React, e.g. when one finishes in the background. */
export function updateTailoredDocs(id: string, patch: Partial<TailoredDocs>) {
  update("tailored", EMPTY_TAILORED, (previous) => ({
    ...previous,
    [id]: { ...previous[id], ...patch, updatedAt: new Date().toISOString() },
  }));
}

/**
 * Saves drafted application answers outside React (see lib/job-tasks.ts): all of them, or `add`ed to
 * the ones there, replacing any to the same question.
 */
export function saveAnswers(id: string, answers: ApplicationAnswer[], add: boolean) {
  update("tailored", EMPTY_TAILORED, (previous) => {
    const kept = add ? (previous[id]?.answers ?? []).filter((old) => !answers.some((a) => a.question === old.question)) : [];
    return { ...previous, [id]: { ...previous[id], answers: [...kept, ...answers], updatedAt: new Date().toISOString() } };
  });
}

/** Saves a job's match score outside React (see lib/job-tasks.ts). */
export function updateStoredMatch(id: string, match: StoredMatch) {
  update("matches", EMPTY_MATCHES, (previous) => ({ ...previous, [id]: match }));
}

/** Everything JobScratch keeps in this browser, keyed as in a backup file ("jobscratch:saved" and so on). */
export async function exportLocalData(): Promise<Record<string, unknown>> {
  await ready;
  const data: Record<string, unknown> = {};
  for (const key of KEYS) {
    const value = stored(key);
    if (value !== null) data[PREFIX + key] = value;
  }
  return data;
}

/** Whether a backup file holds any JobScratch data. */
export function isBackup(data: Record<string, unknown>): boolean {
  return KEYS.some((key) => PREFIX + key in data);
}

/**
 * Replaces what's in this browser with a backup (keys as exportLocalData gives them), or with nothing
 * (Delete all data). Resolves once it's saved, so the page can be reloaded straight after.
 */
export async function replaceLocalData(data: Record<string, unknown> = {}): Promise<void> {
  await ready;
  for (const key of KEYS) {
    if (!save(key, data[PREFIX + key] ?? null)) throw new Error("your browser's storage is full");
  }
  await persist(KEYS);
  notify();
}

export function newId(): string {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}${Math.random().toString(36).slice(2)}`;
}
