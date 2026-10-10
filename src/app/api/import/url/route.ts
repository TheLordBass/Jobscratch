import { z } from "zod";
import { ImportError, fetchPublicHtml } from "@/lib/safe-fetch";

export const maxDuration = 30;

const Body = z.object({ url: z.string().min(1).max(2000) });

/**
 * Fetches a public job page and returns its HTML. The browser then runs the
 * same extractor the bookmarklet uses (public/extractor.js) on an inert copy.
 */
export async function POST(request: Request) {
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Send { url }" }, { status: 400 });
  try {
    const page = await fetchPublicHtml(parsed.data.url.trim());
    return Response.json(page);
  } catch (error) {
    if (error instanceof ImportError) {
      return Response.json({ error: error.message, blockedSite: error.blockedSite }, { status: error.status });
    }
    console.error("URL import failed", error);
    return Response.json({ error: "Import failed" }, { status: 500 });
  }
}
