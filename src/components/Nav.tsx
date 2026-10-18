"use client";

import { BriefcaseBusiness, Check, Cloud, CloudAlert, CloudUpload, Loader2, LogOut, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useHydrated, useSavedJobs } from "@/lib/store";
import { signOut, useSession } from "@/components/useSession";
import { startSync, useSyncState } from "@/lib/sync";
import { dismissTask, useJobTasks, type TaskKind } from "@/lib/job-tasks";

/** Three sections; each covers the pages listed in `paths`. */
const SECTIONS = [
  { href: "/", label: "Find jobs", icon: Search, paths: ["/", "/import"] },
  { href: "/saved", label: "My jobs", icon: BriefcaseBusiness, paths: ["/saved", "/progress", "/tailor"] },
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
    if (!onLogin) startSync();
  }, [onLogin]);

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/75 backdrop-blur-lg dark:border-zinc-800/70 dark:bg-zinc-950/75">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3 sm:gap-6 sm:px-6">
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-600/30">
            <BriefcaseBusiness size={16} strokeWidth={2.25} aria-hidden />
          </span>
          <span className="hidden text-lg sm:inline">JobScratch</span>
        </Link>
        {onLogin ? null : (
          <>
            <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto" aria-label="Main">
              {SECTIONS.map(({ href, label, icon: Icon, paths }) => {
                const active = inSection(pathname, paths);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`btn rounded-full ${active ? "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100" : "btn-ghost"}`}
                  >
                    <Icon size={16} aria-hidden className="hidden sm:block" />
                    {label}
                    {href === "/saved" && hydrated && savedCount > 0 && (
                      <span
                        className={`rounded-full px-1.5 text-[10px] leading-4 font-bold ${active ? "bg-white/20 text-white dark:bg-zinc-900/10 dark:text-zinc-900" : "bg-indigo-600 text-white"}`}
                      >
                        {savedCount}
                      </span>
                    )}
                  </Link>
                );
              })}
            </nav>
            <SyncIndicator />
            <SignOutButton />
          </>
        )}
      </div>
      {!onLogin && <JobTasksBar />}
    </header>
  );
}

const TASK_NAMES: Record<TaskKind, string> = { analysis: "Match analysis", cv: "Tailored CV", coverLetter: "Cover letter" };

/** Analyses and documents being written in the background (lib/job-tasks.ts), and ones just finished. */
function JobTasksBar() {
  const tasks = useJobTasks().filter((task) => task.status === "running" || task.status === "done");
  if (tasks.length === 0) return null;
  return (
    <div className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 pb-2 sm:px-6" aria-live="polite">
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

/** Switches between the pages inside one section, e.g. Search / Add a job. */
export function SectionTabs({ tabs }: { tabs: ReadonlyArray<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="inline-flex rounded-xl border border-zinc-200/80 bg-zinc-100/80 p-1 dark:border-zinc-800 dark:bg-zinc-900" aria-label="Section">
      {tabs.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-lg px-3.5 py-1.5 text-sm font-semibold transition-colors ${active ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-800 dark:text-white" : "text-zinc-500 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
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
