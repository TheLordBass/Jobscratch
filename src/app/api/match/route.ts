import { after } from "next/server";
import { z } from "zod";
import { JobNotesSchema, TailorJobSchema } from "@/lib/ai/prompts";
import { MATCH_BATCH_SIZE, hasFullDescription } from "@/lib/candidate";
import {
  enqueueMatches,
  matchQueueStatus,
  stalled,
  startStep,
  stopMatches,
} from "@/lib/match-queue-server";
import { dataBackend, storageAvailability } from "@/lib/server-data";

export const maxDuration = 60;

const Body = z.object({
  jobs: z
    .array(
      z.object({
        id: z.string().min(1).max(300),
        job: TailorJobSchema,
        notes: JobNotesSchema,
        hash: z.string().regex(/^[a-z0-9]{1,32}$/i),
      }),
    )
    .min(1)
    .max(MATCH_BATCH_SIZE),
});

function open() {
  const backend = dataBackend(process.env);
  if (!backend || storageAvailability(process.env, backend)) return null;
  return backend;
}

const OFF = () =>
  Response.json(
    { error: "Server storage is off, so the server can't match for you." },
    { status: 409 },
  );

/*
 * Match all, done by the server (lib/match-queue-server.ts). The scores arrive with the rest of the
 * synced data.
 */

/** GET: how far it's got (null when it's never run); starts a step again if the last one died. */
export async function GET(request: Request) {
  const backend = open();
  if (!backend) return OFF();
  const status = await matchQueueStatus(backend);
  if (stalled(status)) after(() => startStep(request));
  return Response.json({ status });
}

/** POST { jobs }: adds up to MATCH_BATCH_SIZE jobs to match, and starts matching them. */
export async function POST(request: Request) {
  const backend = open();
  if (!backend) return OFF();
  const parsed = Body.safeParse(await request.json().catch(() => null));
  if (!parsed.success)
    return Response.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 },
    );
  if (
    parsed.data.jobs.some(({ job }) => !hasFullDescription(job.description))
  ) {
    return Response.json(
      { error: "Only jobs with a full description can be matched." },
      { status: 422 },
    );
  }
  const status = await enqueueMatches(
    backend,
    Object.fromEntries(parsed.data.jobs.map(({ id, ...item }) => [id, item])),
  );
  // A step already going takes these on too; otherwise this starts one.
  after(() => startStep(request));
  return Response.json({ status });
}

/** DELETE: stops; the scores already made are kept. */
export async function DELETE() {
  const backend = open();
  if (!backend) return OFF();
  await stopMatches(backend);
  return Response.json({ ok: true });
}
