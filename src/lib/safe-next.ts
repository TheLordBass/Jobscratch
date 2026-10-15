/** A path inside this site to go to after signing in ("/import?x=1"), or "/" for anything else. */
export function safeNext(next: string | null | undefined): string {
  return next && next.startsWith("/") && !next.startsWith("//") && !next.startsWith("/\\") ? next : "/";
}
