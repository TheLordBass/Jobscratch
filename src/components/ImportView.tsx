"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { FIND_TABS, SectionTabs } from "@/components/Nav";
import { buildBookmarklet, payloadToJob, readImportHash, type ImportPayload } from "@/lib/import";
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
      ➕ Send to JobScratch
    </a>
  );
}

export function ImportView() {
  const router = useRouter();
  const { saved, saveJob } = useSavedJobs();
  const [draft, setDraft] = useState<ImportPayload | null>(null);
  const [origin, setOrigin] = useState<"extension" | "url" | "paste" | null>(null);
  const [url, setUrl] = useState("");
  const [fetching, setFetching] = useState(false);
  const [urlError, setUrlError] = useState<{ message: string; blockedSite?: string } | null>(null);
  const [savedId, setSavedId] = useState<string | null>(null);

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

  return (
    <div className="space-y-4">
      <SectionTabs tabs={FIND_TABS} />
      <div>
        <h1 className="text-xl font-semibold">Add a job</h1>
        <p className="muted text-sm">
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
              Saved to My jobs. <Link href={`/tailor?job=${encodeURIComponent(savedId)}`} className="link">Open it</Link>{" "}
              to tailor your CV.
            </p>
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
