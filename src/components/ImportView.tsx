"use client";

import { Plus } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { JobCard } from "@/components/JobCard";
import { MatchAllButton, useCurrentMatches } from "@/components/MatchAll";
import { FIND_TABS, SectionTabs } from "@/components/Nav";
import { formatPosted } from "@/lib/format";
import { buildBookmarklet, findSavedCopy, payloadToJob, readImportHash, type ImportPayload } from "@/lib/import";
import { parseJobspyFile, type JobspyImport } from "@/lib/jobspy";
import { useSavedJobs } from "@/lib/store";

type Extract = (doc: Document, href: string) => ImportPayload;

const EMPTY: ImportPayload = { title: "", company: "", location: "", description: "", url: "", sourceName: "" };

async function loadExtractor(): Promise<Extract> {
  const w = window as Window & { jobscratchExtract?: Extract };
  if (!w.jobscratchExtract) {
    await new Promise<void>((resolve, reject) => {
      const script = document.createElement("script");
      script.src = "/extractor.js";
      script.onload = () => resolve();
      script.onerror = () => reject(new Error("Couldn't load the page reader"));
      document.head.append(script);
    });
  }
  return w.jobscratchExtract!;
}

function Bookmarklet() {
  const ref = useRef<HTMLAnchorElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch("/extractor.js")
      .then((response) => response.text())
      .then((source) => {
        if (cancelled || !ref.current) return;
        // Set directly: React deliberately refuses javascript: URLs in href props.
        ref.current.setAttribute("href", buildBookmarklet(source, window.location.origin));
        setReady(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <a
      ref={ref}
      className={`btn btn-primary cursor-grab ${ready ? "" : "pointer-events-none opacity-50"}`}
      onClick={(event) => {
        event.preventDefault();
        window.alert("Drag this button to your bookmarks bar, then click it while you're viewing a job.");
      }}
      title="Drag me to your bookmarks bar"
    >
      <Plus size={15} aria-hidden /> Send to JobScratch
    </a>
  );
}

/** Loads a results file from scripts/jobspy/search.py, which the user runs on their own computer. */
function JobspyImporter() {
  const router = useRouter();
  const { saved, saveJob, removeJob } = useSavedJobs();
  const { matchFor } = useCurrentMatches();
  const [result, setResult] = useState<JobspyImport | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [order, setOrder] = useState<"match" | "file">("match");

  async function load(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    setError(null);
    try {
      setResult(parseJobspyFile(await file.text()));
    } catch (err) {
      setResult(null);
      setError((err as Error).message);
    }
  }

  // A job you've already saved shows as saved, including anything added since, e.g. a LinkedIn
  // description sent with the bookmarklet.
  const jobs = (result?.jobs ?? []).map((job) => findSavedCopy(saved, job)?.job ?? job);
  const unsaved = jobs.filter((job) => !saved[job.id]);
  const anyMatched = jobs.some((job) => matchFor(job));
  const shown =
    order === "match" && anyMatched
      ? [...jobs].sort((a, b) => (matchFor(b)?.score ?? -1) - (matchFor(a)?.score ?? -1))
      : jobs;

  return (
    <section className="card space-y-3 p-4" aria-labelledby="jobspy-title">
      <div>
        <h2 id="jobspy-title" className="flex items-center gap-2 font-semibold">
          From JobSpy
          <span className="chip bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">Unofficial</span>
        </h2>
        <p className="muted text-sm">
          Load the results of the JobSpy script, which searches LinkedIn, Indeed, Glassdoor and Google Jobs from your
          own computer. Those sites don’t allow scraping, so use it at your own risk. The README explains how to run it.
        </p>
      </div>
      <label className="btn btn-secondary">
        Choose results file
        <input type="file" accept=".json,application/json" className="sr-only" onChange={load} />
      </label>
      {error && (
        <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {error}
        </p>
      )}
      {result && (
        <div className="space-y-3">
          <div className="flex flex-wrap items-center gap-2" role="status">
            <p className="text-sm">
              <strong>{result.jobs.length}</strong> jobs{result.query && ` for “${result.query}”`}
              {result.createdAt && <span className="muted">, found {formatPosted(result.createdAt)}</span>}
              {result.skipped > 0 && <span className="muted"> ({result.skipped} without a title or link left out)</span>}
            </p>
            <div className="ml-auto flex items-center gap-2">
              {anyMatched && (
                <select
                  className="input w-auto py-1 text-xs"
                  value={order}
                  onChange={(e) => setOrder(e.target.value as "match" | "file")}
                  aria-label="Order"
                >
                  <option value="match">Best match first</option>
                  <option value="file">As found</option>
                </select>
              )}
              {unsaved.length > 0 && (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => unsaved.forEach((job) => saveJob(job))}>
                  Save all ({unsaved.length})
                </button>
              )}
            </div>
          </div>
          <MatchAllButton jobs={jobs} />
          {shown.map((job) => (
            <JobCard
              key={job.id}
              job={job}
              status={saved[job.id]?.status}
              match={matchFor(job)}
              expanded={expanded === job.id}
              onToggle={() => setExpanded(expanded === job.id ? null : job.id)}
              onSave={() => {
                const entry = saved[job.id];
                if (!entry) saveJob(job);
                else if (entry.status === "saved" || window.confirm(`Remove this job? It's marked “${entry.status}”.`)) {
                  removeJob(job.id);
                }
              }}
              onTailor={() => {
                if (!saved[job.id]) saveJob(job);
                router.push(`/tailor?job=${encodeURIComponent(job.id)}`);
              }}
            />
          ))}
        </div>
      )}
    </section>
  );
}

export function ImportView() {
  const router = useRouter();
  const { saved, saveJob, mergeJob } = useSavedJobs();
  const [draft, setDraft] = useState<ImportPayload | null>(null);
  const [origin, setOrigin] = useState<"extension" | "url" | "paste" | null>(null);
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [urlError, setUrlError] = useState<{ message: string; blockedSite?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [mergedInto, setMergedInto] = useState<string | null>(null);

  useEffect(() => {
    const take = () => {
      const payload = readImportHash(window.location.hash);
      if (!payload) return;
      setDraft(payload);
      setOrigin("extension");
      setSavedId(null);
      // Remove the job from the address bar so a refresh doesn't re-import it.
      history.replaceState(null, "", window.location.pathname);
    };
    take();
    window.addEventListener("hashchange", take);
    return () => window.removeEventListener("hashchange", take);
  }, []);

  async function importUrl(event: FormEvent) {
    event.preventDefault();
    setUrlError(null);
    setFetching(true);
    try {
      const response = await fetch("/api/import/url", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url }),
      });
      const data = await response.json();
      if (!response.ok) {
        setUrlError({ message: data.error ?? "Import failed", blockedSite: data.blockedSite });
        return;
      }
      const extract = await loadExtractor();
      const doc = new DOMParser().parseFromString(data.html as string, "text/html");
      const payload = extract(doc, data.url as string);
      if (!payload.title && !payload.description) {
        setUrlError({ message: "Couldn't find a job on that page. Try pasting it instead." });
        return;
      }
      setDraft(payload);
      setOrigin("url");
      setSavedId(null);
    } catch (error) {
      setUrlError({ message: (error as Error).message });
    } finally {
      setFetching(false);
    }
  }

  function save(andTailor: boolean) {
    if (!draft) return;
    const job = payloadToJob(draft);
    saveJob(job);
    setSavedId(job.id);
    if (andTailor) router.push(`/tailor?job=${encodeURIComponent(job.id)}`);
  }

  const set = (field: keyof ImportPayload) => (value: string) => setDraft({ ...(draft ?? EMPTY), [field]: value });
  const previewJob = draft ? payloadToJob(draft) : null;
  const alreadySaved = previewJob ? Boolean(saved[previewJob.id]) : false;
  // The same job may already be saved, e.g. from a JobSpy search that couldn't get LinkedIn's description.
  const savedCopy = previewJob ? findSavedCopy(saved, previewJob) : undefined;

  function merge(andOpen: boolean) {
    if (!previewJob || !savedCopy) return;
    const id = savedCopy.job.id;
    mergeJob(id, previewJob);
    setMergedInto(id);
    setSavedId(id);
    if (andOpen) router.push(`/tailor?job=${encodeURIComponent(id)}`);
  }

  /** Overwrite the saved copy with this page's details, keeping its id, status and notes. */
  function replace() {
    if (!previewJob || !savedCopy) return;
    saveJob({ ...previewJob, id: savedCopy.job.id });
    setMergedInto(null);
    setSavedId(savedCopy.job.id);
  }

  return (
    <div className="space-y-4">
      <SectionTabs tabs={FIND_TABS} />
      <div>
        <h1 className="page-title">Add a job</h1>
        <p className="page-subtitle">
          Found a job somewhere else? Bring it in to track it and tailor your CV for it.
        </p>
      </div>

      {draft && (
        <section className="card space-y-3 border-indigo-200 p-4 dark:border-indigo-900" aria-labelledby="draft-title">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="draft-title" className="font-semibold">
              {origin === "extension" ? `Job received${draft.sourceName ? ` from ${draft.sourceName}` : ""}` : "Check the details"}
            </h2>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setDraft(null)}>
              Discard
            </button>
          </div>
          {savedCopy && !savedId && (
            <p className="text-sm font-medium text-indigo-700 dark:text-indigo-300">
              This job is already in My jobs. Merge it below to add these details to it.
            </p>
          )}
          <div className="grid gap-3 sm:grid-cols-2">
            <div>
              <label className="label" htmlFor="f-title">Job title</label>
              <input id="f-title" className="input" value={draft.title} onChange={(e) => set("title")(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-company">Company</label>
              <input id="f-company" className="input" value={draft.company} onChange={(e) => set("company")(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-location">Location</label>
              <input id="f-location" className="input" value={draft.location} onChange={(e) => set("location")(e.target.value)} />
            </div>
            <div>
              <label className="label" htmlFor="f-url">Link to apply</label>
              <input id="f-url" className="input" type="url" value={draft.url} onChange={(e) => set("url")(e.target.value)} />
            </div>
          </div>
          <div>
            <label className="label" htmlFor="f-desc">Description</label>
            <textarea
              id="f-desc"
              className="input min-h-56 text-xs leading-relaxed"
              value={draft.description}
              onChange={(e) => set("description")(e.target.value)}
            />
            {draft.description.length < 300 && (
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-300">
                The description looks short. Paste the full text for better CV tailoring.
              </p>
            )}
          </div>
          {savedId ? (
            <p className="text-sm text-emerald-700 dark:text-emerald-300">
              {mergedInto === savedId ? "Merged into the job in My jobs." : "Saved to My jobs."}{" "}
              <Link href={`/tailor?job=${encodeURIComponent(savedId)}`} className="link">
                Open it
              </Link>{" "}
              to {mergedInto === savedId ? "check your match or tailor your CV" : "tailor your CV"}.
            </p>
          ) : savedCopy && previewJob ? (
            <div className="space-y-2.5 rounded-xl border border-indigo-200 bg-indigo-50/70 p-3 dark:border-indigo-900 dark:bg-indigo-950/40">
              <p className="text-sm">
                <strong>Already in My jobs:</strong> “{savedCopy.job.title}” at {savedCopy.job.company}, from{" "}
                {savedCopy.job.sourceName}.{" "}
                {previewJob.description.length > savedCopy.job.description.length
                  ? "Merging adds the full description from this page."
                  : "Merging adds anything it’s missing from this page."}{" "}
                Its status and notes stay as they are.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="btn btn-primary" onClick={() => merge(true)}>
                  Merge &amp; open job
                </button>
                <button type="button" className="btn btn-secondary" onClick={() => merge(false)}>
                  Merge
                </button>
                <button type="button" className="btn btn-ghost" disabled={!draft.title.trim()} onClick={replace}>
                  Replace it with these details
                </button>
              </div>
            </div>
          ) : (
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn btn-primary" disabled={!draft.title.trim()} onClick={() => save(true)}>
                Save &amp; tailor CV
              </button>
              <button type="button" className="btn btn-secondary" disabled={!draft.title.trim()} onClick={() => save(false)}>
                {alreadySaved ? "Update saved job" : "Save job"}
              </button>
            </div>
          )}
        </section>
      )}

      <section className="card space-y-3 p-4">
        <div>
          <h2 className="font-semibold">Paste a link</h2>
          <p className="muted text-sm">
            A job on a company careers page or job board (Greenhouse, Lever, Workday, Ashby and so on).
          </p>
        </div>
        <form onSubmit={importUrl} className="flex flex-col gap-2 sm:flex-row">
          <input
            className="input"
            type="url"
            required
            placeholder="https://careers.example.com/jobs/123"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-label="Job link"
          />
          <button type="submit" className="btn btn-primary" disabled={fetching}>
            {fetching ? "Reading…" : "Add job"}
          </button>
        </form>
        {urlError && (
          <p
            role="alert"
            className={`rounded-lg px-3 py-2 text-sm ${urlError.blockedSite ? "bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}
          >
            {urlError.message}
          </p>
        )}
      </section>

      <section className="card space-y-4 p-4">
        <div>
          <h2 className="font-semibold">From LinkedIn, Indeed or Glassdoor</h2>
          <p className="muted text-sm">
            These sites don’t allow automated reading, so their links can’t be pasted above. Instead, open the job in
            your browser and send it here with one click. Only the page you’re looking at is read, and only when you
            click.
          </p>
        </div>
        <div className="grid gap-4 md:grid-cols-2">
          <div className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
            <h3 className="text-sm font-semibold">Bookmark button (any browser)</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>
                Drag this to your bookmarks bar: <Bookmarklet />
              </li>
              <li>Open a job on LinkedIn (or anywhere).</li>
              <li>Click the bookmark. The job opens here, ready to save.</li>
            </ol>
            <p className="muted text-xs">
              Tip: if the description is incomplete, select the description text on the page first, then click the
              bookmark.
            </p>
          </div>
          <div className="space-y-2 rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800/50">
            <h3 className="text-sm font-semibold">Browser extension (Chrome, Edge)</h3>
            <ol className="list-decimal space-y-1 pl-5 text-sm">
              <li>
                Open <code>chrome://extensions</code> and turn on Developer mode.
              </li>
              <li>
                Click <strong>Load unpacked</strong> and choose the <code>extension/</code> folder from this project.
              </li>
              <li>On a job page, click the JobScratch icon, then <strong>Send job</strong>.</li>
            </ol>
            <p className="muted text-xs">Set the app address in the extension popup if JobScratch isn’t on localhost:3000.</p>
          </div>
        </div>
      </section>

      <JobspyImporter />

      <section id="paste" className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-center">
        <div className="flex-1">
          <h2 className="font-semibold">Type or paste it in</h2>
          <p className="muted text-sm">From an email, a PDF, a recruiter’s message or anywhere else.</p>
        </div>
        <button
          type="button"
          className="btn btn-secondary"
          onClick={() => {
            setDraft({ ...EMPTY, sourceName: "Manual entry" });
            setOrigin("paste");
            setSavedId(null);
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          Enter a job
        </button>
      </section>
    </div>
  );
}
