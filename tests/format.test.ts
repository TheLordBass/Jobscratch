import { describe, expect, it } from "vitest";
import { olderThan } from "@/lib/format";

describe("olderThan", () => {
  const now = Date.parse("2026-11-04T12:00:00Z");
  it("counts whole days back from now", () => {
    expect(olderThan("2026-10-04T11:00:00Z", 30, now)).toBe(true);
    expect(olderThan("2026-10-05T13:00:00Z", 30, now)).toBe(false);
    expect(olderThan("2026-11-03T11:59:00Z", 1, now)).toBe(true);
  });
  it("keeps a job whose date can't be read", () => {
    expect(olderThan("", 1, now)).toBe(false);
  });
});
