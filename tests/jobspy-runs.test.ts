import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// Outside a real request, there's no request scope to wait for.
vi.mock("next/server", async (original) => ({ ...(await original<typeof import("next/server")>()), connection: async () => {} }));
import { GET as getSearches } from "@/app/api/helper/searches/route";
import { POST as postResults } from "@/app/api/helper/results/route";
import { GET as getRun } from "@/app/api/jobspy-run/route";
import { checkHelperToken, readRun, readRunJobs, saveRunPart } from "@/lib/jobspy-runs";
import { applyOps, clearAll, fileBackend } from "@/lib/server-data";

const TOKEN = "a".repeat(40);
const row = (n: number) => ({
  site: "linkedin",
  job_url: `https://www.linkedin.com/jobs/view/${n}`,
  title: `Data Analyst ${n}`,
  company: "Acme",
  location: "Manchester",
  description: "<p>SQL and Power BI.</p>",
});

let folder: string;
const saved: Record<string, string | undefined> = {};

beforeEach(() => {
  folder = mkdtempSync(join(tmpdir(), "jobscratch-run-"));
  for (const key of ["JOBSCRATCH_DATA_FILE", "JOBSCRATCH_HELPER_TOKEN", "APP_PASSWORD"]) saved[key] = process.env[key];
  process.env.JOBSCRATCH_DATA_FILE = join(folder, "data.json");
  process.env.JOBSCRATCH_HELPER_TOKEN = TOKEN;
});

afterEach(() => {
  for (const [key, value] of Object.entries(saved)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  rmSync(folder, { recursive: true, force: true });
});

const helperRequest = (path: string, body?: unknown, token = TOKEN) =>
  new Request(`http://localhost${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });

describe("the helper token", () => {
  it("must match JOBSCRATCH_HELPER_TOKEN, which must be long", () => {
    expect(checkHelperToken({ JOBSCRATCH_HELPER_TOKEN: TOKEN }, `Bearer ${TOKEN}`)).toBe(true);
    expect(checkHelperToken({ JOBSCRATCH_HELPER_TOKEN: TOKEN }, `Bearer ${"b".repeat(40)}`)).toBe(false);
    expect(checkHelperToken({ JOBSCRATCH_HELPER_TOKEN: TOKEN }, null)).toBe(false);
    expect(checkHelperToken({ JOBSCRATCH_HELPER_TOKEN: "short" }, "Bearer short")).toBe(false);
    expect(checkHelperToken({}, "Bearer ")).toBe(false);
  });
});

describe("a morning run", () => {
  it("is kept in parts, and a new run replaces the old one", async () => {
    const backend = fileBackend(join(folder, "parts.json"));
    const job = (id: string) => ({ id } as never);
    await saveRunPart(backend, { id: "run-one-1", startedAt: "2026-10-26T07:00:00Z", failed: [], jobs: [job("a"), job("b")], done: true });
    await saveRunPart(backend, { id: "run-two-2", startedAt: "2026-10-27T07:00:00Z", failed: [], jobs: [job("c")], done: false });
    let run = await saveRunPart(backend, { id: "run-two-2", startedAt: "2026-10-27T07:00:00Z", failed: ["LinkedIn: “x”"], jobs: [job("d")], done: true }, "2026-10-27T07:20:00Z");
    expect(run).toMatchObject({ id: "run-two-2", count: 2, finishedAt: "2026-10-27T07:20:00Z", failed: ["LinkedIn: “x”"] });
    expect((await readRunJobs(backend)).jobs.map((j) => j.id).sort()).toEqual(["c", "d"]);
    // Delete all data takes the run too.
    await clearAll(backend);
    run = (await readRun(backend))!;
    expect(run).toBeNull();
  });

  it("goes in and comes back out through the routes", async () => {
    const backend = fileBackend(process.env.JOBSCRATCH_DATA_FILE!);
    await applyOps(backend, [
      { key: "settings", value: { country: "gb", jobspy: { search: ["data analyst"], location: ["Manchester"], hours: null } } },
    ]);

    const search = await (await getSearches(helperRequest("/api/helper/searches"))).json();
    // A morning run only looks back two days, and gets the defaults for anything not saved.
    expect(search).toMatchObject({ search: ["data analyst"], hours: 48, sites: ["indeed", "linkedin"], country: "united kingdom" });

    const part = (jobs: unknown[], done: boolean) => ({
      id: "0123456789abcdef",
      startedAt: "2026-10-27T07:00:00Z",
      query: { search: ["data analyst"], location: ["Manchester"] },
      failed: [],
      jobs,
      done,
    });
    let response = await postResults(helperRequest("/api/helper/results", part([row(1), row(2), { title: "no link" }], false)));
    expect(await response.json()).toEqual({ count: 2, skipped: 1 });
    response = await postResults(helperRequest("/api/helper/results", part([row(3)], true)));
    expect(await response.json()).toEqual({ count: 3, skipped: 0 });

    const { run } = await (await getRun(new Request("http://localhost/api/jobspy-run"))).json();
    expect(run).toMatchObject({ count: 3, query: "data analyst in Manchester" });
    expect(run.finishedAt).toBeTruthy();
    const page = await (await getRun(new Request("http://localhost/api/jobspy-run?cursor=0"))).json();
    expect(page.cursor).toBe("0");
    expect(page.jobs).toHaveLength(3);
    // Stored as JobScratch jobs, with the HTML turned into text.
    expect(page.jobs[0]).toMatchObject({ company: "Acme", description: "SQL and Power BI.", sourceName: "LinkedIn (JobSpy)" });
  });

  it("is refused without the right token, or without a token set", async () => {
    expect((await getSearches(helperRequest("/api/helper/searches", undefined, "b".repeat(40)))).status).toBe(401);
    expect((await postResults(helperRequest("/api/helper/results", { id: "x" }, "wrong"))).status).toBe(401);
    delete process.env.JOBSCRATCH_HELPER_TOKEN;
    expect((await getSearches(helperRequest("/api/helper/searches"))).status).toBe(503);
  });

  it("says so when no JobSpy search has been saved", async () => {
    const response = await getSearches(helperRequest("/api/helper/searches"));
    expect(response.status).toBe(404);
    expect((await response.json()).error).toMatch(/Search once from the app/);
  });
});
