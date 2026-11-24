import { analyzeMatch, toAiError } from "@/lib/ai/claude";
import type { MatchAnalysis, TailorJob } from "@/lib/ai/prompts";
import { candidateFor, matchFromAnalysis } from "@/lib/candidate";
import { hasCvText } from "@/lib/cvs";
import {
  MATCH_LOCK_KEY,
  MATCH_QUEUE_KEY,
  MATCH_STATE_KEY,
  applyOps,
  readCollection,
  readHash,
  readSomeItems,
  readValue,
  type DataBackend,
} from "@/lib/server-data";
import type {
  SavedJob,
  StoredCv,
  StoredMatch,
  StoredProfile,
  TailoredDocs,
} from "@/lib/store";

/*
 * Match all, done by the server rather than the device. The app sends the jobs to match
 * (/api/match), and the server works through them a few at a time, each step starting the next
 * (/api/match/work), so it carries on with the app closed. Each score goes into the same server
 * storage the app syncs from, so every device picks up the scores together instead of saving them one by one
 * (which is what made a phone freeze on a big run).
 */

const QUEUE_KEY = MATCH_QUEUE_KEY;
const STATE_KEY = MATCH_STATE_KEY;
const LOCK_KEY = MATCH_LOCK_KEY;

/** How many analyses run at the same time. */
const PARALLEL = 3;
/** A step stops starting new analyses after this long, so the ones in hand finish inside its 300 seconds. */
export const STEP_MS = 180_000;
/** An analysis still going this long into a step is given up on, and stays queued for the next step. */
const ANALYSIS_LIMIT_MS = 270_000;
/** A step holds the lock this long at most: one that died lets the next take over after this. */
const LOCK_SECONDS = 300;
/** No step has reported for this long while jobs are waiting: it's assumed to have died and is started again. */
export const STALLED_MS = 6 * 60_000;
/** Errors that every other job would hit too: the key, the model, the API being down. */
const FATAL = new Set([401, 403, 404, 503]);

export interface QueuedMatch {
  job: TailorJob;
  notes?: string;
  /** The description's part of the match key (lib/candidate.ts matchKey), worked out by the app. */
  hash: string;
}

export interface MatchQueueState {
  total: number;
  done: number;
  failed: number;
  startedAt: string;
  /** When a step last reported, to tell a run that's still going from one that died. */
  updatedAt: string;
  /** Why it stopped early (a missing key, say, or Stop), if it did. */
  stopped?: string;
  /** Claude's rate limit was reached: the next step waits a little first. */
  pausedUntil?: string;
}

export interface MatchQueueStatus extends MatchQueueState {
  /** Jobs still waiting to be matched. */
  waiting: number;
}

async function readState(
  backend: DataBackend,
): Promise<MatchQueueState | null> {
  const [raw] = await backend.run([["GET", STATE_KEY]]);
  return typeof raw === "string" ? (JSON.parse(raw) as MatchQueueState) : null;
}

async function writeState(backend: DataBackend, state: MatchQueueState) {
  await backend.run([["SET", STATE_KEY, JSON.stringify(state)]]);
}

async function waitingCount(backend: DataBackend): Promise<number> {
  const [count] = await backend.run([["HLEN", QUEUE_KEY]]);
  return Number(count) || 0;
}

export async function matchQueueStatus(
  backend: DataBackend,
): Promise<MatchQueueStatus | null> {
  const [state, waiting] = await Promise.all([
    readState(backend),
    waitingCount(backend),
  ]);
  return state ? { ...state, waiting } : null;
}

/** Whether jobs are waiting but no step has reported for a while, so one should be started. */
export function stalled(
  status: MatchQueueStatus | null,
  now = Date.now(),
): boolean {
  return Boolean(
    status &&
    status.waiting > 0 &&
    !status.stopped &&
    now - Date.parse(status.updatedAt) > STALLED_MS,
  );
}

/**
 * Adds jobs to match. A job already waiting is replaced rather than matched twice. When nothing was
 * waiting, the count starts again from these.
 */
export async function enqueueMatches(
  backend: DataBackend,
  items: Record<string, QueuedMatch>,
  now = new Date().toISOString(),
): Promise<MatchQueueStatus> {
  const ids = Object.keys(items);
  if (ids.length === 0)
    return (
      (await matchQueueStatus(backend)) ?? {
        total: 0,
        done: 0,
        failed: 0,
        startedAt: now,
        updatedAt: now,
        waiting: 0,
      }
    );
  const [state, waiting, [found]] = await Promise.all([
    readState(backend),
    waitingCount(backend),
    backend.run([["HMGET", QUEUE_KEY, ...ids]]),
  ]);
  const already = (found as Array<string | null>).filter(
    (raw) => raw !== null,
  ).length;
  const fresh = !state || waiting === 0 || Boolean(state.stopped);
  const next: MatchQueueState = fresh
    ? { total: ids.length, done: 0, failed: 0, startedAt: now, updatedAt: now }
    : { ...state, total: state.total + ids.length - already, updatedAt: now };
  await backend.run([
    [
      "HSET",
      QUEUE_KEY,
      ...Object.entries(items).flatMap(([id, item]) => [
        id,
        JSON.stringify(item),
      ]),
    ],
  ]);
  await writeState(backend, next);
  return { ...next, waiting: waiting + ids.length - already };
}

/** Stop: the jobs still waiting are dropped; scores already made are kept. */
export async function stopMatches(
  backend: DataBackend,
  now = new Date().toISOString(),
): Promise<void> {
  const state = await readState(backend);
  await backend.run([["DEL", QUEUE_KEY]]);
  if (state)
    await writeState(backend, {
      ...state,
      stopped: state.stopped ?? "Stopped.",
      updatedAt: now,
    });
}

/** Takes the lock, or says another step holds it. A lock left by a step that died runs out. */
async function takeLock(backend: DataBackend, now: number): Promise<boolean> {
  const until = String(now + LOCK_SECONDS * 1000);
  const [taken] = await backend.run([
    ["SET", LOCK_KEY, until, "NX", "EX", String(LOCK_SECONDS)],
  ]);
  if (taken === "OK") return true;
  // A store that doesn't expire keys itself (the local file in development): an old lock is cleared here.
  const [held] = await backend.run([["GET", LOCK_KEY]]);
  if (typeof held === "string" && Number(held) < now) {
    await backend.run([["DEL", LOCK_KEY]]);
    const [again] = await backend.run([
      ["SET", LOCK_KEY, until, "NX", "EX", String(LOCK_SECONDS)],
    ]);
    return again === "OK";
  }
  return false;
}

export interface MatchStepDeps {
  analyze: typeof analyzeMatch;
  /** The time, in milliseconds; replaceable in tests. */
  clock: () => number;
}

const DEPS: MatchStepDeps = { analyze: analyzeMatch, clock: Date.now };

/**
 * One step: matches waiting jobs, PARALLEL at a time, until STEP_MS has passed or none are left.
 * Answers whether more are waiting, for the caller to start the next step.
 */
export async function matchStep(
  backend: DataBackend,
  env: Record<string, string | undefined>,
  deps: MatchStepDeps = DEPS,
): Promise<{ more: boolean; busy?: true }> {
  const started = deps.clock();
  if (!(await takeLock(backend, started))) return { more: false, busy: true };
  try {
    const state = await readState(backend);
    if (!state || state.stopped) return { more: false };
    const [cv, profile] = (await Promise.all([
      readValue(backend, "cv"),
      readValue(backend, "profile"),
    ])) as [StoredCv | null, StoredProfile | null];
    if (!hasCvText(cv)) {
      await backend.run([["DEL", QUEUE_KEY]]);
      await writeState(backend, {
        ...state,
        stopped: "Add your CV first, under Profile.",
        updatedAt: new Date(deps.clock()).toISOString(),
      });
      return { more: false };
    }
    const candidate = candidateFor(cv, {
      website: "",
      github: "",
      evidence: "",
      enabled: true,
      ...profile,
    });
    const settings = (await readValue(backend, "settings")) as {
      useJobNotes?: boolean;
    } | null;
    const useNotes = settings?.useJobNotes ?? true;

    const queue = Object.entries(
      await readHash<QueuedMatch>(backend, QUEUE_KEY),
    );
    const saved = await readCollection<SavedJob>(backend, "saved");
    // Read again before each change, so jobs added meanwhile (enqueueMatches) keep their count, and
    // one change at a time, so analyses finishing together don't overwrite each other's.
    let reporting: Promise<void> = Promise.resolve();
    const report = (
      counts: { done?: number; failed?: number },
      change: Partial<MatchQueueState> = {},
    ) => {
      const next = reporting.then(async () => {
        const latest = (await readState(backend)) ?? state;
        Object.assign(state, latest, change, {
          done: latest.done + (counts.done ?? 0),
          failed: latest.failed + (counts.failed ?? 0),
          updatedAt: new Date(deps.clock()).toISOString(),
        });
        await writeState(backend, state);
      });
      // One that failed doesn't stop the ones after it.
      reporting = next.catch(() => undefined);
      return next;
    };

    if (state.pausedUntil) {
      // Rate limited a moment ago: wait it out here rather than spend a request on it.
      const wait = Math.min(
        Date.parse(state.pausedUntil) - deps.clock(),
        60_000,
      );
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      await report({}, { pausedUntil: undefined });
    }

    // Saved with the job's match, and as the analysis of a saved job, as the app does.
    const save = async (id: string, analysis: MatchAnalysis, key: string) => {
      const at = new Date(deps.clock()).toISOString();
      const ops: Parameters<typeof applyOps>[1] = [
        {
          key: "matches",
          items: { [id]: matchFromAnalysis(analysis, key, at) as StoredMatch },
        },
      ];
      if (saved[id]) {
        const docs = await readSomeItems<TailoredDocs>(backend, "tailored", [
          id,
        ]);
        ops.push({
          key: "tailored",
          items: {
            [id]: {
              ...docs[id],
              analysis,
              analysisFrom: candidate.key,
              updatedAt: at,
            },
          },
        });
      }
      await applyOps(backend, ops, at);
    };

    const signal = AbortSignal.timeout(
      ANALYSIS_LIMIT_MS - (deps.clock() - started),
    );
    let halt = false;
    const worker = async () => {
      for (
        let next = queue.shift();
        next && !halt && deps.clock() - started < STEP_MS;
        next = queue.shift()
      ) {
        const [id, item] = next;
        try {
          const analysis = await deps.analyze(
            {
              ...candidate,
              cv: candidate.cv,
              job: item.job,
              notes: useNotes ? item.notes : undefined,
            },
            env,
            signal,
          );
          await save(id, analysis, `${candidate.key}:${item.hash}`);
          await backend.run([["HDEL", QUEUE_KEY, id]]);
          await report({ done: 1 });
          // Stop was pressed meanwhile.
          if (state.stopped) halt = true;
        } catch (error) {
          // Given up on at the end of the step: it stays queued for the next one.
          if (signal.aborted) return;
          const aiError = toAiError(error);
          if (aiError.status === 429) {
            halt = true;
            await report(
              {},
              { pausedUntil: new Date(deps.clock() + 30_000).toISOString() },
            );
          } else if (FATAL.has(aiError.status)) {
            halt = true;
            await backend.run([["DEL", QUEUE_KEY]]);
            await report({}, { stopped: aiError.message });
          } else {
            await backend.run([["HDEL", QUEUE_KEY, id]]);
            await report({ done: 1, failed: 1 });
          }
        }
      }
    };
    await Promise.all(Array.from({ length: PARALLEL }, worker));
    await report({});
    return { more: !state.stopped && (await waitingCount(backend)) > 0 };
  } finally {
    await backend.run([["DEL", LOCK_KEY]]);
  }
}

/**
 * Starts a step as a request of its own (/api/match/work), so each has a function's full time. It
 * goes with the sign-in of the request that asked, which the proxy checks as for any other.
 */
export async function startStep(request: Request): Promise<void> {
  const headers: Record<string, string> = {};
  for (const name of ["cookie", "authorization"]) {
    const value = request.headers.get(name);
    if (value) headers[name] = value;
  }
  try {
    const response = await fetch(new URL("/api/match/work", request.url), {
      method: "POST",
      headers,
      cache: "no-store",
    });
    if (!response.ok)
      console.error(
        `Couldn't start the next matching step (HTTP ${response.status})`,
      );
  } catch (error) {
    console.error("Couldn't start the next matching step", error);
  }
}
