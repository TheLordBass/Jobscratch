import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/*
 * The browser side of server storage (lib/sync.ts), with a stand-in browser:
 * localStorage, page events and fetch.
 */

const storage = new Map<string, string>();
const posted: unknown[] = [];
let remoteSaved: Record<string, unknown> = {};
let remoteMatches: Record<string, unknown> = {};
const cleanups: string[] = [];
let online = true;

function fakeBrowser() {
  const localStorage = {
    getItem: (key: string) => storage.get(key) ?? null,
    setItem: (key: string, value: string) => void storage.set(key, value),
    removeItem: (key: string) => void storage.delete(key),
  };
  vi.stubGlobal("window", { localStorage, addEventListener() {} });
  vi.stubGlobal("document", { addEventListener() {}, visibilityState: "visible" });
  vi.stubGlobal(
    "fetch",
    vi.fn(async (url: string, init?: RequestInit) => {
      const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
      if (init?.method === "POST") {
        if (!online) throw new TypeError("Failed to fetch");
        if (url === "/api/data/cleanup") {
          cleanups.push(url);
          return json({ cleared: { matches: 0, tailored: 0 } });
        }
        posted.push(JSON.parse(String(init.body)));
        return json({ updatedAt: new Date().toISOString() });
      }
      if (url === "/api/data") return json({ enabled: true, updatedAt: "earlier" });
      if (url.startsWith("/api/data?key=saved")) return json({ items: remoteSaved, cursor: "0" });
      if (url.startsWith("/api/data?key=matches")) return json({ items: remoteMatches, cursor: "0" });
      if (url.includes("&cursor=")) return json({ items: {}, cursor: "0" });
      return json({ value: null });
    }),
  );
}

/** A fresh copy of the module, as on a new visit, with a store holding `local`. */
async function visit(local: Record<string, unknown>) {
  vi.resetModules();
  const sync = await import("@/lib/sync");
  const data = new Map<string, unknown>(Object.entries(local));
  sync.connectStore({ read: (key) => data.get(key) ?? null, apply: (key, value) => void data.set(key, value), ready: async () => {} });
  sync.startSync();
  await vi.waitFor(() => expect(sync.getSyncState().status).not.toBe("checking"));
  return { sync, data };
}

const job = (updatedAt: string) => ({ job: { title: "Data Analyst" }, status: "saved", updatedAt });

describe("server storage sync", () => {
  beforeEach(() => {
    storage.clear();
    posted.length = 0;
    cleanups.length = 0;
    remoteMatches = {};
    online = true;
    remoteSaved = { a: job("2026-10-01T10:00:00.000Z") };
    fakeBrowser();
  });
  afterEach(() => vi.unstubAllGlobals());

  it("doesn't bring back a job deleted while the server couldn't be reached", async () => {
    // First visit: the job is deleted, but sending it fails and the tab is closed.
    const first = await visit({ saved: { a: remoteSaved.a } });
    online = false;
    first.sync.queueChange("saved", { a: remoteSaved.a }, {});
    await first.sync.flush();
    expect(storage.get("jobscratch-sync:pending")).toContain("$deleted");

    // Next visit: the server still has the job. The saved removal wins and is sent.
    online = true;
    const second = await visit({ saved: {} });
    await vi.waitFor(() => expect(second.sync.getSyncState().status).toBe("saved"));
    expect(second.data.get("saved")).toEqual({});
    const sent = posted.flatMap((body) => (body as { ops: Array<{ key: string; items?: Record<string, unknown> }> }).ops);
    expect(sent.find((op) => op.key === "saved")?.items?.a).toMatchObject({ $deleted: expect.any(String) });
    expect(storage.has("jobscratch-sync:pending")).toBe(false);
  });

  it("drops old scores for jobs that aren't saved, doesn't send them back, and asks the server to clear up once a day", async () => {
    const at = (daysAgo: number) => new Date(Date.now() - daysAgo * 86_400_000).toISOString();
    const score = (daysAgo: number) => ({ score: 70, key: "k", at: at(daysAgo), analysis: {} });
    // The server still has an old score; this browser has another old one, and two worth keeping.
    remoteMatches = { oldThere: score(30) };
    const { sync, data } = await visit({
      saved: { a: remoteSaved.a },
      matches: { a: score(40), oldHere: score(20), recent: score(2) },
    });
    await vi.waitFor(() => expect(sync.getSyncState().status).toBe("saved"));
    expect(Object.keys(data.get("matches") as object).sort()).toEqual(["a", "recent"]);
    const sent = posted.flatMap((body) => (body as { ops: Array<{ key: string; items?: Record<string, unknown> }> }).ops);
    expect(Object.keys(sent.find((op) => op.key === "matches")?.items ?? {}).sort()).toEqual(["a", "recent"]);
    await vi.waitFor(() => expect(cleanups).toHaveLength(1));

    // A second visit the same day doesn't ask again.
    const again = await visit({ saved: { a: remoteSaved.a }, matches: {} });
    await vi.waitFor(() => expect(again.sync.getSyncState().status).toBe("saved"));
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(cleanups).toHaveLength(1);
  });

  it("forgets unsent changes when all data is deleted", async () => {
    const { sync } = await visit({ saved: { a: remoteSaved.a } });
    online = false;
    sync.queueChange("saved", {}, { b: job("2026-10-02T10:00:00.000Z") });
    expect(storage.has("jobscratch-sync:pending")).toBe(true);
    online = true;
    await sync.clearServerData();
    expect(storage.has("jobscratch-sync:pending")).toBe(false);
  });
});
