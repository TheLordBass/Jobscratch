"use client";

import { MessageSquarePlus, RotateCcw, Sparkles, Square, Trash2 } from "lucide-react";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { CopyButton } from "@/components/CopyButton";
import { DEFAULT_QUESTIONS, MAX_QUESTIONS, type ApplicationAnswer } from "@/lib/ai/prompts";
import type { JobTask } from "@/lib/job-tasks";

const PLACEHOLDER = "[add your answer]";

/**
 * A job's page → Answers: drafted answers to the questions on its application form, to copy into
 * the form. The usual questions, plus any you paste in from the form.
 */
export function AnswersPanel({
  answers = [],
  task,
  blocker,
  detailsMissing,
  onDraft,
  onChange,
  onStop,
}: {
  answers?: ApplicationAnswer[];
  task?: JobTask;
  /** Why answers can't be drafted yet (no CV or job description). */
  blocker?: string;
  /** No application details on the Profile page yet. */
  detailsMissing: boolean;
  /** `add` keeps the other answers; otherwise the usual questions are drafted afresh. */
  onDraft: (questions: string[], add: boolean) => void;
  onChange: (answers: ApplicationAnswer[]) => void;
  onStop: () => void;
}) {
  const [question, setQuestion] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const running = task?.status === "running";

  function ask(event: FormEvent) {
    event.preventDefault();
    if (question.trim().length < 3) return;
    onDraft([question.trim().slice(0, 500)], true);
    setQuestion("");
  }

  return (
    <div className="space-y-4">
      {running && (
        <div className="flex items-center gap-3 rounded-lg bg-indigo-50 px-3 py-2 text-xs text-indigo-800 dark:bg-indigo-950 dark:text-indigo-200" role="status">
          <span className="inline-block h-2 w-2 animate-pulse rounded-full bg-indigo-500" />
          <span className="flex-1">Drafting answers from your CV and the job…</span>
          <button type="button" className="btn btn-ghost btn-sm py-0.5" onClick={onStop}>
            <Square size={12} aria-hidden /> Stop
          </button>
        </div>
      )}
      {task?.status === "error" && (
        <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700 dark:bg-red-950 dark:text-red-300">{task.error}</p>
      )}
      {detailsMissing && (
        <p className="muted text-xs">
          Add your right to work, notice period and salary under{" "}
          <Link href="/cv" className="link">
            Profile → Application details
          </Link>{" "}
          and they’ll be used where a form asks for them.
        </p>
      )}

      {answers.length === 0 && !running ? (
        <div className="py-6 text-center text-sm">
          <p className="mb-1 font-medium">Answers for the application form</p>
          <p className="muted mx-auto mb-3 max-w-md">
            Drafts answers to the questions most forms ask, from your CV and this job, ready to copy and paste:
          </p>
          <ul className="muted mx-auto mb-4 max-w-sm space-y-0.5 text-left text-xs">
            {DEFAULT_QUESTIONS.map((q) => (
              <li key={q}>• {q}</li>
            ))}
          </ul>
          <button type="button" className="btn btn-primary" disabled={Boolean(blocker)} onClick={() => onDraft(DEFAULT_QUESTIONS, false)}>
            <Sparkles size={15} aria-hidden /> Draft answers
          </button>
          {blocker && <p className="muted mt-2 text-xs">{blocker}</p>}
        </div>
      ) : (
        <ol className="space-y-3">
          {answers.map((entry, i) => (
            <li key={`${entry.question}-${i}`} className="space-y-2 rounded-lg border border-zinc-100 p-3 dark:border-zinc-800">
              <p className="text-sm font-semibold">{entry.question}</p>
              {editing === i ? (
                <textarea
                  className="input min-h-32 text-sm leading-relaxed"
                  value={entry.answer}
                  onChange={(e) => onChange(answers.map((a, j) => (j === i ? { ...a, answer: e.target.value } : a)))}
                  aria-label={`Answer to: ${entry.question}`}
                />
              ) : (
                <p className="text-sm leading-relaxed whitespace-pre-wrap">{entry.answer}</p>
              )}
              {entry.answer.includes(PLACEHOLDER) && (
                <p className="text-xs text-amber-700 dark:text-amber-300">Fill in the {PLACEHOLDER} part before you paste it.</p>
              )}
              <div className="flex flex-wrap items-center gap-1.5">
                <CopyButton text={entry.answer} />
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setEditing(editing === i ? null : i)}>
                  {editing === i ? "Done" : "Edit"}
                </button>
                <span className="muted ml-auto text-xs tabular-nums">{entry.answer.trim().split(/\s+/).length} words</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-icon btn-sm"
                  onClick={() => onChange(answers.filter((_, j) => j !== i))}
                  aria-label={`Delete the answer to: ${entry.question}`}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}

      {(answers.length > 0 || running) && (
        <div className="space-y-2 border-t border-zinc-100 pt-3 dark:border-zinc-800">
          <form onSubmit={ask} className="flex flex-wrap gap-2">
            <input
              className="input min-w-0 flex-1 text-sm"
              value={question}
              maxLength={500}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Paste another question from the form"
              aria-label="Another question from the application form"
            />
            <button
              type="submit"
              className="btn btn-secondary btn-sm"
              disabled={Boolean(blocker) || running || question.trim().length < 3 || answers.length >= MAX_QUESTIONS * 2}
            >
              <MessageSquarePlus size={14} aria-hidden /> Draft an answer
            </button>
          </form>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            disabled={Boolean(blocker) || running}
            onClick={() => {
              if (window.confirm("Draft the usual questions again? Your edits to those answers will be replaced; your own questions stay.")) {
                onDraft(DEFAULT_QUESTIONS, true);
              }
            }}
          >
            <RotateCcw size={13} aria-hidden /> Redraft the usual questions
          </button>
        </div>
      )}
    </div>
  );
}
