"use client";

import { ArrowLeft, Check, RotateCcw, Sparkles, Trash2, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { AnswersPanel } from "@/components/AnswersPanel";
import { ApplyButton, CompanyMark, OtherApplyLinks } from "@/components/JobCard";
import { useCurrentMatches } from "@/components/MatchAll";
import { MarkdownView } from "@/components/MarkdownView";
import { STATUS_LABEL, STATUS_STYLE, SavedView } from "@/components/SavedView";
import { useSources } from "@/components/useSources";
import type { MatchAnalysis, TailorOptions } from "@/lib/ai/prompts";
import { markdownToDocx } from "@/lib/export-docx";
import { canMatch, hasFullDescription, matchKey } from "@/lib/candidate";
import { cvVersions, hasCvText } from "@/lib/cvs";
import { dismissTask, startAnalysis, startAnswers, startDocument, stopJobTasks, stopTask, useJobTask, type JobTask } from "@/lib/job-tasks";
import { jobKeys } from "@/lib/import";
import { documentFileName } from "@/lib/apply";
import { downloadBlob, formatPosted } from "@/lib/format";
import { hasProjectSections, printableHtml, removeProjectSections } from "@/lib/markdown";
import { useSessionState } from "@/lib/session-state";
import {
  APPLICATION_STATUSES,
  useCv,
  useHydrated,
  useMatches,
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
type Tab = "job" | "analysis" | DocKind | "answers";
const TABS: Tab[] = ["job", "analysis", "cv", "coverLetter", "answers"];

interface Generation {
  status: "idle" | "streaming" | "error";
  text: string;
  thinking: string;
  notice?: string;
  error?: string;
  startedAt?: number;
}

const IDLE: Generation = { status: "idle", text: "", thinking: "" };

/** How a background task (lib/job-tasks.ts) shows on the page. */
function toGeneration(task: JobTask | undefined): Generation {
  if (!task) return IDLE;
  if (task.status === "running") {
    return { status: "streaming", text: task.text, thinking: task.thinking, notice: task.notice, startedAt: task.startedAt };
  }
  if (task.status === "error") return { status: "error", text: "", thinking: "", error: task.error };
  return { status: "idle", text: "", thinking: "", notice: task.status === "stopped" ? task.notice : undefined };
}

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
              <Check size={12} aria-hidden /> {k}
            </span>
          ))}
          {analysis.keywordsMissing.map((k) => (
            <span key={k} className="chip bg-amber-50 text-amber-800 dark:bg-amber-950 dark:text-amber-200">
              <X size={12} aria-hidden /> {k}
            </span>
          ))}
        </div>
      </div>
      {section("Suggestions", analysis.suggestions, "No suggestions.")}
    </div>
  );
}

/**
 * What the match found missing, asking whether the candidate has it anyway. What they write goes
 * into the job's notes, which tailoring uses as their own account of their experience.
 */
function MissingExperience({ items, notes, onAdd }: { items: string[]; notes: string; onAdd: (line: string) => void }) {
  const [open, setOpen] = useState<string | null>(null);
  const [text, setText] = useState("");
  const noted = (item: string) => notes.toLowerCase().includes(item.toLowerCase());
  const list = [...new Set(items.map((item) => item.trim()).filter(Boolean))];
  if (list.length === 0) return null;

  return (
    <div className="mt-6 space-y-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
      <h3 className="text-sm font-semibold">Have you done any of these?</h3>
      <p className="muted text-xs">
        Your CV doesn’t show them. If you have the experience, say where and how: it’s added to this job’s notes, and the
        next tailored CV and cover letter use it.
      </p>
      <ul className="space-y-1.5">
        {list.map((item) => (
          <li key={item} className="rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
            <div className="flex flex-wrap items-center gap-2">
              <span className="min-w-0 flex-1">{item}</span>
              {noted(item) ? (
                <span className="flex items-center gap-1 text-xs text-emerald-700 dark:text-emerald-400">
                  <Check size={13} aria-hidden /> In your notes
                </span>
              ) : open !== item ? (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  onClick={() => {
                    setOpen(item);
                    setText("");
                  }}
                >
                  I have this
                </button>
              ) : null}
            </div>
            {open === item && !noted(item) && (
              <form
                className="mt-2 flex flex-wrap gap-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  if (!text.trim()) return;
                  onAdd(`${item}: ${text.trim()}`);
                  setOpen(null);
                }}
              >
                <input
                  className="input min-w-0 flex-1 py-1.5 text-sm"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  placeholder="Where and how, e.g. used it weekly at Acme for the sales dashboards"
                  aria-label={`Your experience with ${item}`}
                  autoFocus
                />
                <button type="submit" className="btn btn-primary btn-sm" disabled={!text.trim()}>
                  Add to notes
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(null)}>
                  Cancel
                </button>
              </form>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

/** A job description laid out to read: paragraphs, bullet lists and section headings. */
function JobDescription({ text }: { text: string }) {
  const blocks = text
    .replace(/\r\n?/g, "\n")
    .split(/\n\s*\n/)
    .map((block) => block.split("\n").map((line) => line.trim()).filter(Boolean))
    .filter((lines) => lines.length);
  const bullet = /^([•·▪◦‣*–—-]|\d{1,2}[.)])\s+/;
  // A short line on its own that ends with ":" or is in capitals reads as a heading.
  const heading = (line: string, first: boolean, more: boolean) =>
    line.length <= 80 &&
    !bullet.test(line) &&
    (/:$/.test(line) ||
      (/[A-Z]/.test(line) && line === line.toUpperCase()) ||
      (first && more && line.length <= 50 && !/[.,;!?)]$/.test(line)));
  return (
    <div className="max-w-prose space-y-4 text-[15px] leading-7 text-zinc-800 dark:text-zinc-200">
      {blocks.map((lines, i) => {
        const out: ReactNode[] = [];
        let list: string[] = [];
        const flush = () => {
          if (list.length) {
            out.push(
              <ul key={out.length} className="list-disc space-y-1.5 pl-5 marker:text-zinc-400">
                {list.map((item, j) => (
                  <li key={j}>{item}</li>
                ))}
              </ul>,
            );
            list = [];
          }
        };
        let paragraph: string[] = [];
        const flushParagraph = () => {
          if (paragraph.length) {
            out.push(<p key={out.length}>{paragraph.join(" ")}</p>);
            paragraph = [];
          }
        };
        lines.forEach((line, index) => {
          if (bullet.test(line)) {
            flushParagraph();
            list.push(line.replace(bullet, ""));
          } else if (heading(line, index === 0, lines.length > 1)) {
            flushParagraph();
            flush();
            out.push(
              <h3 key={out.length} className="pt-1 text-base font-semibold text-zinc-900 dark:text-white">
                {line.replace(/:$/, "")}
              </h3>,
            );
          } else {
            flush();
            // Lines inside a paragraph are often hard-wrapped; a line that ends a sentence starts a new one.
            paragraph.push(line);
            if (/[.!?]$/.test(line) && lines.length > 3) flushParagraph();
          }
        });
        flushParagraph();
        flush();
        return <div key={i} className="space-y-3">{out}</div>;
      })}
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
  // The CV as it was before "Remove projects", for Undo.
  const [beforeRemoval, setBeforeRemoval] = useState<string | null>(null);
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
  // Undo is offered only until the CV changes in some other way.
  const canUndoRemoval = beforeRemoval !== null && content === removeProjectSections(beforeRemoval);
  const lastThought = generation.thinking.trim().split("\n").filter(Boolean).at(-1);

  const fileBase = () => documentFileName(content, kind === "cv" ? "cv" : "cover-letter", job.company);

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
          <Sparkles size={15} aria-hidden /> Write my {label}
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
          {kind === "cv" &&
            (canUndoRemoval ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => onEdit(beforeRemoval)}>
                <RotateCcw size={13} aria-hidden /> Put projects back
              </button>
            ) : (
              hasProjectSections(content) && (
                <button
                  type="button"
                  className="btn btn-secondary btn-sm"
                  title="Take the Projects section out of this CV"
                  onClick={() => {
                    setBeforeRemoval(content);
                    onEdit(removeProjectSections(content));
                  }}
                >
                  <X size={13} aria-hidden /> Remove projects
                </button>
              )
            ))}
          <button
            type="button"
            className="btn btn-ghost btn-sm ml-auto"
            disabled={Boolean(blocker)}
            title={blocker}
            onClick={() => {
              if (!markdown || window.confirm(`Replace this ${label} with a new version?`)) onGenerate();
            }}
          >
            <RotateCcw size={13} aria-hidden /> Regenerate
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

function TailorWorkspace({ entry, initialTab }: { entry: SavedJob; initialTab?: Tab }) {
  const job = entry.job;
  const { updateJob, removeJob } = useSavedJobs();
  const router = useRouter();
  const [cv] = useCv();
  const [profile] = useProfile();
  const [settings, setSettings] = useSettings();
  const [tailored, setTailored] = useTailored();
  const sources = useSources();
  const docs: TailoredDocs | undefined = tailored[job.id];
  // An analysis from Match all counts as this job's until one is run here (an out-of-date one is marked so).
  // Not for a job with only a snippet: one made from it would be misleading.
  // Everything about the candidate (every CV, the website and GitHub), the same for every job.
  const { matchFor, candidate } = useCurrentMatches();
  const [matches] = useMatches();
  const currentMatch = matchFor(job);
  const listMatch = currentMatch ?? (canMatch(job) ? matches[job.id] : undefined);
  const analysis = docs?.analysis ?? listMatch?.analysis;
  const staleAnalysis = !docs?.analysis && Boolean(listMatch?.analysis) && !currentMatch;

  // Open on what there is: the tailored CV, else the match analysis, else the job itself.
  // Coming back to the job (without a tab in the link, e.g. from the navigation) opens the tab you were on.
  const [lastTab, rememberTab] = useSessionState<Tab | null>(`tailor:tab:${job.id}`, null);
  const [tab, showTab] = useState<Tab>(initialTab ?? lastTab ?? (docs?.cv ? "cv" : analysis ? "analysis" : "job"));
  const setTab = (next: Tab) => {
    showTab(next);
    rememberTab(next);
  };
  // On a phone the tabs scroll sideways: keep the open one in view (e.g. Answers, opened from Apply).
  const tabButtons = useRef<Partial<Record<Tab, HTMLButtonElement | null>>>({});
  useEffect(() => {
    tabButtons.current[tab]?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [tab]);
  // Open for editing when there is only a snippet, which is worth replacing with the full text.
  const [editingDescription, setEditingDescription] = useState(
    () => !hasFullDescription(docs?.jobDescription ?? job.description),
  );
  // Analysis and writing run in the background (lib/job-tasks.ts), so leaving this page doesn't stop them.
  const analysisTask = useJobTask(job.id, "analysis");
  const cvTask = useJobTask(job.id, "cv");
  const letterTask = useJobTask(job.id, "coverLetter");
  const answersTask = useJobTask(job.id, "answers");
  const analysisState =
    analysisTask?.status === "running"
      ? { status: "loading" as const }
      : analysisTask?.status === "error"
        ? { status: "error" as const, error: analysisTask.error }
        : { status: "idle" as const };
  const generations: Record<DocKind, Generation> = { cv: toGeneration(cvTask), coverLetter: toGeneration(letterTask) };
  // Anything that finished while you were elsewhere has now been seen.
  useEffect(() => {
    for (const task of [analysisTask, cvTask, letterTask, answersTask]) if (task?.status === "done") dismissTask(task.jobId, task.kind);
  }, [analysisTask, cvTask, letterTask, answersTask]);
  const label = `${job.title} at ${job.company}`;

  const description = docs?.jobDescription ?? job.description;
  const options = settings.tailor;
  const versions = cvVersions(cv).filter(hasCvText);
  const cvText = candidate.cv;
  const blocker =
    cvText.trim().length < 50
      ? "Add your CV first, under Profile."
      : !description.trim()
        ? "Paste the job description first."
        : undefined;
  const ready = !blocker;
  // Matching needs the full description; tailoring can still go ahead without it.
  const fullDescription = hasFullDescription(description);
  const matchBlocker =
    blocker ?? (fullDescription ? undefined : "Add the full job description first (on the right): it’s only a snippet so far.");

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
  const { cvs: payloadCvs, profile: payloadProfile, skills: payloadSkills, staleDetails } = candidate;
  const payloadNotes = settings.useJobNotes ? entry.notes.trim().slice(0, 4000) || undefined : undefined;

  const payloadJob = {
    title: job.title,
    company: job.company,
    location: job.location,
    url: job.url,
    description,
  };

  function analyse() {
    setTab("analysis");
    startAnalysis(
      job.id,
      label,
      { cv: cvText, cvs: payloadCvs, job: payloadJob, profile: payloadProfile, skills: payloadSkills, notes: payloadNotes },
      // So the score shows in the job lists too, when it's for the job's own description.
      description === job.description ? matchKey(job, candidate) : undefined,
    );
  }

  function generate(kind: DocKind) {
    setTab(kind);
    startDocument(job.id, label, kind, { cv: cvText, cvs: payloadCvs, job: payloadJob, profile: payloadProfile, skills: payloadSkills, notes: payloadNotes, options });
  }

  /** Drafts application answers in the background; `add` keeps the job's other answers. */
  function draftAnswersFor(questions: string[], add: boolean) {
    setTab("answers");
    startAnswers(
      job.id,
      label,
      { cv: cvText, cvs: payloadCvs, job: payloadJob, profile: payloadProfile, skills: payloadSkills, notes: payloadNotes, questions, details: profile.application },
      add,
    );
  }

  /** Adds a line to the job's notes (from "Have you done any of these?"), and makes sure tailoring uses them. */
  function addToNotes(line: string) {
    const current = entry.notes.trimEnd();
    updateJob(job.id, { notes: current ? `${current}\n${line}` : line });
    if (!settings.useJobNotes) setSettings({ ...settings, useJobNotes: true });
  }

  /** Removes the job and its tailored documents, then goes back to My jobs. */
  function remove() {
    const status = entry.status === "saved" ? "" : ` It’s marked “${STATUS_LABEL[entry.status]}”.`;
    const documents = docs?.cv || docs?.coverLetter ? " Its tailored CV and cover letter will be deleted too." : "";
    if (!window.confirm(`Remove ${job.title} at ${job.company} from My jobs?${status}${documents} This can’t be undone.`)) return;
    stopJobTasks(job.id);
    router.replace("/saved");
    removeJob(job.id);
    setTailored((previous) => {
      const next = { ...previous };
      delete next[job.id];
      return next;
    });
  }

  /** A full analysis can run: CV and full description here, Claude set up, nothing else being written. */
  const canAnalyse = (): boolean =>
    ready && fullDescription && sources?.aiConfigured !== false && generations.cv.status !== "streaming" && generations.coverLetter.status !== "streaming";

  const busy = analysisState.status === "loading" || generations.cv.status === "streaming" || generations.coverLetter.status === "streaming";

  return (
    <div className="space-y-4">
      <Link href="/saved" className="link inline-flex items-center gap-1 text-sm">
        <ArrowLeft size={14} aria-hidden /> My jobs
      </Link>

      <div className="card flex flex-col gap-4 p-4 sm:flex-row sm:items-start sm:p-5">
        <div className="flex min-w-0 flex-1 items-start gap-3 sm:gap-4">
          <CompanyMark job={job} size="lg" />
          <div className="min-w-0 flex-1">
            <h1 className="text-lg leading-snug font-bold tracking-tight sm:text-xl">{job.title}</h1>
            <p className="text-sm">
              {job.company}
              {job.location && <span className="muted"> · {job.location}</span>}
            </p>
            <div className="mt-1">
              <OtherApplyLinks job={job} />
            </div>
          </div>
        </div>
        <div className="flex items-center gap-1.5">
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
          <ApplyButton job={job} className="min-w-0 flex-1 sm:flex-none" />
          <button
            type="button"
            className="btn btn-danger btn-sm btn-icon shrink-0"
            onClick={remove}
            aria-label="Remove this job from My jobs"
            title="Remove from My jobs"
          >
            <Trash2 size={15} aria-hidden />
          </button>
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
          <div className="-mx-1 mb-4 flex gap-1 overflow-x-auto border-b border-zinc-100 px-1 pb-2 dark:border-zinc-800" role="tablist">
            {(
              [
                ["job", "Job", false],
                [
                  "analysis",
                  analysis ? `Match ${analysis.matchScore}%` : "Match",
                  Boolean(analysis),
                ],
                ["cv", "Tailored CV", Boolean(docs?.cv)],
                ["coverLetter", "Cover letter", Boolean(docs?.coverLetter)],
                ["answers", "Answers", Boolean(docs?.answers?.length)],
              ] as const
            ).map(([id, label, done]) => (
              <button
                key={id}
                type="button"
                role="tab"
                aria-selected={tab === id}
                ref={(button) => {
                  tabButtons.current[id] = button;
                }}
                onClick={() => {
                  // Clicking Match on a job with its full description but no full analysis yet runs one.
                  if (id === "analysis" && canAnalyse() && !analysis && analysisState.status !== "loading") analyse();
                  else setTab(id);
                }}
                className={`btn btn-sm shrink-0 ${tab === id ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white" : "btn-ghost"}`}
              >
                {label}
                {(id === "cv" || id === "coverLetter" || id === "answers") && done && (
                  <Check size={13} className="text-emerald-600 dark:text-emerald-400" aria-label="(written)" />
                )}
                {(id === "cv" || id === "coverLetter"
                  ? generations[id].status === "streaming"
                  : id === "answers" && answersTask?.status === "running") && (
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
                {analysis ? (
                  <>
                    <AnalysisPanel analysis={analysis} />
                    {staleAnalysis && (
                      <p className="muted mt-3 text-xs">
                        Your CV or this job’s description has changed since this analysis, so it may be out of date.
                      </p>
                    )}
                    <MissingExperience
                      items={analysis.keywordsMissing.length ? analysis.keywordsMissing : analysis.gaps}
                      notes={entry.notes}
                      onAdd={addToNotes}
                    />
                    <div className="mt-6 flex flex-wrap items-center gap-2 border-t border-zinc-100 pt-4 dark:border-zinc-800">
                      {!docs?.cv && (
                        <button
                          type="button"
                          className="btn btn-primary"
                          disabled={!ready || busy}
                          onClick={() => void generate("cv")}
                        >
                          <Sparkles size={15} aria-hidden /> Next: tailor my CV
                        </button>
                      )}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={!ready || busy || !fullDescription}
                        title={matchBlocker}
                        onClick={() => void analyse()}
                      >
                        <RotateCcw size={13} aria-hidden /> Analyse again
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="py-10 text-center text-sm">
                    {fullDescription ? (
                      <>
                        <p className="mb-1 font-medium">How well do you fit this job?</p>
                        <p className="muted mb-4">Get a match score, your strengths, the gaps and the keywords you’re missing.</p>
                      </>
                    ) : (
                      <>
                        <p className="mb-1 font-medium">No full description yet, so no match</p>
                        <p className="muted mx-auto mb-4 max-w-md">
                          A score from a snippet would be misleading. Add the full description on the right (for LinkedIn,
                          Indeed or Glassdoor, your Send to JobScratch bookmark does it), then analyse the match.
                        </p>
                      </>
                    )}
                    <div className="flex flex-wrap justify-center gap-2">
                      <button
                        type="button"
                        className="btn btn-primary"
                        disabled={!ready || busy || !fullDescription}
                        onClick={() => void analyse()}
                      >
                        Analyse match
                      </button>
                      <button type="button" className="btn btn-secondary" disabled={!ready || busy} onClick={() => void generate("cv")}>
                        <Sparkles size={15} aria-hidden /> Skip to tailored CV
                      </button>
                    </div>
                    {blocker && <p className="muted mt-3 text-xs">{blocker}</p>}
                  </div>
                )}
              </>
            ))}
          {tab === "job" && (
            <div className="space-y-4">
              {!fullDescription && (
                <p className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-950 dark:text-amber-200">
                  {jobKeys(job).length > 0 ? (
                    <>
                      {job.sourceName.replace(/\s*\(JobSpy\)$/, "")} didn’t share the full description. Open the job there
                      and click your <strong>Send to JobScratch</strong> bookmark, then choose <strong>Merge</strong>: it’s
                      added here. Until then it isn’t matched.
                    </>
                  ) : (
                    "This looks like a snippet, so it isn’t matched. Open the listing and paste the full description here (Edit)."
                  )}
                </p>
              )}
              {editingDescription ? (
                <textarea
                  className="input min-h-96 text-sm leading-relaxed"
                  value={description}
                  onChange={(e) => updateDocs({ jobDescription: e.target.value })}
                  placeholder="Paste the full job description"
                  aria-label="Job description"
                />
              ) : description.trim() ? (
                <JobDescription text={description} />
              ) : (
                <p className="muted text-sm">No description yet. Click Edit to paste it.</p>
              )}
              <div className="flex flex-wrap items-center gap-3 border-t border-zinc-100 pt-3 text-sm dark:border-zinc-800">
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setEditingDescription(!editingDescription)}>
                  {editingDescription ? "Done" : "Edit"}
                </button>
                {docs?.jobDescription !== undefined && (
                  <button type="button" className="link text-xs" onClick={() => updateDocs({ jobDescription: undefined })}>
                    Back to the original
                  </button>
                )}
                {job.postedAt && <span className="muted text-xs">Posted {formatPosted(job.postedAt)}</span>}
              </div>
            </div>
          )}

          {tab === "answers" && (
            <AnswersPanel
              answers={docs?.answers}
              task={answersTask}
              blocker={blocker}
              detailsMissing={!Object.values(profile.application ?? {}).some((value) => value.trim())}
              onDraft={draftAnswersFor}
              onChange={(answers) => updateDocs({ answers })}
              onStop={() => stopTask(job.id, "answers")}
            />
          )}

          {(tab === "cv" || tab === "coverLetter") && (
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
              onStop={() => stopTask(job.id, tab)}
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
            {versions.length > 0 ? (
              <>
                <p className="muted text-xs">
                  {versions.length > 1 ? (
                    <>
                      All {versions.length}: {versions.map((v) => v.name).join(", ")}. Matching and writing use everything in
                      them, taking what fits this job from each.
                    </>
                  ) : (
                    `${versions[0].fileName ?? "Pasted CV"} · ${cvText.trim().split(/\s+/).length} words`
                  )}
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
              <fieldset>
                <legend className="label">Projects</legend>
                <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
                  {(
                    [
                      [true, "Include relevant ones"],
                      [false, "Leave them out"],
                    ] as const
                  ).map(([value, text]) => (
                    <label key={text} className="flex cursor-pointer items-center gap-2">
                      <input
                        type="radio"
                        name="projects"
                        checked={options.projects === value}
                        onChange={() => setOptions({ projects: value })}
                      />
                      {text}
                    </label>
                  ))}
                </div>
              </fieldset>
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
              placeholder="e.g. I used Tableau every week at Acme, though it's not on my CV. Interview on Tuesday with Sam."
              value={entry.notes}
              onChange={(e) => updateJob(job.id, { notes: e.target.value })}
            />
            <label className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                className="mt-0.5"
                checked={settings.useJobNotes}
                onChange={(e) => setSettings({ ...settings, useJobNotes: e.target.checked })}
              />
              <span className="muted">
                Use these notes when tailoring and analysing: experience you mention that isn’t in your CV is used as
                yours, and so is guidance like “emphasise X”. Contacts, dates and salary stay out of the documents.
                Regenerate to use new notes.
              </span>
            </label>
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
  const tab = params.get("tab");
  return <TailorWorkspace key={jobId} entry={entry} initialTab={TABS.includes(tab as Tab) ? (tab as Tab) : undefined} />;
}
