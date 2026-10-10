import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional password gate for deployed copies. When APP_PASSWORD is set, every
 * page and API route asks for it (HTTP Basic Auth), so strangers who find the
 * URL can't spend your Anthropic or job-API credits. Leave it unset locally.
 */
export function proxy(request: NextRequest) {
  const password = process.env.APP_PASSWORD;
  if (!password) return NextResponse.next();

  const username = process.env.APP_USERNAME || "jobscratch";
  const [scheme, encoded] = (request.headers.get("authorization") ?? "").split(" ");
  if (scheme === "Basic" && encoded) {
    try {
      const decoded = atob(encoded);
      const split = decoded.indexOf(":");
      if (split >= 0 && safeEqual(decoded.slice(0, split), username) && safeEqual(decoded.slice(split + 1), password)) {
        return NextResponse.next();
      }
    } catch {
      // Malformed header: fall through to the challenge.
    }
  }
  return new NextResponse("Sign in to use JobScratch.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="JobScratch", charset="UTF-8"' },
  });
}

/** Compare without returning early, so response time doesn't reveal how much matched. */
function safeEqual(a: string, b: string): boolean {
  let diff = a.length ^ b.length;
  for (let i = 0; i < Math.max(a.length, b.length); i++) diff |= (a.charCodeAt(i) || 0) ^ (b.charCodeAt(i) || 0);
  return diff === 0;
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
