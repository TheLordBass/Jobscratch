import type { ApplicationStatus, SavedJob, StatusChange } from "@/lib/store";

/*
 * The numbers on the Progress page, worked out from your saved jobs and the
 * statuses you've given them.
 */

const APPLIED: readonly ApplicationStatus[] = ["applied", "interviewing", "offer"];
const INTERVIEWED: readonly ApplicationStatus[] = ["interviewing", "offer"];

export interface WeekCount {
  /** Monday 00:00 local time, as an ISO string. */
  start: string;
  count: number;
}

export interface SiteCount {
  name: string;
  applied: number;
  /** Applications that led to an interview or an offer. */
  interviews: number;
}

/** No reply this many days after applying counts as no reply (still Applied, but not waiting on). */
export const NO_REPLY_AFTER_DAYS = 21;

/** Applications in one group (a score band, with or without a cover letter) and how many led to an interview. */
export interface GroupCount {
  name: string;
  applied: number;
  interviews: number;
}

/** What Progress needs to know about each job beyond its status: its score, and whether a cover letter went with it. */
export interface ProgressExtras {
  scoreOf?: (entry: SavedJob) => number | undefined;
  hasLetter?: (entry: SavedJob) => boolean;
}

export const SCORE_BANDS = ["75% or more", "65–74%", "50–64%", "Under 50%", "Not scored"] as const;

function scoreBand(score: number | undefined): (typeof SCORE_BANDS)[number] {
  if (score === undefined) return "Not scored";
  if (score >= 75) return "75% or more";
  if (score >= 65) return "65–74%";
  if (score >= 50) return "50–64%";
  return "Under 50%";
}

export interface Progress {
  /** How many jobs are at each status now. */
  now: Record<ApplicationStatus, number>;
  applied: number;
  interviews: number;
  offers: number;
  /** Still Applied three weeks or more after applying. */
  noReply: number;
  /** Applications and interviews by the job's match score, best first. */
  bands: GroupCount[];
  /** With a cover letter and without. */
  letters: GroupCount[];
  /** Interviews ÷ applications, or null before any applications. */
  interviewRate: number | null;
  /** Applications per week, oldest first, ending with this week. */
  weeks: WeekCount[];
  sites: SiteCount[];
  /** Applications marked before status dates were kept, so dated by their last change instead. */
  estimated: number;
}

/** What the job has been through, oldest first, always ending with its status now. */
function historyOf(entry: SavedJob): StatusChange[] {
  const history = entry.history?.length
    ? entry.history
    : [{ status: entry.status, at: entry.status === "saved" ? entry.savedAt : entry.updatedAt }];
  const last = history[history.length - 1];
  return last.status === entry.status ? history : [...history, { status: entry.status, at: entry.updatedAt }];
}

/** When the job first reached one of these statuses, or null if it never did. */
function firstAt(history: StatusChange[], statuses: readonly ApplicationStatus[]): string | null {
  return history.find((change) => statuses.includes(change.status))?.at ?? null;
}

/** When you applied, or null if you haven't. */
export function appliedAt(entry: SavedJob): string | null {
  const history = historyOf(entry);
  // A job closed before dates were kept is most likely a rejection, so it counts as an application.
  if (!entry.history?.length && entry.status === "rejected") return entry.updatedAt;
  return firstAt(history, APPLIED);
}

/** The site a job came from, without "(JobSpy)". */
export function siteName(sourceName: string): string {
  return sourceName.replace(/\s*\(JobSpy\)\s*$/i, "").trim() || "Other";
}

/** Monday 00:00 of the week `date` is in, in local time. */
export function startOfWeek(date: Date): Date {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

const MAX_SITES = 6;

export function progressStats(saved: Record<string, SavedJob>, now = new Date(), weekCount = 8, extras: ProgressExtras = {}): Progress {
  const entries = Object.values(saved);
  const counts: Record<ApplicationStatus, number> = { saved: 0, applied: 0, interviewing: 0, offer: 0, rejected: 0 };
  for (const entry of entries) counts[entry.status] += 1;

  const thisWeek = startOfWeek(now);
  const weekStarts = Array.from({ length: weekCount }, (_, i) => {
    const start = new Date(thisWeek);
    start.setDate(start.getDate() - 7 * (weekCount - 1 - i));
    return start;
  });
  const weeks = weekStarts.map((start) => ({ start: start.toISOString(), count: 0 }));
  const end = new Date(thisWeek);
  end.setDate(end.getDate() + 7);

  const bySite = new Map<string, SiteCount>();
  let applied = 0;
  let interviews = 0;
  let offers = 0;
  let estimated = 0;
  let noReply = 0;
  const bands = new Map<string, GroupCount>(SCORE_BANDS.map((name) => [name, { name, applied: 0, interviews: 0 }]));
  const letters = new Map<string, GroupCount>(
    ["With a cover letter", "Without"].map((name) => [name, { name, applied: 0, interviews: 0 }]),
  );
  const count = (group: GroupCount | undefined, interviewed: boolean) => {
    if (!group) return;
    group.applied += 1;
    if (interviewed) group.interviews += 1;
  };

  for (const entry of entries) {
    const at = appliedAt(entry);
    if (!at) continue;
    const history = historyOf(entry);
    const interviewed = firstAt(history, INTERVIEWED) !== null;
    applied += 1;
    if (interviewed) interviews += 1;
    if (entry.status === "applied" && now.getTime() - Date.parse(at) >= NO_REPLY_AFTER_DAYS * 86_400_000) noReply += 1;
    count(bands.get(scoreBand(extras.scoreOf?.(entry))), interviewed);
    if (extras.hasLetter) count(letters.get(extras.hasLetter(entry) ? "With a cover letter" : "Without"), interviewed);
    if (firstAt(history, ["offer"])) offers += 1;
    if (!entry.history?.length) estimated += 1;

    const time = new Date(at).getTime();
    if (time < end.getTime()) {
      for (let i = weekStarts.length - 1; i >= 0; i--) {
        if (time >= weekStarts[i].getTime()) {
          weeks[i].count += 1;
          break;
        }
      }
    }

    const name = siteName(entry.job.sourceName);
    const site = bySite.get(name) ?? { name, applied: 0, interviews: 0 };
    site.applied += 1;
    if (interviewed) site.interviews += 1;
    bySite.set(name, site);
  }

  let sites = [...bySite.values()].sort(
    (a, b) => b.interviews - a.interviews || b.applied - a.applied || a.name.localeCompare(b.name),
  );
  if (sites.length > MAX_SITES) {
    const rest = sites.slice(MAX_SITES - 1);
    sites = [
      ...sites.slice(0, MAX_SITES - 1),
      {
        name: `${rest.length} other sites`,
        applied: rest.reduce((sum, site) => sum + site.applied, 0),
        interviews: rest.reduce((sum, site) => sum + site.interviews, 0),
      },
    ];
  }

  return {
    now: counts,
    applied,
    interviews,
    offers,
    noReply,
    // Only the groups with applications in them.
    bands: [...bands.values()].filter((group) => group.applied > 0),
    letters: [...letters.values()].filter((group) => group.applied > 0),
    interviewRate: applied ? interviews / applied : null,
    weeks,
    sites,
    estimated,
  };
}
