import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/claude";
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

/** Claude stand-ins: each job's score is set in `scores`, and what was asked for is recorded. */
function fakes(scores: Record<string, number>) {
  const calls = { analyze: [] as string[], write: [] as string[], answers: [] as string[], notify: [] as Array<{ title: string; body: string; url: string }> };
  const deps: PrepDeps = {
    analyze: async (materials) => {
      calls.analyze.push(materials.job.title);
      const score = scores[materials.job.title];
      if (score === undefined) throw new AiError("The analysis was cut off. Try again.", 502);
      return analysis(score);
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

async function seed(prep: Partial<MorningPrepSettings>, jobs: Job[], done = false) {
  await applyOps(backend, [
    { key: "settings", value: { morningPrep: { ...DEFAULT_MORNING_PREP, ...prep } } },
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
  it("matches and tailors each job with its own CV", async () => {
    const jobs = [job(1), job(2, { title: "Operations Manager" }), job(3, { title: "Office Manager" })];
    const used: string[] = [];
    const { deps } = fakes({ "Data Analyst 1": 95, "Operations Manager": 92, "Office Manager": 90 });
    const analyze = deps.analyze;
    deps.analyze = async (materials, env) => {
      used.push(`${materials.job.title}: ${materials.cv.slice(0, 4)}`);
      return analyze(materials, env);
    };
    const write = deps.write;
    deps.write = async (kind, materials, options, env) => {
      if (kind === "cv") used.push(`write ${materials.job.title}: ${materials.cv.slice(0, 4)}`);
      return write(kind, materials, options, env);
    };
    await seed({ match: true, ready: true, readyFrom: 85, readyLimit: 3, coverLetters: false, answers: false, notify: false }, jobs, true);
    const ops = `Ops. ${"Ran warehouse and operations teams, rotas, budgets and suppliers. ".repeat(2)}`;
    await applyOps(backend, [
      {
        key: "cv",
        value: { text: CV, updatedAt: "2026-10-27T06:00:00.000Z", others: [{ id: "ops", name: "Ops CV", text: ops, titles: ["operations"], updatedAt: "2026-10-27T06:00:00.000Z" }] },
      },
      // Picked on its page before the run: the Office Manager job uses the Ops CV too.
      { key: "saved", items: { "linkedin:3": { job: jobs[2], status: "saved", notes: "", savedAt: "2026-10-26T06:00:00.000Z", updatedAt: "2026-10-26T06:00:00.000Z" } } },
      { key: "tailored", items: { "linkedin:3": { cvId: "ops", updatedAt: "2026-10-26T06:00:00.000Z" } } },
    ]);

    for (let i = 0; i < 6 && (await step(deps)).state === "working"; i++);
    expect(used.sort()).toEqual([
      "Data Analyst 1: Test",
      "Office Manager: Ops.",
      "Operations Manager: Ops.",
      "write Data Analyst 1: Test",
      "write Office Manager: Ops.",
      "write Operations Manager: Ops.",
    ]);
    // Scored against the CV each job uses, so the scores count as current in the app.
    const tailored = await readCollection<TailoredDocs>(backend, "tailored");
    expect(tailored["linkedin:3"].cvId).toBe("ops");
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
