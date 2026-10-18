"use client";

import { Upload } from "lucide-react";
import Link from "next/link";
import { useState, type ChangeEvent, type DragEvent } from "react";
import { PROFILE_TABS, SectionTabs } from "@/components/Nav";
import { ProfileLinks } from "@/components/ProfileLinks";
import { useCv, useHydrated } from "@/lib/store";

export function CvView() {
  const hydrated = useHydrated();
  const [cv, setCv] = useCv();
  const [draft, setDraft] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [message, setMessage] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [dragging, setDragging] = useState(false);

  const text = draft ?? cv?.text ?? "";
  const dirty = draft !== null && draft !== (cv?.text ?? "");
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
      setCv({ text: data.text, fileName: data.fileName, updatedAt: new Date().toISOString() });
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
    setCv({ text: draft.trim(), fileName: cv?.fileName, updatedAt: new Date().toISOString() });
    setDraft(null);
    setMessage({ tone: "ok", text: "Saved." });
  }

  return (
    <div className="space-y-4">
      <SectionTabs tabs={PROFILE_TABS} />
      <div>
        <h1 className="page-title">Your CV</h1>
        <p className="page-subtitle">
          Your master CV. JobScratch rewrites a tailored copy for each job, and this one stays as it is. It’s stored only
          in this browser.
        </p>
      </div>

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
        <p className="text-sm font-semibold">Drop your CV here, or</p>
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
        <div className="flex flex-wrap items-center justify-between gap-2">
          <label htmlFor="cv-text" className="text-sm font-semibold">
            CV text {cv?.fileName && <span className="muted font-normal">· from {cv.fileName}</span>}
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
          {cv && !dirty && (
            <>
              <Link href="/saved" className="btn btn-secondary">
                Tailor it to a job
              </Link>
              <button
                type="button"
                className="btn btn-danger ml-auto"
                onClick={() => {
                  if (window.confirm("Delete your saved CV from this browser?")) {
                    setCv(null);
                    setDraft(null);
                  }
                }}
              >
                Delete CV
              </button>
            </>
          )}
        </div>
      </div>

      <ProfileLinks />
    </div>
  );
}
