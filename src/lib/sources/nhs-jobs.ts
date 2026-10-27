import { decodeEntities, toIsoDate, toNumber } from "@/lib/text";
import type { Job, Salary } from "@/lib/types";
import { fetchText, withQuery } from "./http";
import { applyOptions, perKeyword, type JobSource } from "./types";

/*
 * NHS Jobs' public search (https://www.jobs.nhs.uk/api/v1/search_xml), which NHS Business Services
 * Authority publishes for developers to use in their own sites. It answers in XML, 10 jobs a page,
 * with a short snippet of each description: the full text is on the advert, which the bookmark or
 * Add a job → Paste a link brings in.
 */

const ENDPOINT = "https://www.jobs.nhs.uk/api/v1/search_xml";
/** Pages of 10 read per job title, so a search stays quick. */
const PAGES = 3;

/** The text inside the first <tag>…</tag> in `xml`, or "". */
function tag(xml: string, name: string): string {
  const match = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(xml);
  return match ? decodeEntities(match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).trim() : "";
}

function tags(xml: string, name: string): string[] {
  return [...xml.matchAll(new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "g"))].map((m) => decodeEntities(m[1]).trim()).filter(Boolean);
}

/** "£49387.00 to £56515.00", "£31,049 a year", "£450 a day" or "Negotiable". */
export function nhsSalary(text: string): Salary | undefined {
  if (!text) return undefined;
  const [min, max] = (text.match(/£\s?[\d,]+(?:\.\d+)?/g) ?? []).map(toNumber);
  if (!min) return { text };
  const said = /hour/i.test(text)
    ? "hour"
    : /\bday\b|daily|per diem|session/i.test(text)
      ? "day"
      : /week/i.test(text)
        ? "week"
        : /month/i.test(text)
          ? "month"
          : /year|annum|annual/i.test(text)
            ? "year"
            : undefined;
  // Bands are usually yearly; an amount this small with no period said is an hourly rate.
  const period = said ?? (min < 200 ? "hour" : "year");
  return { min, max: max && max !== min ? max : undefined, currency: "GBP", period };
}

/** One page of NHS Jobs' XML as jobs, and how many pages there are. */
export function parseNhsJobs(xml: string): { jobs: Job[]; totalPages: number } {
  const jobs: Job[] = [];
  for (const [, entry] of xml.matchAll(/<vacancyDetails>([\s\S]*?)<\/vacancyDetails>/g)) {
    const id = tag(entry, "id");
    const url = tag(entry, "url");
    if (!id || !/^https?:\/\//.test(url)) continue;
    const locations = tags(entry, "location");
    const title = tag(entry, "title");
    const closes = tag(entry, "closeDate");
    const snippet = tag(entry, "description");
    jobs.push({
      id: `nhs-jobs:${id}`,
      source: "nhs-jobs",
      sourceName: "NHS Jobs",
      title,
      company: tag(entry, "employer") || "NHS",
      location: locations.slice(0, 3).join(" / ") + (locations.length > 3 ? ` (+${locations.length - 3} more)` : ""),
      remote: /remote|home.?based|home working/i.test(`${title} ${locations.join(" ")}`),
      url,
      applyOptions: applyOptions({ label: "NHS Jobs", url }),
      // A snippet: the full advert is at the link.
      description: [snippet, closes && `Closing date: ${closes}.`].filter(Boolean).join("\n\n"),
      // Nanoseconds and no time zone, e.g. 2026-10-26T15:53:10.825496477.
      postedAt: toIsoDate(tag(entry, "postDate").slice(0, 23)),
      salary: nhsSalary(tag(entry, "salary")),
      employmentType: tag(entry, "type") || undefined,
      tags: [],
    });
  }
  return { jobs, totalPages: Number(tag(xml, "totalPages")) || 1 };
}

export const nhsJobs: JobSource = {
  id: "nhs-jobs",
  name: "NHS Jobs",
  homepage: "https://www.jobs.nhs.uk",
  category: "free",
  description: "Jobs across the NHS in England and Wales, from its public search. No key needed. UK only.",
  envKeys: [],
  keywordSearch: true,
  locationSearch: true,
  available(ctx) {
    return ctx.country === "gb" ? { ok: true } : { ok: false, reason: "NHS Jobs only lists UK jobs" };
  },
  async search(ctx) {
    return perKeyword(ctx, async (keyword) => {
      const found: Job[] = [];
      for (let page = 1; page <= PAGES; page++) {
        const xml = await fetchText(withQuery(ENDPOINT, { keyword, location: ctx.location, page }), {
          signal: ctx.signal,
          accept: "application/xml",
        });
        const { jobs, totalPages } = parseNhsJobs(xml);
        found.push(...jobs);
        if (page >= totalPages || jobs.length === 0) break;
      }
      return found;
    });
  },
};
