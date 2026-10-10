"use client";

import { useState } from "react";
import type { ProfileResponse, ProfileSourceResult } from "@/lib/profile";
import { EMPTY_PROFILE, useHydrated, useProfile } from "@/lib/store";

function SourceStatus({ label, result }: { label: string; result?: ProfileSourceResult }) {
  if (!result) return null;
  return (
    <li className={result.ok ? "text-emerald-700 dark:text-emerald-300" : "text-red-700 dark:text-red-300"}>
      <strong>{label}:</strong> {result.ok ? result.summary : result.error}
    </li>
  );
}

/** Website and GitHub links whose content Claude can use when tailoring and matching. */
export function ProfileLinks() {
  const hydrated = useHydrated();
  const [profile, setProfile] = useProfile();
  const [fetching, setFetching] = useState(false);
  const [result, setResult] = useState<ProfileResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showEvidence, setShowEvidence] = useState(false);

  const hasLinks = Boolean(profile.website.trim() || profile.github.trim());
  const update = (patch: Partial<typeof profile>) => setProfile((previous) => ({ ...previous, ...patch }));

  async function fetchProfile() {
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ website: profile.website, github: profile.github }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Couldn't read your links");
      const fetched = data as ProfileResponse;
      setResult(fetched);
      if (fetched.evidence) {
        update({ evidence: fetched.evidence, enabled: true, fetchedAt: new Date().toISOString() });
        setShowEvidence(true);
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFetching(false);
    }
  }

  return (
    <section className="card space-y-3 p-4" aria-labelledby="links-title">
      <div>
        <h2 id="links-title" className="text-sm font-semibold">
          Website &amp; GitHub
        </h2>
        <p className="muted text-sm">
          Add your own site or portfolio and your GitHub. JobScratch reads their public pages and repositories so Claude
          can use your real projects when tailoring your CV and checking how well you match a job.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label htmlFor="profile-website" className="label">
            Website or portfolio
          </label>
          <input
            id="profile-website"
            className="input"
            type="url"
            inputMode="url"
            placeholder="https://yourname.dev"
            value={hydrated ? profile.website : ""}
            onChange={(e) => update({ website: e.target.value })}
          />
        </div>
        <div>
          <label htmlFor="profile-github" className="label">
            GitHub username or link
          </label>
          <input
            id="profile-github"
            className="input"
            placeholder="octocat or https://github.com/octocat"
            value={hydrated ? profile.github : ""}
            onChange={(e) => update({ github: e.target.value })}
          />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className="btn btn-primary btn-sm" onClick={fetchProfile} disabled={!hasLinks || fetching}>
          {fetching ? "Reading…" : profile.evidence ? "Fetch again" : "Fetch details"}
        </button>
        {profile.evidence && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={profile.enabled} onChange={(e) => update({ enabled: e.target.checked })} />
            Use these when tailoring and matching
          </label>
        )}
      </div>

      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {result && (
        <ul className="space-y-0.5 text-sm" role="status">
          <SourceStatus label="Website" result={result.website} />
          <SourceStatus label="GitHub" result={result.github} />
        </ul>
      )}

      {profile.evidence && (
        <div className="space-y-2">
          <button type="button" className="link cursor-pointer text-sm" onClick={() => setShowEvidence(!showEvidence)}>
            {showEvidence ? "Hide" : "Show"} what Claude will see ({profile.evidence.length.toLocaleString("en")} characters)
          </button>
          {showEvidence && (
            <>
              <textarea
                className="input min-h-72 font-mono text-xs leading-relaxed"
                value={profile.evidence}
                onChange={(e) => update({ evidence: e.target.value })}
                aria-label="Text gathered from your website and GitHub"
              />
              <div className="flex flex-wrap items-center gap-2">
                <p className="muted flex-1 text-xs">
                  Edit or delete anything you don&apos;t want used.
                  {profile.fetchedAt && ` Fetched ${new Date(profile.fetchedAt).toLocaleDateString("en-GB")}.`}
                </p>
                <button
                  type="button"
                  className="btn btn-danger btn-sm"
                  onClick={() => {
                    if (window.confirm("Remove your website and GitHub details?")) {
                      setProfile(EMPTY_PROFILE);
                      setResult(null);
                    }
                  }}
                >
                  Remove
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
