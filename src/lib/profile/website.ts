import { ImportError, fetchPublicHtml, type FetchedPage } from "@/lib/safe-fetch";
import { decodeEntities, htmlToText, truncate } from "@/lib/text";
import { ProfileError } from "./errors";

const PAGE_CHARS = 4000;
const TOTAL_CHARS = 12_000;
const MAX_EXTRA_PAGES = 3;
const USEFUL_PATH = /(about|projects?|portfolio|work|case-stud|experience|resume|cv|skills)/i;
const SKIP_FILE = /\.(pdf|png|jpe?g|gif|svg|webp|zip|mp4|mov|docx?)$/i;

export interface WebsiteProfile {
  url: string;
  pages: string[];
  text: string;
}

type FetchPage = (url: string) => Promise<FetchedPage>;

function sameSite(a: URL, b: URL): boolean {
  return a.hostname.replace(/^www\./, "") === b.hostname.replace(/^www\./, "");
}

/** Page text without navigation, footers, forms or scripts. */
export function pageText(html: string): string {
  const withoutHead = html.replace(/<(head|title)[\s>][\s\S]*?<\/\1>/gi, " ");
  const main = /<main[\s>][\s\S]*?<\/main>/i.exec(withoutHead)?.[0];
  const body = (main ?? withoutHead).replace(/<(nav|footer|form|svg|iframe|noscript)[\s>][\s\S]*?<\/\1>/gi, " ");
  return htmlToText(body);
}

function pageTitle(html: string): string {
  const title = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html)?.[1] ?? "";
  const description =
    /<meta[^>]+name=["']description["'][^>]*content=["']([^"']*)["']/i.exec(html)?.[1] ??
    /<meta[^>]+content=["']([^"']*)["'][^>]*name=["']description["']/i.exec(html)?.[1] ??
    "";
  return [title, description].map((t) => decodeEntities(t).trim()).filter(Boolean).join(" — ");
}

/** Same-site links that look like they describe the person or their work. */
export function usefulLinks(html: string, base: URL): string[] {
  const links = new Set<string>();
  for (const match of html.matchAll(/<a\s[^>]*href=["']([^"'#]+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    let url: URL;
    try {
      url = new URL(decodeEntities(match[1]), base);
    } catch {
      continue;
    }
    const label = htmlToText(match[2]);
    if (!/^https?:$/.test(url.protocol) || !sameSite(url, base) || SKIP_FILE.test(url.pathname)) continue;
    if (url.pathname === base.pathname || !(USEFUL_PATH.test(url.pathname) || USEFUL_PATH.test(label))) continue;
    url.hash = "";
    links.add(url.toString());
  }
  return [...links].slice(0, MAX_EXTRA_PAGES);
}

function friendly(error: unknown): ProfileError {
  if (error instanceof ImportError) {
    return new ProfileError(
      error.blockedSite
        ? `${error.blockedSite} pages can't be read automatically. Put that link on your CV instead.`
        : error.message,
    );
  }
  return error instanceof ProfileError ? error : new ProfileError((error as Error).message);
}

/** Read the candidate's own website: the page they gave plus a few About/Projects-style pages. */
export async function fetchWebsiteProfile(
  input: string,
  fetchPage: FetchPage = (url) => fetchPublicHtml(url),
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
  const pages = [first, ...extra.flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))];

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
