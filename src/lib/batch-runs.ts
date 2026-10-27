"use client";

import { useSyncExternalStore } from "react";

/*
 * Match all and Tailor top matches, run outside the page that started them (as lib/job-tasks.ts does
 * for one job): going to another page, say to open a job and apply, doesn't stop them, and coming back
 * shows how far they've got. A reload or closing the tab still does, so the app warns before that.
 * Each is kept under the page it was started from, so one page's run doesn't show on another's.
 */

export type BatchKind = "match" | "tailor";

export interface BatchRun {
  kind: BatchKind;
  /** The page it was started from, e.g. "/saved", for the link in the navigation. */
  page: string;
  /** What's being written, e.g. "CVs and cover letters", for the navigation. */
  what: string;
  /** done: finished while you may have been elsewhere, until you're back on its page. */
  status: "running" | "done" | "seen";
  done: number;
  total: number;
  failed: number;
  /** The jobs being worked on right now. */
  current: string[];
  /** Why it stopped early, e.g. the API key was refused. */
  stopped?: string;
}

const runs = new Map<string, BatchRun>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let all: BatchRun[] = [];

const keyOf = (kind: BatchKind, page: string) => `${kind}:${page}`;

function changed() {
  all = [...runs.values()];
  for (const listener of listeners) listener();
}

if (typeof window !== "undefined") {
  // Leaving the app (a reload or closing the tab) would stop them, so the browser asks first.
  window.addEventListener("beforeunload", (event) => {
    if (all.some((run) => run.status === "running")) event.preventDefault();
  });
}

export interface BatchHandle {
  signal: AbortSignal;
  /** Stops the run, e.g. when every job would fail the same way. */
  abort: () => void;
  report: (patch: Partial<Pick<BatchRun, "done" | "failed" | "current" | "stopped">>) => void;
  /** Marks it finished; `done` until its page is looked at again. */
  finish: () => void;
}

/** Starts a run for `page` (stopping one already running there) and returns how to report on it. */
export function beginBatch(kind: BatchKind, page: string, total: number, what = ""): BatchHandle {
  const key = keyOf(kind, page);
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  runs.set(key, { kind, page, what, status: "running", done: 0, total, failed: 0, current: [] });
  changed();
  const mine = () => controllers.get(key) === controller;
  return {
    signal: controller.signal,
    abort: () => controller.abort(),
    report(patch) {
      const run = runs.get(key);
      if (!mine() || !run) return;
      runs.set(key, { ...run, ...patch });
      changed();
    },
    finish() {
      const run = runs.get(key);
      if (!mine() || !run) return;
      controllers.delete(key);
      runs.set(key, { ...run, status: "done", current: [] });
      changed();
    },
  };
}

export function stopBatch(kind: BatchKind, page: string) {
  controllers.get(keyOf(kind, page))?.abort();
}

/** Clears the "finished" note in the navigation once the run's page has been seen (or it's dismissed). */
export function markBatchSeen(kind: BatchKind, page: string) {
  const run = runs.get(keyOf(kind, page));
  if (run?.status === "done") {
    runs.set(keyOf(kind, page), { ...run, status: "seen" });
    changed();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NONE: BatchRun[] = [];

export function useBatch(kind: BatchKind, page: string): BatchRun | undefined {
  return useSyncExternalStore(
    subscribe,
    () => runs.get(keyOf(kind, page)),
    () => undefined,
  );
}

export function useBatches(): BatchRun[] {
  return useSyncExternalStore(subscribe, () => all, () => NONE);
}
