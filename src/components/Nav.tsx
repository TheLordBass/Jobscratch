"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHydrated, useSavedJobs } from "@/lib/store";

/** Three sections; each covers the pages listed in `paths`. */
const SECTIONS = [
  { href: "/", label: "Find jobs", paths: ["/", "/import"] },
  { href: "/saved", label: "My jobs", paths: ["/saved", "/tailor"] },
  { href: "/cv", label: "Profile", paths: ["/cv", "/settings"] },
] as const;

export function inSection(pathname: string, paths: readonly string[]): boolean {
  return paths.some((path) => (path === "/" ? pathname === "/" : pathname.startsWith(path)));
}

export function Nav() {
  const pathname = usePathname();
  const { saved } = useSavedJobs();
  const hydrated = useHydrated();
  const savedCount = Object.keys(saved).length;

  return (
    <header className="sticky top-0 z-20 border-b border-zinc-200 bg-white/85 backdrop-blur dark:border-zinc-800 dark:bg-zinc-950/85">
      <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3 sm:px-6">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-indigo-600 text-sm text-white">J</span>
          <span className="hidden sm:inline">JobScratch</span>
        </Link>
        <nav className="-mx-1 flex flex-1 gap-1 overflow-x-auto" aria-label="Main">
          {SECTIONS.map(({ href, label, paths }) => {
            const active = inSection(pathname, paths);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`btn ${active ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white" : "btn-ghost"}`}
              >
                {label}
                {href === "/saved" && hydrated && savedCount > 0 && (
                  <span className="rounded-full bg-indigo-600 px-1.5 text-[10px] leading-4 text-white">{savedCount}</span>
                )}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

/** Switches between the pages inside one section, e.g. Search / Add a job. */
export function SectionTabs({ tabs }: { tabs: ReadonlyArray<{ href: string; label: string }> }) {
  const pathname = usePathname();
  return (
    <nav className="inline-flex rounded-lg bg-zinc-100 p-1 dark:bg-zinc-800/70" aria-label="Section">
      {tabs.map(({ href, label }) => {
        const active = pathname === href;
        return (
          <Link
            key={href}
            href={href}
            aria-current={active ? "page" : undefined}
            className={`rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${active ? "bg-white text-zinc-900 shadow-sm dark:bg-zinc-900 dark:text-white" : "text-zinc-600 hover:text-zinc-900 dark:text-zinc-400 dark:hover:text-white"}`}
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

export const PROFILE_TABS = [
  { href: "/cv", label: "CV & links" },
  { href: "/settings", label: "Settings" },
] as const;
