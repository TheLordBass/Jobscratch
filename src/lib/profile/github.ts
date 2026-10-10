import { tidyText, truncate } from "@/lib/text";
import { ProfileError } from "./errors";

const API = "https://api.github.com";
const USERNAME = /^[a-z\d](?:[a-z\d]|-(?=[a-z\d])){0,38}$/i;
const MAX_REPOS_LISTED = 12;
const MAX_READMES = 4;
const README_EXCERPT = 900;

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

interface GithubUser {
  login: string;
  name?: string | null;
  bio?: string | null;
  company?: string | null;
  blog?: string | null;
  location?: string | null;
  public_repos?: number;
  followers?: number;
  html_url: string;
}

interface GithubRepo {
  name: string;
  full_name: string;
  html_url: string;
  description?: string | null;
  fork?: boolean;
  archived?: boolean;
  language?: string | null;
  topics?: string[];
  stargazers_count?: number;
  homepage?: string | null;
  pushed_at?: string | null;
}

export interface GithubProfile {
  username: string;
  url: string;
  repoCount: number;
  text: string;
}

interface Options {
  token?: string;
  signal?: AbortSignal;
}

function headers(token: string | undefined, accept = "application/vnd.github+json"): HeadersInit {
  return {
    Accept: accept,
    "User-Agent": "JobScratch",
    "X-GitHub-Api-Version": "2022-11-28",
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
  };
}

async function githubFetch(path: string, options: Options, accept?: string): Promise<Response> {
  let response: Response;
  try {
    response = await fetch(`${API}${path}`, { headers: headers(options.token, accept), signal: options.signal });
  } catch (error) {
    throw new ProfileError(`Couldn't reach GitHub: ${(error as Error).message}`);
  }
  if ((response.status === 403 || response.status === 429) && response.headers.get("x-ratelimit-remaining") === "0") {
    throw new ProfileError(
      options.token
        ? "GitHub's rate limit was reached. Try again later."
        : "GitHub's limit for anonymous requests was reached. Try again in an hour, or add a GITHUB_TOKEN to raise the limit.",
    );
  }
  return response;
}

/** Turn a README into a short plain-text excerpt: no code, images, badges or HTML. */
export function readmeExcerpt(markdown: string): string {
  const text = markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/^\s*#+\s*/gm, "")
    .replace(/^\s*[-*+]\s+/gm, "• ")
    .replace(/[*_`>]/g, "");
  return truncate(tidyText(text).replace(/\n{2,}/g, "\n"), README_EXCERPT);
}

function rankRepos(repos: GithubRepo[]): GithubRepo[] {
  return repos
    .filter((repo) => !repo.fork)
    .sort(
      (a, b) =>
        (b.stargazers_count ?? 0) - (a.stargazers_count ?? 0) ||
        (b.pushed_at ?? "").localeCompare(a.pushed_at ?? ""),
    );
}

function languageSummary(repos: GithubRepo[]): string {
  const counts = new Map<string, number>();
  for (const repo of repos) if (repo.language) counts.set(repo.language, (counts.get(repo.language) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 8)
    .map(([language, count]) => `${language} (${count} ${count === 1 ? "repo" : "repos"})`)
    .join(", ");
}

/** Read a user's public GitHub profile and summarise their own repositories as plain text. */
export async function fetchGithubProfile(input: string, options: Options = {}): Promise<GithubProfile> {
  const username = parseGithubUsername(input);
  if (!username) throw new ProfileError("That doesn't look like a GitHub username or profile link.");

  const userResponse = await githubFetch(`/users/${username}`, options);
  if (userResponse.status === 404) throw new ProfileError(`There's no GitHub user called “${username}”.`);
  if (!userResponse.ok) throw new ProfileError(`GitHub returned HTTP ${userResponse.status}.`);
  const user = (await userResponse.json()) as GithubUser;

  const reposResponse = await githubFetch(`/users/${user.login}/repos?per_page=100&sort=pushed&type=owner`, options);
  if (!reposResponse.ok) throw new ProfileError(`GitHub returned HTTP ${reposResponse.status} for the repository list.`);
  const own = rankRepos((await reposResponse.json()) as GithubRepo[]);
  const listed = own.slice(0, MAX_REPOS_LISTED);

  const readmes = await Promise.all(
    listed.slice(0, MAX_READMES).map(async (repo) => {
      try {
        const response = await githubFetch(`/repos/${repo.full_name}/readme`, options, "application/vnd.github.raw+json");
        return response.ok ? readmeExcerpt(await response.text()) : "";
      } catch {
        return "";
      }
    }),
  );

  const lines = [
    `GitHub profile: ${user.html_url}`,
    ...[
      user.name && `Name: ${user.name}`,
      user.bio && `Bio: ${user.bio}`,
      user.company && `Company: ${user.company}`,
      user.location && `Location: ${user.location}`,
      user.blog && `Website: ${user.blog}`,
    ].filter(Boolean),
    `Own public repositories: ${own.length}`,
  ];
  const languages = languageSummary(own);
  if (languages) lines.push(`Main languages: ${languages}`);

  if (listed.length) {
    lines.push("", "Repositories (most starred, then most recently updated):");
    listed.forEach((repo, i) => {
      const details = [
        repo.language && `Language: ${repo.language}`,
        repo.topics?.length && `Topics: ${repo.topics.join(", ")}`,
        repo.stargazers_count ? `${repo.stargazers_count} stars` : "",
        repo.pushed_at && `Last updated ${repo.pushed_at.slice(0, 7)}`,
        repo.archived && "Archived",
      ].filter(Boolean);
      lines.push(
        `- ${repo.name}${repo.description ? `: ${repo.description}` : ""}`,
        `  ${[...details, repo.html_url, repo.homepage && `Live: ${repo.homepage}`].filter(Boolean).join(" · ")}`,
      );
      if (readmes[i]) lines.push(`  README: ${readmes[i].replace(/\n/g, " ")}`);
    });
  }

  return { username: user.login, url: user.html_url, repoCount: own.length, text: lines.join("\n") };
}
