"use client";

import { useRef, useState } from "react";
import type { ProfileResponse, ProfileSourceResult } from "@/lib/profile";
import {
  MAX_EVIDENCE_CHARS,
  MAX_GITHUB_LENGTH,
  MAX_WEBSITE_LENGTH,
  linksChanged,
  mergeEvidence,
} from "@/lib/profile/links";
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
  // Not stopped when you leave the page: what it reads is saved to your profile when it arrives.
  const request = useRef<AbortController | null>(null);

  const hasLinks = Boolean(profile.website.trim() || profile.github.trim());
  const stale = Boolean(profile.evidence) && linksChanged(profile, profile.fetchedFor);
  const update = (patch: Partial<typeof profile>) => setProfile((previous) => ({ ...previous, ...patch }));

  async function fetchProfile() {
    request.current?.abort();
    const controller = new AbortController();
    request.current = controller;
    const requested = { website: profile.website.trim(), github: profile.github.trim() };
    setFetching(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(requested),
        signal: controller.signal,
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Couldn't read your links (HTTP ${response.status}). Try again.`);
      const fetched = data as ProfileResponse;
      setResult(fetched);
      // A source that failed this time keeps the text it had, if its link is unchanged.
      setProfile((previous) => {
        const evidence = mergeEvidence(previous, requested, fetched.sections ?? {});
        if (!evidence) return previous;
        return { ...previous, evidence, enabled: true, fetchedAt: new Date().toISOString(), fetchedFor: requested };
      });
      if (fetched.evidence) setShowEvidence(true);
    } catch (err) {
      if (!controller.signal.aborted) setError((err as Error).message);
    } finally {
      if (request.current === controller) {
        request.current = null;
        setFetching(false);
      }
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
            maxLength={MAX_WEBSITE_LENGTH}
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
            maxLength={MAX_GITHUB_LENGTH}
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

      {stale && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          You&apos;ve changed your links since these details were fetched, so Claude won&apos;t see them. Click{" "}
          <strong>Fetch again</strong> to read your new links.
        </p>
      )}
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {/* Always in the page, so screen readers announce what's put in it. */}
      <div role="status">
        {fetching && <p className="muted text-sm">Reading your links…</p>}
        {result && (
          <ul className="space-y-0.5 text-sm">
            <SourceStatus label="Website" result={result.website} />
            <SourceStatus label="GitHub" result={result.github} />
          </ul>
        )}
      </div>

      {profile.evidence && (
        <div className="space-y-2">
          <button type="button" className="link cursor-pointer text-sm" onClick={() => setShowEvidence(!showEvidence)}>
            {showEvidence ? "Hide" : "Show"} what Claude will see ({profile.evidence.length.toLocaleString("en")} characters)
          </button>
          {profile.evidence.length > MAX_EVIDENCE_CHARS && (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              Claude only sees the first {MAX_EVIDENCE_CHARS.toLocaleString("en")} characters. Shorten this so nothing
              important is cut off.
            </p>
          )}
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
                      // Stop a fetch that's still running from putting them back.
                      request.current?.abort();
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
