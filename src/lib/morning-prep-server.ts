import {
  AiError,
  analyzeMatch,
  cancelMatchBatch,
  draftAnswers,
  readMatchBatch,
  streamDocument,
  submitMatchBatch,
  toAiError,
  type BatchOutcome,
  type DocumentKind,
} from "@/lib/ai/claude";
import { DEFAULT_QUESTIONS, type MatchAnalysis, type TailorMaterials, type TailorOptions } from "@/lib/ai/prompts";
import { canMatch, candidateFor, madeFromCurrent, matchFromAnalysis, matchKey, type Candidate } from "@/lib/candidate";
import { hasCvText } from "@/lib/cvs";
import { dismissKeys, findSavedCopy } from "@/lib/import";
import { RUN_JOBS_KEY, RUN_PREP_KEY, readRun, type JobspyRun, type RunJob } from "@/lib/jobspy-runs";
import {
  DEFAULT_MORNING_PREP,
  TODAY_FROM,
  TODAY_LIMIT,
  TODAY_MAX_DAYS,
  emptyPrepState,
  prepSummary,
  type MorningPrepSettings,
  type PrepState,
} from "@/lib/morning-prep";
import { followUpsDue } from "@/lib/follow-ups";
import { postingFlag } from "@/lib/job-flags";
import { notifyDevices, type PushMessage } from "@/lib/push";
import { applyOps, readCollection, readHash, readSomeItems, readValue, type DataBackend } from "@/lib/server-data";
import type { DismissedJob, SavedJob, Settings, StoredCv, StoredMatch, StoredProfile, TailoredDocs } from "@/lib/store";
import type { Job } from "@/lib/types";

/*
 * One step of the morning run's preparation (see lib/morning-prep.ts), asked for again and again by
 * scripts/jobspy/scheduled.py until it says it's done. Each step does a little, so no request runs
 * for long: while the run is still searching it matches the jobs uploaded so far (sent to Claude as
 * a batch at half price and read back on a later step, or one at a time if batches are off or one
 * took too long); once the run has finished it gets the best matches ready to apply, one job a
 * step, then sends the summary. What it
 * writes goes into the same server storage the app syncs from, so it appears on every device.
 */

/** Analyses in one step, and how many at a time: two rounds stay well inside a function's 300 seconds. */
const MATCHES_PER_STEP = 6;
const PARALLEL = 3;
const DAY_MS = 86_400_000;
/** How long a batch may take before it's cancelled and the rest are matched one at a time. */
const BATCH_PATIENCE_MS = 60 * 60 * 1000;
/** With a batch out and the searches done: how long the run waits before asking again. */
const BATCH_WAIT_SECONDS = 60;
/** Errors that every other job would hit too: the key, the model, the API being down. */
const FATAL = new Set([401, 403, 404, 503]);

type Env = Record<string, string | undefined>;

export interface StepResult {
  /**
   * working: ask again straight away. idle: nothing to do until more jobs arrive. waiting: a batch is
   * with Claude, ask again in `wait` seconds. done/off: stop asking.
   */
  state: "working" | "idle" | "waiting" | "done" | "off";
  message: string;
  wait?: number;
  prep?: PrepState;
}

/** The Claude calls and the notification, replaceable in tests. */
export interface PrepDeps {
  analyze: typeof analyzeMatch;
  submitBatch: typeof submitMatchBatch;
  readBatch: typeof readMatchBatch;
  cancelBatch: typeof cancelMatchBatch;
  write: (kind: DocumentKind, materials: TailorMaterials, options: TailorOptions, env: Env) => Promise<string>;
  answers: typeof draftAnswers;
  notify: (backend: DataBackend, env: Env, message: PushMessage, origin: string) => Promise<unknown>;
}

/** A CV or cover letter in one piece: the streamed text, put together. */
async function writeDocument(kind: DocumentKind, materials: TailorMaterials, options: TailorOptions, env: Env): Promise<string> {
  let text = "";
  for await (const event of streamDocument(kind, materials, options, env)) {
    if (event.type === "text") text += event.text;
    // A CV that ran long, being shortened: the shorter one replaces it.
    if (event.type === "restart") text = "";
    if (event.type === "error") throw new AiError(event.message, event.status);
  }
  if (!text.trim()) throw new AiError("Claude didn't write anything. Try again.", 502);
  return text.trim();
}

const DEPS: PrepDeps = {
  analyze: analyzeMatch,
  submitBatch: submitMatchBatch,
  readBatch: readMatchBatch,
  cancelBatch: cancelMatchBatch,
  write: writeDocument,
  answers: draftAnswers,
  notify: notifyDevices,
};

export async function readPrep(backend: DataBackend): Promise<PrepState | null> {
  const [raw] = await backend.run([["GET", RUN_PREP_KEY]]);
  return typeof raw === "string" ? (JSON.parse(raw) as PrepState) : null;
}

async function savePrep(backend: DataBackend, prep: PrepState, now: string) {
  prep.updatedAt = now;
  await backend.run([["SET", RUN_PREP_KEY, JSON.stringify(prep)]]);
}

function materialsFor(job: Job, candidate: Candidate, description: string, notes: string | undefined): TailorMaterials {
  return {
    cv: candidate.cv,
    cvs: candidate.cvs,
    profile: candidate.profile,
    skills: candidate.skills,
    notes,
    job: {
      title: job.title.slice(0, 300),
      company: job.company.slice(0, 200),
      location: job.location.slice(0, 200),
      url: job.url.slice(0, 2000),
      description: description.slice(0, 40_000),
    },
  };
}

export async function prepareStep(
  backend: DataBackend,
  env: Env,
  runId: string,
  origin: string,
  deps: PrepDeps = DEPS,
  now = new Date().toISOString(),
): Promise<StepResult> {
  const stored = (await readValue(backend, "settings")) as Partial<Settings> | null;
  const settings: MorningPrepSettings = { ...DEFAULT_MORNING_PREP, ...stored?.morningPrep };
  const run = (await readRun(backend)) as JobspyRun | null;
  // Before the run's first jobs have arrived, or after a newer run has replaced it.
  if (!run || run.id !== runId) return { state: "idle", message: "Waiting for the run's jobs." };
  const previous = await readPrep(backend);
  const prep = previous?.runId === runId ? previous : emptyPrepState(runId, now);
  if (prep.finished) return { state: "done", message: "Already done.", prep };
  if (!settings.match && !settings.ready && !settings.notify) {
    return { state: "off", message: "Matching, getting jobs ready and the summary are all off (Add a job → From JobSpy)." };
  }
  const searching = !run.finishedAt;
  const matchesLeft = settings.matchLimit - prep.matched - prep.failed.length;
  // Nothing to do until the searches are done: not worth reading everything again to find that out.
  if (searching && !prep.batch && (!settings.match || prep.stopped || matchesLeft <= 0 || prep.checkedCount === run.count)) {
    return { state: "idle", message: "Waiting for more jobs.", prep };
  }

  const [cv, profile] = (await Promise.all([readValue(backend, "cv"), readValue(backend, "profile")])) as [
    StoredCv | null,
    StoredProfile | null,
  ];
  const fullProfile: StoredProfile = { website: "", github: "", evidence: "", enabled: true, ...profile };
  // Every CV, the website and GitHub, for every job, as in the app (lib/cvs.ts).
  const candidate = candidateFor(cv, fullProfile);
  const canWork = hasCvText(cv) && !prep.stopped;
  const tailor = stored?.tailor ?? { style: "uk-cv", tone: "professional", length: "two-pages", extraInstructions: "", projects: true };
  const useNotes = stored?.useJobNotes ?? true;

  const [runJobs, matches, saved, dismissed] = await Promise.all([
    readHash<RunJob>(backend, RUN_JOBS_KEY).then((all) => Object.values(all).map((found) => ("job" in found ? found.job : (found as unknown as Job)))),
    readCollection<StoredMatch>(backend, "matches"),
    readCollection<SavedJob>(backend, "saved"),
    readCollection<DismissedJob>(backend, "dismissed"),
  ]);
  const hidden = new Set(Object.values(dismissed).flatMap((entry) => entry.keys ?? []));
  const isDismissed = (job: Job) => dismissKeys(job).some((key) => hidden.has(key));
  const current = (job: Job) => {
    const match = matches[job.id];
    return match?.analysis && match.key === matchKey(job, candidate) ? match : undefined;
  };

  // Saved jobs you haven't applied to whose score is from an earlier version of the CVs: matched again
  // after the run's own jobs, so a CV change doesn't leave My jobs with outdated scores.
  const inRun = new Set(runJobs.map((job) => job.id));
  const outdatedSaved = Object.values(saved)
    .filter((entry) => entry.status === "saved" && !inRun.has(entry.job.id) && matches[entry.job.id] && !current(entry.job))
    .map((entry) => entry.job);
  const toMatch = [...runJobs, ...outdatedSaved];

  // Saved with the job's match, and with its tailored documents if it's saved, as the app does.
  // `from`: the candidate it was matched with (a batch's can be older than the CVs are now).
  const saveMatches = async (found: Array<{ job: Job; analysis: MatchAnalysis; key: string; from?: string }>) => {
    if (!found.length) return;
    const at = new Date().toISOString();
    const savedIds = found.filter(({ job }) => saved[job.id]).map(({ job }) => job.id);
    const docs = savedIds.length ? await readSomeItems<TailoredDocs>(backend, "tailored", savedIds) : {};
    const items: Record<string, StoredMatch> = {};
    const tailored: Record<string, TailoredDocs> = {};
    for (const { job, analysis, key, from } of found) {
      items[job.id] = matches[job.id] = matchFromAnalysis(analysis, key, at);
      if (saved[job.id]) tailored[job.id] = { ...docs[job.id], analysis, analysisFrom: from ?? candidate.key, updatedAt: at };
    }
    const ops: Parameters<typeof applyOps>[1] = [{ key: "matches", items }];
    if (savedIds.length) ops.push({ key: "tailored", items: tailored });
    await applyOps(backend, ops);
    prep.matched += found.length;
  };
  // A batch is out: while the run's still searching, it waits as it does for more jobs.
  const waitForBatch = (message: string): StepResult =>
    searching ? { state: "idle", message, prep } : { state: "waiting", wait: BATCH_WAIT_SECONDS, message, prep };

  // 1a. Match: a batch sent on an earlier step, once it's back.
  if (settings.match && canWork && prep.batch) {
    const batch = prep.batch;
    let outcomes: Record<string, BatchOutcome> | null;
    try {
      outcomes = await deps.readBatch(batch.id, env);
    } catch (error) {
      const aiError = toAiError(error);
      if (aiError.status === 401 || aiError.status === 403) prep.stopped = aiError.message;
      // Gone (sent with a different API key, say): the rest are matched one at a time.
      else if (aiError.status === 404) [prep.batch, prep.live] = [undefined, true];
      else return waitForBatch("Couldn't ask after the batch of matches; trying again shortly.");
      await savePrep(backend, prep, now);
      return { state: "working", message: prep.stopped ? `Stopped matching: ${prep.stopped}` : "Matching one at a time.", prep };
    }
    if (!outcomes) {
      if (!batch.canceled && Date.parse(now) - Date.parse(batch.sentAt) > BATCH_PATIENCE_MS) {
        try {
          await deps.cancelBatch(batch.id, env);
          batch.canceled = true;
          prep.live = true;
          await savePrep(backend, prep, now);
        } catch (error) {
          console.error("Couldn't cancel the batch of matches", error);
        }
      }
      return waitForBatch(`${batch.jobs.length} ${batch.jobs.length === 1 ? "job is" : "jobs are"} with Claude to match.`);
    }
    const byId = new Map(toMatch.map((job) => [job.id, job]));
    const found: Array<{ job: Job; analysis: MatchAnalysis; key: string; from?: string }> = [];
    batch.jobs.forEach((entry, i) => {
      const outcome = outcomes[`job-${i}`];
      const job = byId.get(entry.id);
      if (!job) return;
      // Cancelled before Claude got to it: matched one at a time instead.
      if (outcome && "canceled" in outcome) prep.live = true;
      else if (outcome && "analysis" in outcome) found.push({ job, analysis: outcome.analysis, key: entry.key, from: batch.from });
      else prep.failed.push(entry.id);
    });
    await saveMatches(found);
    prep.batch = undefined;
    await savePrep(backend, prep, now);
    return { state: "working", message: `Matched ${prep.matched} so far.`, prep };
  }

  // 1b. Match: the jobs uploaded so far, up to the morning's limit.
  if (settings.match && canWork && matchesLeft > 0) {
    const todo = toMatch.filter((job) => canMatch(job) && !isDismissed(job) && !current(job) && !prep.failed.includes(job.id));
    const notesOf = (job: Job) => (useNotes ? saved[job.id]?.notes.trim().slice(0, 4000) || undefined : undefined);

    // All of them in one batch, read back on a later step.
    if (todo.length && settings.batch && !prep.live) {
      const sending = todo.slice(0, matchesLeft).map((job, i) => ({
        job,
        customId: `job-${i}`,
        materials: materialsFor(job, candidate, job.description, notesOf(job)),
      }));
      try {
        const id = await deps.submitBatch(sending.map(({ customId, materials }) => ({ customId, materials })), env);
        prep.batch = {
          id,
          sentAt: now,
          from: candidate.key,
          jobs: sending.map(({ job }) => ({ id: job.id, key: matchKey(job, candidate) })),
        };
      } catch (error) {
        const aiError = toAiError(error);
        if (aiError.status === 429) return { state: "idle", message: "Claude's rate limit was reached; trying again shortly.", prep };
        if (aiError.status === 401 || aiError.status === 403) prep.stopped = aiError.message;
        // Batches can't be had: one at a time instead.
        else prep.live = true;
        await savePrep(backend, prep, now);
        return { state: "working", message: prep.stopped ? `Stopped matching: ${prep.stopped}` : "Matching one at a time.", prep };
      }
      await savePrep(backend, prep, now);
      return waitForBatch(`Sent ${sending.length} ${sending.length === 1 ? "job" : "jobs"} to Claude to match.`);
    }

    // One at a time, a few at once.
    const next = todo.slice(0, Math.min(MATCHES_PER_STEP, matchesLeft));
    if (next.length) {
      let rateLimited = false;
      const queue = [...next];
      const worker = async () => {
        for (let job = queue.shift(); job && !prep.stopped && !rateLimited; job = queue.shift()) {
          try {
            const analysis = await deps.analyze(materialsFor(job, candidate, job.description, notesOf(job)), env);
            // Saved as each one finishes, so a step cut short keeps what it did.
            await saveMatches([{ job, analysis, key: matchKey(job, candidate) }]);
          } catch (error) {
            const aiError = toAiError(error);
            if (aiError.status === 429) rateLimited = true;
            else if (FATAL.has(aiError.status)) prep.stopped = aiError.message;
            else prep.failed.push(job.id);
          }
        }
      };
      await Promise.all(Array.from({ length: PARALLEL }, worker));
      await savePrep(backend, prep, now);
      if (rateLimited) return { state: "idle", message: "Claude's rate limit was reached; trying again shortly.", prep };
      return { state: "working", message: prep.stopped ? `Stopped matching: ${prep.stopped}` : `Matched ${prep.matched} so far.`, prep };
    }
  }
  if (searching) {
    // Everything uploaded so far is matched: the next step needn't look again until more arrive.
    prep.checkedCount = run.count;
    await savePrep(backend, prep, now);
    return { state: "idle", message: "Waiting for more jobs.", prep };
  }

  // 2. Ready to apply: the best matches, once the run has finished, one job a step.
  if (settings.ready && canWork && prep.ready.length < settings.readyLimit) {
    const best = runJobs
      .map((job) => ({ job, match: current(job) }))
      .filter((entry): entry is { job: Job; match: StoredMatch } => Boolean(entry.match && entry.match.score >= settings.readyFrom))
      .filter((entry) => !isDismissed(entry.job))
      .sort((a, b) => b.match.score - a.match.score);
    for (const { job, match } of best) {
      if (prep.ready.length >= settings.readyLimit) break;
      const copy = saved[job.id] ?? findSavedCopy(saved, job);
      const id = copy?.job.id ?? job.id;
      if (prep.ready.includes(id) || prep.readyFailed.includes(id)) continue;
      // Applied to, interviewing and the like: not one to get ready.
      if (copy && copy.status !== "saved") continue;
      const docs = (await readSomeItems<TailoredDocs>(backend, "tailored", [id]))[id];
      // A CV or cover letter written from an earlier CV is written again.
      const needs = {
        cv: !madeFromCurrent(docs, "cv", candidate),
        coverLetter: settings.coverLetters && !madeFromCurrent(docs, "coverLetter", candidate),
        answers: settings.answers && !docs?.answers?.length,
      };
      if (!needs.cv && !needs.coverLetter && !needs.answers) {
        prep.ready.push(id);
        continue;
      }
      const description =
        docs?.jobDescription ?? (copy && copy.job.description.length > job.description.length ? copy.job.description : job.description);
      const notes = useNotes ? copy?.notes.trim().slice(0, 4000) || undefined : undefined;
      const materials = materialsFor(copy?.job ?? job, candidate, description, notes);
      try {
        const [cvText, letter, answers] = await Promise.all([
          needs.cv ? deps.write("cv", materials, tailor, env) : undefined,
          needs.coverLetter ? deps.write("cover-letter", materials, tailor, env) : undefined,
          needs.answers ? deps.answers(materials, DEFAULT_QUESTIONS, profile?.application, env) : undefined,
        ]);
        const at = new Date().toISOString();
        const savedJob: SavedJob = copy ?? { job, status: "saved", notes: "", savedAt: at, updatedAt: at, history: [{ status: "saved", at }] };
        await applyOps(backend, [
          { key: "saved", items: { [id]: { ...savedJob, updatedAt: at } } },
          // The score under the saved copy's id too, for My jobs and Apply.
          { key: "matches", items: { [id]: { ...match, at } } },
          {
            key: "tailored",
            items: {
              [id]: {
                ...docs,
                ...(!madeFromCurrent(docs, "analysis", candidate) && { analysis: match.analysis, analysisFrom: candidate.key }),
                ...(cvText && { cv: cvText, cvFrom: candidate.key }),
                ...(letter && { coverLetter: letter, coverLetterFrom: candidate.key }),
                ...(answers?.length && { answers }),
                updatedAt: at,
              },
            },
          },
        ]);
        prep.ready.push(id);
      } catch (error) {
        const aiError = toAiError(error);
        if (aiError.status === 429) {
          await savePrep(backend, prep, now);
          return { state: "idle", message: "Claude's rate limit was reached; trying again shortly.", prep };
        }
        if (FATAL.has(aiError.status)) prep.stopped = aiError.message;
        else prep.readyFailed.push(id);
      }
      await savePrep(backend, prep, now);
      return { state: "working", message: `${prep.ready.length} ready to apply so far.`, prep };
    }
  }

  // 3. Today's shortlist: the best few fresh jobs from employers that name themselves, saved to My jobs.
  if (settings.shortlist !== false && !prep.today) {
    const at = new Date().toISOString();
    const fresh = (job: Job) => !job.postedAt || Date.parse(now) - Date.parse(job.postedAt) <= TODAY_MAX_DAYS * DAY_MS;
    const picks = runJobs
      .map((job) => ({ job, match: current(job) }))
      .filter((entry): entry is { job: Job; match: StoredMatch } => Boolean(entry.match && entry.match.score >= TODAY_FROM))
      .filter(({ job }) => fresh(job) && !postingFlag(job) && !isDismissed(job))
      .sort((a, b) => b.match.score - a.match.score || (b.job.postedAt ?? "").localeCompare(a.job.postedAt ?? ""));
    const today: string[] = [];
    const newlySaved: Record<string, SavedJob> = {};
    const scores: Record<string, StoredMatch> = {};
    for (const { job, match } of picks) {
      if (today.length >= TODAY_LIMIT) break;
      const copy = saved[job.id] ?? findSavedCopy(saved, job);
      // Applied to, interviewing and the like: not one for today.
      if (copy && copy.status !== "saved") continue;
      const id = copy?.job.id ?? job.id;
      if (today.includes(id)) continue;
      today.push(id);
      if (!copy) {
        newlySaved[id] = saved[id] = { job, status: "saved", notes: "", savedAt: at, updatedAt: at, history: [{ status: "saved", at }] };
        scores[id] = matches[id] = { ...match, at };
      }
    }
    if (Object.keys(newlySaved).length) {
      await applyOps(backend, [
        { key: "saved", items: newlySaved },
        { key: "matches", items: scores },
      ]);
    }
    prep.today = today;
    await savePrep(backend, prep, now);
  }

  // 4. Done: the summary, once.
  prep.strong = runJobs.filter((job) => (current(job)?.score ?? -1) >= settings.readyFrom).length;
  prep.finished = true;
  if (settings.notify && !prep.notified) {
    const named = (ids: string[]) =>
      ids
        .map((id) => ({ entry: saved[id], score: matches[id]?.score }))
        .filter((found) => found.entry)
        .slice(0, 3)
        .map(({ entry, score }) => `${entry.job.title} at ${entry.job.company}${score === undefined ? "" : ` (${score}%)`}`);
    const today = prep.today ?? [];
    const followUps = followUpsDue(saved, Date.parse(now)).length;
    const message: PushMessage = {
      title: today.length
        ? `Today's top ${today.length}: apply while they're fresh`
        : prep.ready.length
          ? `${prep.ready.length} ${prep.ready.length === 1 ? "job" : "jobs"} ready to apply`
          : `Morning run: ${run.count} ${run.count === 1 ? "job" : "jobs"}`,
      body: [
        `${prepSummary(run.count, prep, settings)}.`,
        (today.length ? named(today) : named(prep.ready)).join("; "),
        followUps > 0 && `${followUps} ${followUps === 1 ? "application is" : "applications are"} due a follow-up.`,
        prep.stopped && `Stopped early: ${prep.stopped}`,
      ]
        .filter(Boolean)
        .join(" "),
      url: today.length || prep.ready.length || followUps ? "/apply" : "/import#morning-run",
      tag: "morning-run",
    };
    try {
      await deps.notify(backend, env, message, origin);
      prep.notified = true;
    } catch (error) {
      console.error("Couldn't send the morning summary", error);
    }
  }
  await savePrep(backend, prep, now);
  const summary = prepSummary(run.count, prep, settings);
  return { state: "done", message: prep.stopped ? `${summary}. Stopped early: ${prep.stopped}` : summary, prep };
}
