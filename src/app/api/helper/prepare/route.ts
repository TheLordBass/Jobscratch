import { z } from "zod";
import { openForHelper } from "@/lib/helper-request";
import { prepareStep } from "@/lib/morning-prep-server";

// A step writes at most one job's CV, cover letter and answers (at the same time), or six analyses,
// or sends or reads back a batch of them.
export const maxDuration = 300;

const Body = z.object({ id: z.string().regex(/^[a-zA-Z0-9-]{8,64}$/) });

/**
 * POST /api/helper/prepare { id }, for the scheduled JobSpy run on the user's computer: one step of
 * matching its jobs and getting the best ready to apply (lib/morning-prep-server.ts). It asks again
 * until the answer's state is "done" or "off" ("waiting" says how long to wait first).
 */
export async function POST(request: Request) {
  const backend = openForHelper(request);
  if (backend instanceof Response) return backend;
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "Which run? Send its id." }, { status: 400 });
  try {
    const { prep, ...result } = await prepareStep(backend, process.env, parsed.data.id, new URL(request.url).origin);
    return Response.json({ ...result, matched: prep?.matched ?? 0, ready: prep?.ready.length ?? 0 });
  } catch (error) {
    console.error("Couldn't prepare the morning run's jobs", error);
    return Response.json({ error: "Couldn't work on the run's jobs. Trying again shortly." }, { status: 502 });
  }
}
