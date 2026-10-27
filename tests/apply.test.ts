import { describe, expect, it } from "vitest";
import { applyQueue, documentFileName } from "@/lib/apply";
import { markdownToPlainText } from "@/lib/markdown";
import type { SavedJob, TailoredDocs } from "@/lib/store";

const entry = (id: string, status: SavedJob["status"], savedAt: string): SavedJob => ({
  job: { id, title: `Job ${id}`, company: "Acme", location: "", url: "", applyOptions: [], description: "", source: "import", sourceName: "x", remote: false, tags: [] },
  status,
  notes: "",
  savedAt,
  updatedAt: savedAt,
});

describe("the Apply page", () => {
  it("lists saved jobs not applied to yet, those with a tailored CV ready, best match first", () => {
    const saved = {
      a: entry("a", "saved", "2026-10-01"),
      b: entry("b", "saved", "2026-10-03"),
      c: entry("c", "saved", "2026-10-02"),
      d: entry("d", "applied", "2026-10-04"),
      e: entry("e", "saved", "2026-10-05"),
    };
    const docs = (cv: string): TailoredDocs => ({ cv, updatedAt: "" });
    const tailored = { a: docs("# A"), b: docs("# B"), c: docs("# C"), d: docs("# D"), e: docs("  ") };
    const scores: Record<string, number> = { a: 70, b: 70, c: 90 };
    const { ready, notReady } = applyQueue(saved, tailored, (s) => scores[s.job.id]);
    // c scores highest; a and b tie, so the more recently saved (b) comes first.
    expect(ready.map((s) => s.job.id)).toEqual(["c", "b", "a"]);
    expect(notReady.map((s) => s.job.id)).toEqual(["e"]);
  });

  it("names the CV after the candidate and the company", () => {
    expect(documentFileName("# Jane Doe\njane@example.com", "cv", "Acme Ltd")).toBe("jane-doe-cv-acme-ltd");
    expect(documentFileName("Dear team", "cover-letter", "Acme")).toBe("cover-letter-acme");
  });

  it("turns a document into plain text for a form's text box", () => {
    expect(markdownToPlainText("Dear **hiring team**,\n\nI saw the [role](https://x.example).\n\n- SQL\n- Power BI")).toBe(
      "Dear hiring team,\n\nI saw the role.\n\n• SQL\n• Power BI",
    );
  });
});
