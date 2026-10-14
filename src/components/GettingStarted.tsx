"use client";

import { ArrowRight, Bookmark, Check, FileText, Sparkles } from "lucide-react";
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
      icon: FileText,
      title: "Add your CV",
      body: "Upload it once. Each job gets its own tailored copy.",
      action: { href: "/cv", label: "Add CV" },
    },
    {
      done: jobs.length > 0,
      icon: Bookmark,
      title: "Save a job",
      body: "Search below, or bring one in from LinkedIn or any link.",
      action: { href: "/import", label: "Add a job" },
    },
    {
      done: Object.values(tailored).some((docs) => docs.cv),
      icon: Sparkles,
      title: "Tailor and apply",
      body: "Open a saved job to check your match and write a tailored CV.",
      action: jobs[0]
        ? { href: `/tailor?job=${encodeURIComponent(jobs[0].job.id)}`, label: "Open job" }
        : { href: "/saved", label: "My jobs" },
    },
  ];
  if (!hydrated || steps.every((step) => step.done)) return null;
  const next = steps.findIndex((step) => !step.done);
  const doneCount = steps.filter((step) => step.done).length;

  return (
    <section className="card overflow-hidden" aria-labelledby="getting-started">
      <div className="flex items-center justify-between gap-3 border-b border-zinc-100 px-4 py-3 dark:border-zinc-800">
        <h2 id="getting-started" className="text-sm font-bold">
          Getting started
        </h2>
        <div className="flex items-center gap-2">
          <span className="muted text-xs font-medium">
            {doneCount} of {steps.length} done
          </span>
          <span className="h-1.5 w-20 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800" aria-hidden>
            <span
              className="block h-full rounded-full bg-indigo-600"
              style={{ width: `${(doneCount / steps.length) * 100}%` }}
            />
          </span>
        </div>
      </div>
      <ol className="grid divide-y divide-zinc-100 sm:grid-cols-3 sm:divide-x sm:divide-y-0 dark:divide-zinc-800">
        {steps.map((step, i) => {
          const Icon = step.icon;
          const current = i === next;
          return (
            <li key={step.title} className={`flex gap-3 p-4 ${current ? "bg-indigo-50/60 dark:bg-indigo-950/30" : ""}`}>
              <span
                className={`grid h-9 w-9 shrink-0 place-items-center rounded-xl ${step.done ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-400" : current ? "bg-indigo-600 text-white shadow-sm shadow-indigo-600/30" : "bg-zinc-100 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400"}`}
                aria-hidden
              >
                {step.done ? <Check size={17} strokeWidth={2.5} /> : <Icon size={17} />}
              </span>
              <div className="min-w-0 space-y-1">
                <p className={`text-sm font-bold ${step.done ? "muted line-through" : ""}`}>
                  {step.title}
                  {step.done && <span className="sr-only"> (done)</span>}
                </p>
                {!step.done && (
                  <>
                    <p className="muted text-xs leading-relaxed">{step.body}</p>
                    {current && (
                      <Link href={step.action.href} className="btn btn-primary btn-sm mt-1">
                        {step.action.label} <ArrowRight size={13} aria-hidden />
                      </Link>
                    )}
                  </>
                )}
              </div>
            </li>
          );
        })}
      </ol>
    </section>
  );
}
