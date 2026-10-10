const USER_AGENT = "JobScratch/0.1 (personal job search aggregator)";
const MAX_CACHE_ENTRIES = 300;

interface CacheEntry {
  expires: number;
  value: unknown;
}

// Per-process response cache. It keeps repeat searches fast and stays inside
// the free APIs' rate limits (Remotive, for example, asks for only a few
// requests a day).
const cache = new Map<string, CacheEntry>();

export class SourceError extends Error {
  constructor(
    message: string,
    readonly status?: number,
  ) {
    super(message);
    this.name = "SourceError";
  }
}

export interface FetchJsonOptions {
  signal: AbortSignal;
  method?: "GET" | "POST";
  headers?: Record<string, string>;
  body?: unknown;
  /** How long to cache a successful response. Defaults to 15 minutes. */
  ttlMs?: number;
}

export async function fetchJson<T>(url: string, options: FetchJsonOptions): Promise<T> {
  const method = options.method ?? "GET";
  const body = options.body === undefined ? undefined : JSON.stringify(options.body);
  const cacheKey = `${method} ${url} ${body ?? ""} ${JSON.stringify(options.headers ?? {})}`;
  const cached = cache.get(cacheKey);
  if (cached && cached.expires > Date.now()) return cached.value as T;

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      signal: options.signal,
      headers: {
        "User-Agent": USER_AGENT,
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
      body,
      cache: "no-store",
    });
  } catch (error) {
    if (options.signal.aborted) throw new SourceError("Timed out");
    throw new SourceError(`Network error: ${(error as Error).message}`);
  }

  if (!response.ok) {
    const hint =
      response.status === 401 || response.status === 403
        ? " (check the API key)"
        : response.status === 429
          ? " (rate limited — try again later)"
          : "";
    throw new SourceError(`HTTP ${response.status}${hint}`, response.status);
  }

  let value: T;
  try {
    value = (await response.json()) as T;
  } catch {
    throw new SourceError("Response was not valid JSON");
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value;
    if (oldest !== undefined) cache.delete(oldest);
  }
  cache.set(cacheKey, { expires: Date.now() + (options.ttlMs ?? 15 * 60_000), value });
  return value;
}

export function clearSourceCache(): void {
  cache.clear();
}

export function withQuery(base: string, params: Record<string, string | number | boolean | undefined>): string {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== "") url.searchParams.set(key, String(value));
  }
  return url.toString();
}
