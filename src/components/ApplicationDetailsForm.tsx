"use client";

import { useState } from "react";
import { APPLICATION_DETAIL_LABELS, type ApplicationDetails } from "@/lib/ai/prompts";
import { useHydrated, useProfile } from "@/lib/store";

export const EMPTY_DETAILS: ApplicationDetails = { rightToWork: "", noticePeriod: "", salary: "", location: "", other: "" };

const PLACEHOLDERS: Record<keyof ApplicationDetails, string> = {
  rightToWork: "e.g. British citizen, no sponsorship needed",
  noticePeriod: "e.g. One month, or available straight away",
  salary: "e.g. £32,000–£38,000",
  location: "e.g. Manchester or remote; happy to travel to Leeds",
  other: "e.g. Full UK driving licence. Happy to work the occasional weekend.",
};

/**
 * Profile → your standard answers to the practical questions application forms ask. Drafted
 * answers use them, and the Apply page shows them for copying.
 */
export function ApplicationDetailsForm() {
  const hydrated = useHydrated();
  const [profile, setProfile] = useProfile();
  const saved = { ...EMPTY_DETAILS, ...profile.application };
  if (!hydrated) return null;
  return (
    <section className="card space-y-3 p-4" aria-labelledby="application-title">
      <div>
        <h2 id="application-title" className="font-semibold">
          Application details
        </h2>
        <p className="muted text-sm">
          Your answers to the questions most application forms ask. They’re used when Claude drafts a job’s application
          answers (and sent to Anthropic only then), and shown on the Apply page so you can copy them into forms.
        </p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        {(Object.keys(APPLICATION_DETAIL_LABELS) as Array<keyof ApplicationDetails>).map((key) => (
          <DetailField
            key={key}
            id={key}
            value={saved[key]}
            onSave={(value) =>
              setProfile((previous) => ({ ...previous, application: { ...EMPTY_DETAILS, ...previous.application, [key]: value } }))
            }
          />
        ))}
      </div>
    </section>
  );
}

/** Saved when you leave the box. */
function DetailField({ id, value, onSave }: { id: keyof ApplicationDetails; value: string; onSave: (value: string) => void }) {
  const [text, setText] = useState(value);
  const long = id === "other";
  const props = {
    id: `detail-${id}`,
    className: `input text-sm ${long ? "min-h-20" : ""}`,
    value: text,
    placeholder: PLACEHOLDERS[id],
    maxLength: long ? 2000 : 300,
    onChange: (e: { target: { value: string } }) => setText(e.target.value),
    onBlur: () => {
      if (text.trim() !== value) onSave(text.trim());
    },
  };
  return (
    <div className={long ? "sm:col-span-2" : ""}>
      <label className="label" htmlFor={props.id}>
        {APPLICATION_DETAIL_LABELS[id]}
      </label>
      {long ? <textarea {...props} /> : <input {...props} />}
    </div>
  );
}
