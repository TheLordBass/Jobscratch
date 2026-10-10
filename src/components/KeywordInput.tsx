"use client";

import { useId, type KeyboardEvent } from "react";

export function splitTerms(text: string): string[] {
  return text
    .split(/[,;\n]/)
    .map((term) => term.trim())
    .filter(Boolean);
}

export function addTerms(existing: string[], text: string): string[] {
  const next = [...existing];
  for (const term of splitTerms(text)) {
    if (!next.some((t) => t.toLowerCase() === term.toLowerCase())) next.push(term);
  }
  return next;
}

interface Props {
  label: string;
  values: string[];
  onChange: (values: string[]) => void;
  draft: string;
  onDraftChange: (draft: string) => void;
  placeholder?: string;
  tone?: "default" | "exclude";
}

/** Chips input: type a term and press Enter or comma. Pasting "a, b, c" adds three. */
export function KeywordInput({ label, values, onChange, draft, onDraftChange, placeholder, tone = "default" }: Props) {
  const id = useId();

  const commit = () => {
    if (draft.trim()) {
      onChange(addTerms(values, draft));
      onDraftChange("");
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if ((event.key === "Enter" || event.key === ",") && draft.trim()) {
      event.preventDefault();
      commit();
    } else if (event.key === "Backspace" && !draft && values.length) {
      onChange(values.slice(0, -1));
    }
  };

  const chipClass =
    tone === "exclude"
      ? "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"
      : "bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300";

  return (
    <div>
      <label htmlFor={id} className="label">
        {label}
      </label>
      <div className="input flex min-h-10 flex-wrap items-center gap-1.5 py-1.5 focus-within:border-indigo-500 focus-within:ring-2 focus-within:ring-indigo-500/20">
        {values.map((value) => (
          <span key={value} className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-medium ${chipClass}`}>
            {value}
            <button
              type="button"
              className="cursor-pointer opacity-60 hover:opacity-100"
              aria-label={`Remove ${value}`}
              onClick={() => onChange(values.filter((v) => v !== value))}
            >
              ×
            </button>
          </span>
        ))}
        <input
          id={id}
          value={draft}
          onChange={(event) => {
            const text = event.target.value;
            if (/[,;\n]/.test(text)) {
              onChange(addTerms(values, text));
              onDraftChange("");
            } else {
              onDraftChange(text);
            }
          }}
          onKeyDown={onKeyDown}
          onBlur={commit}
          placeholder={values.length ? "" : placeholder}
          className="min-w-32 flex-1 bg-transparent py-0.5 outline-none placeholder:text-zinc-400"
        />
      </div>
    </div>
  );
}
