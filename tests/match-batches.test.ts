import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST as sendBatch } from "@/app/api/tailor/analyze/batch/route";
import type { MatchAnalysis } from "@/lib/ai/prompts";
import type { Candidate } from "@/lib/candidate";
import type { StoredMatch, TailoredDocs } from "@/lib/store";
import type { Job } from "@/lib/types";

// What the store was asked to save, and which jobs count as saved.
const saved = { matches: {} as Record<string, StoredMatch>, docs: {} as Record<string, Partial<TailoredDocs>>, jobs: new Set<string>() };
vi.mock("@/lib/store", () => ({
  updateStoredMatch: (id: string, match: StoredMatch) => (saved.matches[id] = match),
  updateTailoredDocs: (id: string, patch: Partial<TailoredDocs>) => (saved.docs[id] = patch),
  isSavedJob: (id: string) => saved.jobs.has(id),
}));

const DESCRIPTION = "We need SQL, Power BI and stakeholder reporting. ".repeat(20);
const job = (n: number): Job =>
  ({ id: `job:${n}`, title: `Data Analyst ${n}`, company: "Co", location: "Leeds", url: `https://x.example/${n}`, description: DESCRIPTION }) as Job;
const candidate: Candidate = { cv: "Test Person. ".repeat(10), staleDetails: false, key: "cand" };
const analysis = (score: number): MatchAnalysis => ({
  matchScore: score,
  verdict: "Fit",
  strengths: [],
  gaps: [],
  keywordsPresent: [],
  keywordsMissing: [],
  suggestions: [],
});

/** A phone browser: storage, visibility, and the batch route, which answers `done` once told to. */
function fakePhone() {
  const storage = new Map<string, string>();
  const sent: Array<{ customId: string; job: { title: string } }[]> = [];
  const state = { done: false, failSend: 0 as number, deleted: [] as string[] };
  vi.stubGlobal("window", {
    localStorage: {
      getItem: (key: string) => storage.get(key) ?? null,
      setItem: (key: string, value: string) => storage.set(key, value),
      removeItem: (key: string) => storage.delete(key),
    },
    matchMedia: () => ({ matches: true }),
    addEventListener: () => undefined,
  });
  vi.stubGlobal("document", { visibilityState: "visible", addEventListener: () => undefined });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === "POST") {
        if (state.failSend) return Response.json({ error: "Anthropic rejected the API key." }, { status: state.failSend });
        const body = JSON.parse(String(init.body));
        sent.push(body.jobs);
        return Response.json({ id: `batch-${sent.length}` });
      }
      const id = new URL(url, "http://x").searchParams.get("id")!;
      if (init?.method === "DELETE") {
        state.deleted.push(id);
        return Response.json({ ok: true });
      }
      if (!state.done) return Response.json({ done: false });
      const jobs = sent[Number(id.split("-")[1]) - 1];
      return Response.json({
        done: true,
        outcomes: Object.fromEntries(
          jobs.map(({ customId, job: j }) => [customId, j.title.endsWith(" 3") ? { error: "Couldn't be read." } : { analysis: analysis(80) }]),
        ),
      });
    }),
  );
  return { storage, sent, state };
}

beforeEach(() => {
  vi.resetModules();
  saved.matches = {};
  saved.docs = {};
  saved.jobs = new Set(["job:2"]);
});

afterEach(() => vi.unstubAllGlobals());

describe("Match all on a phone", () => {
  it("sends the jobs as batches, remembers them, and saves the scores once they're back", async () => {
    const phone = fakePhone();
    const { matchInBatches, matchesInBackground } = await import("@/lib/match-batches");
    expect(matchesInBackground()).toBe(true);
    const jobs = Array.from({ length: 30 }, (_, i) => ({ job: job(i + 1), notes: i === 0 ? "Mention dbt." : undefined }));
    await matchInBatches("/saved", candidate, jobs);

    // 25 to a batch, and kept in the browser in case the page is reloaded.
    expect(phone.sent.map((chunk) => chunk.length)).toEqual([25, 5]);
    expect(phone.sent[0][0]).toMatchObject({ customId: "job-0", notes: "Mention dbt." });
    expect(JSON.parse(phone.storage.get("jobscratch:match-batches")!)).toHaveLength(2);

    // A reloaded page picks them up; nothing's saved while Claude's still at it.
    const { resumeMatchBatches } = await import("@/lib/match-batches");
    resumeMatchBatches();
    await vi.waitFor(() => expect(vi.mocked(fetch).mock.calls.filter(([, init]) => !init?.method).length).toBeGreaterThanOrEqual(2));
    expect(saved.matches).toEqual({});

    phone.state.done = true;
    resumeMatchBatches();
    await vi.waitFor(() => expect(phone.storage.has("jobscratch:match-batches")).toBe(false));
    expect(Object.keys(saved.matches)).toHaveLength(29);
    // Saved under the key of what was sent, so they count as current.
    expect(saved.matches["job:1"].score).toBe(80);
    expect(saved.matches["job:1"].key).toMatch(/^cand:/);
    // The one that failed isn't saved; the saved job gets its analysis too.
    expect(saved.matches["job:3"]).toBeUndefined();
    expect(saved.docs["job:2"]?.analysis?.matchScore).toBe(80);
  });

  it("stops sending when the API key is refused", async () => {
    const phone = fakePhone();
    phone.state.failSend = 401;
    const { matchInBatches } = await import("@/lib/match-batches");
    await matchInBatches("/saved", candidate, Array.from({ length: 30 }, (_, i) => ({ job: job(i + 1) })));
    expect(vi.mocked(fetch)).toHaveBeenCalledTimes(1);
    expect(phone.storage.has("jobscratch:match-batches")).toBe(false);
  });

  it("refuses snippets and too many jobs at once on the server", async () => {
    const post = (jobs: object[]) =>
      sendBatch(new Request("http://localhost/api/tailor/analyze/batch", { method: "POST", body: JSON.stringify({ cv: candidate.cv, jobs }) }));
    const one = (description: string) => ({ customId: "job-0", job: { title: "Data Analyst", company: "Co", description } });
    expect((await post([one("Short.")])).status).toBe(422);
    expect((await post(Array.from({ length: 26 }, () => one(DESCRIPTION)))).status).toBe(400);
  });
});
