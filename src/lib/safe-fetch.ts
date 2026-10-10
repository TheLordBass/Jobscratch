import { lookup } from "node:dns/promises";
import net from "node:net";

/**
 * Sites whose terms forbid automated access. The URL importer won't fetch them;
 * use the bookmarklet or extension on the page you're viewing instead.
 */
const NO_AUTOMATED_ACCESS: Array<{ pattern: RegExp; name: string }> = [
  { pattern: /(^|\.)linkedin\.com$/i, name: "LinkedIn" },
  { pattern: /(^|\.)indeed\.[a-z.]+$/i, name: "Indeed" },
  { pattern: /(^|\.)glassdoor\.[a-z.]+$/i, name: "Glassdoor" },
];

export class ImportError extends Error {
  constructor(
    message: string,
    readonly status = 400,
    readonly blockedSite?: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}

export function blockedSiteFor(hostname: string): string | undefined {
  return NO_AUTOMATED_ACCESS.find(({ pattern }) => pattern.test(hostname))?.name;
}

function ipv4ToInt(ip: string): number {
  return ip.split(".").reduce((acc, part) => (acc << 8) + Number(part), 0) >>> 0;
}

const PRIVATE_V4: Array<[string, number]> = [
  ["0.0.0.0", 8],
  ["10.0.0.0", 8],
  ["100.64.0.0", 10],
  ["127.0.0.0", 8],
  ["169.254.0.0", 16],
  ["172.16.0.0", 12],
  ["192.0.0.0", 24],
  ["192.168.0.0", 16],
  ["198.18.0.0", 15],
  ["224.0.0.0", 4],
  ["240.0.0.0", 4],
];

export function isPrivateAddress(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const value = ipv4ToInt(ip);
    return PRIVATE_V4.some(([base, bits]) => {
      const mask = bits === 0 ? 0 : (~0 << (32 - bits)) >>> 0;
      return (value & mask) === (ipv4ToInt(base) & mask);
    });
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    const mapped = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/.exec(lower);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      lower === "::" ||
      lower === "::1" ||
      /^f[cd]/.test(lower) ||
      /^fe[89ab]/.test(lower) ||
      /^ff/.test(lower)
    );
  }
  return true;
}

/** Throws unless the URL is http(s) on a default port and resolves only to public addresses. */
export async function assertPublicUrl(raw: string): Promise<URL> {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new ImportError("That doesn't look like a valid URL.");
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new ImportError("Only http and https links can be imported.");
  }
  if (url.port && url.port !== "80" && url.port !== "443") {
    throw new ImportError("Links on non-standard ports can't be imported.");
  }
  if (url.username || url.password) throw new ImportError("Links with credentials can't be imported.");
  const blocked = blockedSiteFor(url.hostname);
  if (blocked) {
    throw new ImportError(
      `${blocked} doesn't allow automated access, so JobScratch won't fetch it. Open the job in your browser and use the “Send to JobScratch” bookmarklet or extension instead.`,
      422,
      blocked,
    );
  }
  const host = url.hostname.replace(/^\[|\]$/g, "");
  if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    throw new ImportError("Local addresses can't be imported.");
  }
  const addresses = net.isIP(host) ? [{ address: host }] : await lookup(host, { all: true }).catch(() => []);
  if (addresses.length === 0) throw new ImportError("Couldn't find that website.", 502);
  if (addresses.some(({ address }) => isPrivateAddress(address))) {
    throw new ImportError("Private network addresses can't be imported.");
  }
  return url;
}

export interface FetchedPage {
  html: string;
  url: string;
}

/** Fetch a public HTML page with redirect re-validation, a size cap, and a timeout. */
export async function fetchPublicHtml(
  raw: string,
  { maxBytes = 3_000_000, maxRedirects = 4, timeoutMs = 12_000 } = {},
): Promise<FetchedPage> {
  let url = await assertPublicUrl(raw);
  const signal = AbortSignal.timeout(timeoutMs);
  for (let hop = 0; hop <= maxRedirects; hop++) {
    let response: Response;
    try {
      response = await fetch(url, {
        redirect: "manual",
        signal,
        headers: {
          "User-Agent": "Mozilla/5.0 (compatible; JobScratch/0.1; personal job import)",
          Accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (error) {
      throw new ImportError(
        signal.aborted ? "The site took too long to respond." : `Couldn't reach the site: ${(error as Error).message}`,
        502,
      );
    }
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new ImportError("The site redirected without a destination.", 502);
      url = await assertPublicUrl(new URL(location, url).toString());
      continue;
    }
    if (!response.ok) {
      throw new ImportError(
        response.status === 403 || response.status === 429
          ? `The site refused the request (HTTP ${response.status}). Use the bookmarklet or paste the job instead.`
          : `The site returned HTTP ${response.status}.`,
        502,
      );
    }
    const type = response.headers.get("content-type") ?? "";
    if (type && !/html|xml/i.test(type)) throw new ImportError("That link isn't a web page.", 415);
    return { html: await readCapped(response, maxBytes), url: url.toString() };
  }
  throw new ImportError("Too many redirects.", 502);
}

async function readCapped(response: Response, maxBytes: number): Promise<string> {
  if (!response.body) return "";
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      break;
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}
