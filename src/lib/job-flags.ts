import { olderThan } from "@/lib/format";
import { normalizeForMatch } from "@/lib/text";
import type { Job } from "@/lib/types";

/*
 * Warnings shown on a job before you apply: a low match score, and a posting that isn't from the
 * employer (no company named, a job aggregator or CV service, or a recruitment agency).
 */

/** Below this match score a job is a long shot: most of what it asks for isn't on the CV. */
export const LONG_SHOT_BELOW = 60;

export function isLongShot(score: number | undefined): score is number {
  return score !== undefined && score < LONG_SHOT_BELOW;
}

/** A posting more than this many days old has often been filled, or is being reposted. */
export const OLD_POSTING_DAYS = 30;

export function isOldPosting(job: Pick<Job, "postedAt">, now = Date.now()): boolean {
  return Boolean(job.postedAt) && olderThan(job.postedAt!, OLD_POSTING_DAYS, now);
}

export type PostingKind = "unnamed" | "aggregator" | "agency";

export interface PostingFlag {
  kind: PostingKind;
  /** A word or two for a list. */
  label: string;
  /** What it means for the application. */
  detail: string;
}

const FLAGS: Record<PostingKind, Omit<PostingFlag, "kind">> = {
  unnamed: {
    label: "No company named",
    detail:
      "The ad doesn’t say who’s hiring, so you can’t research the employer or write to them. These are often recruiters or job aggregators.",
  },
  aggregator: {
    label: "Job aggregator",
    detail:
      "Posted by a job site or CV service, not the employer. These often aren’t a live vacancy, so spend your time on the employer’s own ad if you can find it.",
  },
  agency: {
    label: "Recruitment agency",
    detail:
      "Posted by a recruitment agency for an employer it doesn’t name. Worth a call or message to the recruiter: they can tell you who it is and put you forward.",
  },
};

const UNNAMED = /^(unknown company|confidential|company confidential|anonymous|undisclosed|private( company)?|hiring company|stealth( startup)?)$/;

/** Job sites, aggregators and CV services that post other employers' jobs as their own. */
const AGGREGATORS = /\b(jobright|jobgether|lensa|tietalent|talent com|crossover|hiring cafe|jooble|adzuna|cv library|cv bridge|cv)\b/;

/** Words in an agency's name ("Halecroft Recruitment", "Dexter Talent", "Resourcery Group"). */
const AGENCY_WORDS = /\b(recruit\w*|staffing|personnel|talent|resourcing|resourcery|headhunt\w*|search and selection|appointments)\b/;

/** Agencies whose names don't say so, as the name alone or followed by more ("Robert Walters Outsourcing"). */
const AGENCIES = [
  "michael page",
  "robert walters",
  "robert half",
  "harnham",
  "adecco",
  "lorien",
  "referment",
  "randstad",
  "manpower",
  "pertemps",
  "nigel frank",
  "spencer ogden",
  "sanderson",
  "oliver james",
  "la fosse",
  "morgan mckinley",
  "goodman masson",
  "venn group",
  "brook street",
  "office angels",
  "blue arrow",
  "hamilton barnes",
  "jumar",
  "burns sheehan",
  "search consultancy",
  "gravitas",
];

/** Agencies that share a first word with other companies (Reed Construction, Hays Travel): the name alone, or with "Ltd" and the like. */
const AGENCY_NAMES = /^(reed|hays)( specialist recruitment)?( (ltd|limited|plc|uk|group))*$/;

function isAgency(company: string): boolean {
  return AGENCY_WORDS.test(company) || AGENCY_NAMES.test(company) || AGENCIES.some((name) => company === name || company.startsWith(`${name} `));
}

/** What an agency writes about the employer it's hiring for. */
const AGENCY_WORDING = /\b(on behalf of (our|a|my) client|our client(?!s)|my client(?!s))\b/i;

/** Whether a job wasn't posted by the employer itself, and what that means; undefined when it was. */
export function postingFlag(job: Pick<Job, "company" | "description">): PostingFlag | undefined {
  const company = normalizeForMatch(job.company);
  const kind: PostingKind | undefined =
    !company || UNNAMED.test(company)
      ? "unnamed"
      : AGGREGATORS.test(company)
        ? "aggregator"
        : isAgency(company) || AGENCY_WORDING.test(job.description)
          ? "agency"
          : undefined;
  return kind && { kind, ...FLAGS[kind] };
}
