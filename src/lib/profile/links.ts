/*
 * Shared by the browser and the server, so it mustn't import anything server-only.
 */

const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;

/** Accepts "octocat", "@octocat", "github.com/octocat" or "https://github.com/octocat/repo". */
export function parseGithubUsername(input: string): string | undefined {
  let value = input.trim().replace(/^@/, "");
  if (!value) return undefined;
  if (/github\.com/i.test(value)) {
    try {
      const url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
      if (!/(^|\.)github\.com$/i.test(url.hostname)) return undefined;
      value = url.pathname.split("/").filter(Boolean)[0] ?? "";
    } catch {
      return undefined;
    }
  }
  return USERNAME.test(value) ? value : undefined;
}

/** The longest website link, GitHub link and fetched text the tailoring requests accept. */
export const MAX_WEBSITE_LENGTH = 500;
export const MAX_GITHUB_LENGTH = 200;
export const MAX_EVIDENCE_CHARS = 24_000;

export type ProfileSource = "website" | "github";
export const PROFILE_SOURCES: ProfileSource[] = ["website", "github"];

export interface ProfileLinkValues {
  website: string;
  github: string;
}

/** A comparable form of a link, so "https://www.jane.dev/" and "jane.dev" count as the same. */
function linkKey(source: ProfileSource, link: string): string {
  const value = link.trim();
  if (source === "github") return (parseGithubUsername(value) ?? value).toLowerCase();
  return value
    .toLowerCase()
    .replace(/^https?:\/\//, "")
    .replace(/^www\./, "")
    .replace(/\/+$/, "");
}

export function sameLink(source: ProfileSource, a: string, b: string): boolean {
  return linkKey(source, a) === linkKey(source, b);
}

/** Whether the fetched details were read from other links than the ones entered now. */
export function linksChanged(current: ProfileLinkValues, fetchedFor: ProfileLinkValues | undefined): boolean {
  // Details fetched before the links were recorded can't be checked.
  if (!fetchedFor) return false;
  return PROFILE_SOURCES.some((source) => !sameLink(source, current[source], fetchedFor[source]));
}

const HEADING: Record<ProfileSource, string> = { website: "## Website (", github: "## GitHub (" };

/** The "## Website (…)" and "## GitHub (…)" sections of fetched evidence. */
export function evidenceSections(evidence: string): Partial<Record<ProfileSource, string>> {
  const sections: Partial<Record<ProfileSource, string>> = {};
  for (const part of evidence.split(/\n(?=## (?:Website|GitHub) \()/)) {
    const text = part.trim();
    const source = PROFILE_SOURCES.find((s) => text.startsWith(HEADING[s]));
    if (source) sections[source] = text;
  }
  return sections;
}

/**
 * The evidence after a fetch: each source's new text or, when a source failed
 * this time (e.g. GitHub's hourly limit) and its link hasn't changed, the text
 * it had before, including any edits.
 */
export function mergeEvidence(
  previous: { evidence: string; fetchedFor?: ProfileLinkValues },
  requested: ProfileLinkValues,
  fetched: Partial<Record<ProfileSource, string>>,
): string {
  const old = evidenceSections(previous.evidence);
  return PROFILE_SOURCES.map((source) => {
    if (!requested[source].trim()) return undefined;
    if (fetched[source]) return fetched[source];
    const unchanged = previous.fetchedFor !== undefined && sameLink(source, requested[source], previous.fetchedFor[source]);
    return unchanged ? old[source] : undefined;
  })
    .filter(Boolean)
    .join("\n\n");
}
