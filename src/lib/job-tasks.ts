"use client";

import { useSyncExternalStore } from "react";
import type { MatchAnalysis } from "@/lib/ai/prompts";
import { pausedInBackground } from "@/lib/batch-runs";
import { matchFromAnalysis } from "@/lib/candidate";
import { isSavedJob, saveAnswers, updateStoredMatch, updateTailoredDocs } from "@/lib/store";
import { requestAnswers, streamTailored, type AnswersRequest, type TailorRequest } from "@/lib/tailor-client";

/*
 * Match analysis, tailored CVs and cover letters for one job, run outside the
 * page that started them: leaving the job's page (for My jobs or anywhere else
 * in the app) doesn't stop them, and the result is saved when it arrives. A
 * reload or closing the tab still does, so the app warns before that. One dropped while a phone had the
 * app in the background starts again when you're back.
 */

export type TaskKind = "analysis" | "cv" | "coverLetter" | "answers";

export interface JobTask {
  jobId: string;
  kind: TaskKind;
  /** "Data Analyst at CBRE", for the indicator in the navigation. */
  label: string;
  /** done: finished while you may have been elsewhere, until you look at the job. */
  status: "running" | "done" | "stopped" | "error";
  /** The document so far, while it's written. */
  text: string;
  thinking: string;
  notice?: string;
  error?: string;
  startedAt: number;
}

const tasks = new Map<string, JobTask>();
const controllers = new Map<string, AbortController>();
const listeners = new Set<() => void>();
let all: JobTask[] = [];

const keyOf = (jobId: string, kind: TaskKind) => `${jobId}:${kind}`;

function changed() {
  all = [...tasks.values()];
  for (const listener of listeners) listener();
  if (typeof window !== "undefined") {
    const running = all.some((task) => task.status === "running");
    // Leaving the app (a reload or closing the tab) would stop them, so the browser asks first.
    window.onbeforeunload = running
      ? (event) => {
          event.preventDefault();
          event.returnValue = "";
        }
      : null;
  }
}

function set(jobId: string, kind: TaskKind, patch: Partial<JobTask>) {
  const key = keyOf(jobId, kind);
  const current = tasks.get(key);
  if (!current) return;
  tasks.set(key, { ...current, ...patch });
  changed();
}

function begin(jobId: string, kind: TaskKind, label: string): AbortController {
  const key = keyOf(jobId, kind);
  controllers.get(key)?.abort();
  const controller = new AbortController();
  controllers.set(key, controller);
  tasks.set(key, { jobId, kind, label, status: "running", text: "", thinking: "", startedAt: Date.now() });
  changed();
  return controller;
}

function finish(jobId: string, kind: TaskKind, controller: AbortController) {
  const key = keyOf(jobId, kind);
  if (controllers.get(key) === controller) controllers.delete(key);
}

/** Saves a result, unless the job was removed while it was being written. */
function save(jobId: string, patch: Parameters<typeof updateTailoredDocs>[1]) {
  if (isSavedJob(jobId)) updateTailoredDocs(jobId, patch);
}

/** `matchKey` (see lib/candidate.ts), when given, also saves the result as the job's match score in lists. */
export function startAnalysis(
  jobId: string,
  label: string,
  body: Omit<TailorRequest, "kind" | "options">,
  matchKey?: string,
) {
  const controller = begin(jobId, "analysis", label);
  void (async () => {
    try {
      const response = await fetch("/api/tailor/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      // A timeout or server error can come back as a page rather than JSON.
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `The analysis failed (HTTP ${response.status}). Try again.`);
      const analysis = data as MatchAnalysis;
      save(jobId, { analysis });
      if (matchKey) updateStoredMatch(jobId, matchFromAnalysis(analysis, matchKey));
      set(jobId, "analysis", { status: "done" });
    } catch (error) {
      if (controller.signal.aborted) set(jobId, "analysis", { status: "stopped" });
      else if (await pausedInBackground(controller.signal)) startAnalysis(jobId, label, body, matchKey);
      else set(jobId, "analysis", { status: "error", error: (error as Error).message });
    } finally {
      finish(jobId, "analysis", controller);
    }
  })();
}

export function startDocument(jobId: string, label: string, kind: "cv" | "coverLetter", request: Omit<TailorRequest, "kind">) {
  const controller = begin(jobId, kind, label);
  let text = "";
  void (async () => {
    try {
      const finished = await streamTailored(
        { ...request, kind: kind === "cv" ? "cv" : "cover-letter" },
        {
          signal: controller.signal,
          onText: (current) => {
            text = current;
            set(jobId, kind, { text: current });
          },
          onThinking: (thinking) => set(jobId, kind, { thinking }),
          onNotice: (notice) => set(jobId, kind, { notice }),
        },
      );
      save(jobId, { [kind]: finished });
      set(jobId, kind, { status: "done", text: "" });
    } catch (error) {
      if (controller.signal.aborted) {
        if (text.trim()) save(jobId, { [kind]: text.trim() });
        set(jobId, kind, { status: "stopped", text: "", notice: text ? "Stopped early, so this draft may be incomplete." : undefined });
      } else if (await pausedInBackground(controller.signal)) {
        startDocument(jobId, label, kind, request);
      } else {
        set(jobId, kind, { status: "error", text: "", error: (error as Error).message });
      }
    } finally {
      finish(jobId, kind, controller);
    }
  })();
}

/** Drafts application answers; `add` keeps the job's other answers (a new question) rather than replacing them. */
export function startAnswers(jobId: string, label: string, request: AnswersRequest, add = false) {
  const controller = begin(jobId, "answers", label);
  void (async () => {
    try {
      const answers = await requestAnswers(request, controller.signal);
      if (isSavedJob(jobId)) saveAnswers(jobId, answers, add);
      set(jobId, "answers", { status: "done" });
    } catch (error) {
      if (controller.signal.aborted) set(jobId, "answers", { status: "stopped" });
      else if (await pausedInBackground(controller.signal)) startAnswers(jobId, label, request, add);
      else set(jobId, "answers", { status: "error", error: (error as Error).message });
    } finally {
      finish(jobId, "answers", controller);
    }
  })();
}

export function stopTask(jobId: string, kind: TaskKind) {
  controllers.get(keyOf(jobId, kind))?.abort();
}

/** Stops everything for a job and forgets it (when the job is removed). */
export function stopJobTasks(jobId: string) {
  for (const kind of ["analysis", "cv", "coverLetter", "answers"] as const) {
    stopTask(jobId, kind);
    tasks.delete(keyOf(jobId, kind));
  }
  changed();
}

/** Clears finished tasks once they've been seen (on the job's page, or dismissed). */
export function dismissTask(jobId: string, kind: TaskKind) {
  const task = tasks.get(keyOf(jobId, kind));
  if (task && task.status !== "running") {
    tasks.delete(keyOf(jobId, kind));
    changed();
  }
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

const NONE: JobTask[] = [];

export function useJobTask(jobId: string, kind: TaskKind): JobTask | undefined {
  return useSyncExternalStore(
    subscribe,
    () => tasks.get(keyOf(jobId, kind)),
    () => undefined,
  );
}

/** Every task: running, or finished and not yet seen. */
export function useJobTasks(): JobTask[] {
  return useSyncExternalStore(subscribe, () => all, () => NONE);
}
