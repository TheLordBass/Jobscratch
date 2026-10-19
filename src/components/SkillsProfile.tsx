"use client";

import { Check, Plus, Trash2 } from "lucide-react";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import type { ExtraSkill } from "@/lib/ai/prompts";
import { useHydrated, useMatches, useProfile, useSavedJobs, useTailored } from "@/lib/store";
import { hasSkill, skillTrends } from "@/lib/trends";

const SHOWN = 15;

/**
 * Profile → which skills your saved jobs keep asking for, and the skills and experience you've
 * added because your CV doesn't show them (sent with every analysis, CV and cover letter).
 */
export function SkillsProfile() {
  const hydrated = useHydrated();
  const [profile, setProfile] = useProfile();
  const { saved } = useSavedJobs();
  const [tailored] = useTailored();
  const [matches] = useMatches();
  const [name, setName] = useState("");
  const [detail, setDetail] = useState("");
  const [showAll, setShowAll] = useState(false);
  const detailInput = useRef<HTMLInputElement>(null);

  const skills = profile.skills ?? [];
  const setSkills = (next: ExtraSkill[]) => setProfile((previous) => ({ ...previous, skills: next }));
  const { analysed, trends } = skillTrends(saved, (id) => tailored[id]?.analysis ?? matches[id]?.analysis);
  const shown = showAll ? trends : trends.slice(0, SHOWN);

  function add(event: FormEvent) {
    event.preventDefault();
    if (!name.trim()) return;
    const entry = { name: name.trim().slice(0, 100), detail: detail.trim().slice(0, 500) };
    setSkills(hasSkill(skills, entry.name) ? skills.map((s) => (hasSkill([s], entry.name) ? entry : s)) : [...skills, entry]);
    setName("");
    setDetail("");
  }

  if (!hydrated) return null;

  return (
    <>
      <section className="card space-y-3 p-4" aria-labelledby="trends-title">
        <div>
          <h2 id="trends-title" className="font-semibold">
            What your jobs ask for
          </h2>
          <p className="muted text-sm">
            {analysed === 0
              ? "Once your saved jobs have a match analysis (Match all on My jobs, or Analyse match on a job), the skills they ask for most show here."
              : `The skills asked for most across the ${analysed} saved ${analysed === 1 ? "job" : "jobs"} with a match analysis. Add the ones you have that your CV doesn't show.`}
          </p>
        </div>
        {analysed === 0 ? (
          <Link href="/saved" className="btn btn-secondary btn-sm">
            Go to My jobs
          </Link>
        ) : (
          <>
            <ul className="divide-y divide-zinc-100 rounded-lg border border-zinc-200 dark:divide-zinc-800 dark:border-zinc-800">
              {shown.map((trend) => {
                const added = hasSkill(skills, trend.name);
                return (
                  <li key={trend.name} className="flex flex-wrap items-center gap-2 px-3 py-2 text-sm">
                    <span className="min-w-0 flex-1">
                      <span className="font-medium">{trend.name}</span>
                      <span className="muted text-xs">
                        {" "}
                        · {trend.jobs} of {analysed} {analysed === 1 ? "job" : "jobs"}
                        {trend.applied > 0 && `, ${trend.applied} applied`}
                      </span>
                    </span>
                    {trend.inCv ? (
                      <span className="chip bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300">
                        <Check size={12} aria-hidden /> In your CV
                      </span>
                    ) : added ? (
                      <span className="chip bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300">
                        <Check size={12} aria-hidden /> In your profile
                      </span>
                    ) : (
                      <button
                        type="button"
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                          setName(trend.name);
                          setDetail("");
                          detailInput.current?.focus();
                          detailInput.current?.scrollIntoView({ block: "center", behavior: "smooth" });
                        }}
                      >
                        <Plus size={13} aria-hidden /> I have this
                      </button>
                    )}
                  </li>
                );
              })}
            </ul>
            {trends.length > SHOWN && (
              <button type="button" className="link cursor-pointer text-xs" onClick={() => setShowAll(!showAll)}>
                {showAll ? "Show fewer" : `Show all ${trends.length}`}
              </button>
            )}
          </>
        )}
      </section>

      <section className="card space-y-3 p-4" aria-labelledby="skills-title">
        <div>
          <h2 id="skills-title" className="font-semibold">
            Skills and experience not in your CV
          </h2>
          <p className="muted text-sm">
            Claude uses these with every match analysis, tailored CV and cover letter, as your own account of real
            experience: say where and how you used each, so it can describe it truthfully. A job’s own notes can add more for
            that job.
          </p>
        </div>
        {skills.length > 0 && (
          <ul className="space-y-1.5">
            {skills.map((skill) => (
              <li key={skill.name} className="flex items-start gap-2 rounded-lg border border-zinc-200 px-3 py-2 text-sm dark:border-zinc-800">
                <span className="min-w-0 flex-1">
                  <span className="font-medium">{skill.name}</span>
                  {skill.detail ? <span className="muted">: {skill.detail}</span> : <span className="muted text-xs"> (no detail yet)</span>}
                </span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon"
                  aria-label={`Remove ${skill.name}`}
                  onClick={() => setSkills(skills.filter((s) => s !== skill))}
                >
                  <Trash2 size={14} aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        )}
        <form onSubmit={add} className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr_auto]">
          <input
            className="input"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Skill, e.g. Tableau"
            aria-label="Skill"
            maxLength={100}
          />
          <input
            ref={detailInput}
            className="input"
            value={detail}
            onChange={(e) => setDetail(e.target.value)}
            placeholder="Where and how, e.g. built weekly sales dashboards at Acme for two years"
            aria-label="Where and how you used it"
            maxLength={500}
          />
          <button type="submit" className="btn btn-primary" disabled={!name.trim()}>
            <Plus size={15} aria-hidden /> Add
          </button>
        </form>
      </section>
    </>
  );
}
