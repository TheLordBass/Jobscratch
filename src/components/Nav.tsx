"use client";

import { BriefcaseBusiness, Check, Cloud, CloudAlert, CloudUpload, Loader2, LogOut, Menu, Search, UserRound, X } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { useHydrated, useSavedJobs } from "@/lib/store";
import { signOut, useSession } from "@/components/useSession";
import { startSync, useSyncState } from "@/lib/sync";
import { markBatchSeen, useBatches, type BatchRun } from "@/lib/batch-runs";
import { dismissTask, useJobTasks, type TaskKind } from "@/lib/job-tasks";
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
  // The phone menu is open for the page it was opened on, so going to another page closes it.
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const menuOpen = menuFor === pathname;

  // The sign-in page has nothing to sync yet; signing in reloads the page.
  const onLogin = pathname === "/login";
  useEffect(() => {
    if (!onLogin) startSync();
  }, [onLogin]);

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200/70 bg-white/75 backdrop-blur-lg dark:border-zinc-800/70 dark:bg-zinc-950/75">
      <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-2.5 sm:gap-6 sm:px-6 sm:py-3">
        <Link href="/" className="flex items-center gap-2.5 font-bold tracking-tight">
          <span className="grid h-8 w-8 place-items-center rounded-xl bg-linear-to-br from-indigo-500 to-violet-600 text-white shadow-sm shadow-indigo-600/30">
            <BriefcaseBusiness size={16} strokeWidth={2.25} aria-hidden />
          </span>
          <span className="text-lg">JobScratch</span>
        </Link>
        {onLogin ? null : (
          <>
            <nav className="-mx-1 hidden flex-1 gap-1 sm:flex" aria-label="Main">
              {SECTIONS.map(({ href, label, icon: Icon, paths }) => {
                const active = inSection(pathname, paths);
                return (
                  <Link
                    key={href}
                    href={href}
                    aria-current={active ? "page" : undefined}
                    className={`btn rounded-full ${active ? "bg-zinc-900 text-white shadow-sm hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100" : "btn-ghost"}`}
                  >
                    <Icon size={16} aria-hidden />
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
            <div className="ml-auto flex items-center gap-1 sm:ml-0">
              <SyncIndicator />
              <span className="hidden sm:inline-flex">
                <SignOutButton />
              </span>
              <button
                type="button"
                className="btn btn-ghost btn-icon -mr-1.5 h-10! w-10! sm:hidden"
                onClick={() => setMenuFor(menuOpen ? null : pathname)}
                aria-expanded={menuOpen}
                aria-controls="phone-menu"
                aria-label={menuOpen ? "Close menu" : "Open menu"}
              >
                {menuOpen ? <X size={20} aria-hidden /> : <Menu size={20} aria-hidden />}
              </button>
            </div>
          </>
        )}
      </div>
      {!onLogin && menuOpen && (
        <nav
          id="phone-menu"
          className="border-t border-zinc-200/70 px-4 pb-3 sm:hidden dark:border-zinc-800/70"
          aria-label="Main"
          onKeyDown={(event) => event.key === "Escape" && setMenuFor(null)}
        >
          <ul className="space-y-1 pt-2">
            {SECTIONS.map(({ href, label, icon: Icon, paths }) => {
              const active = inSection(pathname, paths);
              return (
                <li key={href}>
                  <Link
                    href={href}
                    aria-current={active ? "page" : undefined}
                    onClick={() => setMenuFor(null)}
                    className={`flex items-center gap-3 rounded-xl px-3 py-2.5 text-base font-semibold ${active ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "hover:bg-zinc-900/5 dark:hover:bg-white/5"}`}
                  >
                    <Icon size={18} aria-hidden />
                    <span className="flex-1">{label}</span>
                    {href === "/saved" && hydrated && savedCount > 0 && (
                      <span
                        className={`rounded-full px-2 text-xs leading-5 font-bold ${active ? "bg-white/20 text-white dark:bg-zinc-900/10 dark:text-zinc-900" : "bg-indigo-600 text-white"}`}
                      >
                        {savedCount}
                      </span>
                    )}
                  </Link>
                </li>
              );
            })}
          </ul>
          <SignOutButton wide />
        </nav>
      )}
      {!onLogin && <JobTasksBar />}
      <ScrollMemory />
    </header>
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
  answers: "Application answers",
};

function batchName(run: BatchRun): string {
  const jobs = (n: number) => `${n} ${n === 1 ? "job" : "jobs"}`;
  if (run.kind === "match") {
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
    <div className="mx-auto flex max-w-6xl flex-wrap gap-2 px-4 pb-2 sm:px-6" aria-live="polite">
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

/** `wide`: a full-width row with the account name, for the phone menu. */
function SignOutButton({ wide = false }: { wide?: boolean }) {
  const session = useSession();
  const [busy, setBusy] = useState(false);
  if (!session?.signedIn) return null;
  if (wide) {
    return (
      <button
        type="button"
        className="mt-2 flex w-full cursor-pointer items-center gap-3 rounded-xl border-t border-zinc-200/70 px-3 pt-3 pb-1 text-left text-sm text-zinc-600 dark:border-zinc-800/70 dark:text-zinc-400"
        onClick={() => {
          setBusy(true);
          void signOut();
        }}
        disabled={busy}
      >
        <LogOut size={18} aria-hidden />
        <span className="flex-1">
          Sign out <span className="muted">({session.username})</span>
        </span>
      </button>
    );
  }
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
