import { describe, expect, it } from "vitest";
import { materialsBlock, type MatchAnalysis } from "@/lib/ai/prompts";
import { candidateFor } from "@/lib/candidate";
import { EMPTY_PROFILE, type SavedJob } from "@/lib/store";
import { hasSkill, skillTrends } from "@/lib/trends";

const analysis = (present: string[], missing: string[]): MatchAnalysis => ({
  matchScore: 70,
  verdict: "",
  strengths: [],
  gaps: [],
  keywordsPresent: present,
  keywordsMissing: missing,
  suggestions: [],
});
const entry = (id: string, status: SavedJob["status"]) => ({ job: { id }, status }) as SavedJob;

describe("skill trends", () => {
  it("counts the skills saved jobs ask for, how many were applied to, and whether the CV shows them", () => {
    const saved = { a: entry("a", "applied"), b: entry("b", "saved"), c: entry("c", "interviewing"), d: entry("d", "saved") };
    const analyses: Record<string, MatchAnalysis> = {
      a: analysis(["SQL", "Power BI"], ["Tableau", "dbt"]),
      b: analysis(["sql"], ["tableau"]),
      c: analysis(["SQL"], ["Tableau", "Snowflake", "Snowflake"]),
      // d has no analysis yet.
    };
    const { analysed, trends } = skillTrends(saved, (id) => analyses[id]);
    expect(analysed).toBe(3);
    expect(trends.slice(0, 3)).toEqual([
      { name: "SQL", jobs: 3, applied: 2, inCv: true },
      { name: "Tableau", jobs: 3, applied: 2, inCv: false },
      { name: "dbt", jobs: 1, applied: 1, inCv: false },
    ]);
    expect(trends.find((trend) => trend.name === "Snowflake")?.jobs).toBe(1);
  });

  it("knows a skill already in the profile, whatever its case", () => {
    expect(hasSkill([{ name: "Power BI" }], "power bi")).toBe(true);
    expect(hasSkill([{ name: "Power BI" }], "Tableau")).toBe(false);
  });
});

describe("extra skills from the profile", () => {
  const job = { title: "Data Analyst", company: "CBRE", location: "", url: "", description: "Build dashboards." };

  it("go to Claude with the CV, as the candidate's own account", () => {
    const candidate = candidateFor(
      { text: "Alex Test", updatedAt: "" },
      { ...EMPTY_PROFILE, skills: [{ name: " Tableau ", detail: "weekly sales dashboards at Acme" }, { name: " ", detail: "" }] },
    );
    expect(candidate.skills).toEqual([{ name: "Tableau", detail: "weekly sales dashboards at Acme" }]);
    const block = materialsBlock({ cv: candidate.cv, job, skills: candidate.skills });
    expect(block).toContain("<candidate_extra_skills>");
    expect(block).toContain("- Tableau: weekly sales dashboards at Acme");
    expect(block.indexOf("<candidate_extra_skills>")).toBeLessThan(block.indexOf("<job_posting>"));
  });

  it("don't change the match key, so adding one keeps existing scores", () => {
    const cv = { text: "Alex Test", updatedAt: "" };
    expect(candidateFor(cv, { ...EMPTY_PROFILE, skills: [{ name: "Tableau", detail: "" }] }).key).toBe(candidateFor(cv, EMPTY_PROFILE).key);
    expect(materialsBlock({ cv: "Alex Test", job })).not.toContain("candidate_extra_skills");
  });
});
