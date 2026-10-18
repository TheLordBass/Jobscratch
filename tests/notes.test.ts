import { describe, expect, it } from "vitest";
import { SYSTEM_PROMPT, materialsBlock } from "@/lib/ai/prompts";

const job = { title: "Data Analyst", company: "CBRE", location: "", url: "", description: "Build Power BI dashboards." };

describe("job notes in tailoring", () => {
  it("gives Claude the candidate's notes on the job, with how to use them", () => {
    const block = materialsBlock({ cv: "Alex Test", job, notes: "Tableau: used it weekly at Acme.\nInterview Tuesday with Sam." });
    expect(block).toContain("<candidate_notes>");
    expect(block).toContain("Tableau: used it weekly at Acme.");
    // Experience counts, admin details stay out, and it comes after the job (so the cached prefix is shared).
    expect(block).toMatch(/their own account of what they have really done/);
    expect(block).toMatch(/never copy private details/);
    expect(block.indexOf("<candidate_notes>")).toBeGreaterThan(block.indexOf("</job_posting>"));
    expect(SYSTEM_PROMPT).toContain("the candidate's own notes on this job");
  });

  it("leaves the notes out when there are none", () => {
    expect(materialsBlock({ cv: "Alex Test", job })).not.toContain("candidate_notes");
    expect(materialsBlock({ cv: "Alex Test", job, notes: "  \n" })).not.toContain("candidate_notes");
  });
});
