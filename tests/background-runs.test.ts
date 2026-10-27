import { describe, expect, it } from "vitest";
import { beginBatch, markBatchSeen, stopBatch } from "@/lib/batch-runs";
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
