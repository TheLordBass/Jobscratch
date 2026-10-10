"use client";

import Link from "next/link";
import { useCv, useHydrated, useSavedJobs, useTailored } from "@/lib/store";

/** The three steps to a first application, until they're all done. */
export function GettingStarted() {
  const hydrated = useHydrated();
  const [cv] = useCv();
  const { saved } = useSavedJobs();
  const [tailored] = useTailored();

  const jobs = Object.values(saved).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  const steps = [
    {
      done: (cv?.text.trim().length ?? 0) >= 50,
      title: "Add your CV",
      body: "Upload it once. Each job gets its own tailored copy.",
      action: { href: "/cv", label: "Add CV" },
    },
    {
      done: jobs.length > 0,
      title: "Save a job",
      body: "Search below, or bring one in from LinkedIn or any link.",
      action: { href: "/import", label: "Add a job" },
    },
    {
      done: Object.values(tailored).some((docs) => docs.cv),
      title: "Tailor and apply",
      body: "Open a saved job to check your match and write a tailored CV.",
      action: jobs[0]
        ? { href: `/tailor?job=${encodeURIComponent(jobs[0].job.id)}`, label: "Open job" }
        : { href: "/saved", label: "My jobs" },
    },
  ];
  if (!hydrated || steps.every((step) => step.done)) return null;
  const next = steps.findIndex((step) => !step.done);

  return (
    <section className="card p-4" aria-labelledby="getting-started">
      <h2 id="getting-started" className="mb-3 text-sm font-semibold">
        Getting started
      </h2>
      <ol className="grid gap-3 sm:grid-cols-3">
        {steps.map((step, i) => (
          <li
            key={step.title}
            className={`flex gap-3 rounded-lg p-3 ${i === next ? "bg-indigo-50 dark:bg-indigo-950/40" : "bg-zinc-50 dark:bg-zinc-800/40"}`}
          >
            <span
              className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-xs font-semibold ${step.done ? "bg-emerald-600 text-white" : i === next ? "bg-indigo-600 text-white" : "bg-zinc-200 text-zinc-600 dark:bg-zinc-700 dark:text-zinc-300"}`}
              aria-hidden
            >
              {step.done ? "✓" : i + 1}
            </span>
            <div className="min-w-0 space-y-1">
              <p className={`text-sm font-medium ${step.done ? "muted line-through" : ""}`}>
                {step.title}
                {step.done && <span className="sr-only"> (done)</span>}
              </p>
              {!step.done && (
                <>
                  <p className="muted text-xs">{step.body}</p>
                  {i === next && (
                    <Link href={step.action.href} className="btn btn-primary btn-sm">
                      {step.action.label}
                    </Link>
                  )}
                </>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
