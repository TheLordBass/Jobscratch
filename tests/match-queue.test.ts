import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiError } from "@/lib/ai/claude";
import type { MatchAnalysis } from "@/lib/ai/prompts";
import { candidateFor } from "@/lib/candidate";
import {
  STALLED_MS,
  STEP_MS,
  enqueueMatches,
  matchQueueStatus,
  matchStep,
  stalled,
  stopMatches,
  type MatchStepDeps,
  type QueuedMatch,
} from "@/lib/match-queue-server";
import {
  MATCH_LOCK_KEY,
  applyOps,
  fileBackend,
  readCollection,
  type DataBackend,
} from "@/lib/server-data";
import type { StoredMatch, TailoredDocs } from "@/lib/store";

const CV =
  "Test Person. Data analyst with SQL, Power BI and Python, five years in retail and finance reporting.";

const queued = (title: string): QueuedMatch => ({
  job: {
    title,
    company: "Acme",
    location: "Leeds",
    url: "",
    description: `${title}. ${"SQL and reporting. ".repeat(30)}`,
  },
  hash: `h${title.length}`,
});

const analysis = (score: number): MatchAnalysis => ({
  matchScore: score,
  verdict: "Fit",
  strengths: [],
  gaps: [],
  keywordsPresent: [],
  keywordsMissing: [],
  suggestions: [],
});

/** Claude stand-in: each title's score, or the error it fails with; `tick` moves the clock on per analysis. */
function fakes(outcomes: Record<string, number | AiError>, tick = 0) {
  let now = Date.parse("2026-11-18T10:00:00.000Z");
  const asked: string[] = [];
  const deps: MatchStepDeps = {
    clock: () => now,
    analyze: async (materials) => {
      asked.push(materials.job.title);
      now += tick;
      const outcome = outcomes[materials.job.title];
      if (outcome instanceof AiError) throw outcome;
      return analysis(outcome);
    },
  };
  return { deps, asked };
}

let folder: string;
let backend: DataBackend;

beforeEach(async () => {
  folder = mkdtempSync(join(tmpdir(), "jobscratch-match-"));
  backend = fileBackend(join(folder, "data.json"));
  await applyOps(backend, [
    { key: "cv", value: { text: CV, updatedAt: "2026-11-01T09:00:00.000Z" } },
    {
      key: "saved",
      items: {
        saved1: {
          job: { id: "saved1" },
          status: "saved",
          updatedAt: "2026-11-01T09:00:00.000Z",
        },
      },
    },
  ]);
});

afterEach(() => rmSync(folder, { recursive: true, force: true }));

describe("Match all on the server", () => {
  it("matches every job waiting, saving each score and a saved job's analysis", async () => {
    await enqueueMatches(backend, {
      a: queued("Analyst"),
      saved1: queued("BI Developer"),
    });
    const { deps } = fakes({ Analyst: 72, "BI Developer": 64 });
    expect(await matchStep(backend, {}, deps)).toEqual({ more: false });

    const candidate = candidateFor(
      { text: CV, updatedAt: "2026-11-01T09:00:00.000Z" } as never,
      {
        website: "",
        github: "",
        evidence: "",
        enabled: true,
      },
    );
    const matches = await readCollection<StoredMatch>(backend, "matches");
    expect(matches.a).toMatchObject({ score: 72, key: `${candidate.key}:h7` });
    expect(matches.saved1.score).toBe(64);
    const tailored = await readCollection<TailoredDocs>(backend, "tailored");
    expect(Object.keys(tailored)).toEqual(["saved1"]);
    expect(tailored.saved1).toMatchObject({
      analysis: { matchScore: 64 },
      analysisFrom: candidate.key,
    });
    expect(await matchQueueStatus(backend)).toMatchObject({
      total: 2,
      done: 2,
      failed: 0,
      waiting: 0,
    });
  });

  it("stops starting new ones when the step's time is up, leaving the rest for the next step", async () => {
    const titles = ["One", "Two", "Three", "Four", "Five", "Six", "Seven"];
    await enqueueMatches(
      backend,
      Object.fromEntries(titles.map((title) => [title, queued(title)])),
    );
    const { deps, asked } = fakes(
      Object.fromEntries(titles.map((title) => [title, 70])),
      STEP_MS / 2,
    );
    expect(await matchStep(backend, {}, deps)).toEqual({ more: true });
    expect(asked.length).toBeLessThan(titles.length);
    expect(await matchQueueStatus(backend)).toMatchObject({
      done: asked.length,
      waiting: titles.length - asked.length,
    });

    expect(
      await matchStep(
        backend,
        {},
        fakes(Object.fromEntries(titles.map((title) => [title, 70]))).deps,
      ),
    ).toEqual({ more: false });
    expect(await matchQueueStatus(backend)).toMatchObject({
      done: 7,
      waiting: 0,
    });
  });

  it("counts a job that fails, and stops for an error every job would hit", async () => {
    await enqueueMatches(backend, {
      a: queued("Analyst"),
      b: queued("Cut off"),
    });
    await matchStep(
      backend,
      {},
      fakes({
        Analyst: 70,
        "Cut off": new AiError("The analysis was cut off.", 502),
      }).deps,
    );
    expect(await matchQueueStatus(backend)).toMatchObject({
      done: 2,
      failed: 1,
      waiting: 0,
    });

    await enqueueMatches(backend, {
      c: queued("Engineer"),
      d: queued("Manager"),
    });
    const result = await matchStep(
      backend,
      {},
      fakes({
        Engineer: new AiError("Invalid API key.", 401),
        Manager: new AiError("Invalid API key.", 401),
      }).deps,
    );
    expect(result).toEqual({ more: false });
    expect(await matchQueueStatus(backend)).toMatchObject({
      stopped: "Invalid API key.",
      waiting: 0,
    });
  });

  it("runs one step at a time", async () => {
    await enqueueMatches(backend, { a: queued("Analyst") });
    await backend.run([["SET", MATCH_LOCK_KEY, String(Date.now() + 60_000)]]);
    const { deps, asked } = fakes({ Analyst: 70 });
    expect(await matchStep(backend, {}, { ...deps, clock: Date.now })).toEqual({
      more: false,
      busy: true,
    });
    expect(asked).toEqual([]);
    // A lock left by a step that died runs out.
    await backend.run([["SET", MATCH_LOCK_KEY, String(Date.now() - 1)]]);
    expect(await matchStep(backend, {}, { ...deps, clock: Date.now })).toEqual({
      more: false,
    });
    expect(asked).toEqual(["Analyst"]);
  });

  it("adds to a run that's going without counting a job twice, and starts afresh once it's done", async () => {
    await enqueueMatches(backend, {
      a: queued("Analyst"),
      b: queued("Engineer"),
    });
    const added = await enqueueMatches(backend, {
      b: queued("Engineer"),
      c: queued("Manager"),
    });
    expect(added).toMatchObject({ total: 3, waiting: 3 });
    await matchStep(
      backend,
      {},
      fakes({ Analyst: 70, Engineer: 70, Manager: 70 }).deps,
    );
    expect(
      await enqueueMatches(backend, { d: queued("Designer") }),
    ).toMatchObject({ total: 1, done: 0, waiting: 1 });
  });

  it("stops when asked, and tells when a run has died", async () => {
    const status = await enqueueMatches(backend, { a: queued("Analyst") });
    expect(stalled(status, Date.parse(status.updatedAt) + 1000)).toBe(false);
    expect(
      stalled(status, Date.parse(status.updatedAt) + STALLED_MS + 1000),
    ).toBe(true);
    await stopMatches(backend);
    const stopped = await matchQueueStatus(backend);
    expect(stopped).toMatchObject({ stopped: "Stopped.", waiting: 0 });
    expect(stalled(stopped, Date.now() + STALLED_MS * 2)).toBe(false);
    expect(await matchStep(backend, {}, fakes({ Analyst: 70 }).deps)).toEqual({
      more: false,
    });
  });
});
