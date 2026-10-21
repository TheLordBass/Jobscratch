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
  redisBackend,
  redisUrl,
  upstashCredentials,
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

  it("finds the database however Vercel named its settings", () => {
    expect(upstashCredentials({ UPSTASH_REDIS_REST_URL: "https://a.upstash.io", UPSTASH_REDIS_REST_TOKEN: "t1" })).toEqual({ url: "https://a.upstash.io", token: "t1" });
    expect(upstashCredentials({ KV_REST_API_URL: "https://b.upstash.io", KV_REST_API_TOKEN: "t2" })).toEqual({ url: "https://b.upstash.io", token: "t2" });
    // A prefix chosen when connecting it in Vercel.
    expect(
      upstashCredentials({ STORAGE_KV_REST_API_URL: "https://c.upstash.io", STORAGE_KV_REST_API_TOKEN: "t3", STORAGE_KV_REST_API_READ_ONLY_TOKEN: "ro" }),
    ).toEqual({ url: "https://c.upstash.io", token: "t3" });
    expect(upstashCredentials({ KV_URL: "rediss://x", REDIS_URL: "rediss://y" })).toBeUndefined();
    expect(upstashCredentials({ STORAGE_KV_REST_API_URL: "https://c.upstash.io" })).toBeUndefined();
  });

  it("uses Vercel's Redis database (a redis:// address) when there's no Upstash one", () => {
    expect(redisUrl({ REDIS_URL: "rediss://default:pw@redis.example:6379" })).toBe("rediss://default:pw@redis.example:6379");
    expect(redisUrl({ STORAGE_REDIS_URL: "redis://r.example:6379" })).toBe("redis://r.example:6379");
    expect(redisUrl({ REDIS_URL: "https://not-redis.example" })).toBeUndefined();
    expect(dataBackend({ REDIS_URL: "redis://r.example:6379" })?.kind).toBe("redis");
    // Upstash's REST settings come first when both are there.
    expect(dataBackend({ REDIS_URL: "redis://r.example", KV_REST_API_URL: "https://u.upstash.io", KV_REST_API_TOKEN: "t" })?.kind).toBe("upstash");
    // Like Upstash, it holds your CV, so it needs the site password.
    expect(storageAvailability({ REDIS_URL: "redis://r.example" })).toEqual({ enabled: false, reason: "needs-password" });
    expect(storageAvailability({ REDIS_URL: "redis://r.example", APP_PASSWORD: "x" })).toBeNull();
  });

  it("saves and reads everything through a redis:// connection", async () => {
    // A stand-in Redis that answers the commands the app sends.
    const strings = new Map<string, string>();
    const hashes = new Map<string, Map<string, string>>();
    const sent: string[][] = [];
    const fake = {
      async sendCommand([name, key, ...args]: string[]) {
        sent.push([name, key, ...args]);
        if (name === "GET") return strings.get(key) ?? null;
        if (name === "SET") {
          strings.set(key, args[0]);
          return "OK";
        }
        if (name === "HSET") {
          const hash = hashes.get(key) ?? new Map();
          for (let i = 0; i < args.length; i += 2) hash.set(args[i], args[i + 1]);
          hashes.set(key, hash);
          return args.length / 2;
        }
        if (name === "HSCAN") return ["0", [...(hashes.get(key) ?? new Map())].flat()];
        if (name === "DEL") return [key, ...args].filter((k) => strings.delete(k) || hashes.delete(k)).length;
        throw new Error(`unexpected ${name}`);
      },
    };
    let connects = 0;
    const backend = redisBackend("redis://test", async () => (connects++, fake));
    await applyOps(backend, [{ key: "cv", value: { text: "Alex" } }, { key: "saved", items: { a: job("A", "1") } }], "T1");
    expect(await readUpdatedAt(backend)).toBe("T1");
    expect(await readValue(backend, "cv")).toEqual({ text: "Alex" });
    expect(await readItems(backend, "saved")).toEqual({ items: { a: job("A", "1") }, cursor: "0" });
    // The "last changed" time is written after the changes, in the same pipeline.
    expect(sent.slice(0, 3).map(([name, key]) => `${name} ${key}`)).toEqual([
      "SET jobscratch:cv",
      "HSET jobscratch:saved",
      "SET jobscratch:meta",
    ]);
    await clearAll(backend, "T2");
    expect(await readValue(backend, "cv")).toBeNull();
    // One connection, reused.
    expect(connects).toBe(1);
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

  it("saves jobs with long ids, and skips only a change it can't save", async () => {
    // Google Jobs ids are long encoded strings.
    const longId = `google-jobs:${"eyJqb2JfdGl0bGUiOiJEYXRhIEFuYWx5c3Qi".repeat(20)}`;
    expect(longId.length).toBeGreaterThan(500);
    const response = await POST(
      request("/api/data", {
        method: "POST",
        body: JSON.stringify({
          ops: [
            { key: "saved", items: { [longId]: job("Data Analyst", "1") } },
            { key: "nope", value: 1 },
            { key: "cv", value: { text: "Alex" } },
          ],
        }),
      }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).skipped).toBe(1);
    expect((await (await GET(request("/api/data?key=saved&cursor=0"))).json()).items[longId]).toEqual(job("Data Analyst", "1"));
    expect(await (await GET(request("/api/data?key=cv"))).json()).toEqual({ value: { text: "Alex" } });
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
