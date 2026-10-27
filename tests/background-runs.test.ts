import { afterEach, describe, expect, it, vi } from "vitest";
import { beginBatch, markBatchSeen, pausedInBackground, stopBatch } from "@/lib/batch-runs";
import { nextSearch } from "@/lib/search-session";
import { clearSessionState, setSessionValue } from "@/lib/session-state";

describe("background runs", () => {
  it("keeps a run's progress after it's started, and stops it when asked", () => {
    const run = beginBatch("match", "/test-a", 3);
    run.report({ done: 1, failed: 0 });
    expect(run.signal.aborted).toBe(false);
    stopBatch("match", "/test-a");
    expect(run.signal.aborted).toBe(true);
  });

  it("a new run on the same page replaces the old one, which can no longer report", () => {
    const first = beginBatch("tailor", "/test-b", 2, "CVs");
    const second = beginBatch("tailor", "/test-b", 5, "CVs");
    expect(first.signal.aborted).toBe(true);
    first.report({ done: 2 });
    first.finish();
    expect(second.signal.aborted).toBe(false);
    second.finish();
    markBatchSeen("tailor", "/test-b");
  });
});

describe("page state for the session", () => {
  it("keeps a value under its key until cleared", () => {
    setSessionValue("test:count", (previous: number) => previous + 1, 0);
    setSessionValue("test:count", (previous: number) => previous + 1, 0);
    let seen = -1;
    setSessionValue("test:count", (previous: number) => (seen = previous), 0);
    expect(seen).toBe(2);
    clearSessionState();
    setSessionValue("test:count", (previous: number) => (seen = previous), 0);
    expect(seen).toBe(0);
  });

  it("only the newest search may show its results", () => {
    const first = nextSearch();
    const second = nextSearch();
    expect(first()).toBe(false);
    expect(second()).toBe(true);
  });
});

describe("work dropped while the page is in the background", () => {
  function fakeDocument(state: "visible" | "hidden") {
    const listeners = new Set<() => void>();
    const doc = {
      visibilityState: state,
      addEventListener: (_: string, listener: () => void) => listeners.add(listener),
      removeEventListener: (_: string, listener: () => void) => listeners.delete(listener),
      show() {
        doc.visibilityState = "visible";
        for (const listener of [...listeners]) listener();
      },
    };
    vi.stubGlobal("document", doc);
    return doc;
  }

  afterEach(() => vi.unstubAllGlobals());

  it("isn't tried again when the page was in view (a real failure)", async () => {
    fakeDocument("visible");
    expect(await pausedInBackground(new AbortController().signal)).toBe(false);
  });

  it("waits until the page is back, then tries again", async () => {
    const doc = fakeDocument("hidden");
    let settled = false;
    const retry = pausedInBackground(new AbortController().signal).then((value) => ((settled = true), value));
    await Promise.resolve();
    expect(settled).toBe(false);
    doc.show();
    expect(await retry).toBe(true);
  });

  it("gives up when the run is stopped while waiting", async () => {
    fakeDocument("hidden");
    const controller = new AbortController();
    const retry = pausedInBackground(controller.signal);
    controller.abort();
    expect(await retry).toBe(false);
  });
});
