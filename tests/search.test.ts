import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { runSearch, mergeDuplicates } from "@/lib/search";
import { clearSourceCache } from "@/lib/sources/http";
import { parseBoardToken } from "@/lib/sources/boards";
import type { Job } from "@/lib/types";
import * as fx from "./fixtures/api-responses";

const ALL_KEYS = {
  ADZUNA_APP_ID: "id",
  ADZUNA_APP_KEY: "key",
  REED_API_KEY: "reed",
  JOOBLE_API_KEY: "jooble",
  USAJOBS_API_KEY: "usa",
  USAJOBS_EMAIL: "me@example.com",
  SERPAPI_API_KEY: "serp",
  RAPIDAPI_KEY: "rapid",
};

const BOARDS = {
  greenhouse: ["https://boards.greenhouse.io/acme"],
  lever: ["plaid"],
  ashby: ["https://jobs.ashbyhq.com/ramp"],
};

type Route = [RegExp, unknown];

const ROUTES: Route[] = [
  [/remotive\.com\/api\/remote-jobs/, fx.remotive],
  [/remoteok\.com\/api/, fx.remoteok],
  [/arbeitnow\.com\/api\/job-board-api\?page=1/, fx.arbeitnow],
  [/arbeitnow\.com\/api\/job-board-api/, { data: [] }],
  [/jobicy\.com\/api\/v2/, fx.jobicy],
  [/himalayas\.app\/jobs\/api\/search/, fx.himalayas],
  [/boards-api\.greenhouse\.io\/v1\/boards\/acme\/jobs/, fx.greenhouseJobs],
  [/boards-api\.greenhouse\.io\/v1\/boards\/acme$/, fx.greenhouseBoard],
  [/api\.lever\.co\/v0\/postings\/plaid/, fx.lever],
  [/api\.ashbyhq\.com\/posting-api\/job-board\/ramp/, fx.ashby],
  [/api\.adzuna\.com\/v1\/api\/jobs\/gb\/search\/1/, fx.adzuna],
  [/reed\.co\.uk\/api\/1\.0\/search/, fx.reed],
  [/jooble\.org\/api\//, fx.jooble],
  [/data\.usajobs\.gov\/api\/search/, fx.usajobs],
  [/serpapi\.com\/search\.json/, fx.serpapi],
  [/jsearch\.p\.rapidapi\.com\/search/, fx.jsearch],
];

const fetchMock = vi.fn(async (input: string | URL | Request) => {
  const url = String(input);
  const route = ROUTES.find(([pattern]) => pattern.test(url));
  if (!route) return new Response("not found", { status: 404 });
  return Response.json(route[1]);
});

beforeEach(() => {
  clearSourceCache();
  fetchMock.mockClear();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const NOW = new Date("2026-10-10T12:00:00Z");

describe("runSearch", () => {
  it("queries every source and normalises results into one shape", async () => {
    const response = await runSearch(
      { keywords: ["python"], country: "gb", companyBoards: BOARDS },
      { env: ALL_KEYS, now: NOW },
    );
    const statuses = Object.fromEntries(response.sources.map((s) => [s.source, s.status]));
    expect(statuses).toMatchObject({
      remotive: "ok",
      remoteok: "ok",
      arbeitnow: "ok",
      jobicy: "ok",
      himalayas: "ok",
      greenhouse: "ok",
      lever: "ok",
      ashby: "ok",
      adzuna: "ok",
      reed: "ok",
      jooble: "ok",
      "google-jobs": "ok",
      jsearch: "ok",
      // USAJOBS is US-only.
      usajobs: "skipped",
    });

    for (const job of response.jobs) {
      expect(job.title).toBeTruthy();
      expect(job.url).toMatch(/^https:\/\//);
      expect(job.applyOptions[0]?.url).toBeTruthy();
      expect(job.description).not.toMatch(/<\/?[a-z]+>/i);
    }

    const greenhouseJob = response.jobs.find((j) => j.id === "greenhouse:acme:4001")!;
    expect(greenhouseJob.company).toBe("Acme Corp");
    expect(greenhouseJob.description).toBe("Join our platform team.");

    const remotiveJob = response.jobs.find((j) => j.id === "remotive:101")!;
    expect(remotiveJob.company).toBe("Acme & Co");
    expect(remotiveJob.description).toContain("• Python");
    expect(remotiveJob.url).toContain("remotive.com");

    const leverJob = response.jobs.find((j) => j.id === "lever:plaid:abc-123")!;
    expect(leverJob.salary).toMatchObject({ min: 80000, max: 100000, currency: "GBP", period: "year" });
    expect(leverJob.description).toContain("Requirements");

    const adzunaJob = response.jobs.find((j) => j.id === "adzuna:5001")!;
    expect(adzunaJob.title).toBe("Python Developer");
    expect(adzunaJob.salary).toMatchObject({ currency: "GBP" });

    const reedJob = response.jobs.find((j) => j.id === "reed:6001")!;
    expect(reedJob.postedAt).toBe("2026-10-09T00:00:00.000Z");
  });

  it("filters feed sources by keyword but trusts keyword-search APIs", async () => {
    const response = await runSearch(
      { keywords: ["python"], country: "gb", companyBoards: BOARDS },
      { env: ALL_KEYS, now: NOW },
    );
    const titles = response.jobs.map((j) => j.title);
    // Feed sources: non-matching jobs are dropped.
    expect(titles).not.toContain("Account Executive");
    expect(titles).not.toContain("Office Manager");
    expect(titles).not.toContain("Frontend Developer (m/f/d)");
    // Keyword-search API results are kept even if the word isn't in the title
    // (this one is also merged with the identical Remote OK listing).
    const linkedInUrl = "https://www.linkedin.com/jobs/view/999";
    expect(response.jobs.some((j) => j.applyOptions.some((o) => o.url === linkedInUrl))).toBe(true);
  });

  it("merges the same job found on several portals and keeps every apply link", async () => {
    const response = await runSearch(
      { keywords: ["python developer"], country: "gb", sources: ["adzuna", "google-jobs"] },
      { env: ALL_KEYS, now: NOW },
    );
    const wayne = response.jobs.filter((j) => j.company === "Wayne Enterprises");
    expect(wayne).toHaveLength(1);
    expect(wayne[0].source).toBe("adzuna");
    expect(wayne[0].applyOptions.map((o) => o.label)).toEqual(["Adzuna", "LinkedIn", "Indeed", "Google Jobs"]);
    expect(wayne[0].description).toContain("Full description from Google Jobs");
  });

  it("skips keyed sources without credentials and explains why", async () => {
    const response = await runSearch({ keywords: ["python"], country: "gb" }, { env: {}, now: NOW });
    const adzuna = response.sources.find((s) => s.source === "adzuna")!;
    expect(adzuna).toMatchObject({ status: "skipped", message: "Needs ADZUNA_APP_ID, ADZUNA_APP_KEY" });
    const greenhouse = response.sources.find((s) => s.source === "greenhouse")!;
    expect(greenhouse.status).toBe("skipped");
    expect(fetchMock.mock.calls.some(([url]) => String(url).includes("adzuna"))).toBe(false);
  });

  it("applies exclude terms, remote-only and posted-within filters", async () => {
    const response = await runSearch(
      {
        keywords: ["python"],
        exclude: ["senior"],
        remoteOnly: true,
        postedWithinDays: 7,
        country: "gb",
        companyBoards: BOARDS,
      },
      { env: ALL_KEYS, now: NOW },
    );
    expect(response.jobs.every((j) => j.remote)).toBe(true);
    expect(response.jobs.some((j) => /senior/i.test(j.title))).toBe(false);
    // Himalayas job was posted 2026-09-21, more than 7 days before NOW.
    expect(response.jobs.some((j) => j.source === "himalayas")).toBe(false);
  });

  it("only keeps feed jobs that are open to the selected country", async () => {
    const sources: Array<"jobicy" | "remotive" | "greenhouse"> = ["jobicy", "remotive", "greenhouse"];
    const uk = await runSearch(
      { keywords: ["python"], country: "gb", sources, companyBoards: BOARDS },
      { env: {}, now: NOW },
    );
    // Jobicy's job is "Remote (USA)"; Remotive's is open to Europe; Greenhouse's is in London.
    expect(uk.jobs.map((j) => j.id).sort()).toEqual(["greenhouse:acme:4001", "remotive:101"]);

    const us = await runSearch({ keywords: ["python"], country: "us", sources, companyBoards: BOARDS }, { env: {}, now: NOW });
    expect(us.jobs.map((j) => j.id)).toEqual(["jobicy:303"]);
  });

  it("reports a failing source without failing the whole search", async () => {
    fetchMock.mockImplementationOnce(async () => new Response("boom", { status: 500 }));
    const response = await runSearch({ keywords: ["python"], sources: ["remoteok"] }, { env: {}, now: NOW });
    expect(response.sources[0]).toMatchObject({ source: "remoteok", status: "error", message: "HTTP 500" });
    expect(response.jobs).toEqual([]);
  });

  it("returns nothing for an empty keyword list", async () => {
    const response = await runSearch({ keywords: ["  "] }, { env: ALL_KEYS });
    expect(response).toEqual({ jobs: [], sources: [], total: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("mergeDuplicates", () => {
  const job = (over: Partial<Job>): Job => ({
    id: "x",
    source: "remotive",
    sourceName: "X",
    title: "Data Analyst",
    company: "Globex Ltd",
    location: "",
    remote: false,
    url: "https://a.example",
    applyOptions: [{ label: "A", url: "https://a.example" }],
    description: "",
    tags: [],
    ...over,
  });

  it("treats company suffixes and gender markers as the same job", () => {
    const merged = mergeDuplicates([
      job({ id: "1" }),
      job({ id: "2", title: "Data Analyst (m/f/d)", company: "Globex", applyOptions: [{ label: "B", url: "https://b.example" }] }),
    ]);
    expect(merged).toHaveLength(1);
    expect(merged[0].applyOptions).toHaveLength(2);
  });

  it("keeps the same title at the same company in another city as a separate job", () => {
    const merged = mergeDuplicates([
      job({ id: "1", location: "Manchester" }),
      job({ id: "2", location: "London", applyOptions: [{ label: "B", url: "https://b.example" }] }),
      job({ id: "3", location: "Manchester, England", applyOptions: [{ label: "C", url: "https://c.example" }] }),
    ]);
    expect(merged.map((j) => j.location)).toEqual(["Manchester", "London"]);
    expect(merged[0].applyOptions.map((option) => option.label)).toEqual(["A", "C"]);
  });
});

describe("parseBoardToken", () => {
  it.each([
    ["greenhouse", "stripe", "stripe"],
    ["greenhouse", "https://boards.greenhouse.io/stripe", "stripe"],
    ["greenhouse", "https://job-boards.greenhouse.io/stripe/jobs/123", "stripe"],
    ["greenhouse", "https://boards.greenhouse.io/embed/job_board?for=airbnb", "airbnb"],
    ["lever", "https://jobs.lever.co/plaid/abc-123", "plaid"],
    ["ashby", "https://jobs.ashbyhq.com/Ramp", "ramp"],
    ["ashby", "not a token!", undefined],
  ] as const)("%s %s -> %s", (provider, input, expected) => {
    expect(parseBoardToken(provider, input)).toBe(expected);
  });
});
