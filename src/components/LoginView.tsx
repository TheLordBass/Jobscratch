"use client";

import { BriefcaseBusiness, LogIn } from "lucide-react";
import { useSearchParams } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { safeNext } from "@/lib/safe-next";

export function LoginView() {
  const params = useSearchParams();
  const next = safeNext(params.get("next"));
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [checking, setChecking] = useState(true);

  // Keep the #fragment: a job sent by the bookmarklet arrives as /import#job=….
  const goOn = () => window.location.replace(`${next}${window.location.hash}`);

  useEffect(() => {
    fetch("/api/auth/session", { cache: "no-store" })
      .then((response) => response.json())
      .then((session: { enabled: boolean; signedIn?: boolean }) => {
        if (!session.enabled || session.signedIn) goOn();
        else setChecking(false);
      })
      .catch(() => setChecking(false));
    // Only once, when the page opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function submit(event: FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, remember }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? "Couldn’t sign in. Try again.");
      goOn();
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex max-w-sm flex-col items-center gap-6 pt-6 sm:pt-12">
      <div className="flex flex-col items-center gap-3 text-center">
        <span className="grid h-12 w-12 place-items-center rounded-2xl bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-600/30">
          <BriefcaseBusiness size={24} aria-hidden />
        </span>
        <div>
          <h1 className="page-title">Sign in to JobScratch</h1>
          <p className="page-subtitle">Your CV, saved jobs and tailored documents, on any device.</p>
        </div>
      </div>

      <form onSubmit={submit} className="card w-full space-y-4 p-6" aria-busy={checking || busy}>
        <div>
          <label htmlFor="username" className="label">
            Username
          </label>
          <input
            id="username"
            className="input"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            required
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={checking}
          />
        </div>
        <div>
          <label htmlFor="password" className="label">
            Password
          </label>
          <input
            id="password"
            className="input"
            type="password"
            autoComplete="current-password"
            required
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={checking}
          />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
          Remember this device for 30 days
        </label>
        {error && (
          <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary w-full py-2.5" disabled={checking || busy}>
          <LogIn size={16} aria-hidden /> {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="muted text-center text-xs">
        The username and password are the <code>APP_USERNAME</code> and <code>APP_PASSWORD</code> set for this site.
      </p>
    </div>
  );
}
