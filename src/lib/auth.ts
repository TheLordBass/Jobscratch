import { createHmac, timingSafeEqual } from "node:crypto";

export { safeNext } from "@/lib/safe-next";

/*
 * Sign-in for one person. When APP_PASSWORD is set, every page and API route
 * needs a session cookie, which /login hands out for APP_USERNAME and
 * APP_PASSWORD. The cookie is signed with a key derived from the password, so
 * changing the password signs every device out.
 */

type Env = Record<string, string | undefined>;

export const SESSION_COOKIE = "jobscratch_session";
/** "Remember this device". */
export const REMEMBER_SECONDS = 30 * 24 * 60 * 60;
/** Otherwise the session ends with the browser, and after 12 hours at most. */
export const SHORT_SESSION_SECONDS = 12 * 60 * 60;

export function authEnabled(env: Env): boolean {
  return Boolean(env.APP_PASSWORD);
}

export function accountName(env: Env): string {
  return env.APP_USERNAME?.trim() || "jobscratch";
}

function signingKey(env: Env): string {
  return `${env.AUTH_SECRET ?? ""}\u0000${env.APP_PASSWORD ?? ""}\u0000jobscratch-session-v1`;
}

function sign(env: Env, payload: string): string {
  return createHmac("sha256", signingKey(env)).update(payload).digest("base64url");
}

/** Compare without returning early, so response time doesn't reveal how much matched. */
export function safeEqual(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  // timingSafeEqual needs equal lengths; compare against itself so the time doesn't depend on the input.
  return left.length === right.length ? timingSafeEqual(left, right) : !timingSafeEqual(left, left);
}

export function checkCredentials(env: Env, username: string, password: string): boolean {
  if (!authEnabled(env)) return false;
  // Both are checked every time, so the time taken doesn't say which was wrong.
  const nameOk = safeEqual(username.trim().toLowerCase(), accountName(env).toLowerCase());
  const passwordOk = safeEqual(password, env.APP_PASSWORD!);
  return nameOk && passwordOk;
}

export function createSession(env: Env, remember: boolean, now = Date.now()): { token: string; maxAge?: number } {
  const seconds = remember ? REMEMBER_SECONDS : SHORT_SESSION_SECONDS;
  const payload = Buffer.from(JSON.stringify({ u: accountName(env), exp: now + seconds * 1000 })).toString("base64url");
  return { token: `${payload}.${sign(env, payload)}`, maxAge: remember ? seconds : undefined };
}

export function verifySession(env: Env, token: string | undefined, now = Date.now()): boolean {
  if (!token || !authEnabled(env)) return false;
  const [payload, signature, extra] = token.split(".");
  if (!payload || !signature || extra !== undefined || !safeEqual(signature, sign(env, payload))) return false;
  try {
    const { u, exp } = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as { u?: string; exp?: number };
    return u === accountName(env) && typeof exp === "number" && exp > now;
  } catch {
    return false;
  }
}

/** HTTP Basic Auth still works, for scripts and tools that can't sign in with a form. */
export function checkBasicAuth(env: Env, header: string | null): boolean {
  const [scheme, encoded] = (header ?? "").split(" ");
  if (scheme !== "Basic" || !encoded) return false;
  try {
    const decoded = Buffer.from(encoded, "base64").toString("utf8");
    const split = decoded.indexOf(":");
    return split >= 0 && checkCredentials(env, decoded.slice(0, split), decoded.slice(split + 1));
  } catch {
    return false;
  }
}


const MAX_ATTEMPTS = 10;
const WINDOW_MS = 15 * 60 * 1000;
const attempts = new Map<string, { count: number; resetAt: number }>();

/**
 * Wrong passwords per address, to slow down guessing. Kept per server
 * instance, which is enough to make guessing impractical for a personal site.
 */
export function tooManyAttempts(address: string, now = Date.now()): boolean {
  const entry = attempts.get(address);
  return Boolean(entry && entry.resetAt > now && entry.count >= MAX_ATTEMPTS);
}

export function recordFailedAttempt(address: string, now = Date.now()) {
  const entry = attempts.get(address);
  if (!entry || entry.resetAt <= now) attempts.set(address, { count: 1, resetAt: now + WINDOW_MS });
  else entry.count++;
  if (attempts.size > 1000) {
    for (const [key, value] of attempts) if (value.resetAt <= now) attempts.delete(key);
  }
}

export function clearAttempts(address: string) {
  attempts.delete(address);
}
