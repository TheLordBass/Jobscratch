"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { ApplyButton, OtherApplyLinks } from "@/components/JobCard";
import { MarkdownView } from "@/components/MarkdownView";
import { STATUS_LABEL, STATUS_STYLE, SavedView } from "@/components/SavedView";
import { useSources } from "@/components/useSources";
import type { MatchAnalysis, TailorOptions } from "@/lib/ai/prompts";
import { markdownToDocx } from "@/lib/export-docx";
import { MAX_EVIDENCE_CHARS, MAX_GITHUB_LENGTH, MAX_WEBSITE_LENGTH, linksChanged } from "@/lib/profile/links";
import { downloadBlob, slugify } from "@/lib/format";
import { inlinesToText, parseMarkdown, printableHtml } from "@/lib/markdown";
import {
  APPLICATION_STATUSES,
  useCv,
  useHydrated,
  useProfile,
  useSavedJobs,
  useSettings,
  useTailored,
  type ApplicationStatus,
  type SavedJob,
  type TailoredDocs,
} from "@/lib/store";
import type { Job } from "@/lib/types";

type DocKind = "cv" | "coverLetter";
type Tab = "analysis" | DocKind;

interface Generation {
  status: "idle" | "streaming" | "error";
  text: string;
  thinking: string;
  notice?: string;
  error?: string;
  startedAt?: number;
}

const IDLE: Generation = { status: "idle", text: "", thinking: "" };
const SNIPPET_LENGTH = 600;

function ScoreBadge({ score }: { score: number }) {
  const [text, bar] =
    score >= 75
      ? ["text-emerald-600 dark:text-emerald-400", "bg-emerald-500"]
      : score >= 50
        ? ["text-amber-600 dark:text-amber-400", "bg-amber-500"]
        : ["text-red-600 dark:text-red-400", "bg-red-500"];
  return (
    <div className="flex items-center gap-3">
      <div className={`text-4xl font-bold tabular-nums ${text}`}>{score}%</div>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div className={`h-full rounded-full ${bar}`} style={{ width: `${score}%` }} />
      </div>
    </div>
  );
}

function AnalysisPanel({ analysis }: { analysis: MatchAnalysis }) {
  const section = (title: string, items: string[], empty: string) => (
    <div>
      <h3 className="mb-1 text-sm font-semibold">{title}</h3>
      {items.length ? (
        <ul className="list-disc space-y-1 pl-5 text-sm">
          {items.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : (
        <p className="muted text-sm">{empty}</p>
      )}
    </div>
  );
  return (
    <div className="space-y-5">
      <div>
        <ScoreBadge score={analysis.matchScore} />
        <p className="mt-2 text-sm">{analysis.verdict}</p>
      </div>
      {section("Strengths", analysis.strengths, "None identified.")}
      {section("Gaps", analysis.gaps, "No significant gaps.")}
      <div>
        <h3 className="mb-1 text-sm font-semibold">Keywords</h3>
        <div className="flex flex-wrap gap-1">
          {analysis.keywordsPresent.map((k) => (
            <span key={k} className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
              ✓ {k}
            </span>
          ))}
          {analysis.keywordsMissing.map((k) => (
            <span key={k} className="chip bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              ✗ {k}
            </span>
          ))}
        </div>
      </div>
      {section("Suggestions", analysis.suggestions, "No suggestions.")}
    </div>
  );
}

function DocumentPanel({
  kind,
  job,
  markdown,
  generation,
  blocker,
  onEdit,
  onGenerate,
  onStop,
}: {
  kind: DocKind;
  job: Job;
  markdown: string | undefined;
  generation: Generation;
  /** Why a document can't be written yet (no CV or job description). */
  blocker: string | undefined;
  onEdit: (text: string) => void;
  onGenerate: () => void;
  onStop: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [copied, setCopied] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const streaming = generation.status === "streaming";
  const label = kind === "cv" ? "tailored CV" : "cover letter";

  useEffect(() => {
    if (!streaming) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [streaming]);

  const content = streaming ? generation.text : (markdown ?? "");
  const elapsed = generation.startedAt ? Math.max(0, Math.round((now - generation.startedAt) / 1000)) : 0;
  const lastThought = generation.thinking.trim().split("\n").filter(Boolean).at(-1);

  const fileBase = () => {
    const first = parseMarkdown(content).find((b) => b.type === "heading");
    const name = first?.type === "heading" && kind === "cv" ? inlinesToText(first.inlines) : "";
    return [name, kind === "cv" ? "cv" : "cover-letter", job.company].filter(Boolean).map(slugify).join("-");
  };

  const print = () => {
    const win = window.open("", "_blank");
    if (!win) return;
    win.document.write(printableHtml(`${label} – ${job.title} at ${job.company}`, content));
    win.document.close();
    win.focus();
    win.print();
  };

  if (!content && !streaming) {
    return (
      <div className="muted py-10 text-center text-sm">
        {generation.status === "error" ? (
          <p className="mb-3 text-red-600 dark:text-red-400">{generation.error}</p>
        ) : (
          <p className="mb-3">No {label} yet.</p>
        )}
        <button type="button" className="btn btn-primary" disabled={Boolean(blocker)} onClick={onGenerate}>
          ✨ Write my {label}
        </button>
        {blocker && <p className="mt-2 text-xs">{blocker}</p>}
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {streaming && (
        <div className="flex items-center gap-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          <span className="min-w-0 flex-1 truncate">
            {generation.text ? "Writing…" : lastThought ? `Thinking: ${lastThought}` : "Reading your CV and the job…"}
          </span>
          <span className="tabular-nums">{elapsed}s</span>
          <button type="button" className="btn btn-ghost btn-sm py-0.5" onClick={onStop}>
            Stop
          </button>
        </div>
      )}
      {generation.notice && <p className="muted text-xs">{generation.notice}</p>}
      {generation.status === "error" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
          {generation.error}
        </p>
      )}
      {!streaming && (
        <div className="flex flex-wrap gap-1.5">
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditing(!editing)}>
            {editing ? "Preview" : "Edit"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => {
              await navigator.clipboard.writeText(content);
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            }}
          >
            {copied ? "Copied" : "Copy"}
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={async () => downloadBlob(await markdownToDocx(content, `${job.title} at ${job.company}`), `${fileBase()}.docx`)}
          >
            Word (.docx)
          </button>
          <button type="button" className="btn btn-secondary btn-sm" onClick={print}>
            Print / PDF
          </button>
          <button
            type="button"
            className="btn btn-secondary btn-sm"
            onClick={() => downloadBlob(new Blob([content], { type: "text/markdown" }), `${fileBase()}.md`)}
          >
            .md
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            disabled={Boolean(blocker)}
            title={blocker}
            onClick={() => {
              if (!markdown || window.confirm(`Replace this ${label} with a new version?`)) onGenerate();
            }}
          >
            ↻ Regenerate
          </button>
        </div>
      )}
      {editing && !streaming ? (
        <textarea
          className="input min-h-[36rem] font-mono text-xs leading-relaxed"
          value={content}
          onChange={(e) => onEdit(e.target.value)}
          aria-label={`Edit ${label}`}
        />
      ) : (
        <div className="rounded-lg border border-zinc-200 bg-white p-6 dark:border-zinc-800 dark:bg-zinc-950">
          <MarkdownView markdown={content} />
        </div>
      )}
      {!streaming && kind === "cv" && (
        <p className="muted text-xs">
          Check every line before you send it. Claude is told to use only facts from your CV, but you know your history
          best.
        </p>
      )}
    </div>
  );
}

function TailorWorkspace({ entry }: { entry: SavedJob }) {
  const job = entry.job;
  const { updateJob } = useSavedJobs();
  const [cv] = useCv();
  const [profile] = useProfile();
  const [settings, setSettings] = useSettings();
  const [tailored, setTailored] = useTailored();
  const sources = useSources();
  const docs: TailoredDocs | undefined = tailored[job.id];

  const [tab, setTab] = useState<Tab>(docs?.cv || docs?.analysis ? "cv" : "analysis");
  // Open for editing when there is only a snippet, which is worth replacing with the full text.
  const [editingDescription, setEditingDescription] = useState(
    () => (docs?.jobDescription ?? job.description).length < SNIPPET_LENGTH,
  );
  const [analysisState, setAnalysisState] = useState<{ status: "idle" | "loading" | "error"; error?: string }>({
    status: "idle",
  });
  const [generations, setGenerations] = useState<Record<DocKind, Generation>>({ cv: IDLE, coverLetter: IDLE });
  const controllers = useRef<Partial<Record<DocKind, AbortController>>>({});

  useEffect(() => {
    const current = controllers.current;
    return () => Object.values(current).forEach((c) => c?.abort());
  }, []);

  const description = docs?.jobDescription ?? job.description;
  const options = settings.tailor;
  const cvText = cv?.text ?? "";
  const blocker =
    cvText.trim().length < 50
      ? "Add your CV first, under Profile."
      : !description.trim()
        ? "Paste the job description first."
        : undefined;
  const ready = !blocker;

  const updateDocs = (patch: Partial<TailoredDocs>) =>
    setTailored((previous) => ({
      ...previous,
      [job.id]: { ...previous[job.id], ...patch, updatedAt: new Date().toISOString() },
    }));

  const setOptions = (patch: Partial<TailorOptions>) =>
    setSettings({ ...settings, tailor: { ...settings.tailor, ...patch } });

  const hasLinks = Boolean(profile.website.trim() || profile.github.trim() || profile.evidence.trim());
  const profileSources =
    [profile.website.trim() && "website", profile.github.trim() && "GitHub"].filter(Boolean).join(" and ") ||
    "website and GitHub details";
  // A link too long for the API is left out rather than failing every request.
  const website = profile.website.trim().length <= MAX_WEBSITE_LENGTH ? profile.website.trim() : "";
  const github = profile.github.trim().length <= MAX_GITHUB_LENGTH ? profile.github.trim() : "";
  // Details fetched for links that have since changed would describe the wrong site or account.
  const staleDetails = Boolean(profile.evidence.trim()) && linksChanged(profile, profile.fetchedFor);
  const evidence = staleDetails ? "" : profile.evidence.trim().slice(0, MAX_EVIDENCE_CHARS);
  const payloadProfile = profile.enabled && (website || github || evidence) ? { website, github, evidence } : undefined;

  const payloadJob = {
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    description,
  };

  async function analyse() {
    setTab("analysis");
    setAnalysisState({ status: "loading" });
    try {
      const response = await fetch("/api/tailor/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ cv: cvText, job: payloadJob, profile: payloadProfile }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Analysis failed");
      updateDocs({ analysis: data as MatchAnalysis });
      setAnalysisState({ status: "idle" });
    } catch (error) {
      setAnalysisState({ status: "error", error: (error as Error).message });
    }
  }

  async function generate(kind: DocKind) {
    setTab(kind);
    controllers.current[kind]?.abort();
    const controller = new AbortController();
    controllers.current[kind] = controller;
    const update = (patch: Partial<Generation>) =>
      setGenerations((previous) => ({ ...previous, [kind]: { ...previous[kind], ...patch } }));
    update({ ...IDLE, status: "streaming", startedAt: Date.now() });

    let text = "";
    try {
      const response = await fetch("/api/tailor/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: kind === "cv" ? "cv" : "cover-letter",
          cv: cvText,
          job: payloadJob,
          profile: payloadProfile,
          options,
        }),
        signal: controller.signal,
      });
      if (!response.ok || !response.body) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error ?? `Request failed (HTTP ${response.status})`);
      }
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let thinking = "";
      let finished = false;
      while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split("\n");
        buffer = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const event = JSON.parse(line);
          if (event.type === "text") {
            text += event.text;
            update({ text });
          } else if (event.type === "thinking") {
            thinking += event.text;
            update({ thinking });
          } else if (event.type === "notice") {
            update({ notice: event.text });
          } else if (event.type === "error") {
            throw new Error(event.message);
          } else if (event.type === "done") {
            finished = true;
          }
        }
      }
      if (!finished) throw new Error("The connection closed before Claude finished. Try again.");
      updateDocs({ [kind]: text.trim() });
      update({ status: "idle", text: "" });
    } catch (error) {
      if (controller.signal.aborted) {
        if (text.trim()) updateDocs({ [kind]: text.trim() });
        update({ status: "idle", text: "", notice: text ? "Stopped early, so this draft may be incomplete." : undefined });
        return;
      }
      update({ status: "error", text: "", error: (error as Error).message });
    }
  }

  const busy = analysisState.status === "loading" || generations.cv.status === "streaming" || generations.coverLetter.status === "streaming";

  return (
    <div className="space-y-4">
      <Link href="/saved" className="link text-sm">
        ← My jobs
      </Link>

      <div className="card flex flex-col gap-3 p-4 sm:flex-row sm:items-start">
        <div className="min-w-0 flex-1">
          <h1 className="text-lg font-semibold">{job.title}</h1>
          <p className="text-sm">
            {job.company}
            {job.location && <span className="muted"> · {job.location}</span>}
          </p>
          <div className="mt-1">
            <OtherApplyLinks job={job} />
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <select
            className={`input w-auto py-1.5 text-xs font-medium ${STATUS_STYLE[entry.status]}`}
            value={entry.status}
            onChange={(e) => updateJob(job.id, { status: e.target.value as ApplicationStatus })}
            aria-label="Application status"
          >
            {APPLICATION_STATUSES.map((s) => (
              <option key={s} value={s}>
                {STATUS_LABEL[s]}
              </option>
            ))}
          </select>
          <ApplyButton job={job} />
        </div>
      </div>

      {sources && !sources.aiConfigured && (
        <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
          AI isn’t set up yet. Add <code>ANTHROPIC_API_KEY</code> to <code>.env.local</code> and restart the app. See the
          README.
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <div className="card min-w-0 p-4 lg:self-start">
          <div className="mb-4 flex gap-1 border-b border-zinc-100 pb-2 dark:border-zinc-800" role="tablist">
            {(
              [
                ["analysis", docs?.analysis ? `Match ${docs.analysis.matchScore}%` : "Match", Boolean(docs?.analysis)],
                ["cv", "Tailored CV", Boolean(docs?.cv)],
                ["coverLetter", "Cover letter", Boolean(docs?.coverLetter)],
              ] as const
            ).map(([id, label, done]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                onClick={() => setTab(id)}
                className={`btn btn-sm ${tab === id ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white" : "btn-ghost"}`}
              >
                {label}
                {id !== "analysis" && done && <span className="text-emerald-600 dark:text-emerald-400" aria-label="(written)">✓</span>}
                {id !== "analysis" && generations[id].status === "streaming" && (
                  <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-indigo-500" />
                )}
              </button>
            ))}
          </div>

          {tab === "analysis" &&
            (analysisState.status === "loading" ? (
              <p className="muted animate-pulse py-10 text-center text-sm">Comparing your CV with the job…</p>
            ) : (
              <>
                {analysisState.status === "error" && (
                  <p className="mb-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">
                    {analysisState.error}
                  </p>
                )}
                {docs?.analysis ? (
                  <>
                    <AnalysisPanel analysis={docs.analysis} />
                    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                      {!docs.cv && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!ready || busy}
                          onClick={() => void generate("cv")}
                        >
                          ✨ Next: tailor my CV
                        </button>
                      )}
                      <button type="button" className="btn btn-ghost btn-sm" disabled={!ready || busy} onClick={() => void analyse()}>
                        ↻ Analyse again
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center text-sm">
                    <p className="mb-1 font-medium">How well do you fit this job?</p>
                    <p className="muted mb-4">Get a match score, your strengths, the gaps and the keywords you’re missing.</p>
                    <div className="flex flex-wrap justify-center gap-2">
                      <button type="button" className="btn btn-primary" disabled={!ready || busy} onClick={() => void analyse()}>
                        Analyse match
                      </button>
                      <button type="button" className="btn btn-secondary" disabled={!ready || busy} onClick={() => void generate("cv")}>
                        ✨ Skip to tailored CV
                      </button>
                    </div>
                    {blocker && <p className="muted mt-3 text-xs">{blocker}</p>}
                  </div>
                )}
              </>
            ))}
          {tab !== "analysis" && (
            <DocumentPanel
              key={tab}
              kind={tab}
              job={job}
              markdown={docs?.[tab]}
              generation={generations[tab]}
              blocker={blocker}
              onEdit={(text) => updateDocs({ [tab]: text })}
              onGenerate={() => {
                if (ready) void generate(tab);
              }}
              onStop={() => controllers.current[tab]?.abort()}
            />
          )}
        </div>

        <aside className="space-y-4">
          <section className="card space-y-1 p-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Your CV</h2>
              <Link href="/cv" className="link text-xs">
                {cv ? "Edit" : "Add CV"}
              </Link>
            </div>
            {cv ? (
              <>
                <p className="muted text-xs">
                  {cv.fileName ?? "Pasted CV"} · {cvText.trim().split(/\s+/).length} words
                </p>
                <p className="muted text-xs">
                  {payloadProfile ? (
                    <>
                      Also using your {profileSources}
                      {staleDetails
                        ? " links. Their details are out of date, so fetch them again on your Profile"
                        : !payloadProfile.evidence && " links (details not fetched yet)"}
                      .
                    </>
                  ) : hasLinks ? (
                    "Your website and GitHub are turned off for tailoring."
                  ) : (
                    <Link href="/cv" className="link">
                      Add your website or GitHub
                    </Link>
                  )}
                </p>
              </>
            ) : (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Add your CV first. <Link href="/cv" className="link">Upload or paste it</Link>.
              </p>
            )}
          </section>

          <section className="card space-y-2 p-4">
            <div className="flex items-center justify-between gap-2">
              <h2 className="text-sm font-semibold">Job description</h2>
              <span className="flex gap-2">
                {docs?.jobDescription !== undefined && (
                  <button type="button" className="link text-xs" onClick={() => updateDocs({ jobDescription: undefined })}>
                    Reset
                  </button>
                )}
                <button type="button" className="link text-xs" onClick={() => setEditingDescription(!editingDescription)}>
                  {editingDescription ? "Done" : "Edit"}
                </button>
              </span>
            </div>
            {description.length < SNIPPET_LENGTH && (
              <p className="rounded-lg bg-amber-50 px-2.5 py-1.5 text-xs text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                This looks like a snippet. For a better result, open the listing and paste the full description here.
              </p>
            )}
            {editingDescription ? (
              <textarea
                className="input min-h-64 text-xs leading-relaxed"
                value={description}
                onChange={(e) => updateDocs({ jobDescription: e.target.value })}
                placeholder="Paste the full job description"
                aria-label="Job description"
              />
            ) : (
              <p className="muted line-clamp-6 text-xs leading-relaxed whitespace-pre-line">
                {description || "No description yet. Click Edit to paste it."}
              </p>
            )}
          </section>

          <details className="card p-4">
            <summary className="cursor-pointer text-sm font-semibold">Writing options</summary>
            <div className="mt-3 space-y-3">
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label htmlFor="style" className="label">
                    Format
                  </label>
                  <select
                    id="style"
                    className="input py-1.5"
                    value={options.style}
                    onChange={(e) => setOptions({ style: e.target.value as TailorOptions["style"] })}
                  >
                    <option value="uk-cv">UK / EU CV</option>
                    <option value="us-resume">US resume</option>
                  </select>
                </div>
                <div>
                  <label htmlFor="length" className="label">
                    Length
                  </label>
                  <select
                    id="length"
                    className="input py-1.5"
                    value={options.length}
                    onChange={(e) => setOptions({ length: e.target.value as TailorOptions["length"] })}
                  >
                    <option value="one-page">1 page</option>
                    <option value="two-pages">Up to 2 pages</option>
                  </select>
                </div>
                <div className="col-span-2">
                  <label htmlFor="tone" className="label">
                    Tone
                  </label>
                  <select
                    id="tone"
                    className="input py-1.5"
                    value={options.tone}
                    onChange={(e) => setOptions({ tone: e.target.value as TailorOptions["tone"] })}
                  >
                    <option value="professional">Professional</option>
                    <option value="confident">Confident</option>
                    <option value="warm">Warm</option>
                    <option value="concise">Concise</option>
                  </select>
                </div>
              </div>
              <div>
                <label htmlFor="extra" className="label">
                  Anything else? (optional)
                </label>
                <textarea
                  id="extra"
                  className="input min-h-16 text-xs"
                  placeholder="e.g. Emphasise my stakeholder management. I'm relocating to Leeds in May."
                  value={options.extraInstructions}
                  onChange={(e) => setOptions({ extraInstructions: e.target.value })}
                />
              </div>
              <p className="muted text-xs">These apply to every job. Regenerate to use new options.</p>
            </div>
          </details>

          <section className="card space-y-2 p-4">
            <label htmlFor="notes" className="text-sm font-semibold">
              Notes
            </label>
            <textarea
              id="notes"
              className="input min-h-24 text-sm"
              placeholder="Contacts, interview dates, salary discussed…"
              value={entry.notes}
              onChange={(e) => updateJob(job.id, { notes: e.target.value })}
            />
          </section>
        </aside>
      </div>
    </div>
  );
}

export function TailorView() {
  const params = useSearchParams();
  const hydrated = useHydrated();
  const { saved } = useSavedJobs();
  const jobId = params.get("job");
  // The old "pick a job" screen is the My jobs list now.
  if (!jobId) return <SavedView />;
  if (!hydrated) return <div className="card muted p-8 text-center text-sm">Loading…</div>;
  const entry = saved[jobId];
  if (!entry) {
    return (
      <div className="card muted p-8 text-center text-sm">
        That job isn’t in your list any more. <Link href="/saved" className="link">Back to My jobs</Link>.
      </div>
    );
  }
  return <TailorWorkspace key={jobId} entry={entry} />;
}
