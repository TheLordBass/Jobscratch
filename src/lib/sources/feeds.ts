import { hashString } from "@/lib/import";
import { assertPublicUrl, readCapped } from "@/lib/safe-fetch";
import { decodeEntities, htmlToText, toIsoDate } from "@/lib/text";
import type { Job } from "@/lib/types";
import { boardsAvailability, perBoard } from "./boards";
import { applyOptions, type JobSource } from "./types";

/*
 * Employer job feeds: the RSS or Atom feeds many employers publish of their own vacancies (most
 * universities, some councils, housing associations and charities), for anyone to subscribe to.
 * You add the feed's address in Settings, and its jobs come into every search, filtered by your
 * keywords. Only the feed itself is read, never the pages it links to.
 */

const MAX_FEED_BYTES = 3_000_000;
const MAX_REDIRECTS = 3;

/** The text inside the first <name>…</name> in `xml`, without CDATA or entities. */
function tag(xml: string, name: string): string {
  const match = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i").exec(xml);
  if (!match) return "";
  const inner = match[1].trim();
  const cdata = /^<!\[CDATA\[([\s\S]*?)\]\]>$/.exec(inner);
  return cdata ? cdata[1] : decodeEntities(inner);
}

/** An Atom <link href="…"> (the alternate one, if there are several). */
function atomLink(xml: string): string {
  const links = [...xml.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1]);
  const pick = links.find((attrs) => /rel=["']alternate["']/i.test(attrs)) ?? links.find((attrs) => !/rel=/i.test(attrs)) ?? links[0];
  return pick ? decodeEntities(/href=["']([^"']+)["']/i.exec(pick)?.[1] ?? "") : "";
}

/** "Jobs at University of Greater Manchester" → "University of Greater Manchester". */
export function feedCompany(title: string, feedUrl: string): string {
  const name = title
    .replace(/^\s*(latest\s+)?(jobs|vacancies|careers|current vacancies|job vacancies)\s*(at|with|[-–:|])\s*/i, "")
    .replace(/\s*[-–:|]\s*(latest\s+)?(jobs|vacancies|careers)\s*$/i, "")
    .replace(/\s+(jobs|vacancies)$/i, "")
    .trim();
  if (name) return name;
  try {
    return new URL(feedUrl).hostname.replace(/^(www|jobs|careers|vacancies)\./, "");
  } catch {
    return "Unknown company";
  }
}

/** The jobs in an RSS 2.0 or Atom feed. */
export function parseJobFeed(xml: string, feedUrl: string): Job[] {
  const head = xml.split(/<(?:item|entry)\b/i)[0];
  const company = feedCompany(htmlToText(tag(head, "title")), feedUrl);
  const items = [...xml.matchAll(/<(item|entry)\b[\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const jobs: Job[] = [];
  for (const item of items) {
    const title = htmlToText(tag(item, "title"));
    const link = (tag(item, "link") || atomLink(item)).trim();
    if (!title || !/^https?:\/\//i.test(link)) continue;
    const body = tag(item, "content:encoded") || tag(item, "description") || tag(item, "content") || tag(item, "summary");
    const location = htmlToText(tag(item, "location") || tag(item, "job:location"));
    jobs.push({
      id: `feeds:${hashString(tag(item, "guid") || tag(item, "id") || link)}`,
      source: "feeds",
      sourceName: `${company} (feed)`,
      title,
      company,
      location,
      remote: /\bremote\b/i.test(`${title} ${location}`),
      url: link,
      applyOptions: applyOptions({ label: "Employer site", url: link }),
      description: htmlToText(body),
      postedAt: toIsoDate(tag(item, "pubDate") || tag(item, "published") || tag(item, "updated") || tag(item, "dc:date")),
      tags: [],
    });
  }
  return jobs;
}

/** A public feed's text: only public addresses, every redirect checked again, a size cap. */
async function fetchFeed(raw: string, signal: AbortSignal): Promise<string> {
  let url = await assertPublicUrl(raw);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await fetch(url, {
      redirect: "manual",
      signal,
      headers: {
        "User-Agent": "Mozilla/5.0 (compatible; JobScratch/0.1; personal job feed reader)",
        Accept: "application/rss+xml, application/atom+xml, application/xml, text/xml;q=0.9, */*;q=0.5",
      },
    });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("The feed redirected without a destination.");
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) throw new Error(`The feed returned HTTP ${response.status}.`);
    const text = await readCapped(response, MAX_FEED_BYTES);
    if (!/<(rss|feed|rdf:RDF)\b/i.test(text)) throw new Error("That address isn't an RSS or Atom feed.");
    return text;
  }
  throw new Error("The feed redirected too many times.");
}

export const feeds: JobSource = {
  id: "feeds",
  name: "Employer job feeds",
  homepage: "https://en.wikipedia.org/wiki/RSS",
  category: "company",
  description:
    "Vacancies straight from employers that publish an RSS feed of their jobs: most universities, and some councils, housing associations and charities.",
  envKeys: [],
  keywordSearch: false,
  // Feeds you chose yourself, often without a place on each job: kept whatever the location typed.
  locationSearch: true,
  available: (ctx) => boardsAvailability(ctx, "feeds"),
  async search(ctx) {
    return perBoard(ctx, "feeds", async (url) => parseJobFeed(await fetchFeed(url, ctx.signal), url));
  },
};
