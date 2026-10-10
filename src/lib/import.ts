import { z } from "zod";
import { tidyText, toIsoDate } from "@/lib/text";
import type { Job } from "@/lib/types";

/** What public/extractor.js returns (and what the manual import form produces). */
export const ImportPayloadSchema = z.object({
  v: z.number().optional(),
  title: z.string().max(300).default(""),
  company: z.string().max(200).default(""),
  location: z.string().max(200).default(""),
  description: z.string().max(40_000).default(""),
  url: z.string().max(2000).default(""),
  sourceName: z.string().max(100).default(""),
  postedAt: z.string().max(60).optional(),
  employmentType: z.string().max(100).optional(),
  salaryText: z.string().max(200).optional(),
  remote: z.boolean().optional(),
  extractedFrom: z.string().max(40).optional(),
});

export type ImportPayload = z.infer<typeof ImportPayloadSchema>;

export const IMPORT_HASH_KEY = "job";

/** Small stable hash for ids (djb2). */
export function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i++) hash = ((hash << 5) + hash + value.charCodeAt(i)) | 0;
  return (hash >>> 0).toString(36);
}

export function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

export function payloadToJob(payload: ImportPayload): Job {
  const url = isHttpUrl(payload.url) ? payload.url : "";
  const title = tidyText(payload.title) || "Untitled job";
  const company = tidyText(payload.company) || "Unknown company";
  const sourceName = payload.sourceName || (url ? new URL(url).hostname.replace(/^www\./, "") : "Manual entry");
  return {
    id: `import:${hashString(url || `${title}|${company}`)}`,
    source: "import",
    sourceName,
    title,
    company,
    location: tidyText(payload.location),
    remote: Boolean(payload.remote) || /\bremote\b/i.test(payload.location),
    url,
    applyOptions: url ? [{ label: sourceName, url }] : [],
    description: tidyText(payload.description),
    postedAt: toIsoDate(payload.postedAt),
    salary: payload.salaryText ? { text: payload.salaryText } : undefined,
    employmentType: payload.employmentType || undefined,
    tags: [],
  };
}

/** Parse `#job=<encoded JSON>` written by the bookmarklet / extension. */
export function readImportHash(hash: string): ImportPayload | null {
  const params = new URLSearchParams(hash.replace(/^#/, ""));
  const raw = params.get(IMPORT_HASH_KEY);
  if (!raw) return null;
  try {
    const parsed = ImportPayloadSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Builds the javascript: URL for the "Send to JobScratch" bookmarklet. */
export function buildBookmarklet(extractorSource: string, appOrigin: string): string {
  const code = [
    "(function(){",
    extractorSource,
    ";var p=window.jobscratchExtract(document,location.href);",
    "if(!p||(!p.title&&!p.description)){alert('JobScratch could not find a job on this page. Select the job description text and try again.');return;}",
    `window.open(${JSON.stringify(`${appOrigin}/import#${IMPORT_HASH_KEY}=`)}+encodeURIComponent(JSON.stringify(p)),'_blank');`,
    "})();",
  ].join("\n");
  return `javascript:${encodeURIComponent(code)}`;
}
