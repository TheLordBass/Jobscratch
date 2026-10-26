import { z } from "zod";
import { openForHelper } from "@/lib/helper-request";
import { describeQuery, parseJobspyRows } from "@/lib/jobspy";
import { saveRunPart } from "@/lib/jobspy-runs";

export const maxDuration = 30;

const Body = z.object({
  /** The same for every part of one run. */
  id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/),
  startedAt: z.string().max(40),
  query: z.object({ search: z.array(z.string().max(100)).max(50), location: z.array(z.string().max(100)).max(10) }).optional(),
  failed: z.array(z.string().max(300)).max(200).default([]),
  // JobSpy's rows, as in a results file (scripts/jobspy/search.py). Sent a few hundred at a time.
  jobs: z.array(z.unknown()).max(1000),
  done: z.boolean(),
});

/**
 * POST /api/helper/results, for the scheduled JobSpy run on the user's computer: one part of the
 * jobs it found. The first part of a new run replaces the previous run.
 */
export async function POST(request: Request) {
  const backend = openForHelper(request);
  if (backend instanceof Response) return backend;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "That isn't a part of a JobSpy run." }, { status: 400 });
  const { jobs, skipped } = parseJobspyRows(parsed.data.jobs);
  try {
    const run = await saveRunPart(backend, { ...parsed.data, query: describeQuery(parsed.data.query), jobs });
    return Response.json({ count: run.count, skipped });
  } catch (error) {
    console.error("Couldn't save a JobSpy run", error);
    return Response.json({ error: "Couldn't save the jobs on the server. Try again shortly." }, { status: 502 });
  }
}
