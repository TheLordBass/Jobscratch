const BASE = "https://jobscratch.invalid";

/** A path inside this site to go to after signing in ("/import?x=1"), or "/" for anything else. */
export function safeNext(next: string | null | undefined): string {
  if (!next?.startsWith("/")) return "/";
  // Resolve it the way the browser will: it drops tabs and newlines and reads "\" as "/", so
  // "/\t/evil.example" or "/\\evil.example" would otherwise lead off the site.
  try {
    const url = new URL(next, BASE);
    return url.origin === BASE ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}
