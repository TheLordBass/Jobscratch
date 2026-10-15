import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { DELETE, GET, POST } from "@/app/api/data/route";
import {
  applyOps,
  clearAll,
  dataBackend,
  fileBackend,
  readItems,
  readUpdatedAt,
  readValue,
  storageAvailability,
} from "@/lib/server-data";
import { mergeCollection } from "@/lib/sync";

const tempFile = () => join(mkdtempSync(join(tmpdir(), "jobscratch-")), "data.json");
const job = (title: string, updatedAt: string) => ({ job: { title }, status: "saved", updatedAt });

describe("server storage", () => {
  it("stores values and items, pages through collections, and clears everything", async () => {
    const backend = fileBackend(tempFile());
    expect(await readUpdatedAt(backend)).toBeNull();

    const at = await applyOps(
      backend,
      [
        { key: "cv", value: { text: "Alex Test", updatedAt: "2026-10-15" } },
        { key: "saved", items: { a: job("A", "1"), b: job("B", "1") } },
      ],
      "2026-10-15T10:00:00.000Z",
    );
    expect(at).toBe("2026-10-15T10:00:00.000Z");
    expect(await readUpdatedAt(backend)).toBe(at);
    expect(await readValue(backend, "cv")).toEqual({ text: "Alex Test", updatedAt: "2026-10-15" });
    expect(await readItems(backend, "saved")).toEqual({ items: { a: job("A", "1"), b: job("B", "1") }, cursor: "0" });

    // Only the item that changed is written; others are kept.
    await applyOps(backend, [{ key: "saved", items: { b: { $deleted: "2" } } }]);
    expect((await readItems(backend, "saved")).items).toEqual({ a: job("A", "1"), b: { $deleted: "2" } });

    const many = Object.fromEntries(Array.from({ length: 250 }, (_, i) => [`m${i}`, { score: i, at: "1" }]));
    await applyOps(backend, [{ key: "matches", items: many }]);
    const first = await readItems(backend, "matches");
    expect(Object.keys(first.items)).toHaveLength(200);
    const second = await readItems(backend, "matches", first.cursor);
    expect(second.cursor).toBe("0");
    expect(Object.keys({ ...first.items, ...second.items })).toHaveLength(250);

    await clearAll(backend);
    expect(await readValue(backend, "cv")).toBeNull();
    expect((await readItems(backend, "saved")).items).toEqual({});
  });

  it("talks to Upstash through one pipeline request", async () => {
    const fetchMock = vi.fn<typeof fetch>().mockResolvedValue(Response.json([{ result: "OK" }, { result: "OK" }]));
    vi.stubGlobal("fetch", fetchMock);
    const backend = dataBackend({ KV_REST_API_URL: "https://eu1-x.upstash.io/", KV_REST_API_TOKEN: "tok" })!;
    expect(backend.kind).toBe("upstash");
    await applyOps(backend, [{ key: "settings", value: { country: "gb" } }], "T");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("https://eu1-x.upstash.io/pipeline");
    expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
    expect(JSON.parse(String(init?.body))).toEqual([
      ["SET", "jobscratch:settings", '{"country":"gb"}'],
      ["SET", "jobscratch:meta", "T"],
    ]);

    fetchMock.mockResolvedValueOnce(Response.json([{ error: "ERR max request size exceeded" }]));
    await expect(readUpdatedAt(backend)).rejects.toThrow("max request size exceeded");
    vi.unstubAllGlobals();
  });

  it("only turns on behind the site password, except for the local file", () => {
    const upstash = { UPSTASH_REDIS_REST_URL: "https://x.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t" };
    expect(storageAvailability({})).toEqual({ enabled: false, reason: "not-configured" });
    expect(storageAvailability(upstash)).toEqual({ enabled: false, reason: "needs-password" });
    expect(storageAvailability({ ...upstash, APP_PASSWORD: "secret" })).toBeNull();
    expect(storageAvailability({ JOBSCRATCH_DATA_FILE: "/tmp/x.json" })).toBeNull();
    expect(dataBackend({ JOBSCRATCH_DATA_FILE: "/tmp/x.json", NODE_ENV: "production" })).toBeUndefined();
  });
});

describe("/api/data", () => {
  const original = { ...process.env };
  beforeEach(() => {
    process.env.JOBSCRATCH_DATA_FILE = tempFile();
  });
  afterEach(() => {
    process.env = { ...original };
  });
  const request = (path: string, init?: RequestInit) => new Request(`http://localhost${path}`, init);

  it("saves and returns data", async () => {
    expect(await (await GET(request("/api/data"))).json()).toEqual({ enabled: true, updatedAt: null });

    const saved = await POST(
      request("/api/data", {
        method: "POST",
        body: JSON.stringify({ ops: [{ key: "groups", value: [{ name: "Data roles" }] }, { key: "tailored", items: { a: { cv: "# CV" } } }] }),
      }),
    );
    const { updatedAt } = await saved.json();
    expect(updatedAt).toMatch(/^\d{4}-/);
    expect(await (await GET(request("/api/data"))).json()).toEqual({ enabled: true, updatedAt });
    expect(await (await GET(request("/api/data?key=groups"))).json()).toEqual({ value: [{ name: "Data roles" }] });
    expect(await (await GET(request("/api/data?key=tailored&cursor=0"))).json()).toEqual({ items: { a: { cv: "# CV" } }, cursor: "0" });

    expect((await GET(request("/api/data?key=nope"))).status).toBe(400);
    expect((await POST(request("/api/data", { method: "POST", body: JSON.stringify({ ops: [{ key: "nope", value: 1 }] }) }))).status).toBe(400);

    await DELETE();
    expect(await (await GET(request("/api/data?key=groups"))).json()).toEqual({ value: null });
  });

  it("says why it's off", async () => {
    delete process.env.JOBSCRATCH_DATA_FILE;
    expect(await (await GET(request("/api/data"))).json()).toEqual({ enabled: false, reason: "not-configured" });
    expect((await POST(request("/api/data", { method: "POST", body: "{}" }))).status).toBe(409);
  });
});

describe("mergeCollection", () => {
  it("keeps the newer copy of each job and sends the server what it lacks", () => {
    const local = { a: job("A here", "3"), b: job("B here", "1"), mine: job("Only here", "1") };
    const remote = { a: job("A there", "2"), b: job("B there", "2"), theirs: job("Only there", "1") };
    const { merged, upload } = mergeCollection(local, remote);
    expect(merged).toEqual({ a: job("A here", "3"), b: job("B there", "2"), mine: job("Only here", "1"), theirs: job("Only there", "1") });
    expect(upload).toEqual({ a: job("A here", "3"), mine: job("Only here", "1") });
  });

  it("keeps removed jobs removed, unless they changed here afterwards", () => {
    const removedThere = mergeCollection({ a: job("A", "1"), b: job("B", "5") }, { a: { $deleted: "2" }, b: { $deleted: "2" } });
    expect(removedThere.merged).toEqual({ b: job("B", "5") });
    expect(removedThere.upload).toEqual({ b: job("B", "5") });

    const removedHere = mergeCollection({ a: { $deleted: "3" } }, { a: job("A", "2") });
    expect(removedHere.merged).toEqual({});
    expect(removedHere.upload).toEqual({ a: { $deleted: "3" } });
  });
});
