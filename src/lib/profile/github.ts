import { readCapped } from "@/lib/safe-fetch";
import { removeComments, tidyText, truncate } from "@/lib/text";
import { ProfileError } from "./errors";
import { parseGithubUsername } from "./links";

export { parseGithubUsername } from "./links";

const API = "https://api.github.com";
const MAX_REPOS_LISTED = 12;
const MAX_READMES = 4;
const README_EXCERPT = 900;
/** Only the start of a README is used, so don't read (or process) more than this. */
const README_BYTES = 100_000;
/** GitHub lists 100 repositories per page. */
const MAX_REPO_PAGES = 5;

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
  // Bounded patterns throughout, so a hostile README can't make this slow.
  const text = removeComments(removeCodeBlocks(markdown))
    // Only real tags: the "< 50ms … >" in "latency < 50ms, Python >= 3.10" isn't one.
    .replace(/<\/?[a-z][^<>]{0,2000}>/gi, " ")
    .replace(/!\[[^\]\n]{0,500}\]\([^)\n]{0,2000}\)/g, " ")
    .replace(/\[([^\]\n]{0,500})\]\([^)\n]{0,2000}\)/g, "$1")
    .replace(/^[ \t]*#+[ \t]*/gm, "")
    .replace(/^[ \t]*>[ \t]?/gm, "")
    .replace(/^[ \t]*[-*+][ \t]+/gm, "• ")
    // Inline code is kept as written; emphasis markers go everywhere else.
    .split(/(`[^`\n]{0,500}`)/)
    .map((part, i) => (i % 2 ? part.slice(1, -1) : removeEmphasis(part)))
    .join("");
  return truncate(tidyText(text).replace(/\n{2,}/g, "\n"), README_EXCERPT);
}

/** Drop fenced code blocks (an unclosed fence runs to the end). */
function removeCodeBlocks(markdown: string): string {
  let inFence = false;
  return markdown
    .split("\n")
    .filter((line) => {
      if (/^[ \t]*(```|~~~)/.test(line)) {
        inFence = !inFence;
        return false;
      }
      return !inFence;
    })
    .join("\n");
}

/** Remove **bold** / _italic_ markers, but not the underscores in names like great_expectations. */
function removeEmphasis(text: string): string {
  return text.replace(/(?<![\w*])(\*{1,3}|_{1,3})(?=\S)|(?<=\S)(\*{1,3}|_{1,3})(?![\w*])/g, "").replace(/`/g, "");
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

  const pageCount = Math.min(MAX_REPO_PAGES, Math.max(1, Math.ceil((user.public_repos ?? 0) / 100)));
  const repoPages = await Promise.all(
    Array.from({ length: pageCount }, async (_, i) => {
      const response = await githubFetch(
        `/users/${user.login}/repos?per_page=100&sort=pushed&type=owner&page=${i + 1}`,
        options,
      );
      if (!response.ok) throw new ProfileError(`GitHub returned HTTP ${response.status} for the repository list.`);
      return (await response.json()) as GithubRepo[];
    }),
  );
  const own = rankRepos(repoPages.flat());
  const checkedAll = (user.public_repos ?? 0) <= pageCount * 100;
  const listed = own.slice(0, MAX_REPOS_LISTED);

  const readmes = await Promise.all(
    listed.slice(0, MAX_READMES).map(async (repo) => {
      try {
        const response = await githubFetch(`/repos/${repo.full_name}/readme`, options, "application/vnd.github.raw+json");
        return response.ok ? readmeExcerpt(await readCapped(response, README_BYTES)) : "";
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
    `Own public repositories: ${own.length}${checkedAll ? "" : ` (among the ${pageCount * 100} most recently updated)`}`,
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
