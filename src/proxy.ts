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
  if (!authEnabled(env)) return NextResponse.next();

  const { pathname, search } = request.nextUrl;
  // The sign-in page and the routes it uses.
  if (pathname === "/login" || pathname.startsWith("/api/auth/")) return NextResponse.next();

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

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
