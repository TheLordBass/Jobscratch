"use client";

import { BriefcaseBusiness, Check, Cloud, CloudAlert, CloudUpload, Loader2, LogOut, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useHydrated, useSavedJobs, useTailored } from "@/lib/store";
import { useCurrentMatches } from "@/components/MatchAll";
import { stampMadeFrom } from "@/lib/candidate";
import { signOut, useSession } from "@/components/useSession";
import { startSync, useSyncState } from "@/lib/sync";
import { markBatchSeen, useBatches, type BatchRun } from "@/lib/batch-runs";
import { dismissTask, useJobTasks, type TaskKind } from "@/lib/job-tasks";
import { resumeMatchBatches } from "@/lib/match-batches";
import { resumeServerMatching } from "@/lib/server-matching";
import { useSearchState, useSearchUnseen } from "@/lib/search-session";

/** Three sections; each covers the pages listed in `paths`. */
const SECTIONS = [
  { href: "/", label: "Find jobs", icon: Search, paths: ["/", "/import"] },
  { href: "/saved", label: "My jobs", icon: BriefcaseBusiness, paths: ["/saved", "/apply", "/progress", "/tailor"] },
  { href: "/cv", label: "Profile", icon: UserRound, paths: ["/cv", "/settings"] },
] as const;

export function inSection(pathname: string, paths: readonly string[]): boolean {
  return paths.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
}

export function Nav() {
  const pathname = usePathname();
  const { saved } = useSavedJobs();
  const hydrated = useHydrated();
  const savedCount = Object.keys(saved).length;

  // The sign-in page has nothing to sync yet; signing in reloads the page.
  const onLogin = pathname === "/login";
  useEffect(() => {
    if (onLogin) return;
    startSync();
    // Matches sent from this phone before a reload: collected when they're back.
    resumeMatchBatches();
    // Matches the server is doing, started before a reload: their progress shows again.
    resumeServerMatching();
  }, [onLogin]);

  // Notes which tailored documents were made before the CV last changed, while their dates still tell.
  const [tailored, setTailored] = useTailored();
  const { candidate, hasCv } = useCurrentMatches();
  useEffect(() => {
    if (!hasCv) return;
    if (!Object.values(tailored).some((docs) => stampMadeFrom(docs, candidate))) return;
    const at = new Date().toISOString();
    setTailored((previous) => {
      const next = { ...previous };
      for (const [id, docs] of Object.entries(next)) {
        const stamp = stampMadeFrom(docs, candidate);
        if (stamp) next[id] = { ...docs, ...stamp, updatedAt: at };
      }
      return next;
    });
  }, [tailored, candidate, hasCv, setTailored]);

  const count = hydrated && savedCount > 0 ? savedCount : null;

  return (
    <>
      <header className="sticky top-0 z-20 border-b border-zinc-200 bg-zinc-50/85 pt-[env(safe-area-inset-top)] backdrop-blur-md dark:border-zinc-800 dark:bg-zinc-950/85">
        <div className="mx-auto flex h-14 max-w-5xl items-center gap-6 px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-zinc-900 text-white dark:bg-white dark:text-zinc-900">
              <BriefcaseBusiness size={15} strokeWidth={2.25} aria-hidden />
            </span>
            JobScratch
          </Link>
          {!onLogin && (
            <>
              <nav className="hidden flex-1 items-center gap-1 sm:flex" aria-label="Main">
                {SECTIONS.map(({ href, label, paths }) => {
                  const active = inSection(pathname, paths);
                  return (
                    <Link
                      key={href}
                      href={href}
                      aria-current={active ? "page" : undefined}
                      className={`flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-zinc-900/5 text-zinc-900 dark:bg-white/10 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
                    >
                      {label}
                      {href === "/saved" && count && <span className="text-xs text-zinc-400 tabular-nums dark:text-zinc-500">{count}</span>}
                    </Link>
                  );
                })}
              </nav>
              <div className="ml-auto flex items-center gap-1">
                <SyncIndicator />
                <SignOutButton />
              </div>
            </>
          )}
        </div>
        {!onLogin && <JobTasksBar />}
        <ScrollMemory />
      </header>
      {!onLogin && (
        <nav
          className="fixed inset-x-0 bottom-0 z-20 border-t border-zinc-200 bg-white/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-md sm:hidden dark:border-zinc-800 dark:bg-zinc-950/95"
          aria-label="Main"
        >
          <ul className="grid grid-cols-3">
            {SECTIONS.map(({ href, label, icon: Icon, paths }) => {
              const active = inSection(pathname, paths);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`flex h-16 flex-col items-center justify-center gap-1 text-xs font-medium ${active ? "text-zinc-900 dark:text-white" : "text-zinc-400 dark:text-zinc-500"}`}
                  >
                    <span className="relative">
                      <Icon size={22} strokeWidth={active ? 2.25 : 1.75} aria-hidden />
                      {href === "/saved" && count && (
                        <span className="absolute -top-1.5 left-4 min-w-4 rounded-full bg-indigo-600 px-1 text-center text-[10px] leading-4 font-semibold text-white tabular-nums">
                          {count}
                        </span>
                      )}
                    </span>
                    {label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </>
  );
}

/** Lists you scroll through, which come back where you left them. */
const SCROLL_PAGES = ["/", "/import", "/saved", "/apply", "/progress"];
const scrolledTo = new Map<string, number>();

/**
 * Going back to a list from the navigation (not only with the browser's back button) returns to
 * where you were in it, so after opening a job you carry on from that job rather than the top.
 */
function ScrollMemory() {
  const pathname = usePathname();
  useEffect(() => {
    if (!SCROLL_PAGES.includes(pathname)) return;
    const top = scrolledTo.get(pathname);
    // After Next.js has scrolled the page it's shown to the top.
    const frame = top ? window.requestAnimationFrame(() => window.scrollTo({ top })) : 0;
    const onScroll = () => scrolledTo.set(pathname, window.scrollY);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      window.cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
    };
  }, [pathname]);
  return null;
}

const TASK_NAMES: Record<TaskKind, string> = {
  analysis: "Match analysis",
  cv: "Tailored CV",
  coverLetter: "Cover letter",
  interview: "Interview prep",
  testPrep: "Test prep",
  outreach: "Message",
  followUp: "Follow-up",
  answers: "Application answers",
};

function batchName(run: BatchRun): string {
  const jobs = (n: number) => `${n} ${n === 1 ? "job" : "jobs"}`;
  if (run.kind === "match") {
    if (run.status === "running" && run.background) return `Claude is matching ${jobs(run.total - run.done)}`;
    return run.status === "running" ? `Matching ${run.done} of ${jobs(run.total)}` : `Matched ${jobs(run.done - run.failed)}`;
  }
  return run.status === "running"
    ? `Writing ${run.what}: ${run.done} of ${jobs(run.total)}`
    : `Wrote ${run.what} for ${jobs(run.done - run.failed)}`;
}

/**
 * What's running in the background while you're on another page, and what's just finished: a search,
 * Match all and Tailor top matches (lib/batch-runs.ts), and one job's analysis and documents
 * (lib/job-tasks.ts).
 */
function JobTasksBar() {
  const pathname = usePathname();
  const tasks = useJobTasks().filter((task) => task.status === "running" || task.status === "done");
  // A run on the page you're on shows there.
  const batches = useBatches().filter((run) => run.status !== "seen" && run.page !== pathname);
  const [search] = useSearchState();
  const [unseen, setUnseen] = useSearchUnseen();
  const elsewhere = pathname !== "/";
  const searching = search.status === "loading" && elsewhere ? search.label : null;
  const searched =
    unseen && elsewhere
      ? search.status === "done"
        ? `Search done: ${search.response.jobs.length} ${search.response.jobs.length === 1 ? "job" : "jobs"} for ${search.label}`
        : search.status === "error"
          ? "Search failed"
          : null
      : null;
  if (tasks.length === 0 && batches.length === 0 && !searching && !searched) return null;
  return (
    <div className="mx-auto flex max-w-5xl flex-wrap gap-2 px-4 pb-2.5 sm:px-6" aria-live="polite">
      {searching && (
        <span className="chip gap-2 py-1">
          <Loader2 size={13} className="animate-spin" aria-hidden />
          <Link href="/" className="hover:underline">
            Searching: {searching}
          </Link>
        </span>
      )}
      {searched && (
        <span
          className={`chip gap-2 py-1 ${search.status === "done" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : "bg-red-50 text-red-700 dark:bg-red-950 dark:text-red-300"}`}
        >
          {search.status === "done" ? <Check size={13} aria-hidden /> : <X size={13} aria-hidden />}
          <Link href="/" className="hover:underline">
            {searched}
          </Link>
          <button type="button" className="cursor-pointer opacity-70 hover:opacity-100" onClick={() => setUnseen(false)} aria-label="Dismiss">
            <X size={13} aria-hidden />
          </button>
        </span>
      )}
      {batches.map((run) => (
        <span
          key={`${run.kind}:${run.page}`}
          className={`chip gap-2 py-1 ${run.status === "done" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : ""}`}
        >
          {run.status === "running" ? <Loader2 size={13} className="animate-spin" aria-hidden /> : <Check size={13} aria-hidden />}
          <Link href={run.page} className="hover:underline">
            {batchName(run)}
          </Link>
          {run.status === "done" && (
            <button
              type="button"
              className="cursor-pointer opacity-70 hover:opacity-100"
              onClick={() => markBatchSeen(run.kind, run.page)}
              aria-label="Dismiss"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </span>
      ))}
      {tasks.map((task) => (
        <span
          key={`${task.jobId}:${task.kind}`}
          className={`chip gap-2 py-1 ${task.status === "done" ? "bg-emerald-50 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-200" : ""}`}
        >
          {task.status === "running" ? (
            <Loader2 size={13} className="animate-spin" aria-hidden />
          ) : (
            <Check size={13} aria-hidden />
          )}
          <Link href={`/tailor?job=${encodeURIComponent(task.jobId)}`} className="hover:underline">
            {TASK_NAMES[task.kind]} {task.status === "running" ? "in progress" : "ready"}: {task.label}
          </Link>
          {task.status === "done" && (
            <button
              type="button"
              className="cursor-pointer opacity-70 hover:opacity-100"
              onClick={() => dismissTask(task.jobId, task.kind)}
              aria-label="Dismiss"
            >
              <X size={13} aria-hidden />
            </button>
          )}
        </span>
      ))}
    </div>
  );
}

/** Switches between the pages inside one section, e.g. Search / Add a job: a row of tabs over the page. */
export function SectionTabs({ tabs }: { tabs: ReadonlyArray<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="-mx-4 flex gap-5 overflow-x-auto border-b border-zinc-200 px-4 sm:mx-0 sm:px-0 dark:border-zinc-800" aria-label="Section">
      {tabs.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`-mb-px border-b-2 py-2.5 text-sm font-medium whitespace-nowrap transition-colors ${active ? "border-zinc-900 text-zinc-900 dark:border-white dark:text-white" : "border-transparent text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
          >
            {label}
          </Link>
        );
      })}
    </nav>
  );
}

export const FIND_TABS = [
  { href: "/", label: "Search" },
  { href: "/import", label: "Add a job" },
] as const;

export const MY_JOBS_TABS = [
  { href: "/saved", label: "Jobs" },
  { href: "/apply", label: "Apply" },
  { href: "/progress", label: "Progress" },
] as const;

export const PROFILE_TABS = [
  { href: "/cv", label: "CV & links" },
  { href: "/settings", label: "Settings" },
] as const;

/** Whether changes are saved to server storage. Hidden when server storage isn't set up. */
function SyncIndicator() {
  const sync = useSyncState();
  if (sync.status === "checking" || sync.status === "off") return null;
  const [Icon, label, tone] =
    sync.status === "saving"
      ? [CloudUpload, "Saving to the server…", "text-indigo-500"]
      : sync.status === "error"
        ? [CloudAlert, `Not saved to the server yet (${sync.message}). Retrying; your changes are kept in this browser.`, "text-amber-500"]
        : [Cloud, "Saved to the server", "text-zinc-400 dark:text-zinc-500"];
  return (
    <Link href="/settings" className={`shrink-0 ${tone}`} title={label} aria-label={label}>
      <Icon size={18} aria-hidden className={sync.status === "saving" ? "animate-pulse" : undefined} />
    </Link>
  );
}

function SignOutButton() {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  if (!session?.signedIn) return null;
  return (
    <button
      type="button"
      className="btn btn-ghost btn-sm btn-icon shrink-0"
      onClick={() => {
        setBusy(true);
        void signOut();
      }}
      disabled={busy}
      title={`Signed in as ${session.username}. Sign out`}
      aria-label="Sign out"
    >
      <LogOut size={16} aria-hidden />
    </button>
  );
}
