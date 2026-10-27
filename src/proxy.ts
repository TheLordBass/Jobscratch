import { NextResponse, type NextRequest } from "next/server";
import { SESSION_COOKIE, authEnabled, checkBasicAuth, verifySession } from "@/lib/auth";

/**
 * Optional sign-in for deployed copies. When APP_PASSWORD is set, every page
 * and API route needs you to be signed in (see lib/auth.ts), so strangers who
 * find the URL can't see your CV or spend your Anthropic or job-API credits.
 * Leave it unset locally.
 */
export function proxy(request: NextRequest) {
  const env = process.env;
  const { pathname, search } = request.nextUrl;

  // Another website can't make your browser change data or spend credits here, signed in
  // (a remembered Basic Auth password is sent automatically) or not (a local dev server).
  if (pathname.startsWith("/api/") && !SAFE_METHODS.has(request.method) && !sameSite(request)) {
    return Response.json({ error: "Requests from other websites aren't allowed." }, { status: 403 });
  }

  if (!authEnabled(env)) return NextResponse.next();

  // The sign-in page and the routes it uses.
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();
  // What a phone needs to add JobScratch to its home screen and show notifications. Browsers fetch the
  // manifest without cookies, and none of these hold anything personal.
  if (pathname === "/sw.js" || pathname === "/manifest.webmanifest" || pathname.startsWith("/icons/")) return NextResponse.next();
  // The scheduled JobSpy run on your computer: these routes check its own token instead (lib/helper-request.ts).
  if (pathname.startsWith("/api/helper/")) return NextResponse.next();

  if (verifySession(env, request.cookies.get(SESSION_COOKIE)?.value) || checkBasicAuth(env, request.headers.get("authorization"))) {
    return NextResponse.next();
  }

  if (pathname.startsWith("/api/")) {
    return Response.json({ error: "Sign in to use JobScratch." }, { status: 401 });
  }
  // The browser keeps any #fragment across the redirect, so a job sent by the
  // bookmarklet (/import#job=…) survives signing in.
  const login = new URL("/login", request.url);
  if (pathname !== "/") login.searchParams.set("next", `${pathname}${search}`);
  return NextResponse.redirect(login);
}

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Whether a request comes from this site. Browsers send Origin with every cross-site POST,
 * so a request without one comes from a script or tool rather than another web page.
 */
function sameSite(request: NextRequest): boolean {
  const origin = request.headers.get("origin");
  if (origin === null) return request.headers.get("sec-fetch-site") !== "cross-site";
  let host: string;
  try {
    host = new URL(origin).host;
  } catch {
    return false;
  }
  // The site's own address, however the host passed it on.
  const own = [request.nextUrl.host, request.headers.get("host"), request.headers.get("x-forwarded-host")?.split(",")[0].trim()];
  return own.includes(host);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
