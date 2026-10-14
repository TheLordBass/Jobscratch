import { hashString } from "@/lib/import";
import { MAX_EVIDENCE_CHARS, MAX_GITHUB_LENGTH, MAX_WEBSITE_LENGTH, linksChanged } from "@/lib/profile/links";
import type { StoredCv, StoredProfile } from "@/lib/store";
import type { Job } from "@/lib/types";

/** What the tailoring and matching requests send about the candidate. */
export interface Candidate {
  cv: string;
  profile?: { website: string; github: string; evidence: string };
  /** Details fetched for links that have since changed, so they're left out. */
  staleDetails: boolean;
  /** Changes whenever what Claude is told about the candidate changes. */
  key: string;
}

export function candidateFor(cv: StoredCv | null, profile: StoredProfile): Candidate {
  // A link too long for the API is left out rather than failing every request.
  const website = profile.website.trim().length <= MAX_WEBSITE_LENGTH ? profile.website.trim() : "";
  const github = profile.github.trim().length <= MAX_GITHUB_LENGTH ? profile.github.trim() : "";
  // Details fetched for links that have since changed would describe the wrong site or account.
  const staleDetails = Boolean(profile.evidence.trim()) && linksChanged(profile, profile.fetchedFor);
  const evidence = staleDetails ? "" : profile.evidence.trim().slice(0, MAX_EVIDENCE_CHARS);
  const payload = profile.enabled && (website || github || evidence) ? { website, github, evidence } : undefined;
  const text = cv?.text ?? "";
  return { cv: text, profile: payload, staleDetails, key: hashString(JSON.stringify([text, payload ?? null])) };
}

/** Jobs need at least this much description to be matched. */
export const MIN_MATCH_DESCRIPTION = 80;

export function canMatch(job: Job): boolean {
  return job.description.trim().length >= MIN_MATCH_DESCRIPTION;
}

/** Identifies the CV and description a match score was made from, to tell when it's out of date. */
export function matchKey(job: Job, candidate: Candidate): string {
  return `${candidate.key}:${hashString(job.description)}`;
}
