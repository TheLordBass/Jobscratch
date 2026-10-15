import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import {
  SESSION_COOKIE,
  authEnabled,
  checkCredentials,
  clearAttempts,
  createSession,
  recordFailedAttempt,
  tooManyAttempts,
} from "@/lib/auth";

const Body = z.object({
  username: z.string().max(200),
  password: z.string().max(500),
  remember: z.boolean().default(false),
});

/** The visitor's address, as Vercel reports it. */
function address(request: NextRequest): string {
  return request.headers.get("x-forwarded-for")?.split(",")[0].trim() || request.headers.get("x-real-ip") || "local";
}

/** POST /api/auth/login { username, password, remember } → sets the session cookie. */
export async function POST(request: NextRequest) {
  const env = process.env;
  if (!authEnabled(env)) return NextResponse.json({ ok: true });

  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your username and password." }, { status: 400 });

  const from = address(request);
  if (tooManyAttempts(from)) {
    return NextResponse.json({ error: "Too many wrong passwords. Wait 15 minutes and try again." }, { status: 429 });
  }
  const { username, password, remember } = parsed.data;
  if (!checkCredentials(env, username, password)) {
    recordFailedAttempt(from);
    // A short pause makes guessing slower still.
    await new Promise((resolve) => setTimeout(resolve, 400));
    return NextResponse.json({ error: "That username or password isn’t right." }, { status: 401 });
  }

  clearAttempts(from);
  const { token, maxAge } = createSession(env, remember);
  const response = NextResponse.json({ ok: true });
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: request.nextUrl.protocol === "https:",
    path: "/",
    // Without a max age the cookie ends with the browser; the session itself also expires (see lib/auth.ts).
    ...(maxAge ? { maxAge } : {}),
  });
  return response;
}
