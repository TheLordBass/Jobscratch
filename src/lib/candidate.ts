import { hashString } from "@/lib/import";
import { MAX_EVIDENCE_CHARS, MAX_GITHUB_LENGTH, MAX_WEBSITE_LENGTH, linksChanged } from "@/lib/profile/links";
import type { ExtraSkill, MatchAnalysis } from "@/lib/ai/prompts";
import type { CvVersion } from "@/lib/cvs";
import type { StoredCv, StoredMatch, StoredProfile } from "@/lib/store";
import type { Job } from "@/lib/types";

/** What the tailoring and matching requests send about the candidate. */
export interface Candidate {
  cv: string;
  profile?: { website: string; github: string; evidence: string };
  /** Skills from the profile that the CV doesn't show. */
  skills?: ExtraSkill[];
  /** Details fetched for links that have since changed, so they're left out. */
  staleDetails: boolean;
  /** Changes whenever what Claude is told about the candidate changes. */
  key: string;
}

/** What to send about the candidate with `cv`: the main CV, or another one (see lib/cvs.ts). */
export function candidateFor(cv: StoredCv | CvVersion | null, profile: StoredProfile): Candidate {
  // A link too long for the API is left out rather than failing every request.
  const website = profile.website.trim().length <= MAX_WEBSITE_LENGTH ? profile.website.trim() : "";
  const github = profile.github.trim().length <= MAX_GITHUB_LENGTH ? profile.github.trim() : "";
  // Details fetched for links that have since changed would describe the wrong site or account.
  const staleDetails = Boolean(profile.evidence.trim()) && linksChanged(profile, profile.fetchedFor);
  const evidence = staleDetails ? "" : profile.evidence.trim().slice(0, MAX_EVIDENCE_CHARS);
  const payload = profile.enabled && (website || github || evidence) ? { website, github, evidence } : undefined;
  const text = cv?.text ?? "";
  const skills = (profile.skills ?? [])
    .filter((skill) => skill.name.trim())
    .slice(0, 60)
    .map((skill) => ({ name: skill.name.trim().slice(0, 100), detail: skill.detail.trim().slice(0, 500) }));
  // Extra skills aren't part of the key: adding one shouldn't hide every match score. New analyses use them.
  const key = hashString(JSON.stringify([text, payload ?? null]));
  return { cv: text, profile: payload, skills: skills.length ? skills : undefined, staleDetails, key };
}

/**
 * Shorter than this, a description is taken to be a snippet: many sources (Adzuna, Reed, Jooble,
 * LinkedIn through JobSpy) only share the first few lines, or nothing.
 */
export const FULL_DESCRIPTION = 600;

/** Whether there's a full description, not just a snippet. Only those are matched: a snippet gives a misleading score. */
export function hasFullDescription(description: string): boolean {
  return description.trim().length >= FULL_DESCRIPTION;
}

export function canMatch(job: Job): boolean {
  return hasFullDescription(job.description);
}

/** Identifies the CV and description a match score was made from, to tell when it's out of date. */
export function matchKey(job: Job, candidate: Candidate): string {
  return `${candidate.key}:${hashString(job.description)}`;
}

/** A job's match score, as kept for lists, from its full analysis. */
export function matchFromAnalysis(analysis: MatchAnalysis, key: string, at = new Date().toISOString()): StoredMatch {
  return {
    score: analysis.matchScore,
    verdict: analysis.verdict,
    missing: (analysis.keywordsMissing.length ? analysis.keywordsMissing : analysis.gaps).slice(0, 3),
    key,
    at,
    analysis,
  };
}
