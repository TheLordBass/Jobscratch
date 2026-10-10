import { ProfileError } from "./errors";
import { fetchGithubProfile } from "./github";
import { fetchWebsiteProfile } from "./website";

export { ProfileError } from "./errors";
export { parseGithubUsername } from "./github";

export interface ProfileSourceResult {
  ok: boolean;
  /** What was read, e.g. "3 pages" or "14 public repositories". */
  summary?: string;
  error?: string;
}

export interface ProfileResponse {
  website?: ProfileSourceResult;
  github?: ProfileSourceResult;
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

  const response: ProfileResponse = { evidence: "" };
  const sections: string[] = [];
  if (website) {
    if (site.status === "fulfilled" && site.value) {
      const count = site.value.pages.length;
      response.website = { ok: true, summary: `${count} ${count === 1 ? "page" : "pages"} read` };
      sections.push(`## Website (${site.value.url})\n${site.value.text}`);
    } else {
      response.website = { ok: false, error: message(site.status === "rejected" ? site.reason : undefined) };
    }
  }
  if (github) {
    if (gh.status === "fulfilled" && gh.value) {
      const count = gh.value.repoCount;
      response.github = { ok: true, summary: `${count} public ${count === 1 ? "repository" : "repositories"} found` };
      sections.push(`## GitHub (${gh.value.url})\n${gh.value.text}`);
    } else {
      response.github = { ok: false, error: message(gh.status === "rejected" ? gh.reason : undefined) };
    }
  }
  response.evidence = sections.join("\n\n");
  return response;
}
