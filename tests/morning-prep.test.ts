import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiError, type BatchedMatch, type BatchOutcome } from "@/lib/ai/claude";
import type { MatchAnalysis } from "@/lib/ai/prompts";
import { dismissKeys } from "@/lib/import";
import { saveRunPart } from "@/lib/jobspy-runs";
import { DEFAULT_MORNING_PREP, type MorningPrepSettings } from "@/lib/morning-prep";
import { prepareStep, readPrep, type PrepDeps } from "@/lib/morning-prep-server";
import { notifyDevices, saveDevice } from "@/lib/push";
import { applyOps, fileBackend, readCollection, type DataBackend } from "@/lib/server-data";
import type { SavedJob, StoredMatch, TailoredDocs } from "@/lib/store";
import type { Job } from "@/lib/types";

const RUN = "run-1234567890";
const CV = "Test Person. Data analyst with SQL, Power BI and Python, five years in retail and finance reporting.";

function job(n: number, extra: Partial<Job> = {}): Job {
  return {
    id: `linkedin:${n}`,
    source: "jobspy",
    sourceName: "LinkedIn",
    title: `Data Analyst ${n}`,
    company: `Company ${n}`,
    location: "Manchester",
    remote: false,
    url: `https://www.linkedin.com/jobs/view/${n}`,
    applyOptions: [{ label: "LinkedIn", url: `https://www.linkedin.com/jobs/view/${n}` }],
    description: `Job ${n}. ${"We need SQL, Power BI and stakeholder reporting. ".repeat(20)}`,
    tags: [],
    ...extra,
  } as Job;
}

function analysis(score: number): MatchAnalysis {
  return { matchScore: score, verdict: "Fit", strengths: [], gaps: [], keywordsPresent: [], keywordsMissing: ["dbt"], suggestions: [] };
}

/**
 * Claude stand-ins: each job's score is set in `scores`, and what was asked for is recorded. A batch
 * is back once it's been asked after `batchReads` times; cancelled, what's left comes back cancelled.
 */
function fakes(scores: Record<string, number>, batchReads = 1) {
  const calls = {
    analyze: [] as string[],
    batches: [] as string[][],
    canceled: [] as string[],
    write: [] as string[],
    answers: [] as string[],
    notify: [] as Array<{ title: string; body: string; url: string }>,
  };
  const batches = new Map<string, { requests: BatchedMatch[]; reads: number; canceled: boolean }>();
  const score = (title: string) => {
    const found = scores[title];
    if (found === undefined) throw new AiError("The analysis was cut off. Try again.", 502);
    return analysis(found);
  };
  const deps: PrepDeps = {
    analyze: async (materials) => {
      calls.analyze.push(materials.job.title);
      return score(materials.job.title);
    },
    submitBatch: async (requests) => {
      calls.batches.push(requests.map((request) => request.materials.job.title));
      const id = `batch-${batches.size + 1}`;
      batches.set(id, { requests, reads: 0, canceled: false });
      return id;
    },
    readBatch: async (id) => {
      const batch = batches.get(id)!;
      if (!batch.canceled && ++batch.reads < batchReads) return null;
      const outcomes: Record<string, BatchOutcome> = {};
      for (const { customId, materials } of batch.requests) {
        try {
          outcomes[customId] = batch.canceled ? { canceled: true } : { analysis: score(materials.job.title) };
        } catch (error) {
          outcomes[customId] = { error: error as AiError };
        }
      }
      return outcomes;
    },
    cancelBatch: async (id) => {
      calls.canceled.push(id);
      batches.get(id)!.canceled = true;
    },
    write: async (kind, materials) => {
      calls.write.push(`${kind}:${materials.job.title}`);
      return `${kind} for ${materials.job.title}`;
    },
    answers: async (materials, questions) => {
      calls.answers.push(materials.job.title);
      return questions.map((question) => ({ question, answer: `Answer for ${materials.job.title}` }));
    },
    notify: async (_backend, _env, message) => {
      calls.notify.push(message);
    },
  };
  return { deps, calls };
}

let folder: string;
let backend: DataBackend;

/** One at a time unless a test says otherwise; batches have tests of their own. */
async function seed(prep: Partial<MorningPrepSettings>, jobs: Job[], done = false) {
  await applyOps(backend, [
    { key: "settings", value: { morningPrep: { ...DEFAULT_MORNING_PREP, batch: false, ...prep } } },
    { key: "cv", value: { text: CV, updatedAt: "2026-10-27T06:00:00.000Z" } },
  ]);
  await saveRunPart(backend, { id: RUN, startedAt: "2026-10-27T06:00:00.000Z", failed: [], done, jobs: jobs.map((j) => ({ job: j, lists: [] })) });
}

const step = (deps: PrepDeps) => prepareStep(backend, {}, RUN, "https://jobscratch.example", deps);

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "jobscratch-prep-"));
  backend = fileBackend(join(folder, "data.json"));
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("the morning run's preparation", () => {
  it("matches and tailors every job with all the CVs", async () => {
    const jobs = [job(1), job(2, { title: "Operations Manager" })];
    const used: string[] = [];
    const { deps } = fakes({ "Data Analyst 1": 95, "Operations Manager": 92 });
    const analyze = deps.analyze;
    deps.analyze = async (materials, env) => {
      used.push(`match ${materials.job.title}: ${materials.cvs?.map((v) => v.name).join(" + ")}`);
      return analyze(materials, env);
    };
    const write = deps.write;
    deps.write = async (kind, materials, options, env) => {
      if (kind === "cv") used.push(`write ${materials.job.title}: ${materials.cvs?.map((v) => v.name).join(" + ")}`);
      return write(kind, materials, options, env);
    };
    await seed({ match: true, ready: true, readyFrom: 85, readyLimit: 4, coverLetters: false, answers: false, notify: false }, jobs, true);
    const ops = `Ops. ${"Ran warehouse and operations teams, rotas, budgets and suppliers. ".repeat(2)}`;
    await applyOps(backend, [
      { key: "cv", value: { text: CV, updatedAt: "2026-10-27T06:00:00.000Z", others: [{ id: "ops", name: "Ops CV", text: ops, updatedAt: "2026-10-27T06:00:00.000Z" }] } },
    ]);

    for (let i = 0; i < 8 && (await step(deps)).state === "working"; i++);
    expect(used.sort()).toEqual([
      "match Data Analyst 1: Main CV + Ops CV",
      "match Operations Manager: Main CV + Ops CV",
      "write Data Analyst 1: Main CV + Ops CV",
      "write Operations Manager: Main CV + Ops CV",
    ]);
    // Scores made with them all count as current, so nothing is matched twice.
    expect((await step(deps)).state).toBe("done");
    expect(used.filter((line) => line.startsWith("match"))).toHaveLength(2);
  });

  it("matches jobs as they arrive, then gets the best ready to apply and sends the summary", async () => {
    const jobs = Array.from({ length: 8 }, (_, i) => job(i + 1));
    const scores = Object.fromEntries(jobs.map((j, i) => [j.title, [95, 60, 88, 70, 91, 40, 82, 65][i]]));
    const { deps, calls } = fakes(scores);
    await seed({ match: true, ready: true, readyFrom: 85, readyLimit: 2 }, jobs.slice(0, 7));

    // Still searching: six a step, then it waits for more jobs rather than reading everything again.
    expect((await step(deps)).state).toBe("working");
    expect(calls.analyze).toHaveLength(6);
    expect((await step(deps)).state).toBe("working");
    expect(calls.analyze).toHaveLength(7);
    expect((await step(deps)).state).toBe("idle");
    expect((await step(deps)).state).toBe("idle");
    expect(calls.analyze).toHaveLength(7);

    // The last job arrives with the run's end: it's matched, then the best two are got ready.
    await saveRunPart(backend, { id: RUN, startedAt: "2026-10-27T06:00:00.000Z", failed: [], done: true, jobs: [{ job: jobs[7], lists: [] }] });
    expect((await step(deps)).state).toBe("working");
    expect(calls.analyze).toHaveLength(8);
    expect(calls.write).toHaveLength(0);
    expect((await step(deps)).state).toBe("working");
    expect((await step(deps)).state).toBe("working");
    const done = await step(deps);
    expect(done.state).toBe("done");

    // The 95% and the 91% one, not the 88% one (the limit is two).
    expect(calls.write.sort()).toEqual(["cover-letter:Data Analyst 1", "cover-letter:Data Analyst 5", "cv:Data Analyst 1", "cv:Data Analyst 5"]);
    const saved = await readCollection<SavedJob>(backend, "saved");
    expect(Object.keys(saved).sort()).toEqual(["linkedin:1", "linkedin:5"]);
    expect(saved["linkedin:1"].status).toBe("saved");
    const tailored = await readCollection<TailoredDocs>(backend, "tailored");
    expect(tailored["linkedin:1"]).toMatchObject({ cv: "cv for Data Analyst 1", coverLetter: "cover-letter for Data Analyst 1" });
    expect(tailored["linkedin:1"].answers?.[0].answer).toBe("Answer for Data Analyst 1");
    expect(tailored["linkedin:1"].analysis?.matchScore).toBe(95);
    const matches = await readCollection<StoredMatch>(backend, "matches");
    expect(Object.keys(matches)).toHaveLength(8);

    expect(calls.notify).toHaveLength(1);
    expect(calls.notify[0]).toMatchObject({ title: "2 jobs ready to apply", url: "/apply" });
    expect(calls.notify[0].body).toContain("8 jobs found, 8 matched, 3 at 85%+, 2 ready to apply.");
    expect(calls.notify[0].body).toContain("Data Analyst 1 at Company 1 (95%)");

    // Asked again: nothing more is done or sent.
    expect((await step(deps)).state).toBe("done");
    expect(calls.notify).toHaveLength(1);
    expect(calls.analyze).toHaveLength(8);
  });

  it("sends the jobs to Claude as a batch and reads the answers back on a later step", async () => {
    const jobs = [job(1), job(2), job(3, { description: "Short." }), job(4)];
    const { deps, calls } = fakes({ "Data Analyst 1": 95, "Data Analyst 2": 70 }, 2);
    await seed({ match: true, batch: true, ready: true, readyFrom: 85, readyLimit: 2, coverLetters: false, answers: false }, jobs.slice(0, 3));
    const ops = `Ops. ${"Ran warehouse and operations teams, rotas, budgets and suppliers. ".repeat(2)}`;
    await applyOps(backend, [
      { key: "cv", value: { text: CV, updatedAt: "2026-10-27T06:00:00.000Z", others: [{ id: "ops", name: "Ops CV", text: ops, updatedAt: "2026-10-27T06:00:00.000Z" }] } },
      { key: "saved", items: { "linkedin:2": { job: jobs[1], status: "saved", notes: "", savedAt: "2026-10-26T06:00:00.000Z", updatedAt: "2026-10-26T06:00:00.000Z" } } },
    ]);

    // Still searching: the two full descriptions go in one batch, and it waits as it does for more jobs.
    expect((await step(deps)).state).toBe("idle");
    expect(calls.batches).toEqual([["Data Analyst 1", "Data Analyst 2"]]);
    expect((await step(deps)).state).toBe("idle");
    // Back: saved, with the saved job's analysis too.
    expect((await step(deps)).state).toBe("working");
    const matches = await readCollection<StoredMatch>(backend, "matches");
    expect(matches["linkedin:1"]).toMatchObject({ score: 95 });
    expect((await readCollection<TailoredDocs>(backend, "tailored"))["linkedin:2"].analysis?.matchScore).toBe(70);

    // The last job arrives with the run's end: a batch of its own, and the run is told when to ask again.
    await saveRunPart(backend, { id: RUN, startedAt: "2026-10-27T06:00:00.000Z", failed: [], done: true, jobs: [{ job: jobs[3], lists: [] }] });
    expect((await step(deps)).state).toBe("waiting");
    expect(calls.batches[1]).toEqual(["Data Analyst 4"]);
    const waiting = await step(deps);
    expect(waiting).toMatchObject({ state: "waiting", wait: 60 });
    // Data Analyst 4 has no score in the stand-ins: it failed, and isn't sent again.
    for (let i = 0; i < 6 && (await step(deps)).state !== "done"; i++);
    const prep = await readPrep(backend);
    expect(prep).toMatchObject({ matched: 2, failed: ["linkedin:4"], finished: true });
    expect(prep?.ready).toEqual(["linkedin:1"]);
    expect(calls.batches).toHaveLength(2);
    expect(calls.analyze).toEqual([]);
    expect(calls.write).toEqual(["cv:Data Analyst 1"]);
  });

  it("cancels a batch that takes over an hour and matches the rest one at a time", async () => {
    const jobs = [job(1), job(2)];
    const { deps, calls } = fakes({ "Data Analyst 1": 80, "Data Analyst 2": 60 }, 99);
    await seed({ match: true, batch: true, ready: false, notify: false }, jobs, true);
    const at = (minutes: number) => prepareStep(backend, {}, RUN, "https://jobscratch.example", deps, `2026-10-27T07:${String(minutes).padStart(2, "0")}:00.000Z`);
    expect((await at(0)).state).toBe("waiting");
    expect((await at(30)).state).toBe("waiting");
    expect(calls.canceled).toEqual([]);
    expect((await at(59)).state).toBe("waiting");
    // Over the hour (07:00 to 08:01 is past it): cancelled, and the cancelled ones are matched one at a time.
    expect((await prepareStep(backend, {}, RUN, "https://jobscratch.example", deps, "2026-10-27T08:01:00.000Z")).state).toBe("waiting");
    expect(calls.canceled).toEqual(["batch-1"]);
    for (let i = 0; i < 5 && (await step(deps)).state !== "done"; i++);
    expect(calls.analyze.sort()).toEqual(["Data Analyst 1", "Data Analyst 2"]);
    expect(await readPrep(backend)).toMatchObject({ matched: 2, live: true, finished: true });
    expect(calls.batches).toHaveLength(1);
  });

  it("skips jobs you've hidden, applied to or that have only a snippet, and keeps to the limits", async () => {
    const hidden = job(1);
    const applied = job(2);
    const snippet = job(3, { description: "Short." });
    const fine = job(4);
    const { deps, calls } = fakes({ [hidden.title]: 99, [applied.title]: 99, [fine.title]: 90 });
    await seed({ match: true, ready: true, readyFrom: 85, readyLimit: 5, coverLetters: false, answers: false, matchLimit: 2 }, [hidden, applied, snippet, fine], true);
    const now = "2026-10-27T06:30:00.000Z";
    await applyOps(backend, [
      { key: "dismissed", items: { [hidden.id]: { title: hidden.title, company: hidden.company, keys: dismissKeys(hidden), at: now } } },
      { key: "saved", items: { [applied.id]: { job: applied, status: "applied", notes: "", savedAt: now, updatedAt: now } } },
    ]);
    for (let i = 0; i < 10 && (await step(deps)).state !== "done"; i++);
    // Hidden and snippet ones aren't matched; the limit of two covers the applied one and the fine one.
    expect(calls.analyze.sort()).toEqual([applied.title, fine.title]);
    // Applied to already: not got ready again.
    expect(calls.write).toEqual([`cv:${fine.title}`]);
    expect(calls.answers).toEqual([]);
  });

  it("stops matching when the API key is refused, and says so in the summary", async () => {
    const { deps, calls } = fakes({});
    deps.analyze = async () => {
      calls.analyze.push("refused");
      throw new AiError("Anthropic rejected the API key. Check ANTHROPIC_API_KEY.", 401);
    };
    await seed({ match: true, ready: true }, [job(1), job(2), job(3), job(4)], true);
    for (let i = 0; i < 5 && (await step(deps)).state !== "done"; i++);
    // Three at a time: the first round's three, then no more.
    expect(calls.analyze.length).toBeLessThanOrEqual(3);
    expect((await readPrep(backend))?.stopped).toContain("API key");
    expect(calls.notify[0].body).toContain("Stopped early: Anthropic rejected the API key");
  });

  it("does nothing when it's all switched off, and waits for the run's first jobs", async () => {
    const { deps } = fakes({});
    await seed({ match: false, ready: false, notify: false }, [job(1)]);
    expect((await step(deps)).state).toBe("off");
    expect((await prepareStep(backend, {}, "another-run-123", "https://x.example", deps)).state).toBe("idle");
  });

  it("sends the summary alone when only that's on", async () => {
    const { deps, calls } = fakes({});
    await seed({ match: false, ready: false, notify: true }, [job(1), job(2)], true);
    expect((await step(deps)).state).toBe("done");
    expect(calls.analyze).toEqual([]);
    expect(calls.notify[0]).toMatchObject({ title: "Morning run: 2 jobs", url: "/import#morning-run" });
  });
});

describe("notifications", () => {
  const subscription = (n: number) => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "key", auth: "auth" } });
  const env = { JOBSCRATCH_VAPID_PUBLIC_KEY: "public", JOBSCRATCH_VAPID_PRIVATE_KEY: "private" };

  it("go to every device, and forget ones the browser has dropped", async () => {
    await saveDevice(backend, subscription(1), "Android phone");
    await saveDevice(backend, subscription(2), "Windows computer");
    const sentTo: string[] = [];
    const result = await notifyDevices(backend, env, { title: "Hi", body: "Test", url: "/" }, "https://jobscratch.example", async (sub, payload, options) => {
      sentTo.push(sub.endpoint);
      expect(JSON.parse(payload)).toMatchObject({ title: "Hi" });
      expect(options.vapidDetails?.subject).toBe("https://jobscratch.example");
      if (sub.endpoint.endsWith("/2")) throw Object.assign(new Error("Gone"), { statusCode: 410 });
    });
    expect(result).toEqual({ sent: 1, failed: 1 });
    expect(sentTo.sort()).toEqual(["https://push.example/1", "https://push.example/2"]);
    const again: string[] = [];
    await notifyDevices(backend, env, { title: "Hi", body: "Again", url: "/" }, "https://x.example", async (sub) => void again.push(sub.endpoint));
    expect(again).toEqual(["https://push.example/1"]);
  });

  it("aren't sent until the keys are set", async () => {
    await saveDevice(backend, subscription(1), "Android phone");
    let sent = false;
    expect(await notifyDevices(backend, {}, { title: "Hi", body: "", url: "/" }, "https://x.example", async () => void (sent = true))).toEqual({ sent: 0, failed: 0 });
    expect(sent).toBe(false);
  });
});
