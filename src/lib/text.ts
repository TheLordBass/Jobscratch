const NAMED_ENTITIES: Record<string, string> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  nbsp: " ",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  bull: "•",
  middot: "·",
  rsquo: "’",
  lsquo: "‘",
  rdquo: "”",
  ldquo: "“",
  pound: "£",
  euro: "€",
  copy: "©",
  reg: "®",
  trade: "™",
};

export function decodeEntities(input: string): string {
  return input.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (match, entity: string) => {
    if (entity[0] === "#") {
      const code =
        entity[1] === "x" || entity[1] === "X"
          ? parseInt(entity.slice(2), 16)
          : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : match;
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? match;
  });
}

/*
 * The HTML helpers below avoid lazy patterns like /<nav[\s\S]*?<\/nav>/, which
 * rescan to the end of the text for every tag that's never closed. A hostile
 * page full of unclosed tags would otherwise tie up the server.
 */

/** Lower-case A–Z only, so positions still line up with the original ("İ".toLowerCase() is 2 characters). */
export function asciiLower(text: string): string {
  return text.replace(/[A-Z]+/g, (letters) => letters.toLowerCase());
}

/** Remove every `<tag …>…</tag>` for the given tag names. */
export function removeElements(html: string, tags: string[], replacement = " "): string {
  const lower = asciiLower(html);
  const unclosed = new Set<string>();
  let out = "";
  let last = 0;
  for (const match of lower.matchAll(new RegExp(`<(${tags.join("|")})[\\s>/]`, "g"))) {
    const tag = match[1];
    if (match.index < last || unclosed.has(tag)) continue;
    const close = lower.indexOf(`</${tag}>`, match.index);
    if (close === -1) {
      unclosed.add(tag);
      continue;
    }
    out += html.slice(last, match.index) + replacement;
    last = close + tag.length + 3;
  }
  return out + html.slice(last);
}

/** The first `<tag …>…</tag>` element, if it's closed. */
export function firstElement(html: string, tag: string): string | undefined {
  const lower = asciiLower(html);
  const start = lower.search(new RegExp(`<${tag}[\\s>]`));
  if (start === -1) return undefined;
  const close = lower.indexOf(`</${tag}>`, start);
  return close === -1 ? undefined : html.slice(start, close + tag.length + 3);
}

/** Remove HTML comments; an unclosed one runs to the end, as in a browser. */
export function removeComments(html: string): string {
  let out = "";
  let last = 0;
  while (true) {
    const start = html.indexOf("<!--", last);
    if (start === -1) return out + html.slice(last);
    out += `${html.slice(last, start)} `;
    const end = html.indexOf("-->", start + 4);
    if (end === -1) return out;
    last = end + 3;
  }
}

/**
 * Convert an HTML fragment to readable plain text, keeping paragraph breaks
 * and turning list items into bullets. Handles entity-escaped HTML
 * (e.g. Greenhouse's `content` field) too.
 */
export function htmlToText(input: string | null | undefined): string {
  if (!input) return "";
  let html = input;
  if (/&lt;\/?[a-z]/i.test(html) && !/<\/?[a-z][^<>]*>/i.test(html)) {
    html = decodeEntities(html);
  }
  if (!/<[a-z!/][^<>]*>/i.test(html)) {
    return tidyText(decodeEntities(html));
  }
  const text = removeComments(removeElements(html, ["script", "style", "noscript"], ""))
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<li\b[^<>]*>/gi, "\n• ")
    .replace(/<\/li>/gi, "")
    .replace(/<\/(p|div|section|article|h[1-6]|ul|ol|tr|table|blockquote|header|footer)>/gi, "\n\n")
    .replace(/<(p|div|section|h[1-6]|ul|ol|table|blockquote)[^<>]*>/gi, "\n\n")
    .replace(/<[^<>]+>/g, "");
  return tidyText(decodeEntities(text));
}

/** Collapse runs of spaces, trim each line, and allow at most one blank line. */
export function tidyText(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t\f\v ]+/g, " ")
    .split("\n")
    .map((line) => line.trim())
    .join("\n")
    .replace(/\n• \n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  const cut = text.slice(0, max);
  const lastSpace = cut.lastIndexOf(" ");
  return `${cut.slice(0, lastSpace > max * 0.8 ? lastSpace : max).trimEnd()}…`;
}

/** Lower-case, strip punctuation (keeping + and # for terms like C++ / C#). */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9+#]+/g, " ")
    .trim();
}

function containsPhrase(haystack: string, phrase: string): boolean {
  if (!phrase) return false;
  return ` ${haystack} `.includes(` ${phrase} `);
}

export interface MatchableJob {
  title: string;
  description: string;
  tags: string[];
}

/**
 * A job matches a keyword when every word of the keyword appears in the title
 * or tags, or when the whole phrase appears in the description.
 */
export function matchesKeyword(job: MatchableJob, keyword: string): boolean {
  const phrase = normalizeForMatch(keyword);
  if (!phrase) return false;
  const titleAndTags = normalizeForMatch(`${job.title} ${job.tags.join(" ")}`);
  const words = phrase.split(" ");
  if (words.every((word) => containsPhrase(titleAndTags, word))) return true;
  return containsPhrase(normalizeForMatch(job.description), phrase);
}

export function matchesAnyKeyword(job: MatchableJob, keywords: string[]): boolean {
  return keywords.some((keyword) => matchesKeyword(job, keyword));
}

/** Whether a title contains any excluded term (e.g. "senior", "unpaid"). */
export function isExcluded(title: string, exclude: string[]): boolean {
  const normalizedTitle = normalizeForMatch(title);
  return exclude.some((term) => containsPhrase(normalizedTitle, normalizeForMatch(term)));
}

/** Rough relevance: phrase in title counts most, then words in title, then description. */
export function relevanceScore(job: MatchableJob, keywords: string[]): number {
  const title = normalizeForMatch(job.title);
  const tags = normalizeForMatch(job.tags.join(" "));
  const description = normalizeForMatch(job.description);
  let score = 0;
  for (const keyword of keywords) {
    const phrase = normalizeForMatch(keyword);
    if (!phrase) continue;
    if (containsPhrase(title, phrase)) score += 10;
    const words = phrase.split(" ");
    score += words.filter((word) => containsPhrase(title, word)).length * 2;
    if (containsPhrase(tags, phrase)) score += 3;
    if (containsPhrase(description, phrase)) score += 2;
  }
  return score;
}

/** Parse Google-style relative dates ("3 days ago", "1 hour ago") into ISO. */
export function parseRelativeDate(text: string | undefined, now = new Date()): string | undefined {
  if (!text) return undefined;
  const match = /(\d+)\+?\s*(minute|min|hour|hr|day|week|month|year)s?\s+ago/i.exec(text);
  if (!match) {
    if (/just posted|today|just now/i.test(text)) return now.toISOString();
    if (/yesterday/i.test(text)) return new Date(now.getTime() - 86_400_000).toISOString();
    return undefined;
  }
  const amount = Number(match[1]);
  const unitMs: Record<string, number> = {
    minute: 60_000,
    min: 60_000,
    hour: 3_600_000,
    hr: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };
  return new Date(now.getTime() - amount * unitMs[match[2].toLowerCase()]).toISOString();
}

/** Parse loosely-formatted dates into ISO; returns undefined if unparseable. */
export function toIsoDate(value: string | number | null | undefined): string | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  let date: Date;
  if (typeof value === "number") {
    date = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    const ddmmyyyy = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value.trim());
    if (ddmmyyyy) {
      date = new Date(Date.UTC(Number(ddmmyyyy[3]), Number(ddmmyyyy[2]) - 1, Number(ddmmyyyy[1])));
    } else if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}(:\d{2})?$/.test(value.trim())) {
      date = new Date(`${value.trim().replace(" ", "T")}Z`);
    } else {
      date = new Date(value);
    }
  }
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString();
}

export function prettifySlug(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

export function toNumber(value: unknown): number | undefined {
  if (typeof value === "number") return Number.isFinite(value) && value > 0 ? value : undefined;
  if (typeof value === "string" && value.trim()) {
    const n = Number(value.replace(/[^0-9.]/g, ""));
    return Number.isFinite(n) && n > 0 ? n : undefined;
  }
  return undefined;
}
