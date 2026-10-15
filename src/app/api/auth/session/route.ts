import type { NextRequest } from "next/server";
import { SESSION_COOKIE, accountName, authEnabled, verifySession } from "@/lib/auth";

/** GET /api/auth/session → whether sign-in is on, and whether this browser is signed in. */
export async function GET(request: NextRequest) {
  // Read the cookie first, even when sign-in is off: reading the request is what makes Next.js
  // answer this per request instead of building it once, and the answer can change after a build.
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  const env = process.env;
  if (!authEnabled(env)) return Response.json({ enabled: false });
  const signedIn = verifySession(env, token);
  return Response.json({ enabled: true, signedIn, username: signedIn ? accountName(env) : undefined });
}
