import type { MatchAnalysis } from "@/lib/ai/prompts";
import type { ApplicationStatus, SavedJob } from "@/lib/store";
import { normalizeForMatch } from "@/lib/text";

/*
 * Which skills the jobs you save keep asking for, from their match analyses
 * (the keywords each job wants that are, or aren't, in your CV).
 */

export interface SkillTrend {
  /** As the analyses most often wrote it, e.g. "Power BI". */
  name: string;
  /** How many of the analysed jobs ask for it. */
  jobs: number;
  /** How many of those you've applied to (or got further with). */
  applied: number;
  /** Whether your CV shows it, going by most of the analyses. */
  inCv: boolean;
}

const APPLIED: readonly ApplicationStatus[] = ["applied", "interviewing", "offer"];

export function skillTrends(
  saved: Record<string, SavedJob>,
  analysisFor: (jobId: string) => MatchAnalysis | undefined,
): { analysed: number; trends: SkillTrend[] } {
  const counts = new Map<string, { names: Map<string, number>; jobs: number; applied: number; present: number }>();
  let analysed = 0;
  for (const entry of Object.values(saved)) {
    const analysis = analysisFor(entry.job.id);
    if (!analysis) continue;
    analysed++;
    const seen = new Set<string>();
    const add = (name: string, present: boolean) => {
      const key = normalizeForMatch(name);
      if (!key || seen.has(key)) return;
      seen.add(key);
      const count = counts.get(key) ?? { names: new Map(), jobs: 0, applied: 0, present: 0 };
      count.names.set(name.trim(), (count.names.get(name.trim()) ?? 0) + 1);
      count.jobs++;
      if (APPLIED.includes(entry.status)) count.applied++;
      if (present) count.present++;
      counts.set(key, count);
    };
    for (const name of analysis.keywordsPresent) add(name, true);
    for (const name of analysis.keywordsMissing) add(name, false);
  }
  const trends = [...counts.values()]
    .map((count) => ({
      name: [...count.names].sort((a, b) => b[1] - a[1])[0][0],
      jobs: count.jobs,
      applied: count.applied,
      inCv: count.present * 2 > count.jobs,
    }))
    .sort((a, b) => b.jobs - a.jobs || b.applied - a.applied || a.name.localeCompare(b.name));
  return { analysed, trends };
}

/** Whether a skill is already in a list of skills, ignoring case and punctuation. */
export function hasSkill(skills: Array<{ name: string }>, name: string): boolean {
  const key = normalizeForMatch(name);
  return skills.some((skill) => normalizeForMatch(skill.name) === key);
}
