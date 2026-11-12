import { hashString } from "@/lib/import";
import { MAX_EVIDENCE_CHARS, MAX_GITHUB_LENGTH, MAX_WEBSITE_LENGTH, linksChanged } from "@/lib/profile/links";
import type { CandidateCv, ExtraSkill, MatchAnalysis } from "@/lib/ai/prompts";
import { cvVersions, hasCvText } from "@/lib/cvs";
import type { StoredCv, StoredMatch, StoredProfile, TailoredDocs } from "@/lib/store";
import type { Job } from "@/lib/types";

/** What the tailoring and matching requests send about the candidate. */
export interface Candidate {
  /** The main CV (or the first with text). */
  cv: string;
  /** Every CV with text, when there's more than one: Claude uses them all (see lib/cvs.ts). */
  cvs?: CandidateCv[];
  profile?: { website: string; github: string; evidence: string };
  /** Skills from the profile that the CV doesn't show. */
  skills?: ExtraSkill[];
  /** Details fetched for links that have since changed, so they're left out. */
  staleDetails: boolean;
  /** Changes whenever what Claude is told about the candidate changes. */
  key: string;
  /** When the CVs were last changed: a document made before it, and not recorded as made since, is out of date. */
  since?: string;
}

/**
 * What to send about the candidate: all their CVs, website and GitHub, the same for every job. With
 * one CV, the key is what it always was, so scores made before there could be more still count.
 */
export function candidateFor(cv: StoredCv | null, profile: StoredProfile): Candidate {
  const versions = cvVersions(cv).filter(hasCvText);
  const one = { ...candidateForText(versions[0]?.text ?? cv?.text ?? "", profile), since: cv?.updatedAt };
  if (versions.length < 2) return one;
  // To the minute, so two changed on the same day are still in order.
  const cvs = versions.map(({ name, text, updatedAt }) => ({ name, text, updated: updatedAt.slice(0, 16).replace("T", " ") }));
  // Names and dates aren't part of it: renaming a CV shouldn't hide every match score.
  return { ...one, cvs, key: hashString(JSON.stringify([cvs.map((version) => version.text), one.profile ?? null])) };
}

function candidateForText(text: string, profile: StoredProfile): Candidate {
  // A link too long for the API is left out rather than failing every request.
  const website = profile.website.trim().length <= MAX_WEBSITE_LENGTH ? profile.website.trim() : "";
  const github = profile.github.trim().length <= MAX_GITHUB_LENGTH ? profile.github.trim() : "";
  // Details fetched for links that have since changed would describe the wrong site or account.
  const staleDetails = Boolean(profile.evidence.trim()) && linksChanged(profile, profile.fetchedFor);
  const evidence = staleDetails ? "" : profile.evidence.trim().slice(0, MAX_EVIDENCE_CHARS);
  const payload = profile.enabled && (website || github || evidence) ? { website, github, evidence } : undefined;
  const skills = (profile.skills ?? [])
    .filter((skill) => skill.name.trim())
    .slice(0, 60)
    .map((skill) => ({ name: skill.name.trim().slice(0, 100), detail: skill.detail.trim().slice(0, 500) }));
  // Extra skills aren't part of the key: adding one shouldn't hide every match score. New analyses use them.
  const key = hashString(JSON.stringify([text, payload ?? null]));
  return { cv: text, profile: payload, skills: skills.length ? skills : undefined, staleDetails, key };
}

export type MadePart = "analysis" | "cv" | "coverLetter" | "interview" | "testPrep" | "outreach" | "followUp";

/**
 * Whether a job's analysis, tailored CV or cover letter was made from the candidate as they are now,
 * not from an earlier CV. One made before that was recorded counts if it's newer than the CVs.
 */
export function madeFromCurrent(docs: TailoredDocs | undefined, part: MadePart, candidate: Candidate): boolean {
  if (!docs?.[part]) return false;
  const from = docs[`${part}From`];
  if (from) return from === candidate.key;
  return !candidate.since || docs.updatedAt >= candidate.since;
}

/**
 * Records what a job's older documents were made from (see madeFromCurrent), going by their date
 * while it still tells: once anything else about the job is saved, its date moves on. Undefined
 * when there's nothing to record.
 */
export function stampMadeFrom(docs: TailoredDocs, candidate: Candidate): Partial<TailoredDocs> | undefined {
  const parts = (["analysis", "cv", "coverLetter"] as const).filter((part) => docs[part] && !docs[`${part}From`]);
  if (!parts.length) return undefined;
  return Object.fromEntries(parts.map((part) => [`${part}From`, madeFromCurrent(docs, part, candidate) ? candidate.key : "earlier"]));
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

/**
 * Jobs in one batch of matches sent from a phone (lib/match-batches.ts): with descriptions of up to
 * 40,000 characters, the request stays well inside what the server takes in one go.
 */
export const MATCH_BATCH_SIZE = 25;

export function canMatch(job: Job): boolean {
  return hasFullDescription(job.description);
}

/** Identifies the CV and description a match score was made from, to tell when it's out of date. */
export function matchKey(job: Job, candidate: Candidate): string {
  return `${candidate.key}:${descriptionHash(job)}`;
}

// Lists look up every job's score on each change, and a description can run to 40,000 characters:
// each one's hash is worked out once per job (a job whose description changes is a new object).
const descriptionHashes = new WeakMap<Job, { description: string; hash: string }>();

function descriptionHash(job: Job): string {
  const known = descriptionHashes.get(job);
  if (known && known.description === job.description) return known.hash;
  const hash = hashString(job.description);
  descriptionHashes.set(job, { description: job.description, hash });
  return hash;
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
