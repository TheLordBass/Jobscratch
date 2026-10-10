"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useHydrated, useSavedJobs } from "@/lib/store";

const LINKS = [
  { href: "/", label: "Search" },
  { href: "/saved", label: "Saved" },
  { href: "/cv", label: "My CV" },
  { href: "/tailor", label: "Tailor" },
  { href: "/import", label: "Import" },
  { href: "/settings", label: "Settings" },
] as const;

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
          {LINKS.map(({ href, label }) => {
            const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
            return (
              <Link
                key={href}
                href={href}
                aria-current={active ? "page" : undefined}
                className={`btn btn-sm ${active ? "bg-zinc-100 text-zinc-900 dark:bg-zinc-800 dark:text-white" : "btn-ghost"}`}
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
