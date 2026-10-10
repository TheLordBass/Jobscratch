import { truncate } from "@/lib/text";
import { ProfileError } from "./errors";
import { fetchGithubProfile } from "./github";
import { MAX_EVIDENCE_CHARS, type ProfileSource } from "./links";
import { fetchWebsiteProfile } from "./website";

export { ProfileError } from "./errors";
export { parseGithubUsername } from "./links";

/** Each source gets half of what Claude is sent, so together (with the "…" truncate adds) they always fit. */
const SECTION_CHARS = Math.floor(MAX_EVIDENCE_CHARS / 2) - 2;

export interface ProfileSourceResult {
  ok: boolean;
  /** What was read, e.g. "3 pages" or "14 public repositories". */
  summary?: string;
  error?: string;
}

export interface ProfileResponse {
  website?: ProfileSourceResult;
  github?: ProfileSourceResult;
  /** Each source's text, for the ones that were read this time. */
  sections: Partial<Record<ProfileSource, string>>;
  /** Plain text Claude will see; the user can review and edit it. */
  evidence: string;
}
function message(error: unknown): string {
  return error instanceof ProfileError ? error.message : "Something went wrong reading this.";
}

/** Read the candidate's website and GitHub (whichever are given) and combine them as evidence. */
export async function buildProfile(
  input: { website?: string; github?: string },
  env: Record<string, string | undefined>,
): Promise<ProfileResponse> {
  const website = input.website?.trim();
  const github = input.github?.trim();
  const [site, gh] = await Promise.allSettled([
    website ? fetchWebsiteProfile(website) : Promise.resolve(undefined),
    github
      ? fetchGithubProfile(github, { token: env.GITHUB_TOKEN?.trim() || undefined, signal: AbortSignal.timeout(20_000) })
      : Promise.resolve(undefined),
  ]);

  const response: ProfileResponse = { sections: {}, evidence: "" };
  if (website) {
    if (site.status === "fulfilled" && site.value) {
      const count = site.value.pages.length;
      response.website = { ok: true, summary: `${count} ${count === 1 ? "page" : "pages"} read` };
      response.sections.website = truncate(`## Website (${site.value.url})\n${site.value.text}`, SECTION_CHARS);
    } else {
      response.website = { ok: false, error: message(site.status === "rejected" ? site.reason : undefined) };
    }
  }
  if (github) {
    if (gh.status === "fulfilled" && gh.value) {
      const count = gh.value.repoCount;
      response.github = { ok: true, summary: `${count} public ${count === 1 ? "repository" : "repositories"} found` };
      response.sections.github = truncate(`## GitHub (${gh.value.url})\n${gh.value.text}`, SECTION_CHARS);
    } else {
      response.github = { ok: false, error: message(gh.status === "rejected" ? gh.reason : undefined) };
    }
  }
  response.evidence = [response.sections.website, response.sections.github].filter(Boolean).join("\n\n");
  return response;
}
