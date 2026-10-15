"use client";

import { ArrowRight, Table2, BarChart3 } from "lucide-react";
import Link from "next/link";
import { useMemo, useState, type ReactNode } from "react";
import { MY_JOBS_TABS, SectionTabs } from "@/components/Nav";
import { progressStats, type SiteCount, type WeekCount } from "@/lib/progress";
import { useHydrated, useSavedJobs } from "@/lib/store";

const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`;
const weekLabel = (iso: string) => new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" });
const percent = (ratio: number) => `${Math.round(ratio * 100)}%`;

function StatTile({ label, value, detail }: { label: string; value: string; detail: string }) {
  return (
    <div className="card p-4">
      <p className="muted text-xs font-semibold">{label}</p>
      <p className="mt-1 text-3xl font-bold tracking-tight">{value}</p>
      <p className="muted mt-1 text-xs">{detail}</p>
    </div>
  );
}

/** A chart with a button to see the same numbers as a table. */
function ChartCard({ title, subtitle, table, children }: { title: string; subtitle: string; table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <section className="card viz space-y-4 p-4">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h2 className="font-semibold">{title}</h2>
          <p className="muted text-sm">{subtitle}</p>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-sm"
          onClick={() => setAsTable(!asTable)}
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 size={14} aria-hidden /> : <Table2 size={14} aria-hidden />}
          {asTable ? "Chart" : "Table"}
        </button>
      </div>
      {asTable ? table : children}
    </section>
  );
}

/** Round numbers for the y-axis, at most about five steps. */
function axisTicks(max: number): number[] {
  const step = [1, 2, 5, 10, 20, 50, 100].find((s) => max / s <= 5) ?? Math.ceil(max / 500) * 100;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

function WeeklyChart({ weeks }: { weeks: WeekCount[] }) {
  const ticks = axisTicks(Math.max(...weeks.map((week) => week.count)));
  const top = ticks[ticks.length - 1];
  const last = weeks.length - 1;
  const height = (value: number) => `${(value / top) * 100}%`;

  return (
    <div className="flex gap-2" aria-hidden={false}>
      <div className="muted relative h-44 w-5 shrink-0 text-right text-[11px] tabular-nums" aria-hidden>
        {ticks.map((tick) => (
          <span key={tick} className="absolute right-0 translate-y-1/2 leading-none" style={{ bottom: height(tick) }}>
            {tick}
          </span>
        ))}
      </div>
      <div className="min-w-0 flex-1">
        <div className="relative h-44">
          {ticks.map((tick) => (
            <div
              key={tick}
              className={`absolute inset-x-0 border-t ${tick === 0 ? "border-(--viz-axis)" : "border-(--viz-grid)"}`}
              style={{ bottom: height(tick) }}
              aria-hidden
            />
          ))}
          <ul className="absolute inset-0 flex" aria-label="Applications per week">
            {weeks.map((week, i) => {
              const label = `${plural(week.count, "application")}, week of ${weekLabel(week.start)}`;
              const align = i === 0 ? "left-0" : i === last ? "right-0" : "left-1/2 -translate-x-1/2";
              return (
                <li
                  key={week.start}
                  tabIndex={0}
                  aria-label={label}
                  className="group relative flex h-full flex-1 items-end justify-center rounded-md outline-none hover:bg-zinc-900/[0.03] focus-visible:bg-zinc-900/5 focus-visible:ring-2 focus-visible:ring-indigo-500 dark:hover:bg-white/[0.03] dark:focus-visible:bg-white/5"
                >
                  <div
                    className="w-3/5 max-w-6 rounded-t-[4px] bg-(--viz-series) transition group-hover:brightness-110"
                    style={{ height: height(week.count) }}
                  />
                  {i === last && week.count > 0 && (
                    <span
                      className="absolute left-1/2 -translate-x-1/2 pb-1 text-xs font-semibold group-hover:invisible group-focus-visible:invisible"
                      style={{ bottom: height(week.count) }}
                      aria-hidden
                    >
                      {week.count}
                    </span>
                  )}
                  <div
                    role="tooltip"
                    className={`pointer-events-none absolute z-10 mb-2 hidden rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md group-hover:block group-focus-visible:block dark:border-zinc-700 dark:bg-zinc-900 ${align}`}
                    style={{ bottom: height(week.count) }}
                  >
                    <strong className="block text-sm">{plural(week.count, "application")}</strong>
                    <span className="muted">Week of {weekLabel(week.start)}</span>
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
        <div className="muted mt-1.5 flex text-[11px]" aria-hidden>
          {weeks.map((week, i) => (
            // On small screens every other week is labelled, so the dates don't run into each other.
            <span key={week.start} className={`flex-1 text-center ${(last - i) % 2 ? "invisible sm:visible" : ""}`}>
              {i === last ? "This week" : weekLabel(week.start)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function WeeklyTable({ weeks }: { weeks: WeekCount[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="muted border-b border-zinc-200 text-left text-xs dark:border-zinc-800">
          <th className="py-1.5 font-semibold">Week of</th>
          <th className="py-1.5 text-right font-semibold">Applications</th>
        </tr>
      </thead>
      <tbody>
        {[...weeks].reverse().map((week) => (
          <tr key={week.start} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
            <td className="py-1.5">{weekLabel(week.start)}</td>
            <td className="py-1.5 text-right tabular-nums">{week.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function SiteChart({ sites }: { sites: SiteCount[] }) {
  const most = Math.max(...sites.map((site) => site.applied));
  return (
    <div className="space-y-3">
      <div className="muted flex flex-wrap gap-x-4 gap-y-1 text-xs">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-(--viz-series)" aria-hidden /> Led to an interview
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-[2px] bg-(--viz-rest)" aria-hidden /> No interview yet
        </span>
      </div>
      <ul className="space-y-2.5">
        {sites.map((site) => {
          const rest = site.applied - site.interviews;
          return (
            <li
              key={site.name}
              tabIndex={0}
              aria-label={`${site.name}: ${plural(site.interviews, "interview")} from ${plural(site.applied, "application")}`}
              className="group relative grid grid-cols-[minmax(0,8rem)_1fr] items-center gap-3 rounded-md text-sm outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
            >
              <span className="truncate" title={site.name}>
                {site.name}
              </span>
              <div className="flex min-w-0 items-center gap-2">
                <div
                  className="flex h-3.5 gap-[2px] overflow-hidden rounded-r-[4px] transition group-hover:brightness-110"
                  style={{ width: `calc((100% - 4.5rem) * ${site.applied / most})` }}
                  aria-hidden
                >
                  {site.interviews > 0 && <div className="h-full bg-(--viz-series)" style={{ flex: site.interviews }} />}
                  {rest > 0 && <div className="h-full bg-(--viz-rest)" style={{ flex: rest }} />}
                </div>
                <span className="muted shrink-0 text-xs tabular-nums" aria-hidden>
                  {site.interviews} of {site.applied}
                </span>
              </div>
              <div
                role="tooltip"
                className="pointer-events-none absolute bottom-full left-[min(8rem,40%)] z-10 mb-1 hidden rounded-lg border border-zinc-200 bg-white px-2.5 py-1.5 text-xs whitespace-nowrap shadow-md group-hover:block group-focus-visible:block dark:border-zinc-700 dark:bg-zinc-900"
              >
                <strong className="block text-sm">{plural(site.interviews, "interview")}</strong>
                <span className="muted">
                  from {plural(site.applied, "application")} ({percent(site.interviews / site.applied)})
                </span>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

function SiteTable({ sites }: { sites: SiteCount[] }) {
  return (
    <table className="w-full text-sm">
      <thead>
        <tr className="muted border-b border-zinc-200 text-left text-xs dark:border-zinc-800">
          <th className="py-1.5 font-semibold">Site</th>
          <th className="py-1.5 text-right font-semibold">Applications</th>
          <th className="py-1.5 text-right font-semibold">Interviews</th>
          <th className="py-1.5 text-right font-semibold">Rate</th>
        </tr>
      </thead>
      <tbody>
        {sites.map((site) => (
          <tr key={site.name} className="border-b border-zinc-100 last:border-0 dark:border-zinc-800/60">
            <td className="py-1.5">{site.name}</td>
            <td className="py-1.5 text-right tabular-nums">{site.applied}</td>
            <td className="py-1.5 text-right tabular-nums">{site.interviews}</td>
            <td className="py-1.5 text-right tabular-nums">{percent(site.interviews / site.applied)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export function ProgressView() {
  const hydrated = useHydrated();
  const { saved } = useSavedJobs();
  // Only in the browser: the weeks depend on today's date, which a prerender would fix at build time.
  const stats = useMemo(() => (hydrated ? progressStats(saved) : null), [hydrated, saved]);

  const header = (
    <>
      <SectionTabs tabs={MY_JOBS_TABS} />
      <div>
        <h1 className="page-title">Progress</h1>
        <p className="page-subtitle">How your applications are going. Change a job’s status in My jobs and it’s counted here.</p>
      </div>
    </>
  );

  if (!stats) {
    return (
      <div className="space-y-6">
        {header}
        <div className="card muted p-8 text-center text-sm">Loading…</div>
      </div>
    );
  }

  const thisWeek = stats.weeks[stats.weeks.length - 1]?.count ?? 0;
  const lastWeek = stats.weeks[stats.weeks.length - 2]?.count ?? 0;
  const anyRecent = stats.weeks.some((week) => week.count > 0);

  return (
    <div className="space-y-6">
      {header}

      {stats.applied === 0 ? (
        <div className="card space-y-3 p-8 text-center">
          <p className="font-semibold">No applications yet</p>
          <p className="muted text-sm">
            When you apply for a job, set it to Applied in My jobs. Then set it to Interviewing or Offer when you hear
            back, and your progress shows up here.
          </p>
          <Link href="/saved" className="btn btn-secondary">
            Go to My jobs <ArrowRight size={14} aria-hidden />
          </Link>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatTile
              label="Applications"
              value={String(stats.applied)}
              detail={`${thisWeek} this week, ${lastWeek} last week`}
            />
            <StatTile
              label="Interviews"
              value={String(stats.interviews)}
              detail={`${percent(stats.interviewRate ?? 0)} of applications got one`}
            />
            <StatTile label="Offers" value={String(stats.offers)} detail={`${plural(stats.now.rejected, "job")} closed`} />
            <StatTile label="Still to apply" value={String(stats.now.saved)} detail="saved, not applied yet" />
          </div>

          <ChartCard
            title="Applications per week"
            subtitle="The last 8 weeks, by the day you set each job to Applied."
            table={<WeeklyTable weeks={stats.weeks} />}
          >
            {anyRecent ? (
              <WeeklyChart weeks={stats.weeks} />
            ) : (
              <p className="muted text-sm">No applications in the last 8 weeks.</p>
            )}
          </ChartCard>

          <ChartCard
            title="Where interviews came from"
            subtitle="Each bar is the applications you sent through a site; the blue part led to an interview or an offer."
            table={<SiteTable sites={stats.sites} />}
          >
            <SiteChart sites={stats.sites} />
          </ChartCard>

          {stats.estimated > 0 && (
            <p className="muted text-xs">
              {plural(stats.estimated, "application was", "applications were")} marked before JobScratch kept dates, so{" "}
              {stats.estimated === 1 ? "it’s" : "they’re"} dated by the last time {stats.estimated === 1 ? "it was" : "they were"} changed.
            </p>
          )}
        </>
      )}
    </div>
  );
}
