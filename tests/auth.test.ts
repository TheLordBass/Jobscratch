import { NextRequest } from "next/server";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { GET as session } from "@/app/api/auth/session/route";
import {
  REMEMBER_SECONDS,
  SESSION_COOKIE,
  checkBasicAuth,
  checkCredentials,
  createSession,
  safeNext,
  verifySession,
} from "@/lib/auth";
import { proxy } from "@/proxy";

const ENV = { APP_USERNAME: "alex@example.com", APP_PASSWORD: "correct horse battery" };
const original = { ...process.env };

beforeEach(() => {
  process.env.APP_USERNAME = ENV.APP_USERNAME;
  process.env.APP_PASSWORD = ENV.APP_PASSWORD;
});
afterEach(() => {
  process.env = { ...original };
});

const basic = (user: string, password: string) => `Basic ${Buffer.from(`${user}:${password}`).toString("base64")}`;

describe("sessions", () => {
  it("accepts a fresh session and rejects tampered, expired or old-password ones", () => {
    const now = Date.UTC(2026, 9, 15);
    const { token, maxAge } = createSession(ENV, true, now);
    expect(maxAge).toBe(REMEMBER_SECONDS);
    expect(verifySession(ENV, token, now + 1000)).toBe(true);
    expect(verifySession(ENV, token, now + REMEMBER_SECONDS * 1000 + 1)).toBe(false);
    expect(verifySession(ENV, `${token}x`, now)).toBe(false);
    expect(verifySession(ENV, token.replace(/^[^.]+/, Buffer.from('{"u":"alex@example.com","exp":9e15}').toString("base64url")), now)).toBe(false);
    expect(verifySession({ ...ENV, APP_PASSWORD: "changed" }, token, now)).toBe(false);
    expect(verifySession(ENV, undefined, now)).toBe(false);

    const short = createSession(ENV, false, now);
    expect(short.maxAge).toBeUndefined();
    expect(verifySession(ENV, short.token, now + 13 * 60 * 60 * 1000)).toBe(false);
  });

  it("checks the username case-insensitively and the password exactly", () => {
    expect(checkCredentials(ENV, " Alex@Example.com ", "correct horse battery")).toBe(true);
    expect(checkCredentials(ENV, "alex@example.com", "Correct horse battery")).toBe(false);
    expect(checkCredentials(ENV, "someone", "correct horse battery")).toBe(false);
    expect(checkCredentials({}, "jobscratch", "")).toBe(false);
    expect(checkBasicAuth(ENV, basic("alex@example.com", "correct horse battery"))).toBe(true);
    expect(checkBasicAuth(ENV, basic("alex@example.com", "wrong"))).toBe(false);
  });

  it("only redirects within the site after signing in", () => {
    expect(safeNext("/import?x=1")).toBe("/import?x=1");
    expect(safeNext("//evil.example")).toBe("/");
    expect(safeNext("https://evil.example")).toBe("/");
    expect(safeNext(null)).toBe("/");
    // Browsers drop tabs and newlines and read "\" as "/", which would make these lead off the site.
    expect(safeNext("/\t/evil.example")).toBe("/");
    expect(safeNext("/\n/evil.example/x")).toBe("/");
    expect(safeNext("/\\evil.example")).toBe("/");
    expect(safeNext("/saved#job-1")).toBe("/saved#job-1");
  });
});

describe("proxy", () => {
  const request = (path: string, headers: Record<string, string> = {}) =>
    new NextRequest(new URL(path, "https://jobs.example"), { headers });

  it("sends signed-out visitors to the sign-in page, keeping where they were going", () => {
    const page = proxy(request("/saved?x=1"));
    expect(page.status).toBe(307);
    expect(page.headers.get("location")).toBe("https://jobs.example/login?next=%2Fsaved%3Fx%3D1");
    expect(proxy(request("/")).headers.get("location")).toBe("https://jobs.example/login");
  });

  it("answers signed-out API calls with 401 and lets sign-in itself through", async () => {
    const api = proxy(request("/api/data"));
    expect(api.status).toBe(401);
    expect(await api.json()).toEqual({ error: "Sign in to use JobScratch." });
    expect(proxy(request("/login")).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/auth/login")).headers.get("x-middleware-next")).toBe("1");
  });

  it("lets a signed-in browser or a correct Basic header through", () => {
    const { token } = createSession(ENV, true);
    expect(proxy(request("/saved", { cookie: `${SESSION_COOKIE}=${token}` })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/api/data", { authorization: basic(ENV.APP_USERNAME, ENV.APP_PASSWORD) })).headers.get("x-middleware-next")).toBe("1");
    expect(proxy(request("/saved", { cookie: `${SESSION_COOKIE}=forged.token` })).status).toBe(307);
  });

  it("does nothing when no password is set", () => {
    delete process.env.APP_PASSWORD;
    expect(proxy(request("/saved")).headers.get("x-middleware-next")).toBe("1");
  });

  it("refuses API changes sent from another website, signed in or not", async () => {
    const post = (headers: Record<string, string>) =>
      proxy(new NextRequest(new URL("/api/tailor/generate", "https://jobs.example"), { method: "POST", headers }));
    const { token } = createSession(ENV, true);
    const signedIn = { cookie: `${SESSION_COOKIE}=${token}` };
    // A form on another site, even with a remembered Basic Auth password.
    const blocked = post({ origin: "https://evil.example", authorization: basic(ENV.APP_USERNAME, ENV.APP_PASSWORD) });
    expect(blocked.status).toBe(403);
    expect(post({ ...signedIn, "sec-fetch-site": "cross-site" }).status).toBe(403);
    // The app itself, and tools that send no Origin.
    expect(post({ ...signedIn, origin: "https://jobs.example" }).headers.get("x-middleware-next")).toBe("1");
    expect(post(signedIn).headers.get("x-middleware-next")).toBe("1");
    // Without a password (a local dev server) too.
    delete process.env.APP_PASSWORD;
    expect(post({ origin: "https://evil.example" }).status).toBe(403);
    expect(post({ origin: "https://jobs.example" }).headers.get("x-middleware-next")).toBe("1");
  });
});

describe("sign-in routes", () => {
  const post = (body: unknown, ip = "203.0.113.7") =>
    new NextRequest("https://jobs.example/api/auth/login", {
      method: "POST",
      body: JSON.stringify(body),
      headers: { "content-type": "application/json", "x-forwarded-for": ip },
    });

  it("sets a remembered session cookie for the right password", async () => {
    const response = await login(post({ username: ENV.APP_USERNAME, password: ENV.APP_PASSWORD, remember: true }));
    expect(response.status).toBe(200);
    const cookie = response.cookies.get(SESSION_COOKIE)!;
    expect(verifySession(process.env, cookie.value)).toBe(true);
    expect(cookie).toMatchObject({ httpOnly: true, sameSite: "lax", secure: true, path: "/", maxAge: REMEMBER_SECONDS });

    const check = await session(new NextRequest("https://jobs.example/api/auth/session", { headers: { cookie: `${SESSION_COOKIE}=${cookie.value}` } }));
    expect(await check.json()).toEqual({ enabled: true, signedIn: true, username: ENV.APP_USERNAME });

    const out = await logout(new NextRequest("https://jobs.example/api/auth/logout", { method: "POST" }));
    expect(out.cookies.get(SESSION_COOKIE)).toMatchObject({ value: "", maxAge: 0 });
  });

  it("refuses a wrong password, then blocks repeated guessing", async () => {
    const wrong = await login(post({ username: ENV.APP_USERNAME, password: "guess" }, "198.51.100.9"));
    expect(wrong.status).toBe(401);
    expect(wrong.cookies.get(SESSION_COOKIE)).toBeUndefined();
    for (let i = 0; i < 9; i++) await login(post({ username: ENV.APP_USERNAME, password: "guess" }, "198.51.100.9"));
    const blocked = await login(post({ username: ENV.APP_USERNAME, password: ENV.APP_PASSWORD }, "198.51.100.9"));
    expect(blocked.status).toBe(429);
  }, 15_000);
});
