import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { staleIds } from "@/lib/cleanup";
import { applyOps, cleanUp, fileBackend, readCollection, readUpdatedAt } from "@/lib/server-data";

const NOW = Date.parse("2026-11-13T12:00:00.000Z");
const daysAgo = (days: number) => new Date(NOW - days * 86_400_000).toISOString();
const score = (days: number) => ({ score: 70, key: "k", at: daysAgo(days), analysis: { matchScore: 70 } });
const docs = (days: number) => ({ cv: "# CV", updatedAt: daysAgo(days) });
const savedJob = { job: { title: "Data Analyst" }, status: "saved", updatedAt: daysAgo(40) };

describe("clearing old scores and documents", () => {
  it("clears those for jobs that aren't saved once they're two weeks old, and old removal markers", () => {
    const saved = { kept: savedJob, removed: { $deleted: daysAgo(20) } };
    const items = {
      kept: score(60), // saved: stays however old
      fresh: score(3), // not saved, but recent
      old: score(15),
      removed: score(20), // its job was removed
      undated: { score: 50, key: "k" },
      marker: { $deleted: daysAgo(10) },
      oldMarker: { $deleted: daysAgo(31) },
    };
    expect(staleIds(items, saved, NOW).sort()).toEqual(["old", "oldMarker", "removed", "undated"]);
  });

  it("clears them on the server, leaving saved jobs and the last-changed time alone", async () => {
    const backend = fileBackend(join(mkdtempSync(join(tmpdir(), "jobscratch-clean-")), "data.json"));
    await applyOps(
      backend,
      [
        { key: "saved", items: { kept: savedJob } },
        { key: "matches", items: { kept: score(60), fresh: score(3), old1: score(15), old2: score(30) } },
        { key: "tailored", items: { kept: docs(60), orphan: docs(20), recentOrphan: docs(2) } },
      ],
      "2026-11-13T09:00:00.000Z",
    );
    expect(await cleanUp(backend, NOW)).toEqual({ matches: 2, tailored: 1 });
    expect(Object.keys(await readCollection(backend, "matches")).sort()).toEqual(["fresh", "kept"]);
    expect(Object.keys(await readCollection(backend, "tailored")).sort()).toEqual(["kept", "recentOrphan"]);
    expect(Object.keys(await readCollection(backend, "saved"))).toEqual(["kept"]);
    expect(await readUpdatedAt(backend)).toBe("2026-11-13T09:00:00.000Z");
    // Nothing more to clear the second time.
    expect(await cleanUp(backend, NOW)).toEqual({ matches: 0, tailored: 0 });
  });
});
