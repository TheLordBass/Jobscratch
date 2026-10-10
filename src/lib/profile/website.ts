import { ImportError, fetchPublicHtml, type FetchedPage } from "@/lib/safe-fetch";
import { asciiLower, decodeEntities, firstElement, htmlToText, removeElements, truncate } from "@/lib/text";
import { ProfileError } from "./errors";

const PAGE_CHARS = 4000;
const TOTAL_CHARS = 12_000;
const MAX_EXTRA_PAGES = 3;
/** Only the start of each page is used, so don't read (or process) more than this. */
const PAGE_BYTES = 1_000_000;
const USEFUL_PATH = /(about|projects?|portfolio|work|case-stud|experience|resume|cv|skills)/i;
const SKIP_FILE = /\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|mov|docx?)$/i;

/**
 * Sites where many people have pages, and how many path segments name one
 * person's space (medium.com/@jane, sites.google.com/view/jane). Links outside
 * that space are someone else's.
 */
const SHARED_HOSTS: Record<string, number> = {
  "medium.com": 1,
  "dev.to": 1,
  "behance.net": 1,
  "dribbble.com": 1,
  "codepen.io": 1,
  "about.me": 1,
  "linktr.ee": 1,
  "github.com": 1,
  "gitlab.com": 1,
  "sites.google.com": 2,
};

export interface WebsiteProfile {
  url: string;
  pages: string[];
  text: string;
}

type FetchPage = (url: string) => Promise<FetchedPage>;

function bareHost(url: URL): string {
  return url.hostname.toLowerCase().replace(/^www\./, "");
}

/** The part of a shared site that belongs to the person ("/@jane"), or "" for their own site. */
function ownerPrefix(url: URL): string {
  const segments = url.pathname.split("/").filter(Boolean);
  const depth = SHARED_HOSTS[bareHost(url)] ?? (/^[@~]/.test(segments[0] ?? "") ? 1 : 0);
  return depth && segments.length >= depth ? `/${segments.slice(0, depth).join("/")}` : "";
}

/** One key per page, so "/about", "/about/" and "www." versions aren't read twice. */
function pageKey(url: URL): string {
  const path = url.pathname.replace(/\/index\.html?$/i, "").replace(/\/+$/, "");
  return `${bareHost(url)}${path || "/"}${url.search}`;
}

/** A tag's attributes, quoted or not: ` href=/about class="nav"`. */
function attributes(tag: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const match of tag.matchAll(/(?:^|\s)([^\s"'<>/=]+)\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+))/g)) {
    attrs[match[1].toLowerCase()] ??= decodeEntities(match[2] ?? match[3] ?? match[4] ?? "");
  }
  return attrs;
}

/** Page text without navigation, footers, forms or scripts. */
export function pageText(html: string): string {
  const withoutHead = removeElements(html, ["head", "title"]);
  const main = firstElement(withoutHead, "main");
  return htmlToText(removeElements(main ?? withoutHead, ["nav", "footer", "form", "svg", "iframe", "noscript"]));
}

function pageTitle(html: string): string {
  const title = /<title[^<>]{0,500}>([^<]{0,1000})/i.exec(html)?.[1] ?? "";
  let description = "";
  for (const match of html.matchAll(/<meta\s([^<>]{0,2000})>/gi)) {
    const attrs = attributes(match[1]);
    if (attrs.name?.toLowerCase() === "description" && attrs.content) {
      description = attrs.content;
      break;
    }
  }
  return [decodeEntities(title), description].map((t) => t.trim()).filter(Boolean).join(" — ");
}

/** Same-site links that look like they describe the person or their work. */
export function usefulLinks(html: string, base: URL): string[] {
  const lower = asciiLower(html);
  const prefix = ownerPrefix(base);
  const seen = new Set([pageKey(base)]);
  const links: string[] = [];
  let nextClose = -1;
  for (const match of html.matchAll(/<a\s([^<>]{0,2000})>/gi)) {
    if (links.length >= MAX_EXTRA_PAGES) break;
    const start = match.index + match[0].length;
    // Found once and reused, so pages with many unclosed links stay quick.
    if (nextClose !== Infinity && nextClose < start) {
      const found = lower.indexOf("</a>", start);
      nextClose = found === -1 ? Infinity : found;
    }
    const href = attributes(match[1]).href;
    if (!href) continue;
    let url: URL;
    try {
      url = new URL(href, base);
    } catch {
      continue;
    }
    url.hash = "";
    if (!/^https?:$/.test(url.protocol) || bareHost(url) !== bareHost(base) || SKIP_FILE.test(url.pathname)) continue;
    if (prefix && url.pathname !== prefix && !url.pathname.startsWith(`${prefix}/`)) continue;
    const label = htmlToText(html.slice(start, Math.min(nextClose, start + 1000)));
    if (!(USEFUL_PATH.test(url.pathname) || USEFUL_PATH.test(label))) continue;
    const key = pageKey(url);
    if (seen.has(key)) continue;
    seen.add(key);
    links.push(url.toString());
  }
  return links;
}

function friendly(error: unknown): ProfileError {
  if (error instanceof ImportError) {
    if (error.blockedSite) {
      return new ProfileError(`${error.blockedSite} pages can't be read automatically. Put that link on your CV instead.`);
    }
    if (error.refusedStatus) {
      return new ProfileError(
        `The site turned JobScratch away (HTTP ${error.refusedStatus}), so it can't be read automatically. Put the details you want used on your CV instead.`,
      );
    }
    return new ProfileError(error.message);
  }
  return error instanceof ProfileError ? error : new ProfileError((error as Error).message);
}

/** Read the candidate's own website: the page they gave plus a few About/Projects-style pages. */
export async function fetchWebsiteProfile(
  input: string,
  fetchPage: FetchPage = (url) => fetchPublicHtml(url, { maxBytes: PAGE_BYTES }),
): Promise<WebsiteProfile> {
  const raw = input.trim();
  const address = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  let first: FetchedPage;
  try {
    first = await fetchPage(address);
  } catch (error) {
    throw friendly(error);
  }
  const base = new URL(first.url);
  const extra = await Promise.allSettled(usefulLinks(first.html, base).map((url) => fetchPage(url)));
  // Two links can redirect to the same page.
  const byKey = new Map<string, FetchedPage>();
  for (const page of [first, ...extra.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))]) {
    const key = pageKey(new URL(page.url));
    if (!byKey.has(key)) byKey.set(key, page);
  }
  const pages = [...byKey.values()];

  const sections: string[] = [];
  let total = 0;
  for (const page of pages) {
    const text = truncate(pageText(page.html), PAGE_CHARS);
    if (!text || total >= TOTAL_CHARS) continue;
    const heading = [new URL(page.url).pathname === "/" ? page.url : new URL(page.url).pathname, pageTitle(page.html)]
      .filter(Boolean)
      .join(" — ");
    const section = `Page: ${heading}\n${truncate(text, TOTAL_CHARS - total)}`;
    sections.push(section);
    total += section.length;
  }
  if (sections.length === 0) throw new ProfileError("That website didn't have any readable text.");
  return { url: first.url, pages: pages.map((p) => p.url), text: sections.join("\n\n") };
}
