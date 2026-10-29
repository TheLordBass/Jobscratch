"use client";

import { Plus, Upload } from "lucide-react";
import Link from "next/link";
import { useState, type ChangeEvent, type DragEvent } from "react";
import { useSessionState } from "@/lib/session-state";
import { PROFILE_TABS, SectionTabs } from "@/components/Nav";
import { ApplicationDetailsForm } from "@/components/ApplicationDetailsForm";
import { KeywordInput } from "@/components/KeywordInput";
import { SkillsProfile } from "@/components/SkillsProfile";
import { ProfileLinks } from "@/components/ProfileLinks";
import { useFieldDraft } from "@/components/useFieldDraft";
import { MAIN_CV, MAX_CVS, cvVersions, type CvVersion } from "@/lib/cvs";
import { newId, useCv, useHydrated, type StoredCv } from "@/lib/store";

type Message = { tone: "ok" | "error"; text: string } | null;

/**
 * A change to one CV. The CV's own date and the whole value's both move on, so syncing knows this
 * copy is the newer one (lib/sync.ts compares the latter).
 */
function withVersion(previous: StoredCv | null, id: string, patch: Partial<CvVersion>, now: string): StoredCv | null {
  if (id === MAIN_CV) {
    const { text, fileName, name } = patch;
    return {
      ...previous,
      text: text ?? previous?.text ?? "",
      fileName: "fileName" in patch ? fileName : previous?.fileName,
      ...(name !== undefined && { name: name.trim() || undefined }),
      updatedAt: now,
    };
  }
  if (!previous) return previous;
  return {
    ...previous,
    others: (previous.others ?? []).map((version) => (version.id === id ? { ...version, ...patch, updatedAt: now } : version)),
    updatedAt: now,
  };
}

/** Removes a CV. Removing the main one while there are others makes the first of them the main one. */
function withoutVersion(previous: StoredCv | null, id: string, now: string): StoredCv | null {
  if (!previous) return previous;
  if (id !== MAIN_CV) {
    return { ...previous, others: (previous.others ?? []).filter((version) => version.id !== id), updatedAt: now };
  }
  const [next, ...rest] = previous.others ?? [];
  if (!next) return null;
  return { text: next.text, fileName: next.fileName, name: next.name, others: rest.length ? rest : undefined, updatedAt: now };
}

export function CvView() {
  const hydrated = useHydrated();
  const [cv, setCv] = useCv();
  const versions = cvVersions(cv);
  // The CV open here, kept for the session.
  const [openId, setOpenId] = useSessionState<string>("cv:open", MAIN_CV);
  const open = versions.find((version) => version.id === openId) ?? versions[0];
  const openKey = open?.id ?? MAIN_CV;

  const change = (id: string, patch: Partial<CvVersion>) => setCv((previous) => withVersion(previous, id, patch, new Date().toISOString()));

  function addCv() {
    const id = newId();
    const now = new Date().toISOString();
    setCv((previous) =>
      previous
        ? {
            ...previous,
            others: [...(previous.others ?? []), { id, name: `CV ${(previous.others?.length ?? 0) + 2}`, text: "", titles: [], updatedAt: now }],
            updatedAt: now,
          }
        : previous,
    );
    setOpenId(id);
  }

  return (
    <div className="space-y-4">
      <SectionTabs tabs={PROFILE_TABS} />
      <div>
        <h1 className="page-title">Your CV</h1>
        <p className="page-subtitle">
          Your master CV. JobScratch rewrites a tailored copy for each job, and this one stays as it is. Going for more
          than one kind of job? Add another CV for it: matching compares them and uses the one that fits each job best.
        </p>
      </div>

      {cv && (
        <div className="flex flex-wrap items-center gap-2" role="tablist" aria-label="Your CVs">
          {versions.map((version) => {
            const active = version.id === openKey;
            return (
              <button
                key={version.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setOpenId(version.id)}
                className={`rounded-lg border px-3 py-1.5 text-sm font-semibold transition-colors ${active ? "border-indigo-500 bg-indigo-50 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" : "border-zinc-200 text-zinc-600 hover:text-zinc-900 dark:border-zinc-800 dark:text-zinc-400 dark:hover:text-white"}`}
              >
                {version.name}
                {version.id !== MAIN_CV && !version.text.trim() && <span className="muted font-normal"> (empty)</span>}
              </button>
            );
          })}
          {versions.length < MAX_CVS && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={addCv}>
              <Plus size={14} aria-hidden /> Add another CV
            </button>
          )}
        </div>
      )}

      <CvEditor
        key={openKey}
        id={openKey}
        version={open}
        others={versions.length > 1}
        hydrated={hydrated}
        onChange={(patch) => change(openKey, patch)}
        onDelete={() => {
          setCv((previous) => withoutVersion(previous, openKey, new Date().toISOString()));
          setOpenId(MAIN_CV);
        }}
      />

      <SkillsProfile />
      <ApplicationDetailsForm />
      <ProfileLinks />
    </div>
  );
}

function CvEditor({
  id,
  version,
  others,
  hydrated,
  onChange,
  onDelete,
}: {
  id: string;
  version: CvVersion | undefined;
  /** Whether there's more than one CV. */
  others: boolean;
  hydrated: boolean;
  onChange: (patch: Partial<CvVersion>) => void;
  onDelete: () => void;
}) {
  const main = id === MAIN_CV;
  // Unsaved edits are kept for the session, so looking something up on another page doesn't lose them.
  const [draft, setDraft] = useSessionState<string | null>(`cv:draft:${id}`, null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<Message>(null);
  const [dragging, setDragging] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const name = useFieldDraft(version?.name ?? "", (text) => onChange({ name: text.trim() || version?.name }));

  const saved = version?.text ?? "";
  const text = draft ?? saved;
  const dirty = draft !== null && draft !== saved;
  const words = text.trim() ? text.trim().split(/\s+/).length : 0;

  async function upload(file: File) {
    setUploading(true);
    setMessage(null);
    try {
      const form = new FormData();
      form.append("file", file);
      const response = await fetch("/api/cv/parse", { method: "POST", body: form });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error ?? `Upload failed (HTTP ${response.status}). Try again.`);
      onChange({ text: data.text, fileName: data.fileName });
      setDraft(null);
      setMessage({ tone: "ok", text: `Read ${file.name}. Check the text below; fix anything that came through oddly.` });
    } catch (error) {
      setMessage({ tone: "error", text: (error as Error).message });
    } finally {
      setUploading(false);
    }
  }

  function onFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (file) void upload(file);
    event.target.value = "";
  }

  function onDrop(event: DragEvent) {
    event.preventDefault();
    setDragging(false);
    const file = event.dataTransfer.files?.[0];
    if (file) void upload(file);
  }

  function save() {
    if (!draft?.trim()) return;
    onChange({ text: draft.trim() });
    setDraft(null);
    setMessage({ tone: "ok", text: "Saved." });
  }

  return (
    <>
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={onDrop}
        className={`card flex flex-col items-center gap-2 border-2 border-dashed p-6 text-center ${dragging ? "border-indigo-400 bg-indigo-50/50 dark:bg-indigo-950/30" : ""}`}
      >
        <span className="avatar h-11 w-11">
          <Upload size={20} aria-hidden />
        </span>
        <p className="text-sm font-semibold">Drop {others ? `your ${version?.name ?? "CV"}` : "your CV"} here, or</p>
        <label className="btn btn-primary btn-sm">
          {uploading ? "Reading…" : "Choose a file"}
          <input
            type="file"
            accept=".pdf,.docx,.txt,.md,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain,text/markdown"
            className="sr-only"
            onChange={onFile}
            disabled={uploading}
          />
        </label>
        <p className="muted text-xs">PDF, Word (.docx), Markdown or plain text, up to 5 MB.</p>
      </div>

      {message && (
        <p
          role="status"
          className={`rounded-lg px-3 py-2 text-sm ${message.tone === "ok" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}
        >
          {message.text}
        </p>
      )}

      <div className="card space-y-3 p-4">
        {others && version && (
          <div className="grid gap-3 sm:grid-cols-[1fr_2fr]">
            <div>
              <label htmlFor="cv-name" className="label">
                Name
              </label>
              <input id="cv-name" className="input" maxLength={60} {...name} />
            </div>
            {main ? (
              <p className="muted self-end text-sm">
                Each job is matched against all your CVs and uses the one that fits it best. Title words on another CV, or
                a pick on the job’s page, decide it instead.
              </p>
            ) : (
              <div>
                <KeywordInput
                  label="Always use it for job titles with (optional)"
                  values={version.titles}
                  onChange={(titles) => onChange({ titles })}
                  draft={titleDraft}
                  onDraftChange={setTitleDraft}
                  placeholder="e.g. data analyst, BI, reporting"
                />
                <p className="muted mt-1 text-xs">
                  {version.titles.length
                    ? "Jobs whose titles have any of these always use this CV, without comparing."
                    : "Without any, matching decides which jobs this CV fits best."}
                </p>
              </div>
            )}
          </div>
        )}
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="cv-text" className="text-sm font-semibold">
            CV text {version?.fileName && <span className="muted font-normal">· from {version.fileName}</span>}
          </label>
          <span className="muted text-xs">{words} words</span>
        </div>
        <textarea
          id="cv-text"
          className="input min-h-[28rem] font-mono text-xs leading-relaxed"
          placeholder={hydrated ? "…or paste your CV here." : "Loading…"}
          value={text}
          onChange={(e) => setDraft(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" className="btn btn-primary" onClick={save} disabled={!dirty || !draft?.trim()}>
            Save CV
          </button>
          {dirty && (
            <button type="button" className="btn btn-ghost" onClick={() => setDraft(null)}>
              Discard changes
            </button>
          )}
          {version && !dirty && (
            <>
              {saved.trim() && (
                <Link href="/saved" className="btn btn-secondary">
                  Tailor it to a job
                </Link>
              )}
              <button
                type="button"
                className="btn btn-danger ml-auto"
                onClick={() => {
                  const question = !others
                    ? "Delete your saved CV?"
                    : main
                      ? `Delete ${version.name}? Your next CV becomes the main one.`
                      : `Delete ${version.name}? Jobs it was for go back to your main CV.`;
                  if (window.confirm(question)) {
                    setDraft(null);
                    onDelete();
                  }
                }}
              >
                Delete CV
              </button>
            </>
          )}
        </div>
      </div>
    </>
  );
}
