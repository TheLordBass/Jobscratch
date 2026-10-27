"use client";

import { useCallback, useSyncExternalStore } from "react";

/*
 * What a page was showing (a search and its results, its filters, the open tab), kept for this tab's
 * session so going to another page and back picks up where you were. It's kept in memory, so a search
 * still running when you leave lands here, and in sessionStorage so a reload keeps it too, when it fits.
 * Unlike lib/store.ts it isn't saved for good or sent to the server.
 */

const PREFIX = "jobscratch-view:";
const values = new Map<string, unknown>();
const listeners = new Set<() => void>();

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** The value for `key`: what was set this session, else `initial` (kept, so the same object comes back each time). */
function read<T>(key: string, initial: T): T {
  if (values.has(key)) return values.get(key) as T;
  let value: T = initial;
  try {
    const raw = storage()?.getItem(PREFIX + key);
    if (raw != null) value = JSON.parse(raw) as T;
  } catch {
    // Unreadable or blocked: start afresh.
  }
  values.set(key, value);
  return value;
}

function write(key: string, value: unknown) {
  values.set(key, value);
  const session = storage();
  try {
    session?.setItem(PREFIX + key, JSON.stringify(value));
  } catch {
    // Too big for sessionStorage (a long list of results): kept in memory only, so drop the older copy.
    try {
      session?.removeItem(PREFIX + key);
    } catch {
      // Nothing more to do.
    }
  }
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Sets a value outside React, e.g. from a search that finished after you left its page. */
export function setSessionValue<T>(key: string, value: T | ((previous: T) => T), initial: T) {
  write(key, typeof value === "function" ? (value as (previous: T) => T)(read(key, initial)) : value);
}

/**
 * Like useState, but kept for the session under `key` (see above). The value must survive JSON, so a
 * Set is kept as an array. Keys are best named after the page, e.g. "search:keywords".
 */
export function useSessionState<T>(key: string, initial: T): [T, (value: T | ((previous: T) => T)) => void] {
  const value = useSyncExternalStore(
    subscribe,
    () => read(key, initial),
    () => initial,
  );
  const set = useCallback((next: T | ((previous: T) => T)) => setSessionValue(key, next, initial), [key, initial]);
  return [value, set];
}

/** Forgets every page's state (on signing out, so the next person doesn't see your searches). */
export function clearSessionState() {
  values.clear();
  const session = storage();
  try {
    for (const key of Object.keys(session ?? {})) if (key.startsWith(PREFIX)) session?.removeItem(key);
  } catch {
    // Nothing more to do.
  }
  for (const listener of listeners) listener();
}
