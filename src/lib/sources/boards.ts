import type { CompanyBoards, Job } from "@/lib/types";
import type { SearchContext } from "./types";

export const MAX_BOARDS_PER_PROVIDER = 25;

/**
 * Accepts either a bare board token ("stripe") or a careers URL
 * ("https://boards.greenhouse.io/stripe", "https://jobs.lever.co/plaid/…",
 * "https://jobs.ashbyhq.com/ramp") and returns the token.
 */
export function parseBoardToken(provider: keyof CompanyBoards, input: string): string | undefined {
  const value = input.trim();
  if (!value) return undefined;
  if (!/^https?:\/\//i.test(value)) {
    return /^[a-z0-9][a-z0-9._-]*$/i.test(value) ? value.toLowerCase() : undefined;
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return undefined;
  }
  const segments = url.pathname.split("/").filter(Boolean);
  const host = url.hostname.toLowerCase();
  if (provider === "greenhouse") {
    const fromQuery = url.searchParams.get("for");
    if (fromQuery) return fromQuery.toLowerCase();
    if (host.endsWith("greenhouse.io")) {
      const boardsIndex = segments.indexOf("boards");
      const token = boardsIndex >= 0 ? segments[boardsIndex + 1] : segments[0];
      return token?.toLowerCase();
    }
  }
  if (provider === "lever" && host.endsWith("lever.co")) return segments[0]?.toLowerCase();
  if (provider === "ashby" && host.endsWith("ashbyhq.com")) {
    const boardIndex = segments.indexOf("job-board");
    return (boardIndex >= 0 ? segments[boardIndex + 1] : segments[0])?.toLowerCase();
  }
  return undefined;
}

/** Fetch every configured board for a provider; one bad board doesn't sink the rest. */
export async function perBoard(
  ctx: SearchContext,
  provider: keyof CompanyBoards,
  fn: (token: string) => Promise<Job[]>,
): Promise<Job[]> {
  const tokens = [
    ...new Set(
      ctx.companyBoards[provider]
        .map((entry) => parseBoardToken(provider, entry))
        .filter((token): token is string => Boolean(token)),
    ),
  ].slice(0, MAX_BOARDS_PER_PROVIDER);
  const settled = await Promise.allSettled(tokens.map(fn));
  const jobs = settled.flatMap((result) => (result.status === "fulfilled" ? result.value : []));
  const failures = settled
    .map((result, i) => (result.status === "rejected" ? `${tokens[i]}: ${(result.reason as Error).message}` : null))
    .filter(Boolean);
  if (jobs.length === 0 && failures.length > 0) throw new Error(failures.join("; "));
  return jobs;
}

export function boardsAvailability(ctx: SearchContext, provider: keyof CompanyBoards) {
  return ctx.companyBoards[provider].some((entry) => parseBoardToken(provider, entry))
    ? ({ ok: true } as const)
    : ({ ok: false, reason: "No companies added — add some in Settings" } as const);
}
